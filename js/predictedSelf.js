// Guest-side prediction: an in-process copy of the guest's own avatar
// that consumes local input immediately, so movement feels instant even
// when the host is 200 ms away. Reconciliation against the host's
// snapshot is a hard snap when the authoritative tile diverges — for
// tile-locked stepping the disagreement set is small (walls / gates /
// doors the guest didn't know about), and snap-back is cheap.
//
// The renderer is updated separately to draw the predicted self in
// place of the mirror's lagged copy for the guest's own slot.

import { createPlayer, updatePlayer } from "./player.js";
import { pollInput, pushInputPress, clearInputHeld, clearInputState } from "./input.js";
import { getSelfPlayerId } from "./onlineBootstrap.js";
import { getMirrorZone, getMirrorPlayerById } from "./mirrorWorld.js";
import { getInputLog, dropAckedInputs } from "./guestInputForwarder.js";

let predicted = null;
let installed = false;
let lastAckedSeq = 0;
let lastAckedX = null;
let lastAckedY = null;
let unsubs = [];

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
  // Reconciliation: if the host's tile disagrees with our predicted tile
  // (within rounding tolerance), snap. Tile-locked: there's no smoothing.
  if (predicted.tileX !== auth.tileX || predicted.tileY !== auth.tileY) {
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
