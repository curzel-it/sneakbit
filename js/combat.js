// Combat resolution: bullets vs entities, bullets vs players, and melee
// monsters vs every live player.
// Lives separately from shooting.js (which only handles spawning + flight
// physics for player-thrown bullets) so the hit/damage logic is shared
// across attackers and isolated from the input layer.
//
// Damage model mirrors the original: damage = dps * dt while overlapping.
// Bullets pass through targets they don't kill in the same frame.

import { getSpecies } from "./species.js";
import { isWalkable } from "./zone.js";
import { playSfx } from "./audio.js";
import { applyPlayerContinuousDamage, applyPlayerDamage, isPlayerDead } from "./playerHealth.js";
import { hasPiercingKnifeSkill, hasBoomerangSkill, hasBulletCatcherSkill } from "./skills.js";
import { addAmmo } from "./inventory.js";
import { isExplosive } from "./explosives.js";
import { isCreativeMode } from "./creativeMode.js";
import { getSettings } from "./settings.js";
import { startDeathAnimation, tickDeathAnimations } from "./deathAnimation.js";
import { isPvp } from "./gameMode.js";

// Player-vs-player hit listeners. pvpMatch.js subscribes to apply the
// turn clamp ("hit and the clock cuts") without combat.js importing it —
// same registry shape as onPlayerHealthChange. (victimIndex, ownerIndex).
const pvpHitListeners = new Set();
export function onPlayerVsPlayerHit(fn) {
  pvpHitListeners.add(fn);
  return () => pvpHitListeners.delete(fn);
}
function emitPlayerVsPlayerHit(victimIdx, ownerIdx) {
  for (const fn of pvpHitListeners) fn(victimIdx, ownerIdx);
}

const BULLET_HITTABLE_INSET = 0.2; // matches Rust core bullet_hittable_frame
const KUNAI_SPECIES_ID = 7000;
const BOUNCE_LIFESPAN_BONUS = 0.8;
// A melee monster damages the player when its (feet) tile center is
// within this Euclidean distance of the player's tile center. ≈1 tile
// (covers the case where a monster on an adjacent tile starts sliding
// towards us — by progress 0.1 it's already in range).
const MELEE_DAMAGE_RADIUS = 0.9;
// Spawned at the hit position when a non-fatal damage tick lands on a
// monster — mirrors Rust SPECIES_DAMAGE_INDICATOR + the 0.2s lifespan
// from hits_handling_use_case.rs:49. Renders via the normal entity
// pipeline (sheet 1012 / animated_objects, 4-frame anim, z=99 overlay).
const DAMAGE_INDICATOR_SPECIES_ID = 1178;
const DAMAGE_INDICATOR_LIFESPAN = 0.2;
let nextIndicatorId = -1_000_000;

// Run one combat tick. Returns void; mutates zone.entities (splices on
// kill) and player health via playerHealth.js.
// `player` may be a single player object (single-player) or an array of
// players (co-op).
export function tickCombat(zone, player, dt) {
  if (!zone?.entities) return;
  const players = toLivePlayers(player);
  resolveBullets(zone, players, dt);
  resolveMeleeMonsters(zone, players, dt);
  tickDamageIndicators(zone, dt);
  tickDeathAnimations(zone, dt);
}

function toLivePlayers(player) {
  const arr = Array.isArray(player) ? player : (player ? [player] : []);
  // Filter to "alive" — a dead co-op player is invisible and not damageable.
  return arr.filter(p => !isPlayerDead(p?.index | 0));
}

// Ages damage-indicator entities and removes them when their lifespan
// runs out. Spawned by `resolveBullets` whenever a non-fatal hit lands.
function tickDamageIndicators(zone, dt) {
  const ents = zone.entities;
  for (let i = ents.length - 1; i >= 0; i--) {
    const e = ents[i];
    if (!e._damageIndicator) continue;
    e._lifespan -= dt;
    if (e._lifespan <= 0) ents.splice(i, 1);
  }
}

