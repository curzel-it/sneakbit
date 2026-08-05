// Device haptics for the on-screen touch controls. A thumb gets no
// physical confirmation that it hit a virtual button, so every press on
// the touch overlay fires a short vibration.
//
// Two backends, in preference order:
//   1. The iOS shell's native bridge (WebGameView.swift). WebKit never
//      shipped the Vibration API, so the app exposes a message handler that
//      drives the taptic engine — real impact feedback, not a buzz, which is
//      why it wins even where both exist.
//   2. navigator.vibrate — Android WebView (needs the manifest's VIBRATE
//      permission) and mobile web.
//
// A silent no-op when neither is reachable, when the device has no motor, or
// when the player turned Vibration off — so call sites never need to guard.
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

// The iOS shell's message handler, or null everywhere else.
function nativeBridge() {
  if (typeof window === "undefined") return null;
  return window.webkit?.messageHandlers?.haptics || null;
}

// Does anything actually buzz on this device? Desktop Chromium exposes
// navigator.vibrate with no motor behind it, so the API alone proves nothing
// — only a touch device can act on it. The menu uses this to avoid offering
// a setting that does nothing.
export function isTouchHapticsAvailable() {
  if (nativeBridge()) return true;
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return false;
  // Same touch-capability probe as touch.js: `pointer: coarse` alone is
  // unreliable inside wrapped WebViews.
  return (navigator.maxTouchPoints || 0) > 0
    || (typeof window !== "undefined" && "ontouchstart" in window)
    || (typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches);
}

export function hapticTap(kind = "tap") {
  const ms = PATTERNS[kind];
  if (!ms) return;
  if (getSettings().haptics === false) return;

  const now = Date.now();
  if (now - lastTapAt < MIN_INTERVAL_MS) return;

  const native = nativeBridge();
  if (native) {
    // The Swift side picks the impact style from the kind — durations are a
    // Vibration-API concept and mean nothing to the taptic engine.
    lastTapAt = now;
    try { native.postMessage(kind); } catch { /* handler torn down */ }
    return;
  }

  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;
  lastTapAt = now;
  try { navigator.vibrate(ms); } catch { /* blocked by the browser */ }
}

// Test seam — clears the throttle so cases don't suppress each other.
export function _resetHapticsForTesting() { lastTapAt = 0; }
