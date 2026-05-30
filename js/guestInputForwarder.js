// Guest-side: watches the keyboard and forwards movement intents to the
// host as `input` frames. Action intents (interact / shoot / melee) ride
// the same channel and land in Phase 7. Each frame carries a monotonic
// seq for the reconciliation logic that arrives in Phase 6.

import { actionForCode } from "./keyBindings.js?v=20260530a";
import { readPadSnapshotForSlot } from "./gamepad.js?v=20260530a";

const ACTION_TO_INTENT = {
  moveUp: "moveUp",
  moveDown: "moveDown",
  moveLeft: "moveLeft",
  moveRight: "moveRight",
  interact: "interact",
  shoot: "shoot",
  melee: "melee",
};

const MOVE_INTENTS = new Set(["moveUp", "moveDown", "moveLeft", "moveRight"]);
// Discrete one-shot intents — losing one is a missed shot/swing/talk,
// which is what the buffer exists to prevent. Movement intents are
// state-derived (re-emitted from `held` on resume), so they don't need
// buffering; buffering them would actually be wrong because the player
// likely released the key during the blip.
const ACTION_INTENTS = new Set(["shoot", "melee", "interact"]);

// Must match player.js HOLD_PRIORITY. Used to predict which direction
// the chain-fallback in advanceStep will pick on the host so the
// forwarder can stamp lastSentDir to the same value the host's chain
// will choose. Wrong order here would still be self-consistent (host
// gets the full held set so chains correctly), but would cause
// spurious resends since lastSentDir wouldn't match the host's view.
const HOLD_PRIORITY = ["up", "down", "left", "right"];

// Debug-only ring of every forwarded intent (?debug=snap). Lets the
// divergence analysis reconstruct the exact input sequence + held set the
// guest sent around a turn, and time it against when the host applied it
// (auth.direction changes in the trajectory). Inert without the flag.
const SNAP_INPUT_DEBUG = typeof window !== "undefined"
  && /[?&]debug=snap\b/.test(window.location?.search || "");
const SNAP_INPUT_CAP = 96;
function recordSentInput(seq, intent, held, t) {
  if (!SNAP_INPUT_DEBUG) return;
  let buf = window.__sbSnapInput;
  if (!Array.isArray(buf)) buf = window.__sbSnapInput = [];
  buf.push({ t, seq, intent, held: Array.isArray(held) ? held.slice() : null });
  while (buf.length > SNAP_INPUT_CAP) buf.shift();
}

let net = null;
let seq = 0;
let installed = false;
const held = new Set();
let lastSentDir = null;
let onVisibilityHandler = null;
// Ring buffer of unacknowledged inputs so predictedSelf can replay
// them after a snap. Bounded so a wedged ack-stream doesn't grow it
// without limit — older entries get evicted but the bound is well
// above the ~30 Hz cap (host's lastSeq tail can't drift more than
// MAX_LOG entries before the bound bites).
const INPUT_LOG_CAP = 256;
const inputLog = [];
// Action intents (shoot/melee/interact) fired while the WS is down get
// parked here and flushed on the next welcome. Bounded — a long-dead
// connection shouldn't dump 30 shots into the host on resume. Each
// entry is stamped with wall-clock; entries older than ACTION_TTL_MS
// at flush time are dropped (a five-second-old shoot is stale).
const PENDING_ACTION_CAP = 8;
const ACTION_TTL_MS = 5000;
const pendingActions = [];

function intentToDir(intent) {
  switch (intent) {
    case "moveUp": return "up";
    case "moveDown": return "down";
    case "moveLeft": return "left";
    case "moveRight": return "right";
    default: return null;
  }
}

function dirToIntent(dir) {
  switch (dir) {
    case "up": return "moveUp";
    case "down": return "moveDown";
    case "left": return "moveLeft";
    case "right": return "moveRight";
    default: return null;
  }
}

export function installGuestInputForwarder(netIn) {
  if (installed) return;
  installed = true;
  net = netIn;
  if (typeof window === "undefined") return;
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  if (typeof document !== "undefined") {
    onVisibilityHandler = () => { if (document.hidden) onBlur(); };
    document.addEventListener("visibilitychange", onVisibilityHandler);
  }
}

