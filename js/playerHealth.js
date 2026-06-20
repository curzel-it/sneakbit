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

import { getSpecies } from "./species.js";
import { resolveLoadout } from "./sessionLoadouts.js";
import { rumble } from "./rumble.js";
import { isPvp, pvpPlayerHp } from "./gameMode.js";
import { isGiantIndex } from "./giantMode.js";

const MAX_HP = 100;

// Giant mode (giantMode.js) triples a player's max HP for the duration of
// the transformation — the survivability half of the giant power-up (the
// other half is bare-handed melee, see melee.js). Keyed by player index, so
// the buff is correct for the local self (index 0, keyed by playerId under
// the hood) and for local co-op partners (index > 0). A lapsing giant is
// clamped back down in tickPlayerHealth, since expiry is lazy (no event).
const GIANT_HP_MULT = 3;

// Max HP depends on the game mode: PvP runs at 1000 (Rust
// GameMode::player_hp) so matches actually last; co-op/creative stay at
// 100 — then tripled while this player is giant. Every runtime cap (regen,
// clamp, reset, HUD) goes through here, threading the player index so the
// giant buff applies per-player.
function baseMaxHp() {
  return isPvp() ? pvpPlayerHp() : MAX_HP;
}
function maxHp(index = 0) {
  const base = baseMaxHp();
  return isGiantIndex(index) ? base * GIANT_HP_MULT : base;
}
// Matches Rust HERO_RECOVERY_PS=1.0. Potion drops now provide a faster,
// deliberate heal path, so passive regen is back to the original slow trickle.
const RECOVERY_PER_SEC = 1;
const REGEN_DELAY_AFTER_HIT = 1.5;
const INVULN_AFTER_BURST = 0.4;

// Potions don't snap HP up — they top off a per-player `pendingHeal` pool
// that drains into hp at this rate so the bar visibly climbs. 100/s means
// the base 50 HP health potion takes ~0.5s to fill. Drained before (and
// regardless of) the regen delay so a potion still works right after a hit.
const HEAL_PER_SEC = 100;

// Up to 4 players (online co-op cap: host + 3 network guests).
const MAX_PLAYERS = 4;

// Uses baseMaxHp (not maxHp) so module-load never reaches into giantMode →
// onlineBootstrap, which is still mid-evaluation in the import cycle (and no
// one is giant at startup regardless).
function makeRecord() {
  return { hp: baseMaxHp(), invuln: 0, regenDelay: 0, pendingHeal: 0, hardImmune: 0 };
}

const records = Array.from({ length: MAX_PLAYERS }, makeRecord);
const listeners = new Set();

function recordFor(index) {
  const i = index | 0;
  return records[i] ?? records[0];
}

export function tickPlayerHealth(dt) {
  let changed = false;
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const cap = maxHp(i);
    if (rec.invuln > 0) rec.invuln = Math.max(0, rec.invuln - dt);
    // Hard immunity (knockback aura activation): a full-immunity window that,
    // unlike `invuln`, also blocks the continuous melee path. Decayed here.
    if (rec.hardImmune > 0) rec.hardImmune = Math.max(0, rec.hardImmune - dt);
    // Giant expiry: the cap can drop (3× → 1×) the instant the timer lapses,
    // since giantMode expires lazily with no event. Clamp the oversized HP
    // back down here so the bar can't stay above the restored max.
    if (rec.hp > cap) { rec.hp = cap; changed = true; }
    // Drain any queued potion healing first — independent of the regen
    // delay, so drinking right after a hit still heals.
    if (rec.pendingHeal > 0 && rec.hp > 0) {
      const step = Math.min(rec.pendingHeal, HEAL_PER_SEC * dt);
      rec.hp = Math.min(cap, rec.hp + step);
      rec.pendingHeal -= step;
      changed = true;
    }
    if (rec.regenDelay > 0) {
      rec.regenDelay = Math.max(0, rec.regenDelay - dt);
      continue;
    }
    if (rec.hp > 0 && rec.hp < cap) {
      rec.hp = Math.min(cap, rec.hp + RECOVERY_PER_SEC * dt);
      changed = true;
    }
  }
  if (changed) notify();
}

