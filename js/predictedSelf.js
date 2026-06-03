// Guest-side authority for the guest's own avatar (guest-authoritative-
// movement.md). An in-process copy of the avatar consumes local input every
// frame via the real player model, so movement feels instant. Crucially it
// is also the *source of truth* for the avatar's tile path: after each tick
// it streams committed tile-steps + facing to the host (forwardMove), which
// validates + executes them. The host no longer guesses the path between
// input edges, so the old junction / late-stop / multi-key races are gone.
//
// Reconciliation is exact, not a fuzzy tolerance: the host echoes, per guest,
// `lastSeq` alongside the authoritative tile. We keep a committed-step log
// and compare the host's tile to the result of step #lastSeq — match means
// lockstep (any gap is just unacked in-flight steps), mismatch means a real
// divergence (rejection / knockback / host displacement) and we hard-snap.

import { createPlayer, updatePlayer } from "./player.js";
import { pollInput } from "./input.js";
import { getSelfPlayerId } from "./onlineBootstrap.js";
import { getMirrorZone, getMirrorPlayerById } from "./mirrorWorld.js";
import { getStepLog, dropAckedSteps, clearStepLog, forwardMove } from "./guestInputForwarder.js";
import { getSpecies } from "./species.js";

let predicted = null;
let installed = false;
let unsubs = [];

// Highest step seq the host has resolved for us (echoed in lastSeq).
let lastAckedSeq = 0;
// Anchor for reconciliation: the result tile of step #lastAckedSeq — where
// the host's authoritative tile *should* be. Compared against each delta's
// auth tile. Initialised to the join/snap tile (lastSeq 0 has no step).
let lastResolvedX = null;
let lastResolvedY = null;

// Emit-transition tracking. prevStepRef is the step object we last saw on
// the predicted avatar; a new object means a fresh committed step (chained
// steps each get a distinct object, so this catches chains too).
let prevStepRef = null;
let lastEmittedDir = null;

export function installPredictedSelf(net) {
  if (installed) return;
  installed = true;
  unsubs.push(net.on("snapshot", onAuth));
  unsubs.push(net.on("delta", onAuth));
}

// Production teardown — paired with installPredictedSelf. Drops net
// subscriptions and the cached predicted avatar + reconciliation state so a
// future install (e.g. after a role switch) starts from a clean slate.
export function uninstallPredictedSelf() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  installed = false;
  predicted = null;
  lastAckedSeq = 0;
  lastResolvedX = null;
  lastResolvedY = null;
  prevStepRef = null;
  lastEmittedDir = null;
}

export const _uninstallPredictedSelfForTesting = uninstallPredictedSelf;

export function getPredictedSelf() { return predicted; }
export function getLastAckedSeq() { return lastAckedSeq; }

// A self-driven mob (mirror of mobs.js::isMobAi). These are the only entries
// in the mirror's zone.entities that are BOTH lagged AND moving, so they're
// the sole cause of false collision stalls for the predicted self. Static
// rigids (buildings, rocks, closed gates) have stable positions and must
// stay as blockers.
function isMobSpecies(sp) {
  return !!sp && (sp.movement_directions === "FindHero" || sp.movement_directions === "Free");
}

// Collision view for the predicted self: the mirror zone with self-driven
// mobs stripped. Movement is predicted against static geometry (walls,
// buildings, rocks, gates) which the guest knows correctly, but NOT against
// lagged mob positions — a mob the host already walked past would otherwise
// freeze the guest's next step for a full RTT. If the guest predicts through
// a mob that IS still there, the host rejects the step and reconciliation
// snaps it back — the standard optimistic-predict tradeoff.
//
// Returns the zone unchanged (no allocation) when there are no mobs.
function predictionZone(zone) {
  const ents = zone.entities;
  if (!ents || ents.length === 0) return zone;
  let hasMob = false;
  for (const e of ents) {
    if (isMobSpecies(getSpecies(e.species_id))) { hasMob = true; break; }
  }
  if (!hasMob) return zone;
  return { ...zone, entities: ents.filter((e) => !isMobSpecies(getSpecies(e.species_id))) };
}

export const _predictionZoneForTesting = predictionZone;

// Each render frame. Drains local input, advances predicted via the existing
// player model (so it stays bit-for-bit identical to what the host computes),
// then emits any movement transition as a committed step / face to the host.
export function tickPredictedSelf(dt) {
  const zone = getMirrorZone();
  if (!zone) return;
  if (!predicted) {
    predicted = makeFromMirror();
    if (!predicted) return;
    prevStepRef = predicted.step;
    lastEmittedDir = predicted.direction;
  }
  const input = pollInput(1);
  updatePlayer(predicted, input, dt, predictionZone(zone));
  emitTransitions();
}

