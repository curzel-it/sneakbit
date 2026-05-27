// Single source of truth for keyboard bindings. Every feature that
// listens on a hardcoded `e.code` should ask `codesFor(action)` instead
// so the player can rebind it. Persists to localStorage; emits change
// events so listeners can rewire the keymap live (no reload needed).
//
// v2 layout supports two local players: bindings are stored as
// `{ p1: {...}, p2: {...} }`. P1 owns the menu binding (Esc); P2 has no
// menu action — Esc is global. The v1 → v2 migration treats the old flat
// map as P1's bindings, drops the legacy KeyM → menu default so P2's
// melee key doesn't pop the pause overlay, then writes the v2 blob.
//
// This isn't in the Rust build — desktop SneakBit hardcodes WASD/arrows
// and the action keys; the HTML port adds it because rebinding is a
// reasonable expectation for keyboard play, and the no-build-step
// architecture makes it cheap to wire one module through everywhere.

const STORAGE_KEY = "sneakbit.keyBindings.v2";
const LEGACY_STORAGE_KEY = "sneakbit.keyBindings.v1";

// Display order in the settings UI.
export const ACTIONS = [
  { id: "moveUp",    label: "Move up" },
  { id: "moveDown",  label: "Move down" },
  { id: "moveLeft",  label: "Move left" },
  { id: "moveRight", label: "Move right" },
  { id: "interact",  label: "Interact" },
  { id: "shoot",     label: "Throw kunai" },
  { id: "melee",     label: "Melee swing" },
  { id: "menu",      label: "Open / close menu" },
];

// P2 has no menu action — Esc is global and only P1 owns the rebindable
// "menu" slot. The local-coop two-player keyboard setup also wants the
// menu key reserved for P1 so a stray press doesn't pause the game on
// the other player's behalf.
export const ACTIONS_P2 = ACTIONS.filter(a => a.id !== "menu");

// P1 defaults avoid every key in DEFAULT_P2 below so a fresh save in
// local co-op has zero overlap between the two players' keymaps. That
// means no KeyJ/KeyK secondary on shoot/melee (those would collide with
// P2's moveLeft / moveDown), no KeyM on menu (P2's melee), and so on.
const DEFAULT_P1 = {
  moveUp:    ["ArrowUp",    "KeyW"],
  moveDown:  ["ArrowDown",  "KeyS"],
  moveLeft:  ["ArrowLeft",  "KeyA"],
  moveRight: ["ArrowRight", "KeyD"],
  interact:  ["KeyE",       "Enter"],
  shoot:     ["KeyF",       ""],
  melee:     ["KeyG",       ""],
  menu:      ["Escape",     ""],
};

const DEFAULT_P2 = {
  moveUp:    ["KeyI",       ""],
  moveDown:  ["KeyK",       ""],
  moveLeft:  ["KeyJ",       ""],
  moveRight: ["KeyL",       ""],
  interact:  ["KeyB",       ""],
  shoot:     ["KeyN",       ""],
  melee:     ["KeyM",       ""],
};

let bindings = { p1: clonePlayer(DEFAULT_P1), p2: clonePlayer(DEFAULT_P2) };
let loaded = false;
const listeners = new Set();

function clonePlayer(b) {
  const out = {};
  for (const k of Object.keys(b)) out[k] = b[k].slice();
  return out;
}

function load() {
  if (loaded) return;
  loaded = true;
  if (typeof localStorage === "undefined") return;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.p1) overlayPlayer(bindings.p1, parsed.p1);
      if (parsed?.p2) overlayPlayer(bindings.p2, parsed.p2);
      return;
    }
    // First load on this profile: try to inherit v1 (P1 only).
    const v1 = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!v1) return;
    const parsedV1 = JSON.parse(v1);
    if (!parsedV1 || typeof parsedV1 !== "object") return;
    overlayPlayer(bindings.p1, parsedV1);
    // Hard-strip the legacy KeyM=menu binding even if the user explicitly
    // chose it — keeping it would re-introduce the P2 melee conflict the
    // v2 default already fixes.
    bindings.p1.menu = (bindings.p1.menu || []).filter(c => c !== "KeyM");
    persist();
  } catch {}
}