export function getPlayerHp(index = 0)            { return recordFor(index).hp; }
export function getPlayerMaxHp(index = 0)         { return maxHp(index); }
export function isPlayerInvulnerable(index = 0)   { return recordFor(index).invuln > 0; }
export function isPlayerDead(index = 0)           { return recordFor(index).hp <= 0; }

// Push an authoritative HP value into the local record. The host's
// snapshot/delta carries each player's hp; the guest mirrors theirs in
// here so getPlayerHp(0) is a single source of truth for the HUD
// regardless of role. No-op on identical values to avoid flooding
// onPlayerHealthChange listeners.
export function setPlayerHp(hp, index = 0) {
  const rec = recordFor(index);
  const next = Math.max(0, Math.min(maxHp(index), +hp));
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
  if (rec.hardImmune > 0) return "ignored";
  if (rec.invuln > 0 || rec.hp <= 0 || amount <= 0) return "ignored";
  const reduced = applyDamageReductions(amount, victim);
  if (reduced <= 0) return "ignored";
  rec.hp = Math.max(0, rec.hp - reduced);
  rec.invuln = INVULN_AFTER_BURST;
  rec.regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  rumble(index + 1, "hurt");
  return rec.hp <= 0 ? "died" : "hurt";
}

// Continuous damage (melee monster in range). No invuln gating — this
// is meant to be ticked many times per second at dps * dt.
export function applyPlayerContinuousDamage(amount, victim = 0) {
  const index = indexOf(victim);
  const rec = recordFor(index);
  if (rec.hardImmune > 0) return "ignored";
  if (rec.hp <= 0 || amount <= 0) return "ignored";
  const reduced = applyDamageReductions(amount, victim);
  if (reduced <= 0) return "ignored";
  rec.hp = Math.max(0, rec.hp - reduced);
  rec.regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  rumble(index + 1, "hurt");
  return rec.hp <= 0 ? "died" : "hurt";
}

// Potion healing. Queues `amount` into the victim's pending-heal pool,
// which tickPlayerHealth drains into hp over ~0.5s so the bar climbs
// instead of snapping. Capped to the room left under maxHp (accounting
// for heal already in flight) so overheal doesn't waste pool time, and
// a no-op on a dead player — they need a revive, not a potion. Accepts
// an index or a player object, same as the damage paths. Returns the HP
// actually queued.
export function applyPlayerHeal(amount, victim = 0) {
  const victimIdx = indexOf(victim);
  const rec = recordFor(victimIdx);
  if (rec.hp <= 0 || amount <= 0) return 0;
  const room = Math.max(0, maxHp(victimIdx) - rec.hp - rec.pendingHeal);
  const granted = Math.min(amount, room);
  rec.pendingHeal += granted;
  return granted;
}

// Open a full-immunity window for `seconds` on a player. Unlike the brief
// post-hit `invuln`, this also blocks the continuous melee path, so the
// player takes zero damage from any source while it lasts. Used by the
// knockback aura during its activation animation. Extends (never shortens)
// any window already open. Accepts an index or a player object.
export function setPlayerHardImmunity(seconds, victim = 0) {
  const rec = recordFor(indexOf(victim));
  rec.hardImmune = Math.max(rec.hardImmune, +seconds || 0);
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
  const { melee, ranged, armor } = victim && typeof victim === "object"
    ? resolveLoadout(victim)
    : resolveLoadout({ index: indexOf(victim) });
  // Weapons (e.g. shield) and every equipped armour piece each soak a slice
  // of incoming damage; the reductions stack multiplicatively.
  const ids = [melee, ranged, ...(armor ? Object.values(armor) : [])];
  for (const id of ids) {
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
    for (let i = 0; i < records.length; i++) {
      const rec = records[i];
      rec.hp = maxHp(i); rec.invuln = 0; rec.regenDelay = 0; rec.pendingHeal = 0; rec.hardImmune = 0;
    }
  } else {
    const rec = recordFor(index);
    rec.hp = maxHp(index); rec.invuln = 0; rec.regenDelay = 0; rec.pendingHeal = 0; rec.hardImmune = 0;
  }
  notify();
}

export function onPlayerHealthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(records[0].hp, maxHp(0));
}
