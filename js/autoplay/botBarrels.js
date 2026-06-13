// Opportunistic barrel-smashing for the autoplay bot. Barrels (StaticObject,
// isExplosive — species 1038/1039/1073/1074) are rigid props that die to a
// single sword swing (combat.js: ~450-dps melee cross vs ~100 HP) and drop
// coins / ammo (lootDrops.js). The engine auto-collects the scatter when the
// hero walks over it (pickups.js), so all the bot has to do is reach a tile
// next to a barrel, face it, and swing.
//
// This is FILLER, slotted after real objectives and puzzles but before leaving
// the zone (bot.planNext): only with a sword in hand, only for barrels within a
// short detour (MAX_DETOUR — never chase one across the zone), and never under
// a monster threat or mid-Sokoban (combat / `steady` preempt in bot.js). A
// barrel that turns out unreachable or unbreakable is parked in blockedThisZone
// so the tour doesn't loop on it.

import { getSpecies } from "../species.js";
import { isExplosive } from "../explosives.js";
import { getEquipped, SLOT_MELEE } from "../equipment.js";
import { weaponsInSlot } from "../weaponSlots.js";
import { isNavWalkable, findPath } from "./botNav.js";

// Don't walk more than this many tiles out of the way for a barrel — loot is a
// bonus, not worth derailing the tour.
const MAX_DETOUR = 12;

const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
  { dx: 1, dy: 0 },
];

// The hero owns a melee weapon (sword) — barrels only break to melee.
export function hasSword(idx) {
  const equipped = getEquipped(SLOT_MELEE, idx);
  if (equipped != null && getSpecies(equipped)?.entity_type === "WeaponMelee") return true;
  return weaponsInSlot(SLOT_MELEE, idx).some((w) => w.species?.entity_type === "WeaponMelee");
}

// Live barrels in the zone, each with its bottom (blocking) tile. A barrel is a
// 1×2 sprite; its frame.y is the TOP, feet one tile below.
export function nearbyBarrels(zone) {
  const out = [];
  for (const e of zone.entities) {
    if (!e.frame || e._dying) continue;
    if (!isExplosive(e.species_id)) continue;
    const tile = { x: e.frame.x | 0, y: (e.frame.y + (e.frame.h | 0 || 1) - 1) | 0 };
    out.push({ entity: e, tile });
  }
  return out;
}

// Walkable cardinal neighbours of the barrel's feet tile — the only tiles a
// swing can hit it from. A barrel's hittable box is just its bottom tile
// (combat.js entityHittable: the top tile of the 1×2 sprite is empty), and the
// sword's cross covers all four neighbours of the hero on swing, so standing on
// any feet-tile neighbour and swinging lands a hit. Returned as an "x,y" Set (a
// findPath goal) and a {x,y} array (a nav goal).
function standTiles(zone, feet) {
  const set = new Set();
  const tiles = [];
  for (const d of DIRS) {
    const nx = feet.x + d.dx;
    const ny = feet.y + d.dy;
    if (!isNavWalkable(zone, nx, ny)) continue;
    set.add(`${nx},${ny}`);
    tiles.push({ x: nx, y: ny });
  }
  return { set, tiles };
}

// The cardinal direction to face the barrel's feet tile (for a deliberate-
// looking swing — the cross hits it from any neighbour regardless). Null if the
// hero isn't cardinally adjacent to it.
export function faceDirToBarrel(player, feet) {
  const fx = player.tileX;
  const fy = player.tileY;
  if (feet.x === fx && feet.y < fy) return "up";
  if (feet.x === fx && feet.y > fy) return "down";
  if (feet.y === fy && feet.x < fx) return "left";
  if (feet.y === fy && feet.x > fx) return "right";
  return null;
}

// The nearest reachable barrel worth a detour, or null. Returns the entity, its
// bottom tile, the stand-tile nav goal, and the path (for deadline sizing).
// `skip` is the bot's blockedThisZone set (keys "barrel:<id>").
export function planBarrel(zone, player, skip) {
  const idx = player.index | 0;
  if (!hasSword(idx)) return null;
  let best = null;
  for (const b of nearbyBarrels(zone)) {
    if (skip.has(`barrel:${b.entity.id}`)) continue;
    const stands = standTiles(zone, b.tile);
    if (!stands.tiles.length) continue;
    const path = findPath(zone, { x: player.tileX, y: player.tileY }, stands.set);
    if (!path || path.length > MAX_DETOUR) continue;
    if (!best || path.length < best.path.length) {
      best = { entity: b.entity, barrelTile: b.tile, standTiles: stands.tiles, path };
    }
  }
  return best;
}
