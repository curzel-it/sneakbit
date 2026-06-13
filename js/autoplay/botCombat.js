// Combat layer for the autoplay bot — the plan's M3 "hold-and-shoot
// kiting" (docs/autoplay-phase2-bot-plan.md, phase-1 handoff). SneakBit's
// melee monsters are non-rigid chasers that deal heavy contact damage
// (a 1001 blackberry's 170 dps kills the 100-HP hero in ~0.6 s), while a
// single kunai pass deals ~250+ (bullets fly THROUGH targets at dps*dt),
// so the winning move is to SHOOT them, not to push through:
//
//   - A monster within engage range and a usable ranged weapon → line up
//     a cardinal shot (rotate, or sidestep onto its row/column when it's
//     close) and fire. Chasers walk into the firing line on their own.
//   - A bullet-spongy survivor on top of us → kite: step back along the
//     firing line between shots; the monster follows, staying aligned.
//   - Equipped weapon out of ammo but another has rounds (pickups
//     auto-equip whatever was walked over — e.g. an AR-15 with no 5.56)
//     → re-equip the usable one first.
//   - No ammo anywhere → the old avoidance behavior: ignore monsters
//     while healthy (navigation routes around them via the halo), break
//     away only when hurt with a monster on top of us. Reacting to every
//     nearby monster freezes progress — the prototype's flee-vs-nav
//     oscillation lesson still stands for the unarmed case.
//
// Death is handled in bot.js (the game-over overlay is dismissed by the
// dialogue janitor → respawn at the zone spawn point).

import { getSpecies } from "../species.js";
import { shouldBeVisible } from "../entityVisibility.js";
import { isDying } from "../deathAnimation.js";
import { getPlayerHp, getPlayerMaxHp } from "../playerHealth.js";
import { getAmmo } from "../inventory.js";
import { weaponsInSlot } from "../weaponSlots.js";
import { getEquipped, SLOT_RANGED, SLOT_MELEE } from "../equipment.js";
import { isWalkable } from "../zone.js";
import { isNavWalkable } from "./botNav.js";

const KUNAI_BULLET_SPECIES_ID = 7000;

// Engage a monster inside this Manhattan range (their chase vision is 6 —
// anything within 5 is already coming for us; farther ones aren't worth
// the ammo).
const SHOOT_RANGE = 5;
// Close enough that we actively sidestep onto the monster's row/column
// instead of waiting for the chase to align it.
const ALIGN_RANGE = 3;
// A survivor this hurt-resistant gets kited (step back between shots)
// once it's adjacent — roughly more HP than one kunai pass removes.
const KITE_HP = 300;
// Unarmed: a monster only triggers a defensive reaction inside this range.
const DANGER_RANGE = 2;
// Monsters within this range are folded into the flee direction so we break
// away from a cluster, not just the single nearest.
const CLUSTER_RANGE = 4;
// Unarmed: flee once HP drops to this fraction — above it, navigation's
// avoid-halo keeps us clear and we push through the chip damage. Fleeing on
// mere adjacency instead got the bot stuck dancing beside monster clusters
// forever (flee-vs-nav), so unarmed survival is gated on HP, not proximity.
const LOW_HP_FRACTION = 0.4;

const DIRS = [
  { name: "up", dx: 0, dy: -1 },
  { name: "down", dx: 0, dy: 1 },
  { name: "left", dx: -1, dy: 0 },
  { name: "right", dx: 1, dy: 0 },
];
const DIR_DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const OPPOSITE = { up: "down", down: "up", left: "right", right: "left" };

