// Guest-side prediction: an in-process copy of the guest's own avatar
// that consumes local input immediately, so movement feels instant even
// when the host is 200 ms away. Reconciliation against the host's
// snapshot is a hard snap when the authoritative tile diverges — for
// tile-locked stepping the disagreement set is small (walls / gates /
// doors the guest didn't know about), and snap-back is cheap.
//
// The renderer is updated separately to draw the predicted self in
// place of the mirror's lagged copy for the guest's own slot.

import { createPlayer, updatePlayer } from "./player.js?v=20260531a";
import { pollInput, pushInputPress, clearInputHeld, clearInputState, setNetworkHeld, peekInputState } from "./input.js?v=20260531a";
import { getSelfPlayerId } from "./onlineBootstrap.js?v=20260531a";
import { getMirrorZone, getMirrorPlayerById, getMirrorPlayers } from "./mirrorWorld.js?v=20260531a";
import { getInputLog, dropAckedInputs, getSeq } from "./guestInputForwarder.js?v=20260531a";
import { shouldBeVisible } from "./entityVisibility.js?v=20260531a";
import { getValue } from "./storage.js?v=20260531a";
import { isDialogueOpen } from "./dialogue.js?v=20260531a";
import { isHostPausedRemote } from "./guestHostPause.js?v=20260531a";

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

// Debug capture for "guest stuck on host" diagnosis. Activated by adding
// `?debug=snap` to the URL. When the predicted/auth gap reaches the
// pre-snap threshold, snapshots both views' state into a rolling buffer
// on window.__sbSnapDebug. Lets us tell whether the host is stuck because
// of (a) a mirror-vs-host blocker disagreement (storage-flag-gated
// visibility), (b) a gate-key inventory disagreement, or (c) inputs not
// reaching the host at all (input-seq vs last-acked-seq).
const DEBUG_SNAP = typeof window !== "undefined"
  && /[?&]debug=snap\b/.test(window.location?.search || "");
const SNAP_DEBUG_CAPTURE_THRESHOLD = 3;
const SNAP_DEBUG_BUFFER_CAP = 16;
// Continuous trajectory ring. Unlike __sbSnapDebug (which only records
// once the gap is already >= 3 tiles), this samples EVERY auth message —
// so the log shows how the divergence *built up*, not just its frozen
// end-state. The gap between consecutive `t` values is the key tell: a
// ~1 s jump with no samples in between means deltas stopped arriving
// (host pause / tab-background / network stall) while predicted ran on.
// 80 samples covers ~12 s at the normal delta cadence (keepalive deltas
// keep it sampling even when the host's world is otherwise quiet).
const SNAP_TRAJECTORY_CAP = 80;
// Wire-event ring: one entry per incoming snapshot/delta regardless of
// whether P2 is in it. Reveals message cadence + payload during a stall
// (keepalive with players:[] vs a real delta carrying only P1). Bigger
// cap than the trajectory because keepalives fire ~5 Hz during quiet
// windows and we want the whole stall.
const SNAP_WIRE_CAP = 160;

