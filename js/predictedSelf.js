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
import { pollInput } from "./input.js";
import { getSelfPlayerId } from "./onlineBootstrap.js";
import { getMirrorZone, getMirrorPlayerById } from "./mirrorWorld.js";

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

export function _uninstallPredictedSelfForTesting() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  installed = false;
  predicted = null;
  lastAckedSeq = 0;
  lastAckedX = null;
  lastAckedY = null;
}

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
  }
}