// Returns null when nothing needs handling (orchestrator keeps navigating),
// or a combat intent for bot.js:
//   { equipMelee: weaponId }  — equip an owned melee weapon (sword)
//   { melee: true, target }   — swing at an adjacent monster (no ammo, no move)
//   { equip: weaponId }       — swap to a ranged weapon that has ammo
//   { shoot: true, target }   — facing an aligned monster; fire
//   { face: dir }             — rotate toward an aligned monster
//   { move: dir }             — sidestep to align / kite / close to melee range
//   { flee: dir }             — weaponless and hurt; break contact
//   { hold: true }            — cornered; brace and hope for regen
//
// Melee is the workhorse when the hero owns a sword: the swing hits a cross
// (own tile + 4 neighbors), so an adjacent monster dies without aiming, costs
// no ammo, and — crucially — never moves the hero, so it stays safe mid-Sokoban
// (a monster that wanders onto the push line gets cut down instead of wedging
// the plan). Ranged stays the tool for monsters still at distance; the old
// avoid/flee survival is the last resort only when no weapon is usable.
//
// opts.steady suppresses the { move } intents (align sidesteps, kiting, closing
// to melee): mid-Sokoban a displaced player breaks the push plan and forces a
// re-solve, so during puzzle execution the bot only swings/shoots what comes to
// it (chasers do, on their own) and never repositions.
export function decideCombat(state, opts = {}) {
  const player = state.player;
  const zone = state.zone;
  if (!player || !zone) return null;
  const idx = player.index | 0;
  const steady = opts.steady === true;

  const monsters = nearbyMonsters(zone, player, SHOOT_RANGE);
  const threat = monsters[0]; // nearest, if any
  if (!threat) return null;

  // Make sure the blade / a loaded gun is in hand before deciding to fight.
  const melee = meleeReady(idx);
  if (melee?.equip != null) return { equipMelee: melee.equip };
  const armed = rangedReady(idx);
  if (armed?.equip != null) return { equip: armed.equip };

  // Mid-Sokoban (steady): the hero can't reposition without breaking the push
  // plan, so clear an adjacent monster (a push-line blocker) with a swing — it
  // doesn't move us — or shoot one that lines up. This is what lets a puzzle
  // finish in a monster-dense dungeon.
  if (steady) {
    if (melee?.ready) {
      const hit = monsters.find((m) => m.dist <= 1);
      if (hit) return { melee: true, target: hit.entity.id };
    }
    if (armed?.ready) return engagePlan(zone, player, monsters, true);
    return null;
  }

  // Free movement: shoot whatever lines up (chasers walk into the firing line),
  // as before. A shot needs alignment, so most ticks fall through to
  // navigation — this clears monsters WITHOUT pinning the hero.
  if (armed?.ready) {
    const engage = engagePlan(zone, player, monsters, false);
    if (engage) return engage;
  }

  // Whether to actively fight now turns on health. While healthy we let
  // navigation carry us past monsters (the avoid-halo routes around them and
  // chip damage regenerates) — turning to melee EVERY adjacent monster here
  // would pin the hero in a spawn cluster and stall the whole tour. Only when
  // HURT do we stand and fight: swing at anything adjacent, march onto the
  // nearest chaser to bring the blade to bear, else flee if weaponless.
  if (threat.dist > DANGER_RANGE) return null;
  const hp = getPlayerHp(idx);
  const maxHp = getPlayerMaxHp(idx);
  if (hp > maxHp * LOW_HP_FRACTION) return null;

  if (melee?.ready) {
    const hit = monsters.find((m) => m.dist <= 1);
    if (hit) return { melee: true, target: hit.entity.id };
    const near = monsters.find((m) => m.dist <= ALIGN_RANGE);
    if (near) {
      const step = stepToward(zone, player, near.tile);
      if (step) return { move: step };
    }
  }

  const away = fleeDir(zone, player, monsters.filter((m) => m.dist <= CLUSTER_RANGE));
  if (away) return { flee: away };
  return { hold: true }; // cornered — brace
}

// The shoot/face/move decision against the nearest workable target.
function engagePlan(zone, player, monsters, steady) {
  for (const m of monsters) {
    // Overlapping us — a bullet spawns one tile ahead and would fly right
    // past it. Step off first; it chases and re-aligns itself.
    if (m.dist === 0) {
      const away = fleeDir(zone, player, [m]);
      if (away && !steady) return { move: away };
      continue;
    }
    const dir = alignedDir(player, m.tile);
    if (dir && clearLine(zone, player, m.tile)) {
      if (player.direction !== dir) return { face: dir };
      // Adjacent bullet-sponge: kite a step back along the firing line so
      // its contact damage can't out-trade our dps.
      if (!steady && m.dist <= 1 && monsterHp(m.entity) > KITE_HP) {
        const back = OPPOSITE[dir];
        const [bx, by] = DIR_DELTA[back];
        if (isNavWalkable(zone, player.tileX + bx, player.tileY + by)) return { move: back };
      }
      return { shoot: true, target: m.entity.id };
    }
    if (!steady && m.dist <= ALIGN_RANGE) {
      const move = alignStep(zone, player, m);
      if (move) return { move };
    }
  }
  return null; // nothing workable — keep navigating, chasers will line up
}

// A melee weapon ready to swing ({ ready: true }) — a sword is equipped;
// otherwise an owned-but-unequipped one to switch to ({ equip: id }); null
// when the hero owns no blade. Melee has no default weapon (unlike ranged),
// so an empty SLOT_MELEE just means we never picked one up.
function meleeReady(idx) {
  const equipped = getEquipped(SLOT_MELEE, idx);
  if (equipped != null && getSpecies(equipped)?.entity_type === "WeaponMelee") return { ready: true };
  const owned = weaponsInSlot(SLOT_MELEE, idx).find((w) => w.species?.entity_type === "WeaponMelee");
  return owned ? { equip: owned.id } : null;
}

// One walkable step that closes the larger gap to a tile first — used to
// march into melee range of a chaser when out of ammo.
function stepToward(zone, player, t) {
  const dx = t.x - player.tileX;
  const dy = t.y - player.tileY;
  const xStep = dx > 0 ? "right" : "left";
  const yStep = dy > 0 ? "down" : "up";
  const order = Math.abs(dx) >= Math.abs(dy) ? [xStep, yStep] : [yStep, xStep];
  for (const name of order) {
    const [sx, sy] = DIR_DELTA[name];
    if (isNavWalkable(zone, player.tileX + sx, player.tileY + sy)) return name;
  }
  return null;
}

