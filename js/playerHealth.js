// Player HP, brief invulnerability against bullet bursts, regen with a
// short delay after taking damage.
//
// Two damage paths:
//   * applyPlayerDamage(burst)  — instant hits (bullets). Triggers a brief
//     invulnerability window so multiple bullets in one frame don't all
//     stack.
//   * applyPlayerContinuousDamage(dps * dt) — sustained ticks from a
//     melee monster standing on / next to the player. Ignores invuln so
//     the player actually feels the pressure.
// Both paths reset the regen delay, so the player only heals once they've
// been clear of damage for a moment.
//
// Equipment damage reduction (Rust hits_handling_use_case.rs:88) is
// applied multiplicatively before either path consumes HP — every
// currently-equipped weapon contributes `1 - received_damage_reduction`
// to the multiplier (shield 1171 cuts incoming damage by half).

import { getEquipped, SLOT_MELEE, SLOT_RANGED } from "./equipment.js";
import { getSpecies } from "./species.js";

const MAX_HP = 100;
// Intentional divergence from Rust HERO_RECOVERY_PS=1.0. Block-A playtests
// found 1 HP/s left the player chip-damage-locked when crossing biome
// edges with low health — the web build also has no inventory consumables
// yet, so there's no other heal path. Bump up to 3 if/when potion drops
// land, then re-evaluate.
const RECOVERY_PER_SEC = 3;
const REGEN_DELAY_AFTER_HIT = 1.5;
const INVULN_AFTER_BURST = 0.4;

let hp = MAX_HP;
let invuln = 0;
let regenDelay = 0;
const listeners = new Set();

export function tickPlayerHealth(dt) {
  if (invuln > 0) invuln = Math.max(0, invuln - dt);
  if (regenDelay > 0) {
    regenDelay = Math.max(0, regenDelay - dt);
    return;
  }
  if (hp > 0 && hp < MAX_HP) {
    hp = Math.min(MAX_HP, hp + RECOVERY_PER_SEC * dt);
    notify();
  }
}

export function getPlayerHp() { return hp; }
export function getPlayerMaxHp() { return MAX_HP; }
export function isPlayerInvulnerable() { return invuln > 0; }
export function isPlayerDead() { return hp <= 0; }

// Burst damage (bullets). Sets a brief invuln window.
// Returns "hurt" | "died" | "ignored".
export function applyPlayerDamage(amount) {
  if (invuln > 0 || hp <= 0 || amount <= 0) return "ignored";
  const reduced = applyDamageReductions(amount);
  if (reduced <= 0) return "ignored";
  hp = Math.max(0, hp - reduced);
  invuln = INVULN_AFTER_BURST;
  regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  return hp <= 0 ? "died" : "hurt";
}

// Continuous damage (melee monster in range). No invuln gating — this
// is meant to be ticked many times per second at dps * dt.
export function applyPlayerContinuousDamage(amount) {
  if (hp <= 0 || amount <= 0) return "ignored";
  const reduced = applyDamageReductions(amount);
  if (reduced <= 0) return "ignored";
  hp = Math.max(0, hp - reduced);
  regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  return hp <= 0 ? "died" : "hurt";
}

// Multiplies `amount` by (1 - reduction) for every equipped weapon that
// carries a `received_damage_reduction`. Each slot is queried
// independently; missing equipment or unknown species id contributes a
// neutral 1.0 factor.
function applyDamageReductions(amount) {
  let out = amount;
  for (const slot of [SLOT_MELEE, SLOT_RANGED]) {
    const id = getEquipped(slot);
    if (!id) continue;
    const sp = getSpecies(id);
    const r = sp?.received_damage_reduction || 0;
    if (r > 0) out *= Math.max(0, 1 - r);
  }
  return out;
}

export function resetPlayerHealth() {
  hp = MAX_HP;
  invuln = 0;
  regenDelay = 0;
  notify();
}

export function onPlayerHealthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(hp, MAX_HP);
}
