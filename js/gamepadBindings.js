// Single source of truth for gamepad button bindings — the controller
// counterpart to keyBindings.js. gamepad.js asks `buttonFor(action)` so a
// player can remap A/B/X and the menu button. Persists to localStorage;
// emits change events so the menu can re-render live.
//
// Movement is NOT here: the stick (90° sectors) and d-pad are fixed
// cardinal input, so only the action buttons + menu are rebindable. Menu
// is P1-only and global (any pad's menu button opens the overlay), the
// same shape keyBindings uses for Esc.
//
// Button indices follow the Standard Mapping (0 = A, 1 = B, 2 = X,
// 9 = Start, …). Absent storage falls back to defaults identical to the
// previously hard-coded layout, so existing players see no change and no
// migration is needed.

const STORAGE_KEY = "sneakbit.gamepadBindings.v1";

const UNBOUND = -1;

// Display order in the controller bindings UI. Mirrors keyBindings.ACTIONS
// minus the movement rows (stick / d-pad are fixed).
export const GAMEPAD_ACTIONS = [
  { id: "interact", label: "Interact" },
  { id: "shoot",    label: "Throw kunai" },
  { id: "melee",    label: "Melee swing" },
  { id: "menu",     label: "Open / close menu" },
];

// P2 has no menu action — the menu button is global and only P1 owns it.
export const GAMEPAD_ACTIONS_P2 = GAMEPAD_ACTIONS.filter(a => a.id !== "menu");

const DEFAULT_P1 = { interact: 0, shoot: 1, melee: 2, menu: 9 };
const DEFAULT_P2 = { interact: 0, shoot: 1, melee: 2 };
// P3 / P4 (local 4-player co-op): same A/B/X layout as P2 so a 3rd/4th
// controller works out of the box (pads map to slots by connection order).
const DEFAULT_P3 = { interact: 0, shoot: 1, melee: 2 };
const DEFAULT_P4 = { interact: 0, shoot: 1, melee: 2 };

// playerIndex (0-3) → storage key and default layout.
const SLOT_KEYS = ["p1", "p2", "p3", "p4"];
const DEFAULTS = [DEFAULT_P1, DEFAULT_P2, DEFAULT_P3, DEFAULT_P4];

let bindings = {
  p1: { ...DEFAULT_P1 }, p2: { ...DEFAULT_P2 },
  p3: { ...DEFAULT_P3 }, p4: { ...DEFAULT_P4 },
};
let loaded = false;
const listeners = new Set();

function load() {
  if (loaded) return;
  loaded = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed) {
      for (const key of SLOT_KEYS) {
        if (parsed[key]) overlayPlayer(bindings[key], parsed[key]);
      }
    }
  } catch {}
}

function overlayPlayer(target, src) {
  for (const action of Object.keys(target)) {
    const v = src[action];
    if (typeof v === "number" && Number.isInteger(v)) target[action] = v;
  }
}

function persist() {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch {}
}

function slotFor(playerIndex) {
  return bindings[SLOT_KEYS[playerIndex | 0]] || bindings.p1;
}

// Button index bound to `action` for the given player (0 = P1, 1 = P2),
// or -1 if unbound / not an action this player owns.
export function buttonFor(action, playerIndex = 0) {
  load();
  const slot = slotFor(playerIndex);
  const v = slot[action];
  return typeof v === "number" ? v : UNBOUND;
}

// The action a button index maps to for the given player, or null.
export function actionForButton(buttonIndex, playerIndex = 0) {
  load();
  if (buttonIndex < 0) return null;
  const slot = slotFor(playerIndex);
  const list = (playerIndex | 0) === 0 ? GAMEPAD_ACTIONS : GAMEPAD_ACTIONS_P2;
  for (const a of list) {
    if (slot[a.id] === buttonIndex) return a.id;
  }
  return null;
}

// P1's menu button — the global "open / close menu" button honoured on
// any connected pad. Mirrors keyBindings treating Esc as global.
export function menuButton() {
  load();
  const v = bindings.p1.menu;
  return typeof v === "number" ? v : UNBOUND;
}

// Bind `buttonIndex` to `action` for a player. Pass -1 to unbind. A button
// can only map to one action per player, so it's first cleared off this
// player's other actions (a button on the OTHER player is left alone —
// two pads can legitimately share a layout).
export function setGamepadBinding(action, buttonIndex, playerIndex = 0) {
  load();
  const slot = slotFor(playerIndex);
  if (!(action in slot)) return;
  const idx = Number.isInteger(buttonIndex) ? buttonIndex : UNBOUND;
  if (idx >= 0) {
    for (const id of Object.keys(slot)) {
      if (id !== action && slot[id] === idx) slot[id] = UNBOUND;
    }
  }
  slot[action] = idx;
  persist();
  notify();
}

export function resetGamepadBindings(playerIndex) {
  load();
  if (playerIndex == null) {
    for (let pi = 0; pi < SLOT_KEYS.length; pi++) bindings[SLOT_KEYS[pi]] = { ...DEFAULTS[pi] };
  } else {
    const pi = playerIndex | 0;
    bindings[SLOT_KEYS[pi]] = { ...DEFAULTS[pi] };
  }
  persist();
  notify();
}

export function onGamepadBindingsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

// Test-only seam.
export function _resetGamepadBindingsForTesting() {
  bindings = {
    p1: { ...DEFAULT_P1 }, p2: { ...DEFAULT_P2 },
    p3: { ...DEFAULT_P3 }, p4: { ...DEFAULT_P4 },
  };
  loaded = true;
}