// Production teardown — paired with installGuestInputForwarder. Removes
// the keyboard listeners so a role switch back to host/offline doesn't
// keep forwarding intents to a torn-down net, and clears the unacked
// input log + seq counter so the next install starts at seq 1.
export function uninstallGuestInputForwarder() {
  if (typeof window !== "undefined") {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
  }
  if (typeof document !== "undefined" && onVisibilityHandler) {
    document.removeEventListener("visibilitychange", onVisibilityHandler);
  }
  onVisibilityHandler = null;
  net = null;
  seq = 0;
  installed = false;
  held.clear();
  lastSentDir = null;
  inputLog.length = 0;
  pendingActions.length = 0;
  gpHeld.clear();
  gpButtons.interact = gpButtons.shoot = gpButtons.melee = false;
}

// Called by onlineBootstrap on every `welcome`. Drains action intents
// that fired while we were mid-reconnect (sub-TTL only) and re-emits
// the current movement direction so the host's avatar resumes walking
// without the user having to lift+repress the key. No-op if we don't
// have an active net (e.g. tear-down racing the welcome).
export function flushOnReconnect(now = Date.now()) {
  if (!net?.isConnected?.()) return;
  while (pendingActions.length) {
    const entry = pendingActions.shift();
    if (now - entry.queuedAt > ACTION_TTL_MS) continue;
    seq++;
    inputLog.push({ seq, intent: entry.intent });
    if (inputLog.length > INPUT_LOG_CAP) inputLog.shift();
    net.send({ op: "input", seq, t: now, intent: entry.intent });
  }
  // Re-emit movement so a key the user is still holding produces
  // motion again without a release+press. lastSentDir was zeroed at
  // disconnect time (clearInputHeld via onlineBootstrap teardown
  // doesn't run mid-blip, but a fresh welcome means the host's view
  // of our heading is unset).
  if (held.size > 0) {
    const dir = lastSentDir ?? effectiveDir(held) ?? [...held][0];
    lastSentDir = dir;
    const intent = dirToIntent(dir);
    if (intent) {
      const heldSnapshot = [...held];
      seq++;
      inputLog.push({ seq, intent, held: heldSnapshot });
      if (inputLog.length > INPUT_LOG_CAP) inputLog.shift();
      recordSentInput(seq, intent, heldSnapshot, now);
      net.send({ op: "input", seq, t: now, intent, held: heldSnapshot });
    }
  }
}

export function _getPendingActionsForTesting() { return pendingActions.slice(); }

export function getSeq() { return seq; }

// Snapshot copy of the unacked input log. predictedSelf reads this on
// every authoritative frame to replay after a snap-back.
export function getInputLog() { return inputLog.slice(); }

// Drop every entry with seq <= acked. Called by predictedSelf when a
// snapshot/delta brings in a fresh `lastSeq[selfId]`.
export function dropAckedInputs(ackedSeq) {
  while (inputLog.length && inputLog[0].seq <= ackedSeq) inputLog.shift();
}

// Test seams.
export function _injectKeyDownForTesting(code) { onKeyDown({ code }); }
export function _injectKeyUpForTesting(code) { onKeyUp({ code }); }
// Feeds a synthetic pad frame straight into the edge logic, bypassing
// navigator.getGamepads (absent in node). `dirs` is the held-direction
// list, `buttons` an optional { interact, shoot, melee } pressed map.
export function _injectGamepadFrameForTesting(dirs = [], buttons = {}) {
  applyGamepadSnapshot({
    held: new Set(dirs),
    interact: !!buttons.interact,
    shoot: !!buttons.shoot,
    melee: !!buttons.melee,
  });
}
export const _resetForwarderForTesting = uninstallGuestInputForwarder;

// Core movement transitions, shared by the keyboard listeners and the
// per-frame gamepad poll. Both sources mutate the one `held` set keyed by
// direction, so a press already covered by the other source is a no-op
// and a release only stops motion once nothing holds that direction.
function pressDir(dir) {
  if (held.has(dir)) return;
  held.add(dir);
  lastSentDir = dir;
  send(dirToIntent(dir), { held: [...held] });
}

