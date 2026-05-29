// Browser Gamepad API integration.
//
// Each tick the input layer asks `pollGamepadForSlot(slot)` for that
// slot's fresh press events + held set, and feeds them into the same
// channel keyboard.js uses. Action buttons (A = interact, X = melee,
// B = shoot, Start = menu) fire one-shot callbacks registered per slot
// via `setGamepadAction(name, fn, slot)`.
//
// Pads are mapped to slots by connection order: the lowest-index
// connected pad drives slot 1 (player 1 / host), the next drives slot 2
// (local co-op P2). Online guests poll their own machine's pad on their
// own client, so only slots 1–2 are ever assigned here.
//
// Stick layout: left stick OR d-pad. Either source counts as held; a
// transition from neutral → direction emits a press event. The
// horizontal/vertical thresholds match XInput's standard deadzone
// (0.5) so a thumb resting on the stick doesn't drift the hero.
//
// Buttons follow the Standard Mapping for an Xbox-style controller:
//   0 = A    → interact (E)
//   1 = B    → shoot    (F)
//   2 = X    → melee    (G)
//   3 = Y    → unused
//   9 = Start → menu     (Esc) — dispatched as a real keydown so menu.js
//                                wires through unchanged.
// D-pad: 12 up / 13 down / 14 left / 15 right.

const STICK_THRESHOLD = 0.5;

const DIR_BUTTONS = { 12: "up", 13: "down", 14: "left", 15: "right" };
const ACTION_BUTTONS = { 0: "interact", 1: "shoot", 2: "melee" };
const START_BUTTON = 9;

// Per-slot action callbacks. Slot 1 keeps the historical single-player /
// host wiring; slot 2 is wired for local co-op P2 in main.js.
const actionCallbacks = {};

// Per-pad edge state keyed by pad.index, so press events and button
// rising edges are computed independently for each physical pad.
const padState = new Map();

export function setGamepadAction(name, fn, slot = 1) {
  const slotCbs = actionCallbacks[slot] || (actionCallbacks[slot] = {});
  if (["interact", "shoot", "melee"].includes(name)) slotCbs[name] = fn;
}

// Connected pads sorted by their hardware index, holes removed. The
// position in this list is the slot assignment (0 → slot 1, 1 → slot 2).
function connectedPadsByIndex() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return [];
  const pads = navigator.getGamepads();
  if (!pads) return [];
  return [...pads].filter(Boolean).sort((a, b) => a.index - b.index);
}

// Hardware pad.index currently driving `slot`, or -1 if no pad is
// assigned. Used by rumble.js to vibrate the right physical controller.
export function getPadIndexForSlot(slot) {
  const pad = connectedPadsByIndex()[slot - 1];
  return pad ? pad.index : -1;
}

// Returns { events, held } for the pad assigned to `slot`, draining its
// press edges and firing that slot's action callbacks. Empty when no pad
// is assigned to the slot.
export function pollGamepadForSlot(slot) {
  const pad = connectedPadsByIndex()[slot - 1];
  if (!pad) return { events: [], held: new Set() };
  return scanPad(pad, slot);
}

// Back-compat alias — slot 1 only. Kept so callers that just want the
// single-player pad don't need to know about slots.
export function pollGamepadDirections() {
  return pollGamepadForSlot(1);
}

function scanPad(pad, slot) {
  let st = padState.get(pad.index);
  if (!st) { st = { prevHeld: new Set(), prevButtons: new Map() }; padState.set(pad.index, st); }

  const held = new Set();
  const [ax, ay] = readAxes(pad);
  if (ax < -STICK_THRESHOLD) held.add("left");
  if (ax >  STICK_THRESHOLD) held.add("right");
  if (ay < -STICK_THRESHOLD) held.add("up");
  if (ay >  STICK_THRESHOLD) held.add("down");
  for (const [idx, dir] of Object.entries(DIR_BUTTONS)) {
    if (pad.buttons[idx]?.pressed) held.add(dir);
  }

  // Press events: directions newly held since last scan of this pad.
  const events = [];
  for (const dir of held) {
    if (!st.prevHeld.has(dir)) events.push(dir);
  }

  // Action buttons — fire this slot's callback on the rising edge.
  for (const [idx, name] of Object.entries(ACTION_BUTTONS)) {
    fireEdge(st, pad, idx, () => {
      const cb = actionCallbacks[slot]?.[name];
      if (cb) {
        try { cb(); } catch (e) { console.error(`gamepad ${name} cb:`, e); }
      }
    });
  }
  // Start dispatches a synthetic Esc keydown so menu.js's existing
  // listener wires through without a parallel API. Any assigned pad can
  // toggle the menu.
  fireEdge(st, pad, START_BUTTON, () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
    }
  });

  st.prevHeld = held;
  return { events, held: new Set(held) };
}

function readAxes(pad) {
  return [
    typeof pad.axes[0] === "number" ? pad.axes[0] : 0,
    typeof pad.axes[1] === "number" ? pad.axes[1] : 0,
  ];
}

function fireEdge(st, pad, idx, onRise) {
  const pressedNow = !!pad.buttons[idx]?.pressed;
  const pressedLast = !!st.prevButtons.get(idx);
  st.prevButtons.set(idx, pressedNow);
  if (pressedNow && !pressedLast) onRise();
}

// Test seam — clears per-pad edge state so a fresh test starts with no
// stale "previously held" memory between cases.
export function _resetGamepadForTesting() {
  padState.clear();
  for (const k of Object.keys(actionCallbacks)) delete actionCallbacks[k];
}
