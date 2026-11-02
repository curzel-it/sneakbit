// Guest-side authority for the guest's own avatar. An in-process copy of the
// avatar consumes local input every frame via the real player model, so
// movement feels instant. It is also the source of truth for the avatar's
// position: after each tick it streams position updates to the host
// (forwardMove), which validates and applies them.
//
// Reconciliation: the host echoes, per guest, `lastSeq` alongside the
// authoritative position. We keep a log of sent positions and compare the
// host's position to entry #lastSeq — equal means lockstep (any gap is just
// unacked in-flight updates), different means a real divergence (rejection,
// host displacement) and we hard-snap. Updates sent before a snap are not
// compared, as the host may still be applying them.

import { createPlayer, updatePlayer, placePlayer } from "./player.js";
import { pollInput } from "./input.js";
import { getSelfPlayerId } from "./onlineBootstrap.js";
import { getMirrorZone, getMirrorPlayerById } from "./mirrorWorld.js";
import { getStepLog, dropAckedSteps, clearStepLog, forwardMove, positionMove, getSeq } from "./guestInputForwarder.js";
import { getSpecies } from "./species.js";

const EMIT_INTERVAL = 0.033;
const RECONCILE_EPS = 0.01;

let predicted = null;
let installed = false;
let unsubs = [];

let lastAckedSeq = 0;
let lastResolvedX = null;
let lastResolvedY = null;
let snapSeq = 0;

let lastSent = null;
let emitTimer = 0;

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
  snapSeq = 0;
  lastSent = null;
  emitTimer = 0;
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

// Each render frame. Drains local input, advances predicted via the shared
// player model, then streams the new position to the host when it changed.
export function tickPredictedSelf(dt) {
  const zone = getMirrorZone();
  if (!zone) return;
  if (!predicted) {
    predicted = makeFromMirror();
    if (!predicted) return;
    lastSent = sentState(predicted);
  }
  const input = pollInput(1);
  updatePlayer(predicted, input, dt, predictionZone(zone));
  emitTimer += dt;
  emitPosition();
}

function sentState(p) {
  return { x: p.x, y: p.y, d: p.direction, m: !!p.moving };
}

function emitPosition() {
  const now = sentState(predicted);
  const prev = lastSent;
  const moved = !prev || now.x !== prev.x || now.y !== prev.y;
  const turned = !prev || now.d !== prev.d || now.m !== prev.m;
  if (!moved && !turned && !predicted._pushed) return;
  if (!turned && !predicted._pushed && emitTimer < EMIT_INTERVAL) return;
  if (forwardMove(positionMove(predicted)) == null) return;
  lastSent = now;
  emitTimer = 0;
}

function makeFromMirror() {
  const selfId = getSelfPlayerId();
  if (!selfId) return null;
  const mp = getMirrorPlayerById(selfId);
  if (!mp) return null;
  const p = createPlayer({ index: mp.index | 0 });
  p.playerId = selfId;
  p.slot = mp.slot;
  placePlayer(p, mp.x ?? mp.tileX, mp.y ?? mp.tileY);
  p.direction = mp.direction || "down";
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
  placePlayer(p, auth.x ?? auth.tileX, auth.y ?? auth.tileY);
  p.direction = auth.direction || p.direction;
  p.moving = false;
  p._pushed = null;
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
  markSnapped();
  // A snapshot baseline is a zone change (or a resync) — the ground moved
  // under this avatar. Arm the same hold gate the host arms on its own
  // players (transitions.movePlayerTo): a key still held from walking into
  // the door must not immediately walk back into the one we came out of,
  // which over the wire would drag the whole party back with it.
  predicted._holdGate = true;
}

function markSnapped() {
  lastResolvedX = predicted.x;
  lastResolvedY = predicted.y;
  snapSeq = getSeq();
  lastSent = sentState(predicted);
}

function reconcileDelta(auth, lastSeq) {
  if (!predicted) { predicted = makeFromMirror(); return; }
  if (typeof lastSeq === "number" && lastSeq > lastAckedSeq) {
    const entry = findStep(lastSeq);
    if (entry) { lastResolvedX = entry.x; lastResolvedY = entry.y; }
    lastAckedSeq = lastSeq;
    dropAckedSteps(lastAckedSeq);
  }
  if (lastAckedSeq <= snapSeq && lastAckedSeq < getSeq()) return;
  if (lastResolvedX == null) {
    lastResolvedX = auth.x;
    lastResolvedY = auth.y;
  }
  const ax = auth.x ?? auth.tileX, ay = auth.y ?? auth.tileY;
  if (Math.abs(ax - lastResolvedX) > RECONCILE_EPS || Math.abs(ay - lastResolvedY) > RECONCILE_EPS) {
    snapToAuth(auth);
  }
}

function snapToAuth(auth) {
  snapPredictedTo(auth);
  clearStepLog();
  markSnapped();
}

function findStep(seq) {
  const log = getStepLog();
  for (const e of log) if (e.seq === seq) return e;
  return null;
}
