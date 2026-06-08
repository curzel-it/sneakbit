// Tower Defense stones: the pushable boulders that replace the old build shop.
// After every wave the run drops a handful of stones on free tiles inside the
// host's current view; the player builds their maze by simply walking a hero
// into a stone to shove it (the normal pushable path in player.js handles the
// shove — TD heroes are ordinary players). The horde routes around stones via
// the flow field, so the field is recomputed whenever a stone changes tile.
//
// This module owns three things: which tiles a stone blocks (for the flow
// field, the horde's stepping, and ally pathing), spawning stones into the
// view, and keeping the field in sync as stones move. Wall-off is allowed —
// there's deliberately no anti-seal guard here.

import { isWalkable, isEntityBlocked } from "./zone.js";
import { isPushable } from "./pushables.js";
import { getSpecies } from "./species.js";
import { recomputeField, getGoal, getSpawns } from "./tdBoard.js";
import { squadPlayers } from "./heroSwitch.js";

// The boulder species (PushableObject, 1×1, invulnerable, static_objects sheet).
export const STONE_SPECIES = 1030;

// How many stones drop after each wave.
export const STONES_PER_WAVE = 4;

// Negative-id pool for spawned stones — clear of the enemy pool (-2_000_000…)
// and the (removed) build pool (-3_000_000…) so ids never collide.
let nextStoneId = -4_000_000;

export function resetStones() {
  nextStoneId = -4_000_000;
}

// True if a live stone's footprint covers tile (x, y). Replaces the old
// barrel-based tdObstacleAt as the horde's "blocked by what the player built"
// query — shared by tdBoard's flow field, tdEnemies' stepping, and allyAI.
export function stoneBlocksTile(zone, x, y) {
  const ents = zone?.entities;
  if (!ents) return false;
  for (const e of ents) {
    if (e._dying) continue;
    if (!isPushable(e)) continue;
    const f = e.frame;
    if (!f) continue;
    if (x < f.x || x >= f.x + f.w) continue;
    if (y < f.y || y >= f.y + f.h) continue;
    return true;
  }
  return false;
}

export function stoneCount(zone) {
  if (!zone?.entities) return 0;
  return zone.entities.filter((e) => isPushable(e) && !e._dying).length;
}

// Drop `count` stones on random free tiles inside the host's current view.
// "Free" means in-bounds and visible, walkable, not blocked by another entity,
// not already a stone, not the goal or a spawn, and not under a hero. Spawns
// fewer than `count` if the view can't fit that many.
//
// `near` (a tile) + `radius` narrow the candidates to a square around a point —
// used for the opening drop so the first stones land close to the squad and
// stay on-screen on a tall phone (whose visible area is narrower than the
// camera rect), rather than scattering to the rect's far edges.
export function spawnStonesInView(state, count = STONES_PER_WAVE, { near = null, radius = 0 } = {}) {
  const zone = state?.zone;
  const cam = state?.camera;
  if (!zone || !cam) return [];

  const heroTiles = new Set(
    squadPlayers(state).map((p) => `${p.tileX | 0},${p.tileY | 0}`),
  );
  const goal = getGoal();
  const spawns = getSpawns();
  const isSpawnTile = (x, y) => spawns.some((s) => s.x === x && s.y === y);

  let x0 = Math.max(0, Math.floor(cam.x));
  let x1 = Math.min(zone.cols - 1, Math.floor(cam.x + cam.w));
  let y0 = Math.max(0, Math.floor(cam.y));
  let y1 = Math.min(zone.rows - 1, Math.floor(cam.y + cam.h));
  if (near && radius > 0) {
    x0 = Math.max(x0, (near.x | 0) - radius);
    x1 = Math.min(x1, (near.x | 0) + radius);
    y0 = Math.max(y0, (near.y | 0) - radius);
    y1 = Math.min(y1, (near.y | 0) + radius);
  }

  const free = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!isWalkable(zone, x, y)) continue;
      if (isEntityBlocked(zone, x, y)) continue;        // also rejects existing stones
      if (goal && goal.x === x && goal.y === y) continue;
      if (isSpawnTile(x, y)) continue;
      if (heroTiles.has(`${x},${y}`)) continue;
      free.push({ x, y });
    }
  }

  shuffle(free);
  const sp = getSpecies(STONE_SPECIES);
  const w = Math.max(1, sp?.width || sp?.sprite_frame?.w || 1);
  const h = Math.max(1, sp?.height || sp?.sprite_frame?.h || 1);

  const placed = [];
  for (const t of free.slice(0, Math.max(0, count | 0))) {
    const ent = {
      id: nextStoneId--,
      species_id: STONE_SPECIES,
      direction: "Down",
      frame: { x: t.x, y: t.y, w, h },
      _invulnerable: true,
      _tdTile: { x: t.x, y: t.y },
    };
    zone.entities.push(ent);
    placed.push(ent);
  }
  if (placed.length) recomputeField(zone);
  return placed;
}

// Keep the flow field in step with the stones the player shoves around. Called
// each frame: if any stone has changed tile since we last looked, refresh its
// remembered tile and recompute the field once so the horde reroutes.
export function reconcileStones(state) {
  const zone = state?.zone;
  if (!zone?.entities) return;
  let moved = false;
  for (const e of zone.entities) {
    if (!isPushable(e) || !e._tdTile) continue;
    const tx = e.frame.x | 0;
    const ty = e.frame.y | 0;
    if (tx !== e._tdTile.x || ty !== e._tdTile.y) {
      e._tdTile.x = tx;
      e._tdTile.y = ty;
      moved = true;
    }
  }
  if (moved) recomputeField(zone);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
