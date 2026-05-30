// Keyboard input. Exposes two things per tick:
//   - a queue of "press" events (transient, drained on poll)
//   - the set of directions currently held (state)
// The player module needs both: presses to distinguish tap-vs-hold and
// to queue inputs mid-step; held to keep stepping while a key is down.
//
// pollInput() also folds in gamepad input (gamepad.js) — left stick /
// d-pad fan into the same directional channel; action buttons go
// through their own callback registry (see gamepad.setGamepadAction).

import { pollGamepadForSlot } from "./gamepad.js?v=20260530b";
import { resolveAction } from "./keyBindings.js?v=20260530b";
import { localPlayerCount, COOP_KEYMAPS } from "./coopMode.js?v=20260530b";

const ACTION_TO_DIR = {
  moveUp: "up",
  moveDown: "down",
  moveLeft: "left",
  moveRight: "right",
};

// Per-player input state. In single-player mode only index 1 is touched;
// gamepad input also feeds into player 1. In co-op, each player has its
// own held/press fed from their own keyBindings slot.
// Online co-op extends this with slots 3 / 4 driven by network input.
const state = {
  1: { held: new Set(), pressEvents: [] },
  2: { held: new Set(), pressEvents: [] },
  3: { held: new Set(), pressEvents: [] },
  4: { held: new Set(), pressEvents: [] },
};

function ensureSlot(playerIndex) {
  let s = state[playerIndex];
  if (s) return s;
  s = { held: new Set(), pressEvents: [] };
  state[playerIndex] = s;
  return s;
}

// Network-driven injection seams used by hostGuests.js to feed guest
// inputs into the existing input pipeline for slots 2..4. Same data
// shape as local keyboard presses so nothing downstream cares.
export function pushInputPress(playerIndex, direction) {
  const s = ensureSlot(playerIndex);
  if (!s.held.has(direction)) s.pressEvents.push(direction);
  s.held.add(direction);
}

export function releaseInputHeld(playerIndex, direction) {
  const s = state[playerIndex];
  if (s) s.held.delete(direction);
}

// Clears held only. Pending press events are kept so an in-flight step
// finishes — matches the spec's `stopMove` intent (release the key but
// let the press that started this step land).
export function clearInputHeld(playerIndex) {
  const s = state[playerIndex];
  if (s) s.held.clear();
}

// Clears everything (held + pending presses). Used on guest disconnect
// and window blur — there's no avatar around to consume the queue.
export function clearInputState(playerIndex) {
  const s = state[playerIndex];
  if (!s) return;
  s.held.clear();
  s.pressEvents.length = 0;
}

// Network injection: replace the slot's held set with `dirs`, leaving the
// pending press events untouched. Used by hostGuests when a guest input
// frame carries the full authoritative held set: the host needs to mirror
// the guest's `held` so HOLD_PRIORITY chains pick the same direction on
// both sides. Without this, a multi-key hold (e.g. user holding Up+Left)
// makes the guest's predicted self chain Up (HOLD_PRIORITY) while the
// host chains Left (last-pressed key) — they walk in different directions
// and divergence grows until the snap-back fires.
export function setNetworkHeld(playerIndex, dirs) {
  const s = ensureSlot(playerIndex);
  s.held.clear();
  for (const d of dirs || []) s.held.add(d);
}

// Network injection: append a press event without touching held. Pairs
// with setNetworkHeld for the press-with-known-held case so the slot's
// events queue gets the new press (for rotate / queuedDir timing)
// without redundantly mutating the held set we just synced from the wire.
export function pushPressEvent(playerIndex, direction) {
  const s = ensureSlot(playerIndex);
  s.pressEvents.push(direction);
}

// Returns { playerIndex, direction } (1-based slot) for a key event, or
// null if the code isn't a movement key for any active player.
function resolveDirection(code) {
  // Real keyboard players: keyBindings owns both P1 and (when local
  // co-op is on) P2.
  const r = resolveAction(code);
  if (r && ACTION_TO_DIR[r.action]) {
    // Only route to a local player slot that's actually active. P1 is
    // always active; P2/P3/P4 only when the local player count covers them.
    if (r.playerIndex >= 1 && (r.playerIndex + 1) > localPlayerCount()) return null;
    return { playerIndex: r.playerIndex + 1, direction: ACTION_TO_DIR[r.action] };
  }
  // Online guests (slots 3 / 4) — hostGuests synthesises keydowns with
  // F-row sentinel codes that aren't in keyBindings.
  for (const idx of [3, 4]) {
    const km = COOP_KEYMAPS[idx];
    if (!km) continue;
    for (const action of Object.keys(ACTION_TO_DIR)) {
      if (km[action] === code) return { playerIndex: idx, direction: ACTION_TO_DIR[action] };
    }
  }
  return null;
}

function pushPress(idx, dir) {
  const s = state[idx];
  if (!s.held.has(dir)) s.pressEvents.push(dir);
  s.held.add(dir);
}

function clearAll() {
  for (const idx of [1, 2, 3, 4]) {
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

// Non-draining snapshot of a slot's input state. For debug captures
// only — predictedSelf.captureDivergence reads this to record exactly
// what the local input pipeline was holding at the moment of a
// snap-back. Returning arrays (not Sets) keeps the snapshot
// JSON-serialisable for the rolling buffer on window.__sbSnapDebug.
export function peekInputState(playerIndex = 1) {
  const s = state[playerIndex];
  if (!s) return { held: [], pressEvents: [] };
  return { held: [...s.held], pressEvents: s.pressEvents.slice() };
}

// Returns { events, held } for the requested player and drains the press
// queue. Folds in the slot's gamepad for every ACTIVE local slot (1 …
// localPlayerCount), so each of up to four local players can use a pad
// (assigned by connection order). When hosting online, guest slots are
// network-driven; the host's own local count stays low so this doesn't
// fold a pad into a guest's slot.
export function pollInput(playerIndex = 1) {
  const s = state[playerIndex] || state[1];
  const events = s.pressEvents.slice();
  s.pressEvents.length = 0;
  const held = new Set(s.held);
  if (playerIndex <= localPlayerCount()) {
    const gp = pollGamepadForSlot(playerIndex);
    for (const e of gp.events) events.push(e);
    for (const d of gp.held) held.add(d);
  }
  return { events, held };
}

// Test seam — exposes the keyboard code → { playerIndex, direction }
// routing (count-gated) without needing a DOM keydown listener.
export function _resolveDirectionForTesting(code) {
  return resolveDirection(code);
}
