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

import { getSpecies } from "./species.js?v=20260529a";
import { resolveLoadout } from "./sessionLoadouts.js?v=20260529a";

const MAX_HP = 100;
// Intentional divergence from Rust HERO_RECOVERY_PS=1.0. Block-A playtests
// found 1 HP/s left the player chip-damage-locked when crossing biome
// edges with low health — the web build also has no inventory consumables
// yet, so there's no other heal path. Bump up to 3 if/when potion drops
// land, then re-evaluate.
const RECOVERY_PER_SEC = 3;
const REGEN_DELAY_AFTER_HIT = 1.5;
const INVULN_AFTER_BURST = 0.4;

// Up to 4 players (online co-op cap: host + 3 network guests).
const MAX_PLAYERS = 4;

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

// Push an authoritative HP value into the local record. The host's
// snapshot/delta carries each player's hp; the guest mirrors theirs in
// here so getPlayerHp(0) is a single source of truth for the HUD
// regardless of role. No-op on identical values to avoid flooding
// onPlayerHealthChange listeners.
export function setPlayerHp(hp, index = 0) {
  const rec = recordFor(index);
  const next = Math.max(0, Math.min(MAX_HP, +hp));
  if (rec.hp === next) return;
  rec.hp = next;
  notify();
}

// Burst damage (bullets). Sets a brief invuln window.
// Returns "hurt" | "died" | "ignored". Accepts either an index (legacy
// callers, tests) or a player object — the latter lets damage reduction
// consult sessionLoadouts by playerId in online co-op instead of folding
// to local index 0 (which would otherwise have the host's shield protect
// every guest).
export function applyPlayerDamage(amount, victim = 0) {
  const index = indexOf(victim);
  const rec = recordFor(index);
  if (rec.invuln > 0 || rec.hp <= 0 || amount <= 0) return "ignored";
  const reduced = applyDamageReductions(amount, victim);
  if (reduced <= 0) return "ignored";
  rec.hp = Math.max(0, rec.hp - reduced);
  rec.invuln = INVULN_AFTER_BURST;
  rec.regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  return rec.hp <= 0 ? "died" : "hurt";
}

// Continuous damage (melee monster in range). No invuln gating — this
// is meant to be ticked many times per second at dps * dt.
export function applyPlayerContinuousDamage(amount, victim = 0) {
  const index = indexOf(victim);
  const rec = recordFor(index);
  if (rec.hp <= 0 || amount <= 0) return "ignored";
  const reduced = applyDamageReductions(amount, victim);
  if (reduced <= 0) return "ignored";
  rec.hp = Math.max(0, rec.hp - reduced);
  rec.regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  return rec.hp <= 0 ? "died" : "hurt";
}

function indexOf(victim) {
  if (typeof victim === "number") return victim;
  if (victim && typeof victim === "object") return victim.index | 0;
  return 0;
}

// Multiplies `amount` by (1 - reduction) for every equipped weapon that
// carries a `received_damage_reduction`. The victim argument is either
// an index (single-player / tests) or the full player object; the
// object form goes through sessionLoadouts so a guest's shield protects
// THEM and not whoever's local index it lines up with.
function applyDamageReductions(amount, victim) {
  let out = amount;
  const { melee, ranged } = victim && typeof victim === "object"
    ? resolveLoadout(victim)
    : resolveLoadout({ index: indexOf(victim) });
  for (const id of [melee, ranged]) {
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
