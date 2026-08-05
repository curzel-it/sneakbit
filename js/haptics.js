// Device haptics for the on-screen touch controls. A thumb gets no
// physical confirmation that it hit a virtual button, so every press on
// the touch overlay fires a short vibration.
//
// A silent no-op when the Vibration API is missing (iOS Safari / WKWebView
// never shipped it, so this is Android/Chrome-only in practice), when the
// device has no motor, or when the player turned Vibration off — so call
// sites never need to guard.
//
// Only presses vibrate, never releases, and never damage: the phone buzzes
// for input the player made, nothing else. Controller rumble is a separate
// feature (rumble.js) gated on the same setting.

import { getSettings } from "./settings.js";

const PATTERNS = {
  tap: 10,     // d-pad step, menu button
  action: 18,  // melee / throw / interact — reads heavier than a step
};

// Drag-to-switch across the d-pad (touch.js::onPointerMove) fires a new
// direction press every time the finger crosses a diagonal, many times a
// second. Without a floor between pulses a fast drag becomes one continuous
// buzz instead of a series of taps.
const MIN_INTERVAL_MS = 30;

let lastTapAt = 0;

export function hapticTap(kind = "tap") {
  const ms = PATTERNS[kind];
  if (!ms) return;
  if (getSettings().haptics === false) return;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;

  const now = Date.now();
  if (now - lastTapAt < MIN_INTERVAL_MS) return;
  lastTapAt = now;
  try { navigator.vibrate(ms); } catch { /* blocked by the browser */ }
}

// Test seam — clears the throttle so cases don't suppress each other.
export function _resetHapticsForTesting() { lastTapAt = 0; }
