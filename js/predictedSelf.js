// Guest-side prediction: an in-process copy of the guest's own avatar
// that consumes local input immediately, so movement feels instant even
// when the host is 200 ms away. Reconciliation against the host's
// snapshot is a hard snap when the authoritative tile diverges — for
// tile-locked stepping the disagreement set is small (walls / gates /
// doors the guest didn't know about), and snap-back is cheap.
//
// The renderer is updated separately to draw the predicted self in
// place of the mirror's lagged copy for the guest's own slot.

import { createPlayer, updatePlayer } from "./player.js?v=20260528d";
import { pollInput, pushInputPress, clearInputHeld, clearInputState } from "./input.js?v=20260528d";
import { getSelfPlayerId } from "./onlineBootstrap.js?v=20260528d";
import { getMirrorZone, getMirrorPlayerById } from "./mirrorWorld.js?v=20260528d";
import { getInputLog, dropAckedInputs } from "./guestInputForwarder.js?v=20260528d";

let predicted = null;
let installed = false;
let lastAckedSeq = 0;
let lastAckedX = null;
let lastAckedY = null;
let unsubs = [];
let lastMovingAt = 0;

// Reconciliation tolerance for normal RTT lag along the direction we're
// walking. During continuous chained motion the guest and host step at
// the same rate; either can briefly lead the other by a few tiles
// depending on jitter, direction changes, and which side hit a step
// boundary first. We tolerate asymmetrically along the move axis:
//
//   * Host BEHIND us along direction (predicted ran ahead): up to
//     MAX_BEHIND_TILES (5). On a high-RTT transport (WS-relay through
//     a remote VPS) predicted can naturally run a few tiles ahead
//     during a fast walk before auth catches up; the previous limit
//     of 3 was too tight and produced visible "snap back" bursts on
//     prod when network jitter spiked. See the WS-only run of
//     tests/e2e/perfPublicLong.mjs — 13- and 16-snap cascades that
//     all start with `behind > 3 → snap back`. 5 absorbs typical
//     consumer-Wi-Fi spikes; >5 tiles is still treated as real desync.
//
//   * Host AHEAD of us along direction: up to MAX_AHEAD_TILES (3).
//     This is the chained-step race case — predicted finishes step,
//     step briefly null, host's next chained auth arrives. The
//     original snap-fix used 1 here (sufficient for WebRTC's ~10 ms
//     RTT) but the WS-relay path can leave us 2-3 tiles "behind" the
//     host post-direction-change. 3 covers both.
//
// Orthogonal disagreement (cross != 0) is still a real divergence
// (predicted into a different lane than the host) and always snaps,
// regardless of along-axis distance. LATENCY_GRACE_MS keeps the same
// tolerance briefly after the user stops moving so trailing deltas
// don't yank predicted backwards.
const MAX_BEHIND_TILES = 5;
const MAX_AHEAD_TILES = 3;
const LATENCY_GRACE_MS = 500;
const DIR_VEC = {
  up:    { dx:  0, dy: -1 },
  down:  { dx:  0, dy:  1 },
  left:  { dx: -1, dy:  0 },
  right: { dx:  1, dy:  0 },
};

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
  lastMovingAt = 0;
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
  if (predicted.step) lastMovingAt = nowMs();
}

function nowMs() {
  return typeof performance !== "undefined" && performance?.now
    ? performance.now()
    : Date.now();
}

export function _shouldSnapForTesting(predicted, auth, now) {
  return shouldSnap(predicted, auth, now);
}

// Returns true when the guest must hard-snap to auth, false when the
// disagreement is consistent with normal latency (predicted is ahead
// of auth along the move direction) and should be left to resolve on
// the next snapshot.
function shouldSnap(predicted, auth, now = nowMs()) {
  if (predicted.tileX === auth.tileX && predicted.tileY === auth.tileY) return false;
  const dir = DIR_VEC[(predicted.direction || "").toLowerCase()];
  if (!dir) return true;
  const recentlyMoving = !!predicted.step || (now - lastMovingAt) <= LATENCY_GRACE_MS;
  if (!recentlyMoving) return true;
  const ddx = auth.tileX - predicted.tileX;
  const ddy = auth.tileY - predicted.tileY;
  // Orthogonal disagreement (cross product nonzero) means we predicted
  // into a different lane than the host — a real divergence, always
  // snap regardless of along-direction distance.
  const cross = Math.abs(ddx * dir.dy - ddy * dir.dx);
  if (cross !== 0) return true;
  // Project auth-relative-to-predicted onto the reverse of our direction.
  // Positive  = host is behind us along direction (we ran ahead).
  // Negative  = host is ahead of us along direction (we briefly lag).
  // Both are normal RTT shapes within a small window; only large gaps
  // mean we genuinely diverged.
  const behind = -(ddx * dir.dx + ddy * dir.dy);
  if (behind > MAX_BEHIND_TILES) return true;
  if (behind < -MAX_AHEAD_TILES) return true;
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