function releaseDir(dir) {
  if (!held.has(dir)) return;
  held.delete(dir);
  if (held.size === 0) {
    if (lastSentDir !== null) {
      lastSentDir = null;
      send("stopMove");
    }
    return;
  }
  // One direction released but others still held. We can't drop this on
  // the floor (host wouldn't know held shrank, and would keep chaining
  // via the released direction — the multi-key divergence that motivated
  // this whole change). Emit `holdSync` so the host updates its held set
  // without pushing a spurious press event. Updating lastSentDir to the
  // new chain-winner means a future press of that same direction won't
  // re-fire a redundant moveX intent.
  lastSentDir = effectiveDir(held);
  send("holdSync", { held: [...held] });
}

function onKeyDown(e) {
  if (e.repeat) return;
  const action = actionForCode(e.code);
  const intent = action && ACTION_TO_INTENT[action];
  if (!intent) return;
  const dir = intentToDir(intent);
  if (dir) { pressDir(dir); return; }
  send(intent);
}

function onKeyUp(e) {
  const action = actionForCode(e.code);
  const intent = action && ACTION_TO_INTENT[action];
  if (!intent || !MOVE_INTENTS.has(intent)) return;
  releaseDir(intentToDir(intent));
}

// Previous-frame gamepad state for edge detection. Kept separate from the
// keyboard listeners (which are event-driven) since the pad has no events
// — we diff snapshots each frame.
const gpHeld = new Set();
const gpButtons = { interact: false, shoot: false, melee: false };

// Called once per frame from the guest loop. Reads the guest's own pad
// and forwards direction/action edges to the host through the same send
// path the keyboard uses — so a guest plays with a controller exactly
// like with the keyboard, with no wire-format change.
export function pollGuestGamepad() {
  if (!installed) return;
  applyGamepadSnapshot(readPadSnapshotForSlot(1));
}

function applyGamepadSnapshot(snap) {
  const heldNow = snap ? snap.held : new Set();
  for (const d of heldNow) if (!gpHeld.has(d)) pressDir(d);
  for (const d of [...gpHeld]) if (!heldNow.has(d)) releaseDir(d);
  gpHeld.clear();
  for (const d of heldNow) gpHeld.add(d);

  for (const name of ["interact", "shoot", "melee"]) {
    const pressedNow = !!(snap && snap[name]);
    if (pressedNow && !gpButtons[name]) send(name);
    gpButtons[name] = pressedNow;
  }
}

function effectiveDir(heldSet) {
  for (const d of HOLD_PRIORITY) {
    if (heldSet.has(d)) return d;
  }
  return null;
}

function onBlur() {
  held.clear();
  if (lastSentDir !== null) {
    lastSentDir = null;
    send("stopMove");
  }
}

function send(intent, extras) {
  if (!net?.isConnected?.()) {
    // Movement intents are state-derived; on reconnect, the still-held
    // key is re-emitted from flushOnReconnect. Buffering a moveLeft
    // that the user already released would be a phantom step.
    // Action intents are one-shot — drop = miss, so park them.
    if (ACTION_INTENTS.has(intent)) {
      if (pendingActions.length >= PENDING_ACTION_CAP) pendingActions.shift();
      pendingActions.push({ intent, queuedAt: Date.now() });
    }
    return;
  }
  seq++;
  // Carry held into the inputLog so predictedSelf.replayUnackedInputs
  // can restore the actual held set after a snap, not just the most
  // recent press direction.
  const heldSnapshot = Array.isArray(extras?.held) ? extras.held.slice() : null;
  inputLog.push(heldSnapshot ? { seq, intent, held: heldSnapshot } : { seq, intent });
  if (inputLog.length > INPUT_LOG_CAP) inputLog.shift();
  const now = Date.now();
  recordSentInput(seq, intent, heldSnapshot, now);
  net.send({ op: "input", seq, t: now, intent, ...(extras || {}) });
}
