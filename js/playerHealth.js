// Per-player HP, brief invulnerability against bullet bursts, regen with a
// short delay after taking damage.
//
// Two damage paths:
//   * applyPlayerDamage(amount, playerIndex)  — instant hits (bullets).
//     Triggers a brief invulnerability window so multiple bullets in one
//     frame don't all stack.
//   * applyPlayerContinuousDamage(amount, playerIndex) — sustained ticks
//     from a melee monster standing on / next to the player. Ignores
//     invuln so the player actually feels the pressure.
// Both paths reset the regen delay, so the player only heals once they've
// been clear of damage for a moment.
//
// Equipment damage reduction (Rust hits_handling_use_case.rs:88) is
// applied multiplicatively before either path consumes HP — every
// currently-equipped weapon contributes `1 - received_damage_reduction`
// to the multiplier (shield 1171 cuts incoming damage by half).
//
// State is stored in a small per-player record array. The single-player
// API continues to operate on index 0 by default so existing call sites
// keep working until they thread a playerIndex.

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

// Up to 2 players for now (co-op cap). Adding more is a one-line change
// when gamepad routing lands.
const MAX_PLAYERS = 2;

function makeRecord() {
  return { hp: MAX_HP, invuln: 0, regenDelay: 0 };
}

const records = Array.from({ length: MAX_PLAYERS }, makeRecord);
const listeners = new Set();

function recordFor(index) {
  const i = index | 0;
  return records[i] ?? records[0];
}

export function tickPlayerHealth(dt) {
  let changed = false;
  for (const rec of records) {
    if (rec.invuln > 0) rec.invuln = Math.max(0, rec.invuln - dt);
    if (rec.regenDelay > 0) {
      rec.regenDelay = Math.max(0, rec.regenDelay - dt);
      continue;
    }
    if (rec.hp > 0 && rec.hp < MAX_HP) {
      rec.hp = Math.min(MAX_HP, rec.hp + RECOVERY_PER_SEC * dt);
      changed = true;
    }
  }
  if (changed) notify();
}

export function getPlayerHp(index = 0)            { return recordFor(index).hp; }
export function getPlayerMaxHp()                  { return MAX_HP; }
export function isPlayerInvulnerable(index = 0)   { return recordFor(index).invuln > 0; }
export function isPlayerDead(index = 0)           { return recordFor(index).hp <= 0; }

// Burst damage (bullets). Sets a brief invuln window.
// Returns "hurt" | "died" | "ignored".
export function applyPlayerDamage(amount, index = 0) {
  const rec = recordFor(index);
  if (rec.invuln > 0 || rec.hp <= 0 || amount <= 0) return "ignored";
  const reduced = applyDamageReductions(amount, index);
  if (reduced <= 0) return "ignored";
  rec.hp = Math.max(0, rec.hp - reduced);
  rec.invuln = INVULN_AFTER_BURST;
  rec.regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  return rec.hp <= 0 ? "died" : "hurt";
}

// Continuous damage (melee monster in range). No invuln gating — this
// is meant to be ticked many times per second at dps * dt.
export function applyPlayerContinuousDamage(amount, index = 0) {
  const rec = recordFor(index);
  if (rec.hp <= 0 || amount <= 0) return "ignored";
  const reduced = applyDamageReductions(amount, index);
  if (reduced <= 0) return "ignored";
  rec.hp = Math.max(0, rec.hp - reduced);
  rec.regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  return rec.hp <= 0 ? "died" : "hurt";
}

// Multiplies `amount` by (1 - reduction) for every equipped weapon that
// carries a `received_damage_reduction`. Each slot is queried
// independently; missing equipment or unknown species id contributes a
// neutral 1.0 factor.
function applyDamageReductions(amount, index) {
  let out = amount;
  for (const slot of [SLOT_MELEE, SLOT_RANGED]) {
    const id = getEquipped(slot, index);
    if (!id) continue;
    const sp = getSpecies(id);
    const r = sp?.received_damage_reduction || 0;
    if (r > 0) out *= Math.max(0, 1 - r);
  }
  return out;
}

// Reset HP for a given player (default both). Used by death/respawn and
// by tests.
export function resetPlayerHealth(index) {
  if (index == null) {
    for (const rec of records) {
      rec.hp = MAX_HP; rec.invuln = 0; rec.regenDelay = 0;
    }
  } else {
    const rec = recordFor(index);
    rec.hp = MAX_HP; rec.invuln = 0; rec.regenDelay = 0;
  }
  notify();
}

export function onPlayerHealthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(records[0].hp, MAX_HP);
}
