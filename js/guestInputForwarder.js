// Guest-side sender to the host. Two channels:
//
//   * Action intents (interact / shoot / melee) — keyboard + gamepad
//     rising edges, sent as `{ op:"input", seq, t, intent, d }`. `d` is the
//     facing the action fires in (read from the predicted self) so the host
//     can't reorder a shoot against a separate face update.
//
//   * Position updates — emitted by predictedSelf via forwardMove() as
//     `{ op:"move", seq, k:"pos", x, y, d, m }`. The guest owns its own
//     position; the host validates + applies each update. See
//     docs/multiplayer.md.
//
// Movement is NOT watched here: local motion reaches predictedSelf through
// input.js's slot-1 keyboard listeners and pollInput(1) (which folds in the
// guest's gamepad). predictedSelf is the single place that turns that into
// position updates on the wire.

import { actionForCode } from "./keyBindings.js";
import { readPadSnapshotForSlot } from "./gamepad.js";
import { predictGuestSwing } from "./melee.js";
import { predictGuestShoot } from "./shooting.js";
import { getPredictedSelf } from "./predictedSelf.js";
import { isShopOpen } from "./shop.js";

// Discrete one-shot intents — losing one is a missed shot/swing/talk, which
// is what the pending buffer exists to prevent.
const ACTION_INTENTS = new Set(["shoot", "melee", "interact"]);

let net = null;
let seq = 0;
let installed = false;
let onVisibilityHandler = null;

// Position log: one entry per emitted update, used by predictedSelf for
// reconciliation (compare the host's authoritative position to
// stepLog[lastSeq]). Bounded so a wedged ack-stream can't grow it without
// limit.
const STEP_LOG_CAP = 256;
const stepLog = [];

// Action intents fired while the WS is down get parked here and flushed on
// the next welcome. Bounded; each entry is stamped with wall-clock and
// dropped at flush time if older than ACTION_TTL_MS.
const PENDING_ACTION_CAP = 8;
const ACTION_TTL_MS = 5000;
const pendingActions = [];

function currentFacing() {
  return getPredictedSelf()?.direction || "down";
}

export function installGuestInputForwarder(netIn) {
  if (installed) return;
  installed = true;
  net = netIn;
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", onKeyDown);
  if (typeof document !== "undefined") {
    onVisibilityHandler = () => {};
    document.addEventListener("visibilitychange", onVisibilityHandler);
  }
}

// Production teardown — paired with installGuestInputForwarder. Removes the
// keyboard listener so a role switch back to host/offline doesn't keep
// forwarding to a torn-down net, and resets the step-log + seq counter so
// the next install starts at seq 1.
export function uninstallGuestInputForwarder() {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", onKeyDown);
  }
  if (typeof document !== "undefined" && onVisibilityHandler) {
    document.removeEventListener("visibilitychange", onVisibilityHandler);
  }
  onVisibilityHandler = null;
  net = null;
  seq = 0;
  installed = false;
  stepLog.length = 0;
  pendingActions.length = 0;
  gpButtons.interact = gpButtons.shoot = gpButtons.melee = false;
}

// Called by onlineBootstrap on every `welcome`. Drains action intents that
// fired while we were mid-reconnect (sub-TTL only) and re-emits the current
// facing so the host's view of our heading is right after the blip — the
// predicted self re-commits steps from still-held keys on its own.
export function flushOnReconnect(now = Date.now()) {
  if (!net?.isConnected?.()) return;
  while (pendingActions.length) {
    const entry = pendingActions.shift();
    if (now - entry.queuedAt > ACTION_TTL_MS) continue;
    seq++;
    net.send({ op: "input", seq, t: now, intent: entry.intent, d: currentFacing() });
  }
  const p = getPredictedSelf();
  if (p) forwardMove(positionMove(p));
}

export function _getPendingActionsForTesting() { return pendingActions.slice(); }

export function getSeq() { return seq; }

// Snapshot copy of the committed-step log. predictedSelf reads this each
// authoritative frame to anchor reconciliation.
export function getStepLog() { return stepLog.slice(); }