// Detects predicted-avatar transitions since the last tick and streams them.
//   * step null→non-null (or a chained new step) → emit a committed step.
//   * step→idle (stopped) or an idle direction change → emit a face.
function emitTransitions() {
  const step = predicted.step;
  if (step) {
    if (step !== prevStepRef) {
      forwardMove({
        k: "step",
        fx: step.fromX, fy: step.fromY,
        tx: step.toX, ty: step.toY,
        d: predicted.direction,
      });
    }
  } else if (prevStepRef) {
    // A step just ended without chaining → stopped.
    forwardMove({ k: "face", x: predicted.tileX, y: predicted.tileY, d: predicted.direction });
  } else if (predicted.direction !== lastEmittedDir) {
    // Idle direction change (pure rotate, no step).
    forwardMove({ k: "face", x: predicted.tileX, y: predicted.tileY, d: predicted.direction });
  }
  prevStepRef = step || null;
  lastEmittedDir = predicted.direction;
}

function makeFromMirror() {
  const selfId = getSelfPlayerId();
  if (!selfId) return null;
  const mp = getMirrorPlayerById(selfId);
  if (!mp) return null;
  const p = createPlayer({ index: mp.index | 0 });
  p.playerId = selfId;
  p.slot = mp.slot;
  p.tileX = mp.tileX; p.tileY = mp.tileY;
  p.x = mp.x; p.y = mp.y;
  p.direction = mp.direction || "down";
  p.step = null;
  return p;
}

function playerFromAuth(auth) {
  const p = createPlayer({ index: auth.index | 0 });
  p.playerId = getSelfPlayerId();
  p.slot = auth.slot;
  snapPredictedTo(auth, p);
  return p;
}

// Overwrite a predicted avatar's position/facing from an authoritative
// payload and clear all in-flight movement state.
function snapPredictedTo(auth, p = predicted) {
  p.tileX = auth.tileX; p.tileY = auth.tileY;
  p.x = auth.x ?? auth.tileX; p.y = auth.y ?? auth.tileY;
  p.direction = auth.direction || p.direction;
  p.step = null;
  p.queuedDir = null;
  p.pendingDir = null;
  p.pendingTimer = 0;
  p._sliding = false;
}

function onAuth(msg) {
  const selfId = getSelfPlayerId();
  if (!selfId) return;
  const auth = (msg?.players || []).find((p) => p.playerId === selfId);
  const lastSeq = msg?.lastSeq ? msg.lastSeq[selfId] : undefined;
  if (msg?.op === "snapshot") {
    // Fresh baseline (join / resync / zone change) → hard reset + clear the
    // step-log unconditionally.
    hardReset(auth, lastSeq);
    return;
  }
  if (!auth) return;
  reconcileDelta(auth, lastSeq);
}

function hardReset(auth, lastSeq) {
  clearStepLog();
  if (typeof lastSeq === "number") lastAckedSeq = lastSeq;
  if (!predicted) {
    predicted = auth ? playerFromAuth(auth) : makeFromMirror();
    if (!predicted) return;
  } else if (auth) {
    snapPredictedTo(auth);
  }
  lastResolvedX = predicted.tileX;
  lastResolvedY = predicted.tileY;
  prevStepRef = null;
  lastEmittedDir = predicted.direction;
}

function reconcileDelta(auth, lastSeq) {
  if (!predicted) { predicted = makeFromMirror(); return; }
  if (typeof lastSeq === "number" && lastSeq > lastAckedSeq) {
    // Re-anchor to the result tile of the newest resolved step BEFORE
    // dropping it from the log.
    const entry = findStep(lastSeq);
    if (entry) { lastResolvedX = entry.tx; lastResolvedY = entry.ty; }
    lastAckedSeq = lastSeq;
    dropAckedSteps(lastAckedSeq);
  }
  if (lastResolvedX == null) {
    // No anchor yet (no step resolved + never snapped) — adopt auth.
    lastResolvedX = auth.tileX;
    lastResolvedY = auth.tileY;
  }
  // Exact reconciliation: the host's authoritative tile must equal the
  // result of step #lastSeq. Equal → lockstep (any predicted/auth gap is
  // just unacked in-flight steps; no snap). Different → real divergence
  // (no-displacement rejection, knockback, host-driven move) → hard snap.
  if (auth.tileX !== lastResolvedX || auth.tileY !== lastResolvedY) {
    snapToAuth(auth);
  }
}

function snapToAuth(auth) {
  snapPredictedTo(auth);
  clearStepLog();
  lastResolvedX = predicted.tileX;
  lastResolvedY = predicted.tileY;
  prevStepRef = null;
  lastEmittedDir = predicted.direction;
  // The next frames re-commit from currently-held keys (updatePlayer reads
  // input.js slot 1), so a snap doesn't undo a key the user is still holding.
}

function findStep(seq) {
  const log = getStepLog();
  for (const e of log) if (e.seq === seq) return e;
  return null;
}