function spawnDamageIndicator(zone, hittable, parentId) {
  zone.entities.push({
    id: nextIndicatorId--,
    species_id: DAMAGE_INDICATOR_SPECIES_ID,
    _damageIndicator: true,
    _lifespan: DAMAGE_INDICATOR_LIFESPAN,
    parent_id: parentId,
    is_consumable: false,
    direction: "Down",
    frame: { x: hittable.x, y: hittable.y, w: hittable.w, h: hittable.h },
    dialogues: [],
  });
}

function resolveBullets(zone, players, dt) {
  const ents = zone.entities;
  // PvP forces friendly fire on regardless of the user setting (Rust
  // allows_pvp() gates the player-bullet-hits-player path).
  const friendlyFire = !!getSettings().friendlyFire || isPvp();
  for (let i = ents.length - 1; i >= 0; i--) {
    const b = ents[i];
    if (!b._spawned) continue;
    const bsp = getSpecies(b.species_id);
    if (!bsp) continue;

    // Catcher / catch-event: a bounced bullet has returned to one of the
    // players. Original behavior: the bullet always despawns; with the
    // catcher skill it also refunds one of itself into the bullet's
    // owning player's ammo (mirrors Rust hits_handling_use_case.rs).
    if (b._bounced) {
      const catcher = findOverlappingPlayer(b, players);
      if (catcher) {
        if (hasBulletCatcherSkill() && bsp.supports_bullet_catching) {
          addAmmo(b.species_id, 1, b._playerIndex | 0);
        }
        ents.splice(i, 1);
        continue;
      }
    }

    // Bullet-vs-player: when friendly fire is on, a bullet whose owning
    // player index doesn't match the player it overlaps applies damage.
    // Out-of-co-op (single player) the bullet's _playerIndex is 0 and
    // there's only one player, so the check is a no-op.
    if (friendlyFire) {
      const victim = findOverlappingPlayer(b, players);
      if (victim) {
        const victimIdx = victim.index | 0;
        const ownerIdx = b._playerIndex | 0;
        if (victimIdx !== ownerIdx) {
          const dps = (b._dpsOverride != null ? b._dpsOverride : bsp.dps) || 0;
          // Bullets hit briefly and pass through — treat them as a burst
          // (with invuln gate) rather than a sustained continuous tick.
          const result = applyPlayerDamage(dps * damageMultiplier(b) * dt, victim);
          // In PvP, a landed hit cuts the shooter's turn to ≤2s.
          if (isPvp() && result !== "ignored") emitPlayerVsPlayerHit(victimIdx, ownerIdx);
          if (!tryBounce(b, bsp)) ents.splice(i, 1);
          continue;
        }
      }
    }

    // Wall / impassable construction → bullet stops (or bounces).
    if (bulletHitsWall(b, zone)) {
      if (!tryBounce(b, bsp)) ents.splice(i, 1);
      continue;
    }

    // Damage every overlapping target (bullets pass through if none die).
    let consumed = false;
    const hitbox = bulletHitbox(b);
    const dmgMul = damageMultiplier(b);
    for (let j = ents.length - 1; j >= 0; j--) {
      if (j === i) continue;
      const t = ents[j];
      if (t._spawned) continue;
      // A dying entity is already a fireball — bullets pass through it
      // instead of re-triggering its death (which would reset the timer).
      if (t._dying) continue;
      // Off-screen targets don't take bullet damage. Matches Rust's hitmap
      // gating — a kunai launched towards a tile the player can no longer
      // see passes harmlessly through it.
      if (t._visible === false) continue;
      const tsp = getSpecies(t.species_id);
      if (!tsp || !isBulletTarget(tsp)) continue;
      if (!rectsOverlap(hitbox, entityHittable(t, tsp))) continue;

      const dps = (b._dpsOverride != null ? b._dpsOverride : bsp.dps) || 0;
      t._hp = (t._hp ?? tsp.hp ?? 100) - dps * dmgMul * dt;
      if (t._hp <= 0) {
        playSfx(isExplosive(t.species_id) ? "smallExplosion" : "deathMonster");
        // Don't splice: turn the target into a fireball that lingers for a
        // beat before tickDeathAnimations removes it. It's flagged `_dying`
        // so it stops blocking, fusing, attacking and taking further hits.
        startDeathAnimation(t);
        consumed = true;
      } else {
        spawnDamageIndicator(zone, entityHittable(t, tsp), b.parent_id ?? b.id);
      }
    }
    if (consumed) {
      if (!tryBounce(b, bsp)) ents.splice(i, 1);
    }
  }
}

