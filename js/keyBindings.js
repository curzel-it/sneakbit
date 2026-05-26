// Single source of truth for keyboard bindings. Every feature that
// listens on a hardcoded `e.code` should ask `codesFor(action)` instead
// so the player can rebind it. Persists to localStorage; emits change
// events so listeners can rewire the keymap live (no reload needed).
//
// This isn't in the Rust build — desktop SneakBit hardcodes WASD/arrows
// and the action keys; the HTML port adds it because rebinding is a
// reasonable expectation for keyboard play, and the no-build-step
// architecture makes it cheap to wire one module through everywhere.

const STORAGE_KEY = "sneakbit.keyBindings.v1";

// Order here is the order the settings UI displays in.
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

const DEFAULT_BINDINGS = {
  moveUp:    ["ArrowUp",    "KeyW"],
  moveDown:  ["ArrowDown",  "KeyS"],
  moveLeft:  ["ArrowLeft",  "KeyA"],
  moveRight: ["ArrowRight", "KeyD"],
  interact:  ["KeyE",       "Enter"],
  shoot:     ["KeyF",       "KeyJ"],
  melee:     ["KeyG",       "KeyK"],
  menu:      ["Escape",     "KeyM"],
};

let bindings = clone(DEFAULT_BINDINGS);
let loaded = false;

const listeners = new Set();

function clone(b) {
  const out = {};
  for (const k of Object.keys(b)) out[k] = b[k].slice();
  return out;
}

function load() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return;
    for (const a of ACTIONS) {
      const v = parsed[a.id];
      if (Array.isArray(v) && v.every(s => typeof s === "string")) {
        bindings[a.id] = v.slice();
      }
    }
  } catch {}
}

function persist() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bindings)); } catch {}
}

export function codesFor(action) {
  load();
  return bindings[action] ? bindings[action].slice() : [];
}

export function actionForCode(code) {
  load();
  for (const a of ACTIONS) {
    if ((bindings[a.id] || []).includes(code)) return a.id;
  }
  return null;
}

export function matchesAction(action, code) {
  load();
  return (bindings[action] || []).includes(code);
}

// Replace a single slot of an action's bindings. `slot` is 0 (primary)
// or 1 (secondary). Same code on another action is removed from that
// other action so each physical key only maps to one thing.
export function setBinding(action, slot, code) {
  load();
  if (!bindings[action]) bindings[action] = [];
  for (const id of Object.keys(bindings)) {
    if (id === action) continue;
    bindings[id] = bindings[id].filter(c => c !== code);
  }
  bindings[action][slot] = code;
  persist();
  notify();
}

export function resetBindings() {
  bindings = clone(DEFAULT_BINDINGS);
  loaded = true;
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
  bindings = clone(DEFAULT_BINDINGS);
  loaded = true;
}
