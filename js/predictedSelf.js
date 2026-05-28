// Guest-side prediction: an in-process copy of the guest's own avatar
// that consumes local input immediately, so movement feels instant even
// when the host is 200 ms away. Reconciliation against the host's
// snapshot is a hard snap when the authoritative tile diverges — for
// tile-locked stepping the disagreement set is small (walls / gates /
// doors the guest didn't know about), and snap-back is cheap.
//
// The renderer is updated separately to draw the predicted self in
// place of the mirror's lagged copy for the guest's own slot.

import { createPlayer, updatePlayer } from "./player.js?v=20260528g";
import { pollInput, pushInputPress, clearInputHeld, clearInputState } from "./input.js?v=20260528g";
import { getSelfPlayerId } from "./onlineBootstrap.js?v=20260528g";
import { getMirrorZone, getMirrorPlayerById } from "./mirrorWorld.js?v=20260528g";
import { getInputLog, dropAckedInputs } from "./guestInputForwarder.js?v=20260528g";

let predicted = null;
let installed = false;
let lastAckedSeq = 0;
let lastAckedX = null;
let lastAckedY = null;
let unsubs = [];

// Reconciliation tolerance: per-axis tile distance between predicted
// and auth that we accept as "normal RTT shape." Anything beyond this
// box snaps; anything inside it stays.
//
// We don't project onto predicted.direction anymore. Earlier versions
// computed a cross-product against the current direction so any
// "orthogonal" disagreement (predicted on a different lane than auth)
// snapped immediately. That looked clean in the steady-state walking
// case but exploded on direction changes: while you're walking down,
// auth naturally lags by ~1 tile *on the down axis* (RTT shape, well
// within tolerance). The moment you turn right, predicted.direction
// flips to "right" — and that same 1-tile down-axis lag suddenly
// reads as a cross-product hit (orthogonal to right) and snaps.
// Every direction change triggered a snap, because every direction
// change happened during the small window of natural along-axis lag.
//
// New rule: just bound |ddx| and |ddy| each by MAX_DIVERGENCE_TILES.
// L-shaped lag from a turn (small on both axes) is absorbed. A real
// desync (predicted off by more than 5 tiles on either axis) still
// snaps. Knockbacks of <5 tiles aren't auto-corrected by this path
// anymore — they'd need a host-side event op to trigger an explicit
// snap if we ever observe the bug.
const MAX_DIVERGENCE_TILES = 5;

export function installPredictedSelf(net) {
  if (installed) return;
  installed = true;
  unsubs.push(net.on("snapshot", onAuth));
  unsubs.push(net.on("delta", onAuth));
}

// Production teardown — paired with installPredictedSelf. Drops net
// subscriptions, the cached predicted avatar and the last-ack state so a
// future install (e.g. after a role switch) starts from a clean slate.
export function uninstallPredictedSelf() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  installed = false;
  predicted = null;
  lastAckedSeq = 0;
  lastAckedX = null;
  lastAckedY = null;
}

export const _uninstallPredictedSelfForTesting = uninstallPredictedSelf;

export function getPredictedSelf() { return predicted; }
export function getLastAckedSeq() { return lastAckedSeq; }

// Each render frame. Drains local input, advances predicted via the
// existing player update so the model stays bit-for-bit identical to
// what the host will eventually compute.
export function tickPredictedSelf(dt) {
  const zone = getMirrorZone();
  if (!zone) return;
  if (!predicted) {
    predicted = makeFromMirror();
    if (!predicted) return;
  }
  const input = pollInput(1);
  updatePlayer(predicted, input, dt, zone);
}

export function _shouldSnapForTesting(predicted, auth, _now) {
  return shouldSnap(predicted, auth);
}

// Returns true when the guest must hard-snap to auth, false when the
// disagreement is consistent with normal latency (predicted is ahead
// of auth along the move direction) and should be left to resolve on
// the next snapshot.
function shouldSnap(predicted, auth) {
  if (predicted.tileX === auth.tileX && predicted.tileY === auth.tileY) return false;
  const ddx = Math.abs(auth.tileX - predicted.tileX);
  const ddy = Math.abs(auth.tileY - predicted.tileY);
  if (ddx > MAX_DIVERGENCE_TILES) return true;
  if (ddy > MAX_DIVERGENCE_TILES) return true;
  return false;
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

function onAuth(msg) {
  const selfId = getSelfPlayerId();
  if (!selfId) return;
  const auth = (msg?.players || []).find((p) => p.playerId === selfId);
  if (!auth) return;
  const ackedSeq = (msg?.lastSeq && msg.lastSeq[selfId]) ?? lastAckedSeq;
  if (ackedSeq > lastAckedSeq) lastAckedSeq = ackedSeq;
  // Drop acked entries — they're now in the past as far as reconciliation
  // is concerned. Anything left in the log is what the host hasn't seen
  // (or hasn't applied) yet, and is what we'll replay after a snap.
  dropAckedInputs(lastAckedSeq);
  lastAckedX = auth.tileX;
  lastAckedY = auth.tileY;
  if (!predicted) {
    predicted = makeFromMirror();
    return;
  }
  // Reconciliation: snap when the host's tile differs from ours AND
  // the gap isn't just expected RTT lag along our move direction.
  // shouldSnap() decides; see its docstring for the latency-tolerance
  // shape. Without this filter, continuous motion rubber-bands the
  // guest's own avatar on every step boundary the host hasn't acked.
  if (shouldSnap(predicted, auth)) {
    predicted.tileX = auth.tileX;
    predicted.tileY = auth.tileY;
    predicted.x = auth.x;
    predicted.y = auth.y;
    predicted.direction = auth.direction || predicted.direction;
    predicted.step = null;
    // Replay the unacked input log so a snap-back doesn't undo the
    // direction the user is still holding. Without this, on a burst
    // (multiple direction changes faster than RTT) the predicted self
    // visibly rubber-bands every time a stale snapshot arrives.
    replayUnackedInputs();
  }
}

// Re-applies queued direction intents through the local input layer.
// updatePlayer is the only consumer of input state, so feeding it the
// same press events that we already sent to the host keeps prediction
// and authority converging on the same tile path.
function replayUnackedInputs() {
  const log = getInputLog();
  if (log.length === 0) return;
  // Start from a clean slot — held set may include presses the local
  // user is *still* holding, which we want to preserve at the end.
  // Walk the log in order so the final state matches the last intent.
  clearInputState(1);
  for (const { intent } of log) {
    switch (intent) {
      case "moveUp":    pushInputPress(1, "up"); break;
      case "moveDown":  pushInputPress(1, "down"); break;
      case "moveLeft":  pushInputPress(1, "left"); break;
      case "moveRight": pushInputPress(1, "right"); break;
      case "stopMove":  clearInputHeld(1); break;
      // Action intents (shoot/melee/interact) aren't predicted — the
      // host owns those side effects, so dropping them on replay is
      // correct: the originals were already sent to the host.
      default: break;
    }
  }
}
