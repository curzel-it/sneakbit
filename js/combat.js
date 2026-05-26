// Combat resolution: bullets vs entities, and melee monsters vs player.
// Lives separately from shooting.js (which only handles spawning + flight
// physics for player-thrown bullets) so the hit/damage logic is shared
// across attackers and isolated from the input layer.
//
// Damage model mirrors the original: damage = dps * dt while overlapping.
// Bullets pass through targets they don't kill in the same frame.

import { getSpecies } from "./species.js";
import { isWalkable } from "./world.js";
import { playSfx } from "./audio.js";
import { applyPlayerDamage, isPlayerInvulnerable } from "./playerHealth.js";

const BULLET_HITTABLE_INSET = 0.2; // matches Rust core bullet_hittable_frame

// Run one combat tick. Returns void; mutates world.entities (splices on
// kill) and player health via playerHealth.js.
export function tickCombat(world, player, dt) {
  if (!world?.entities) return;
  resolveBullets(world, dt);
  resolveMeleeMonsters(world, player, dt);
}

function resolveBullets(world, dt) {
  const ents = world.entities;
  for (let i = ents.length - 1; i >= 0; i--) {
    const b = ents[i];
    if (!b._spawned) continue;
    const bsp = getSpecies(b.species_id);
    if (!bsp) continue;

    // Wall / impassable construction → bullet stops.
    if (bulletHitsWall(b, world)) {
      ents.splice(i, 1);
      continue;
    }

    // Damage every overlapping target (bullets pass through if none die).
    let consumed = false;
    const hitbox = bulletHitbox(b);
    for (let j = ents.length - 1; j >= 0; j--) {
      if (j === i) continue;
      const t = ents[j];
      if (t._spawned) continue;
      const tsp = getSpecies(t.species_id);
      if (!tsp || !isBulletTarget(tsp)) continue;
      if (!rectsOverlap(hitbox, entityHittable(t, tsp))) continue;

      const dps = bsp.dps || 0;
      t._hp = (t._hp ?? tsp.hp ?? 100) - dps * dt;
      if (t._hp <= 0) {
        playSfx("deathMonster");
        ents.splice(j, 1);
        if (j < i) i -= 1;
        consumed = true;
      }
    }
    if (consumed) ents.splice(i, 1);
  }
}

function resolveMeleeMonsters(world, player, dt) {
  if (isPlayerInvulnerable()) return;
  const playerHitbox = playerHittable(player);
  for (const e of world.entities) {
    if (e._spawned) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (sp.entity_type !== "CloseCombatMonster") continue;
    const dps = sp.dps || 0;
    if (dps <= 0) continue;
    if (!rectsOverlap(playerHitbox, entityHittable(e, sp))) continue;
    const result = applyPlayerDamage(dps * dt);
    if (result === "hurt" || result === "died") break;
  }
}

function bulletHitsWall(b, world) {
  const f = b.frame;
  const cx = f.x + f.w * 0.5;
  const cy = f.y + f.h * 0.5;
  const tx = Math.floor(cx);
  const ty = Math.floor(cy);
  if (!isWalkable(world, tx, ty)) return true;
  for (const o of world.entities) {
    if (o === b) continue;
    if (o._spawned) continue;
    const sp = getSpecies(o.species_id);
    if (!sp || !sp.is_rigid) continue;
    if (sp.entity_type === "Teleporter") continue;
    const of = o.frame;
    if (!of) continue;
    if (cx < of.x || cx > of.x + of.w) continue;
    if (cy < of.y || cy > of.y + of.h) continue;
    return true;
  }
  return false;
}

function isBulletTarget(sp) {
  return sp.entity_type === "CloseCombatMonster";
}

export function bulletHitbox(b) {
  const f = b.frame;
  const horiz = b.direction === "Right" || b.direction === "Left";
  const ox = horiz ? 0 : BULLET_HITTABLE_INSET;
  const oy = horiz ? BULLET_HITTABLE_INSET : 0;
  return { x: f.x + ox, y: f.y + oy, w: f.w - ox * 2, h: f.h - oy * 2 };
}

export function entityHittable(e, sp) {
  const f = e.frame;
  if (sp.entity_type === "CloseCombatMonster" || sp.entity_type === "Npc") {
    const yOff = f.h > 1 ? 1.15 : 0.1;
    const xOff = 0.15;
    return {
      x: f.x + xOff,
      y: f.y + yOff,
      w: f.w - xOff * 2,
      h: f.h - (f.h > 1 ? 1.35 : 0.2),
    };
  }
  return { x: f.x, y: f.y, w: f.w, h: f.h };
}

export function playerHittable(player) {
  // Hero is 1x2 in sprite, occupies one tile of collision.
  return {
    x: player.x + 0.15,
    y: player.y + 0.15,
    w: 0.7,
    h: 0.7,
  };
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
