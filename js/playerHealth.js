// Player HP, brief invulnerability after a hit, and slow regen.
// Mirrors the original game_core (hero hp/100, recovery per second,
// damage taken from bullets / melee monsters).

const MAX_HP = 100;
const RECOVERY_PER_SEC = 5;
const INVULN_AFTER_HIT = 0.6;

let hp = MAX_HP;
let invuln = 0;
const listeners = new Set();

export function tickPlayerHealth(dt) {
  if (invuln > 0) invuln = Math.max(0, invuln - dt);
  if (hp > 0 && hp < MAX_HP) {
    hp = Math.min(MAX_HP, hp + RECOVERY_PER_SEC * dt);
    notify();
  }
}

export function getPlayerHp() { return hp; }
export function getPlayerMaxHp() { return MAX_HP; }
export function isPlayerInvulnerable() { return invuln > 0; }
export function isPlayerDead() { return hp <= 0; }

// Returns "hurt" | "died" | "ignored".
export function applyPlayerDamage(amount) {
  if (invuln > 0 || hp <= 0 || amount <= 0) return "ignored";
  hp = Math.max(0, hp - amount);
  invuln = INVULN_AFTER_HIT;
  notify();
  return hp <= 0 ? "died" : "hurt";
}

export function resetPlayerHealth() {
  hp = MAX_HP;
  invuln = 0;
  notify();
}

export function onPlayerHealthChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  for (const fn of listeners) fn(hp, MAX_HP);
}