// Drop every step-log entry with seq <= acked. Called by predictedSelf when
// a snapshot/delta brings in a fresh lastSeq[selfId].
export function dropAckedSteps(ackedSeq) {
  while (stepLog.length && stepLog[0].seq <= ackedSeq) stepLog.shift();
}

// Clears the committed-step log outright (zone change / resync hard reset).
export function clearStepLog() { stepLog.length = 0; }

/** Wire shape of a predicted avatar's position update. */
export function positionMove(p) {
  const move = { k: "pos", x: round3(p.x), y: round3(p.y), d: p.direction, m: p.moving ? 1 : 0 };
  if (p._pushed) {
    move.push = p._pushed;
    p._pushed = null;
  }
  return move;
}

function round3(n) { return Math.round(n * 1000) / 1000; }

// Emit a position update produced by predictedSelf:
//   { k:"pos", x, y, d, m, push? }
// Assigns the next seq, appends it to the log, and ships it. No-op while
// disconnected: movement is state-derived and resynced from the next
// snapshot on reconnect. Returns the assigned seq (or null when dropped).
export function forwardMove(move) {
  if (!net?.isConnected?.()) return null;
  seq++;
  stepLog.push({ seq, x: move.x, y: move.y });
  if (stepLog.length > STEP_LOG_CAP) stepLog.shift();
  net.send({ op: "move", seq, ...move });
  return seq;
}

// Test seams.
export function _injectKeyDownForTesting(code) { onKeyDown({ code }); }
// Feeds a synthetic pad frame straight into the action edge logic. `buttons`
// is an optional { interact, shoot, melee } pressed map; directions are
// ignored here (they reach predictedSelf via pollInput(1)).
export function _injectGamepadFrameForTesting(_dirs = [], buttons = {}) {
  applyGamepadSnapshot({
    interact: !!buttons.interact,
    shoot: !!buttons.shoot,
    melee: !!buttons.melee,
  });
}
export const _resetForwarderForTesting = uninstallGuestInputForwarder;

function sendAction(intent) {
  // The guest's own buy screen captures input — don't forward shoot/melee/
  // interact (or predict them) while it's open, or the avatar would fire and
  // wander on the host while the player is shopping. Mirrors the predicted-
  // self freeze in main.tickGuestFrame.
  if (isShopOpen()) return;
  // Local prediction: animate the guest's own swing / muzzle flash the
  // instant they press, rather than waiting a full RTT for the host echo.
  // The host still owns the authoritative swing/bullet via the intent.
  if (intent === "melee") predictGuestSwing(getPredictedSelf());
  if (intent === "shoot") predictGuestShoot(getPredictedSelf());
  if (!net?.isConnected?.()) {
    // One-shot — drop = miss, so park it for the reconnect flush.
    if (pendingActions.length >= PENDING_ACTION_CAP) pendingActions.shift();
    pendingActions.push({ intent, queuedAt: Date.now() });
    return;
  }
  seq++;
  net.send({ op: "input", seq, t: Date.now(), intent, d: currentFacing() });
}

function onKeyDown(e) {
  if (e.repeat) return;
  const intent = actionForCode(e.code);
  if (!ACTION_INTENTS.has(intent)) return;
  sendAction(intent);
}

// Previous-frame gamepad button state for edge detection.
const gpButtons = { interact: false, shoot: false, melee: false };

// Called once per frame from the guest loop. Reads the guest's own pad and
// forwards action-button rising edges. Directions are intentionally not
// forwarded — they drive predictedSelf through pollInput(1).
export function pollGuestGamepad() {
  if (!installed) return;
  applyGamepadSnapshot(readPadSnapshotForSlot(1));
}

function applyGamepadSnapshot(snap) {
  for (const name of ["interact", "shoot", "melee"]) {
    const pressedNow = !!(snap && snap[name]);
    if (pressedNow && !gpButtons[name]) sendAction(name);
    gpButtons[name] = pressedNow;
  }
}
