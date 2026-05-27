// Local co-op mode flag. When on:
//   * a second player entity (P2) spawns next to P1
//   * P1 keeps its rebindable single-player keys (defaults: WASD/arrows
//     + E/F/G + Esc)
//   * P2 uses its own rebindable keymap (defaults: IJKL + B/N/M),
//     stored alongside P1's bindings in keyBindings.js
//   * inventory and equipment are shared (one save slot); HP, invuln
//     windows and per-player death state stay independent so the death
//     toast / camera averaging features work
//   * the camera follows the midpoint between the two players
//
// In-memory only — any reload (intentional F5, or one triggered by an
// unrelated feature) lands back in single-player. Toggling on/off is
// hot: partyPanel calls main.enableLocalCoop / disableLocalCoop, which
// spawn or null out state.player2 without rebuilding the world.

let cached = false;
let networkGuestCount = 0;

export function isCoopMode() { return cached; }

// Host network co-op uses the same per-slot input + render infrastructure
// as local co-op, but flipping the persisted localStorage flag would
// change a bunch of unrelated behavior (P2 spawned at boot, save slot
// share, ...). Instead, hostGuests.js reports the live count of network
// guests here and code that only cared about "is there a P2?" can ask
// isCoopActive() to cover both cases.
export function setNetworkGuestCount(n) { networkGuestCount = Math.max(0, n | 0); }
export function getNetworkGuestCount() { return networkGuestCount; }
export function isCoopActive() { return cached || networkGuestCount > 0; }

export function setCoopMode(on) {
  cached = !!on;
}

// Fixed per-player keymaps for co-op. Slots 1/2 used to be the live
// in-game keymap for local P1 and P2; that role has moved to
// keyBindings.js (which lets players rebind them). The slot-1/2 entries
// are kept as a stable reference of the original defaults so existing
// tests / docs / hostGuests pivot helpers keep working without inventing
// a parallel constant. Slots 3/4 are still the live codes for online
// guests — their "keys" are synthesised by
// hostGuests.dispatchActionForSlot, so they can use codes that no
// physical keyboard sends (F-row well past F12).
export const COOP_KEYMAPS = {
  1: {
    moveUp:    "KeyW",
    moveDown:  "KeyS",
    moveLeft:  "KeyA",
    moveRight: "KeyD",
    interact:  "KeyZ",
    shoot:     "KeyX",
    melee:     "KeyC",
  },
  2: {
    moveUp:    "KeyI",
    moveDown:  "KeyK",
    moveLeft:  "KeyJ",
    moveRight: "KeyL",
    interact:  "KeyB",
    shoot:     "KeyN",
    melee:     "KeyM",
  },
  3: {
    moveUp:    "F13",
    moveDown:  "F14",
    moveLeft:  "F15",
    moveRight: "F16",
    interact:  "F17",
    shoot:     "F18",
    melee:     "F19",
  },
  4: {
    moveUp:    "F20",
    moveDown:  "F21",
    moveLeft:  "F22",
    moveRight: "F23",
    interact:  "F24",
    shoot:     "ContextMenu",  // unused on most keyboards
    melee:     "BrowserSearch",
  },
};

// Test-only seam.
export function _setCoopModeForTesting(on) { cached = !!on; }
