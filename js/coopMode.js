// Local co-op mode flag. When on:
//   * a second player entity (P2) spawns next to P1 at boot
//   * P1 inputs are WASD + Z/X/C (interact / shoot / melee)
//   * P2 inputs are IJKL + B/N/M (interact / shoot / melee)
//   * the keyBindings.js settings UI is bypassed — co-op locks the
//     keymap to those two hardwired sets so the second player always
//     has a stable control scheme
//   * inventory, HP, skills and save data are shared (one save slot)
//   * the camera follows the midpoint between the two players
//
// Toggling the flag triggers a page reload — it changes the zone's
// entity list (we add/remove P2) and the input wiring at boot, which
// is simpler than tearing both down at runtime.

const STORAGE_KEY = "sneakbit.coop.v1";
let cached = null;
let networkGuestCount = 0;

function load() {
  if (cached !== null) return cached;
  try { cached = localStorage.getItem(STORAGE_KEY) === "1"; }
  catch { cached = false; }
  return cached;
}

export function isCoopMode() { return load(); }

// Host network co-op uses the same per-slot input + render infrastructure
// as local co-op, but flipping the persisted localStorage flag would
// change a bunch of unrelated behavior (P2 spawned at boot, save slot
// share, ...). Instead, hostGuests.js reports the live count of network
// guests here and code that only cared about "is there a P2?" can ask
// isCoopActive() to cover both cases.
export function setNetworkGuestCount(n) { networkGuestCount = Math.max(0, n | 0); }
export function getNetworkGuestCount() { return networkGuestCount; }
export function isCoopActive() { return load() || networkGuestCount > 0; }

export function setCoopMode(on) {
  cached = !!on;
  try { localStorage.setItem(STORAGE_KEY, on ? "1" : "0"); } catch {}
}

// Fixed per-player keymaps for co-op. Spread across the keyboard so the
// two players can sit at the same machine without their hands colliding.
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
};

// Test-only seam.
export function _setCoopModeForTesting(on) { cached = !!on; }
