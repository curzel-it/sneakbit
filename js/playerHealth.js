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

const MAX_HP = 100;
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
  hp = Math.max(0, hp - amount);
  invuln = INVULN_AFTER_BURST;
  regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  return hp <= 0 ? "died" : "hurt";
}

// Continuous damage (melee monster in range). No invuln gating — this
// is meant to be ticked many times per second at dps * dt.
export function applyPlayerContinuousDamage(amount) {
  if (hp <= 0 || amount <= 0) return "ignored";
  hp = Math.max(0, hp - amount);
  regenDelay = REGEN_DELAY_AFTER_HIT;
  notify();
  return hp <= 0 ? "died" : "hurt";
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
