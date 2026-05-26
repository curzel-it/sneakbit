// Browser Gamepad API integration.
//
// Each tick the input layer asks `pollGamepadDirections()` for fresh
// press events + a held set, and feeds them into the same channel
// keyboard.js uses. Action buttons (A = interact, X = melee, B = shoot,
// Start = menu) fire one-shot callbacks registered via
// `setGamepadAction()`.
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

const heldGamepad = new Set();
const pressEventsGamepad = [];
let actionCallbacks = { interact: null, melee: null, shoot: null };
const buttonLastFrame = new Map();

const DIR_BUTTONS = { 12: "up", 13: "down", 14: "left", 15: "right" };

export function setGamepadAction(name, fn) {
  if (name in actionCallbacks) actionCallbacks[name] = fn;
}

// Returns { events, held } for this poll, draining the press queue.
// Safe to call when no gamepad is connected — returns empty results.
export function pollGamepadDirections() {
  scanGamepad();
  const events = pressEventsGamepad.slice();
  pressEventsGamepad.length = 0;
  return { events, held: new Set(heldGamepad) };
}

function scanGamepad() {
  if (typeof navigator === "undefined" || !navigator.getGamepads) return;
  const pads = navigator.getGamepads();
  if (!pads) return;
  // Build the per-frame snapshot of held directions across all connected
  // pads (multiple pads OR'd together — the controller layer doesn't
  // care which one moved the hero).
  const nextHeld = new Set();
  for (const pad of pads) {
    if (!pad) continue;
    // Left analog stick.
    const [ax, ay] = readAxes(pad);
    if (ax < -STICK_THRESHOLD) nextHeld.add("left");
    if (ax >  STICK_THRESHOLD) nextHeld.add("right");
    if (ay < -STICK_THRESHOLD) nextHeld.add("up");
    if (ay >  STICK_THRESHOLD) nextHeld.add("down");
    // D-pad.
    for (const [idx, dir] of Object.entries(DIR_BUTTONS)) {
      if (pad.buttons[idx]?.pressed) nextHeld.add(dir);
    }
    // Action buttons — fire on the rising edge (was up last frame,
    // pressed this frame).
    fireOnPress(pad, 0, "interact");
    fireOnPress(pad, 1, "shoot");
    fireOnPress(pad, 2, "melee");
    fireOnStartPress(pad, 9);
  }
  // Emit press events for any direction newly added since last frame.
  for (const dir of nextHeld) {
    if (!heldGamepad.has(dir)) pressEventsGamepad.push(dir);
  }
  heldGamepad.clear();
  for (const d of nextHeld) heldGamepad.add(d);
}

function readAxes(pad) {
  return [
    typeof pad.axes[0] === "number" ? pad.axes[0] : 0,
    typeof pad.axes[1] === "number" ? pad.axes[1] : 0,
  ];
}

function fireOnPress(pad, idx, name) {
  const key = `${pad.index}.${idx}`;
  const pressedNow = !!pad.buttons[idx]?.pressed;
  const pressedLast = !!buttonLastFrame.get(key);
  buttonLastFrame.set(key, pressedNow);
  if (pressedNow && !pressedLast) {
    const cb = actionCallbacks[name];
    if (cb) {
      try { cb(); } catch (e) { console.error(`gamepad ${name} cb:`, e); }
    }
  }
}

// Start button dispatches a synthetic Esc keydown so menu.js's existing
// listener wires through without us having to add a parallel API.
function fireOnStartPress(pad, idx) {
  const key = `${pad.index}.${idx}`;
  const pressedNow = !!pad.buttons[idx]?.pressed;
  const pressedLast = !!buttonLastFrame.get(key);
  buttonLastFrame.set(key, pressedNow);
  if (pressedNow && !pressedLast && typeof window !== "undefined") {
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" }));
  }
}
