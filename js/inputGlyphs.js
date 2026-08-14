// Device-correct button labels for on-screen prompts. Steam requires that
// prompts show glyphs matching the active device (and never keyboard
// glyphs while a controller is active) — so `glyphForAction` reads the
// active device and resolves the player's actual binding to a label.
//
// Two lookups, deliberately separate: gamepadBindings.js says which button
// INDEX an action sits on (the player's choice), padKind.js says what that
// index is CALLED on the hardware in hand (the manufacturer's choice). A
// player holding a DualSense reads "Cross", not "A".
//
// The pad kind is resolved per PLAYER, not per game: in local co-op two
// players holding different makes each read their own buttons. Real glyph
// icons (rather than words) come later via the Steam Input API — only
// padKind.js changes when that source is added.

import { getActiveInputDevice } from "./activeInputDevice.js";
import { codesFor } from "./keyBindings.js";
import { buttonFor } from "./gamepadBindings.js";
import { getPadIdForSlot } from "./gamepad.js";
import { padKind, padLabel, PAD_XBOX } from "./padKind.js";

// KeyboardEvent.code → friendly label (e.g. "KeyA" → "A").
export function formatKeyCode(code) {
  if (!code) return "—";
  if (code.startsWith("Key")) return code.slice(3);
  if (code.startsWith("Digit")) return code.slice(5);
  if (code.startsWith("Numpad")) return "Num " + code.slice(6);
  return code;
}

// The make of pad this player is holding. Slots are 1-based (player 0 =
// slot 1), matching gamepad.js's connection-order assignment. With no pad
// connected this is the Xbox default — the Standard Mapping layout.
export function padKindForPlayer(playerIndex = 0) {
  return padKind(getPadIdForSlot((playerIndex | 0) + 1));
}

export function formatPadButton(idx, kind = PAD_XBOX) {
  return padLabel(idx, kind);
}

// Label for the button/key `action` is bound to for the given player,
// under the currently active input device.
export function glyphForAction(action, playerIndex = 0) {
  if (getActiveInputDevice() === "gamepad") {
    return padLabel(buttonFor(action, playerIndex), padKindForPlayer(playerIndex));
  }
  // Keyboard and touch both show the keyboard binding (touch has its own
  // on-screen buttons; a prompt still reads best as the key).
  return formatKeyCode(codesFor(action, playerIndex)[0]);
}

// Fixed UI-navigation conventions, independent of the rebindable gameplay
// buttons: menuNav confirms on button 0 and cancels on button 1, Enter /
// Esc on a keyboard. The INDICES are fixed; their names still come from
// the hardware — which is why a Switch Pro Controller correctly reads
// "B confirms", its bottom face button.
export function confirmGlyph(playerIndex = 0) {
  return getActiveInputDevice() === "gamepad"
    ? padLabel(0, padKindForPlayer(playerIndex))
    : "Enter";
}
export function backGlyph(playerIndex = 0) {
  return getActiveInputDevice() === "gamepad"
    ? padLabel(1, padKindForPlayer(playerIndex))
    : "Esc";
}