function damageMultiplier(b) {
  return (b.species_id === KUNAI_SPECIES_ID && hasPiercingKnifeSkill()) ? 2 : 1;
}

// Tries to bounce the bullet instead of removing it. Returns true if the
// bullet survives (and should stay in the entities list).
function tryBounce(b, bsp) {
  if (b._bounced) return false;
  if (!bsp.supports_bullet_boomerang) return false;
  if (!hasBoomerangSkill()) return false;
  b._vx = -b._vx;
  b._vy = -b._vy;
  b.direction = oppositeDir(b.direction);
  // Match the original: push the bullet one tile in the new direction so
  // it clears whatever it just stopped on.
  b.frame.x += Math.sign(b._vx);
  b.frame.y += Math.sign(b._vy);
  b._bounced = true;
  b._lifespan = (b._lifespan ?? 0) + BOUNCE_LIFESPAN_BONUS;
  playSfx("bulletBounced");
  return true;
}

function oppositeDir(d) {
  return { Up: "Down", Down: "Up", Left: "Right", Right: "Left" }[d] || d;
}

function findOverlappingPlayer(b, players) {
  const hb = bulletHitbox(b);
  for (const p of players) {
    if (!p) continue;
    if (rectsOverlap(hb, playerHittable(p))) return p;
  }
  return null;
}

function resolveMeleeMonsters(zone, players, dt) {
  if (!players.length) return;
  // Creative mode: monsters can be inspected next to the hero without
  // chewing through HP. Mirrors Rust features/monsters.rs returning
  // before handle_melee_attack runs.
  if (isCreativeMode()) return;
  // Off-screen monsters can't damage the player. Matches Rust's hitmap-
  // based attack resolution and prevents unseen "ghost" damage from
  // critters lurking past the camera edge.
  const list = zone.visibleEntities ?? zone.entities;
  for (const e of list) {
    if (e._spawned) continue;
    if (e._dying) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (sp.entity_type !== "CloseCombatMonster") continue;
    const dps = sp.dps || 0;
    if (dps <= 0) continue;
    for (const p of players) {
      const px = p.x + 0.5;
      const py = p.y + 0.5;
      if (!withinMeleeRange(e, sp, px, py)) continue;
      applyPlayerContinuousDamage(dps * dt, p);
    }
  }
}

// True if the mob's feet-tile centre is inside MELEE_DAMAGE_RADIUS of the
// player's tile centre. The "feet" tile is the lower row for 1x2 sprites,
// matching the player's collision tile, so this is symmetric.
function withinMeleeRange(e, sp, px, py) {
  const f = e.frame;
  const feetH = sp.height || f.h || 1;
  const cx = f.x + (f.w || 1) * 0.5;
  const cy = f.y + (feetH - 0.5);
  const dx = cx - px;
  const dy = cy - py;
  return (dx * dx + dy * dy) <= MELEE_DAMAGE_RADIUS * MELEE_DAMAGE_RADIUS;
}

function bulletHitsWall(b, zone) {
  const f = b.frame;
  const cx = f.x + f.w * 0.5;
  const cy = f.y + f.h * 0.5;
  const tx = Math.floor(cx);
  const ty = Math.floor(cy);
  if (!isWalkable(zone, tx, ty)) return true;
  for (const o of zone.entities) {
    if (o === b) continue;
    if (o._spawned) continue;
    if (o._dying) continue;
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
  if (sp.entity_type === "CloseCombatMonster") return true;
  // Explosive barrels are StaticObjects but bullets break them — Rust
  // routes the kill through the normal damage path (sound_effects.rs
  // swaps the death SFX based on is_explosive). Their HP comes from the
  // species' `hp` field (defaults to 100), so a single kunai chips a
  // small amount, and a sword swing destroys most barrels in one hit.
  if (isExplosive(sp.id)) return true;
  return false;
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
