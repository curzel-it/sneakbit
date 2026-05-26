// Keyboard input. Exposes two things per tick:
//   - a queue of "press" events (transient, drained on poll)
//   - the set of directions currently held (state)
// The player module needs both: presses to distinguish tap-vs-hold and
// to queue inputs mid-step; held to keep stepping while a key is down.
//
// pollInput() also folds in gamepad input (gamepad.js) — left stick /
// d-pad fan into the same directional channel; action buttons go
// through their own callback registry (see gamepad.setGamepadAction).

import { pollGamepadDirections } from "./gamepad.js";

const KEY_MAP = {
  ArrowUp: "up",    KeyW: "up",
  ArrowDown: "down", KeyS: "down",
  ArrowLeft: "left", KeyA: "left",
  ArrowRight: "right", KeyD: "right",
};

const held = new Set();
const pressEvents = [];

export function initInput() {
  window.addEventListener("keydown", (e) => {
    const dir = KEY_MAP[e.code];
    if (!dir) return;
    e.preventDefault();
    if (e.repeat) return;
    if (!held.has(dir)) pressEvents.push(dir);
    held.add(dir);
  });
  window.addEventListener("keyup", (e) => {
    const dir = KEY_MAP[e.code];
    if (!dir) return;
    e.preventDefault();
    held.delete(dir);
  });
  window.addEventListener("blur", () => {
    held.clear();
    pressEvents.length = 0;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      held.clear();
      pressEvents.length = 0;
    }
  });
}

// Returns { events, held } and drains the press queue.
// `events` is the FIFO of press directions since the last poll.
// `held` is a fresh Set snapshot so consumers can read it freely.
export function pollInput() {
  const gp = pollGamepadDirections();
  const events = pressEvents.slice();
  pressEvents.length = 0;
  for (const e of gp.events) events.push(e);
  const mergedHeld = new Set(held);
  for (const d of gp.held) mergedHeld.add(d);
  return { events, held: mergedHeld };
}
