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
import { actionForCode } from "./keyBindings.js";
import { isCoopMode, COOP_KEYMAPS } from "./coopMode.js";

const ACTION_TO_DIR = {
  moveUp: "up",
  moveDown: "down",
  moveLeft: "left",
  moveRight: "right",
};

// Per-player input state. In single-player mode only index 1 is touched;
// gamepad input also feeds into player 1. In co-op, each player has its
// own held/press from their own hardwired keymap (see coopMode.js).
const state = {
  1: { held: new Set(), pressEvents: [] },
  2: { held: new Set(), pressEvents: [] },
};

// Returns { playerIndex, direction } for a key event, or null if the
// code isn't a movement key for any active player.
function resolveDirection(code) {
  if (isCoopMode()) {
    for (const idx of [1, 2]) {
      const km = COOP_KEYMAPS[idx];
      for (const action of Object.keys(ACTION_TO_DIR)) {
        if (km[action] === code) return { playerIndex: idx, direction: ACTION_TO_DIR[action] };
      }
    }
    return null;
  }
  const action = actionForCode(code);
  if (!action || !ACTION_TO_DIR[action]) return null;
  return { playerIndex: 1, direction: ACTION_TO_DIR[action] };
}

function pushPress(idx, dir) {
  const s = state[idx];
  if (!s.held.has(dir)) s.pressEvents.push(dir);
  s.held.add(dir);
}

function clearAll() {
  for (const idx of [1, 2]) {
    state[idx].held.clear();
    state[idx].pressEvents.length = 0;
  }
}

export function initInput() {
  window.addEventListener("keydown", (e) => {
    const r = resolveDirection(e.code);
    if (!r) return;
    e.preventDefault();
    if (e.repeat) return;
    pushPress(r.playerIndex, r.direction);
  });
  window.addEventListener("keyup", (e) => {
    const r = resolveDirection(e.code);
    if (!r) return;
    e.preventDefault();
    state[r.playerIndex].held.delete(r.direction);
  });
  window.addEventListener("blur", clearAll);
  document.addEventListener("visibilitychange", () => { if (document.hidden) clearAll(); });
}

// Returns { events, held } for the requested player and drains the
// press queue. Player 1 also folds in gamepad input so a single-player
// session with a gamepad keeps working.
export function pollInput(playerIndex = 1) {
  const s = state[playerIndex] || state[1];
  const events = s.pressEvents.slice();
  s.pressEvents.length = 0;
  const held = new Set(s.held);
  if (playerIndex === 1) {
    const gp = pollGamepadDirections();
    for (const e of gp.events) events.push(e);
    for (const d of gp.held) held.add(d);
  }
  return { events, held };
}