const DEBUG_DIR_VEC = {
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
  // Record EVERY incoming snapshot/delta — before the !auth early return —
  // so a stall where the host ships keepalives (or P1-only deltas) with no
  // P2 position is visible. Without this the trajectory goes silent during
  // exactly the window we most need to see (the 5.3 s gap that grew the
  // divergence to 21 tiles), because those messages early-return here.
  if (DEBUG_SNAP) recordWireEvent(msg, selfId);
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
  if (DEBUG_SNAP) {
    recordTrajectory(predicted, auth, msg);
    captureDivergence(predicted, auth, msg);
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
  let lastHeld = null;
  for (const { intent, held } of log) {
    if (Array.isArray(held)) lastHeld = held;
    switch (intent) {
      case "moveUp":    pushInputPress(1, "up"); break;
      case "moveDown":  pushInputPress(1, "down"); break;
      case "moveLeft":  pushInputPress(1, "left"); break;
      case "moveRight": pushInputPress(1, "right"); break;
      case "stopMove":  clearInputHeld(1); break;
      // holdSync carries the new held set on the wire and was already
      // captured into lastHeld above; the events queue is unaffected.
      // Action intents (shoot/melee/interact) aren't predicted — the
      // host owns those side effects, so dropping them on replay is
      // correct: the originals were already sent to the host.
      default: break;
    }
  }
  // Without this, a multi-key hold (e.g. user holding Up+Left) would
  // collapse to whatever the last moveX touched, because pushInputPress
  // only ever adds — never reflects a release. Re-anchoring to the
  // latest authoritative held set restores the actual two-key state.
  if (lastHeld) setNetworkHeld(1, lastHeld);
}

// Compact per-auth-message sample appended to window.__sbSnapTrajectory.
// Keys are terse on purpose — this fires on every delta, so the buffer
// stays small enough to copy whole. Read it bottom-up alongside
// __sbSnapDebug: the trajectory shows the lead-up, the captures show the
// snap. `un` is the unacked-input count; `dlg`/`hp` are the gate flags
// at sample time so a pause that cleared before the snap is still visible.
function recordTrajectory(predicted, auth, msg) {
  if (typeof window === "undefined") return;
  let buf = window.__sbSnapTrajectory;
  if (!Array.isArray(buf)) buf = window.__sbSnapTrajectory = [];
  // Local slot-1 input state — the guest's own keyboard. Compared against
  // auth.direction this shows whether, at a turn, predicted's held set +
  // direction-choice match what the host ended up doing. If they pick the
  // same direction but land on different tiles, the offset is pure
  // prediction-lead (expected); if held/choice differ, it's a forwarding
  // bug. qd/pend/pt expose the rotate-commit machinery mid-turn.
  const slot1 = peekInputState(1);
  const h1 = describeMirrorSlot1();
  buf.push({
    t: Date.now(),
    op: msg?.op,
    ax: auth.tileX, ay: auth.tileY, ad: auth.direction,
    px: predicted.tileX, py: predicted.tileY, pd: predicted.direction,
    step: predicted.step ? 1 : 0,
    qd: predicted.queuedDir ?? null,
    pend: predicted.pendingDir ?? null,
    pt: predicted.pendingTimer ?? 0,
    hl: slot1.held,
    pe: slot1.pressEvents,
    // Host's own avatar (mirror slot 1). If P1 keeps moving through a
    // stall, real deltas were flowing (P2 sig-filtered out); if P1 is
    // also frozen, the host was emitting empty keepalives.
    hx: h1?.tileX ?? null, hy: h1?.tileY ?? null, hd: h1?.direction ?? null,
    ddx: Math.abs(auth.tileX - predicted.tileX),
    ddy: Math.abs(auth.tileY - predicted.tileY),
    dlg: safeBool(isDialogueOpen) ? 1 : 0,
    hp: safeBool(isHostPausedRemote) ? 1 : 0,
    seq: getSeq(),
    ack: lastAckedSeq,
    un: getInputLog().length,
  });
  while (buf.length > SNAP_TRAJECTORY_CAP) buf.shift();
}

// One entry per incoming snapshot/delta, recorded before onAuth's
// !auth early return. `self` is whether P2 was in this message at all;
// `ids` lists who was. During the stall we expect a run of entries with
// self=false (keepalive players:[] → np:0, or P1-only delta → np:1,
// self:false) — that run is the host failing to tell the guest where
// its avatar is while predicted runs on.
function recordWireEvent(msg, selfId) {
  if (typeof window === "undefined") return;
  let buf = window.__sbSnapWire;
  if (!Array.isArray(buf)) buf = window.__sbSnapWire = [];
  const players = Array.isArray(msg?.players) ? msg.players : [];
  buf.push({
    t: Date.now(),
    op: msg?.op,
    np: players.length,
    ids: players.map((p) => p.playerId),
    self: players.some((p) => p.playerId === selfId),
    lseq: (msg?.lastSeq && selfId) ? (msg.lastSeq[selfId] ?? null) : null,
  });
  while (buf.length > SNAP_WIRE_CAP) buf.shift();
}

function captureDivergence(predicted, auth, msg) {
  try {
    const ddx = Math.abs(auth.tileX - predicted.tileX);
    const ddy = Math.abs(auth.tileY - predicted.tileY);
    if (ddx < SNAP_DEBUG_CAPTURE_THRESHOLD && ddy < SNAP_DEBUG_CAPTURE_THRESHOLD) return;
    const buf = ensureDebugBuffer();
    const last = buf[buf.length - 1];
    if (last
      && last.auth.tileX === auth.tileX && last.auth.tileY === auth.tileY
      && last.predicted.tileX === predicted.tileX && last.predicted.tileY === predicted.tileY) return;

    const mirror = getMirrorZone();
    const authDir = (auth.direction || predicted.direction || "down").toLowerCase();
    const predDir = (predicted.direction || "down").toLowerCase();
    const authVec = DEBUG_DIR_VEC[authDir] || { dx: 0, dy: 0 };
    const predVec = DEBUG_DIR_VEC[predDir] || { dx: 0, dy: 0 };
    const authFrontX = auth.tileX + authVec.dx;
    const authFrontY = auth.tileY + authVec.dy;
    const predFrontX = predicted.tileX + predVec.dx;
    const predFrontY = predicted.tileY + predVec.dy;

    const entry = {
      t: Date.now(),
      ddx, ddy,
      msgOp: msg?.op,
      msgZoneId: msg?.zoneId,
      mirrorZoneId: mirror?.id,
      auth: { tileX: auth.tileX, tileY: auth.tileY, direction: auth.direction },
      predicted: {
        tileX: predicted.tileX,
        tileY: predicted.tileY,
        direction: predicted.direction,
        hasStep: !!predicted.step,
        queuedDir: predicted.queuedDir ?? null,
        pendingDir: predicted.pendingDir ?? null,
        pendingTimer: predicted.pendingTimer ?? 0,
      },
      authFront: {
        x: authFrontX,
        y: authFrontY,
        entities: describeEntitiesAt(mirror, authFrontX, authFrontY),
      },
      predictedFront: {
        x: predFrontX,
        y: predFrontY,
        entities: describeEntitiesAt(mirror, predFrontX, predFrontY),
      },
      // Tile predicted would step into next on a held=down/up/left/right
      // press. If that tile shows blockers/non-walkable when the host's
      // tile is clear, predicted's chain-break sticks even while auth
      // keeps moving — exactly the "predicted frozen, auth advancing"
      // shape we're chasing.
      predictedNextStep: describeStepTargets(mirror, predicted),
      input: {
        currentSeq: getSeq(),
        lastAckedSeq,
        unackedCount: getInputLog().length,
        // Slot 1 = guest's own predicted self. If the guest is holding
        // a key but `held` here doesn't include it, the local keydown
        // never reached input.js (e.g. focus on another element, OS-
        // level interception, or an event-eating overlay).
        localSlot1: peekInputState(1),
        // Full unacked log contents (not just the count) — the exact
        // intents + held sets the host hasn't applied yet. At a turn this
        // shows precisely which press is mid-flight and what held set it
        // carried, so the commit-tile offset can be tied to a real input.
        unacked: getInputLog(),
      },
      // The predicted tick is gated on isDialogueOpen() in main.js.
      // If a stale dialogue/pause flag is what's freezing predicted,
      // this proves it. hostPaused is the authoritative signal —
      // the host broadcasts it as event:hostPause on every edge.
      gating: {
        dialogueOpen: safeBool(isDialogueOpen),
        hostPausedRemote: safeBool(isHostPausedRemote),
      },
      // Mirror's view of the host's own avatar (slot 1 in mirror
      // coords). When auth is at (X, Y) and we want to know whether
      // the host's player1 is sitting in slot 2's path on host, this
      // is the only signal the guest has — it's lagged by interp
      // delay but still close enough for the "is P1 blocking P2"
      // diagnosis.
      hostMirrorSlot1: describeMirrorSlot1(),
      storageHints: collectStorageHints(mirror, authFrontX, authFrontY),
    };
    buf.push(entry);
    while (buf.length > SNAP_DEBUG_BUFFER_CAP) buf.shift();
    if (typeof console !== "undefined") {
      console.warn(`[sbSnap] divergence ddx=${ddx} ddy=${ddy}`
        + ` authFront=(${authFrontX},${authFrontY})`
        + ` blockers=${entry.authFront.entities.length}`
        + ` unacked=${entry.input.unackedCount}`,
        entry);
    }
  } catch (e) {
    if (typeof console !== "undefined") console.warn("[sbSnap] capture failed", e);
  }
}

function ensureDebugBuffer() {
  if (typeof window === "undefined") return [];
  if (!Array.isArray(window.__sbSnapDebug)) window.__sbSnapDebug = [];
  return window.__sbSnapDebug;
}

function describeEntitiesAt(zone, tx, ty) {
  if (!zone?.entities) return [];
  const out = [];
  for (const e of zone.entities) {
    const f = e.frame;
    if (!f) continue;
    if (tx < f.x || tx >= f.x + f.w) continue;
    if (ty < f.y || ty >= f.y + f.h) continue;
    let visible = null;
    try { visible = shouldBeVisible(e); } catch { visible = "throw"; }
    out.push({
      id: e.id,
      species_id: e.species_id,
      frame: { x: f.x, y: f.y, w: f.w, h: f.h },
      direction: e.direction,
      _open: e._open,
      _dead: e._dead,
      _spawned: e._spawned,
      _invisible: e._invisible,
      lock_type: e.lock_type,
      display_conditions: e.display_conditions,
      shouldBeVisible: visible,
    });
  }
  return out;
}

function safeBool(fn) {
  try { return !!fn(); } catch { return null; }
}

function describeStepTargets(zone, predicted) {
  const out = {};
  if (!predicted) return out;
  for (const [dir, vec] of Object.entries(DEBUG_DIR_VEC)) {
    const tx = predicted.tileX + vec.dx;
    const ty = predicted.tileY + vec.dy;
    out[dir] = {
      x: tx,
      y: ty,
      entities: describeEntitiesAt(zone, tx, ty),
    };
  }
  return out;
}

function describeMirrorSlot1() {
  try {
    const players = getMirrorPlayers();
    const slot1 = (players || []).find((p) => (p?.slot | 0) === 1);
    if (!slot1) return null;
    return {
      tileX: slot1.tileX,
      tileY: slot1.tileY,
      direction: slot1.direction,
      playerId: slot1.playerId,
    };
  } catch {
    return null;
  }
}

function collectStorageHints(zone, tx, ty) {
  const out = {};
  if (!zone?.entities) return out;
  for (const e of zone.entities) {
    const f = e.frame;
    if (!f) continue;
    if (tx < f.x || tx >= f.x + f.w) continue;
    if (ty < f.y || ty >= f.y + f.h) continue;
    if (e.id != null) {
      const k = `item_collected.${e.id}`;
      out[k] = getValue(k);
    }
    const conds = e.display_conditions;
    if (Array.isArray(conds)) {
      for (const c of conds) {
        if (c?.key && !(c.key in out)) out[c.key] = getValue(c.key);
      }
    }
  }
  return out;
}