function overlayPlayer(target, src) {
  for (const action of Object.keys(target)) {
    const v = src[action];
    if (Array.isArray(v) && v.every(s => typeof s === "string")) {
      target[action] = v.slice();
    }
  }
}

function persist() {
  if (typeof localStorage === "undefined") return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch {}
}

function slotFor(playerIndex) {
  return (playerIndex | 0) === 1 ? bindings.p2 : bindings.p1;
}

// Returns the [primary, secondary] codes a given player has bound to
// `action`. playerIndex 0 = P1 (default), 1 = P2.
export function codesFor(action, playerIndex = 0) {
  load();
  const slot = slotFor(playerIndex);
  return slot[action] ? slot[action].slice() : [];
}

// True iff `code` is bound to `action` for the given player.
export function matchesAction(action, code, playerIndex = 0) {
  load();
  const slot = slotFor(playerIndex);
  return (slot[action] || []).includes(code);
}

// Returns the action name (e.g. "shoot") for a key code under the given
// player's bindings, or null. Defaults to P1 — single-player code keeps
// working unchanged.
export function actionForCode(code, playerIndex = 0) {
  load();
  const slot = slotFor(playerIndex);
  const list = (playerIndex | 0) === 1 ? ACTIONS_P2 : ACTIONS;
  for (const a of list) {
    if ((slot[a.id] || []).includes(code)) return a.id;
  }
  return null;
}

// Walks P1 then P2 and returns the first match as { playerIndex, action }.
// Used by co-op-aware action listeners (input / shooting / melee /
// interact) so a single code → player routing call replaces the
// hand-rolled COOP_KEYMAPS comparisons each feature used to do.
export function resolveAction(code) {
  load();
  for (const a of ACTIONS) {
    if ((bindings.p1[a.id] || []).includes(code)) return { playerIndex: 0, action: a.id };
  }
  for (const a of ACTIONS_P2) {
    if ((bindings.p2[a.id] || []).includes(code)) return { playerIndex: 1, action: a.id };
  }
  return null;
}

// Replace a single slot of an action's bindings. `slot` is 0 (primary)
// or 1 (secondary). Same code on another action of the SAME player is
// cleared so each physical key only maps to one thing for them. If the
// code is non-empty, it's also cleared from the OTHER player's bindings
// — two players can't share a key, since input.js fans the press into
// whoever owns it first.
export function setBinding(action, slot, code, playerIndex = 0) {
  load();
  const player = (playerIndex | 0) === 1 ? "p2" : "p1";
  const other  = (playerIndex | 0) === 1 ? "p1" : "p2";
  if (!bindings[player][action]) bindings[player][action] = [];
  for (const id of Object.keys(bindings[player])) {
    if (id === action) continue;
    bindings[player][id] = bindings[player][id].filter(c => c !== code);
  }
  if (code) {
    for (const id of Object.keys(bindings[other])) {
      bindings[other][id] = bindings[other][id].filter(c => c !== code);
    }
  }
  bindings[player][action][slot] = code;
  persist();
  notify();
}

export function resetBindings(playerIndex) {
  load();
  if (playerIndex == null) {
    bindings = { p1: clonePlayer(DEFAULT_P1), p2: clonePlayer(DEFAULT_P2) };
  } else if ((playerIndex | 0) === 1) {
    bindings.p2 = clonePlayer(DEFAULT_P2);
  } else {
    bindings.p1 = clonePlayer(DEFAULT_P1);
  }
  persist();
  notify();
}

export function onBindingsChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch {}
  }
}

// Test-only seam.
export function _resetBindingsForTesting() {
  bindings = { p1: clonePlayer(DEFAULT_P1), p2: clonePlayer(DEFAULT_P2) };
  loaded = true;
}