// The equipped ranged weapon if it has ammo ({ ready: true }); otherwise
// the first owned ranged weapon that does ({ equip: id }) — pickups
// auto-equip whatever weapon was walked over, ammo or not. Null when no
// ranged weapon has any rounds.
function rangedReady(idx) {
  const weapon = getSpecies(getEquipped(SLOT_RANGED, idx));
  const bulletId = (weapon?.entity_type === "WeaponRanged" && weapon.bullet_species_id)
    || KUNAI_BULLET_SPECIES_ID;
  if (getAmmo(bulletId, idx) > 0) return { ready: true };
  const usable = weaponsInSlot(SLOT_RANGED, idx).find((w) => (w.ammo ?? 0) > 0);
  return usable ? { equip: usable.id } : null;
}

// Cardinal direction from the player to a tile sharing its row or column,
// or null when not aligned.
function alignedDir(player, t) {
  if (t.x === player.tileX) return t.y > player.tileY ? "down" : "up";
  if (t.y === player.tileY) return t.x > player.tileX ? "right" : "left";
  return null;
}

// Bullet-passability of the tiles strictly between player and target.
// isWalkable is a conservative proxy (bullets also clear water/lava, which
// walking doesn't — we just skip those shots and fall back to avoidance).
function clearLine(zone, player, t) {
  const dx = Math.sign(t.x - player.tileX);
  const dy = Math.sign(t.y - player.tileY);
  let x = player.tileX + dx;
  let y = player.tileY + dy;
  while (x !== t.x || y !== t.y) {
    if (!isWalkable(zone, x, y)) return false;
    x += dx;
    y += dy;
  }
  return true;
}

// One walkable step that puts the player on the monster's row or column,
// zeroing the smaller offset axis first (fewest steps to a firing line).
function alignStep(zone, player, m) {
  const dx = m.tile.x - player.tileX;
  const dy = m.tile.y - player.tileY;
  const xStep = dx > 0 ? "right" : "left";
  const yStep = dy > 0 ? "down" : "up";
  const order = Math.abs(dx) <= Math.abs(dy) ? [xStep, yStep] : [yStep, xStep];
  for (const name of order) {
    const [sx, sy] = DIR_DELTA[name];
    if (isNavWalkable(zone, player.tileX + sx, player.tileY + sy)) return name;
  }
  return null;
}

function monsterHp(e) {
  return e._hp ?? getSpecies(e.species_id)?.hp ?? 100;
}

// Tiles to route navigation AROUND: each nearby monster's feet tile plus its
// 4 neighbors, for monsters within `range` of the player. Keeps the hero a
// tile clear of wandering monsters without a permanent avoid-overlay (the
// path BFS treats these as blocked but falls back to push-through when they
// seal a corridor — see botNav).
export function monsterHalo(zone, player, range = 10) {
  const halo = new Set();
  for (const m of nearbyMonsters(zone, player, range)) {
    halo.add(`${m.tile.x},${m.tile.y}`);
    for (const d of DIRS) halo.add(`${m.tile.x + d.dx},${m.tile.y + d.dy}`);
  }
  return halo;
}

// Live CloseCombatMonsters within `range`, nearest first.
function nearbyMonsters(zone, player, range) {
  const out = [];
  for (const e of zone.entities) {
    if (!e.frame) continue;
    const sp = getSpecies(e.species_id);
    if (!sp || sp.entity_type !== "CloseCombatMonster") continue;
    if (e._dying || isDying(e) || !shouldBeVisible(e)) continue;
    const tile = { x: e.frame.x | 0, y: (e.frame.y + (e.frame.h | 0 || 1) - 1) | 0 };
    const dist = Math.abs(tile.x - player.tileX) + Math.abs(tile.y - player.tileY);
    if (dist <= range) out.push({ entity: e, tile, dist });
  }
  out.sort((a, b) => a.dist - b.dist);
  return out;
}

// The walkable cardinal step that most increases the summed distance to the
// nearby monsters, or null if no neighbor improves it (truly cornered).
function fleeDir(zone, player, monsters) {
  let best = null;
  let bestScore = sumDist(player.tileX, player.tileY, monsters);
  for (const d of DIRS) {
    const nx = player.tileX + d.dx;
    const ny = player.tileY + d.dy;
    if (!isNavWalkable(zone, nx, ny)) continue;
    const score = sumDist(nx, ny, monsters);
    if (score > bestScore) { bestScore = score; best = d.name; }
  }
  return best;
}

function sumDist(x, y, monsters) {
  let s = 0;
  for (const m of monsters) s += Math.abs(m.tile.x - x) + Math.abs(m.tile.y - y);
  return s;
}
