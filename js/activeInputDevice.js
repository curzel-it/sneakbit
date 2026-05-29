// Tracks the player's *active* input device on a last-input-wins basis:
// "keyboard", "gamepad", or "touch". Both keyboard and gamepad stay live
// at all times (Steam requires allowing any mix simultaneously) — this is
// purely a presentation signal so prompts can show device-correct glyphs
// and the touch overlay can hide itself.
//
// Sources report activity here: a window keydown → keyboard, a touchstart
// → touch, and gamepad.js calls markInputDevice("gamepad") when a pad has
// real input this frame. A connected pad (gamepadconnected, wired in
// controllerPresence.js) also flips us to gamepad so a controller works
// with the right glyphs and no settings step — the Steam Deck "no setup"
// rule.

let active = "keyboard";
const listeners = new Set();
let installed = false;

export function getActiveInputDevice() { return active; }

export function onActiveInputDeviceChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

// Report that `device` was just used. Fires change listeners only on an
// actual transition, so per-frame gamepad reports are cheap.
export function markInputDevice(device) {
  if (device !== "keyboard" && device !== "gamepad" && device !== "touch") return;
  if (device === active) return;
  active = device;
  for (const cb of listeners) {
    try { cb(active); } catch (e) { console.error("activeInputDevice listener:", e); }
  }
}

// Passive global listeners. Idempotent. gamepad activity is reported from
// gamepad.js (not here) to avoid a second per-frame poll.
export function installActiveInputDevice() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  // Default to touch on coarse-pointer (mobile) devices so the on-screen
  // controls show before any input.
  if (typeof matchMedia !== "undefined" && matchMedia("(pointer: coarse)").matches) {
    active = "touch";
  }
  window.addEventListener("keydown", () => markInputDevice("keyboard"), true);
  window.addEventListener("touchstart", () => markInputDevice("touch"), { capture: true, passive: true });
  // Debug/e2e hook (harmless, like window.save / window.coop).
  window.__activeInputDevice = getActiveInputDevice;
}

// Test seam.
export function _resetActiveInputDeviceForTesting(d = "keyboard") {
  active = d;
  listeners.clear();
  installed = false;
}
