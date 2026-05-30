// Controller haptics. Maps a player slot to its physical pad (via
// gamepad.js's connection-order assignment) and plays a short vibration
// effect. A silent no-op when the slot has no locally-connected pad, when
// the pad has no vibration actuator, or in browsers without the API
// (Safari) — so call sites never need to guard.
//
// Only two events rumble today: taking damage and the dry-fire "no ammo"
// click. Because slots without a local pad resolve to a no-op, call sites
// can pass any slot freely: a remote guest's damage/no-ammo (resolved on
// the host for slots 3/4) simply finds no host-local pad and stays quiet.

import { getPadIndexForSlot } from "./gamepad.js?v=20260530c";

const PRESETS = {
  hurt:   { duration: 200, strongMagnitude: 0.85, weakMagnitude: 0.6 },
  noAmmo: { duration: 60,  strongMagnitude: 0,    weakMagnitude: 0.25 },
};

// Per-slot throttle so continuous damage (ticked many times a second)
// doesn't restart the effect every frame — one pulse per effect duration.
const lastRumbleAt = new Map();

export function rumble(slot, kind) {
  const preset = PRESETS[kind];
  if (!preset) return;
  if (typeof navigator === "undefined" || !navigator.getGamepads) return;
  const now = Date.now();
  if (now - (lastRumbleAt.get(slot) || 0) < preset.duration) return;

  const padIndex = getPadIndexForSlot(slot);
  if (padIndex < 0) return;
  const pad = navigator.getGamepads()[padIndex];
  const actuator = pad?.vibrationActuator;
  if (!actuator || typeof actuator.playEffect !== "function") return;

  lastRumbleAt.set(slot, now);
  try { actuator.playEffect("dual-rumble", preset); } catch { /* unsupported effect type */ }
}

// Test seam — clears the per-slot throttle so cases don't suppress each other.
export function _resetRumbleForTesting() { lastRumbleAt.clear(); }
