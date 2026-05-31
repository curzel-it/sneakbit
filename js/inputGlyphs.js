// Device-correct button labels for on-screen prompts. Steam requires that
// prompts show glyphs matching the active device (and never keyboard
// glyphs while a controller is active) — so `glyphForAction` reads the
// active device and resolves the player's actual binding to a label.
//
// Labels are short Xbox-style names (A/B/X/Y/LB/Start), which Steam Deck
// accepts. Real glyph icons and per-controller-brand / remap-aware glyphs
// come later via the Steam Input API (Electron shell) — only this module
// changes when that source is added.

import { getActiveInputDevice } from "./activeInputDevice.js";
import { codesFor } from "./keyBindings.js";
import { buttonFor } from "./gamepadBindings.js";

// Standard-Mapping button index → label.
const PAD_BUTTON_LABELS = {
  0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT",
  8: "Back", 9: "Start", 10: "LS", 11: "RS",
  12: "D-Up", 13: "D-Down", 14: "D-Left", 15: "D-Right", 16: "Guide",
};

// KeyboardEvent.code → friendly label (e.g. "KeyA" → "A").
export function formatKeyCode(code) {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

export function formatPadButton(idx) {
  if (idx == null || idx < 0) return "—";
  return PAD_BUTTON_LABELS[idx] || `Button ${idx}`;
}

// Label for the button/key `action` is bound to for the given player,
// under the currently active input device.
export function glyphForAction(action, playerIndex = 0) {
  if (getActiveInputDevice() === "gamepad") {
    return formatPadButton(buttonFor(action, playerIndex));
  }
  // Keyboard and touch both show the keyboard binding (touch has its own
  // on-screen buttons; a prompt still reads best as the key).
  return formatKeyCode(codesFor(action, playerIndex)[0]);
}

// Fixed UI-navigation conventions, independent of the rebindable gameplay
// buttons: A confirms / B cancels on a pad, Enter / Esc on a keyboard.
// Pre-built for the (deferred) in-menu navigation work.
export function confirmGlyph() {
  return getActiveInputDevice() === "gamepad" ? "A" : "Enter";
}
export function backGlyph() {
  return getActiveInputDevice() === "gamepad" ? "B" : "Esc";
}
