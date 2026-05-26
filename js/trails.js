// Footstep trails. When the player steps onto a snow tile a footstep
// sprite is dropped at their previous footprint; it cycles through its
// 15 animation frames and despawns. Lightweight: trails are kept in a
// per-world list separate from `world.entities` so they don't show up
// in collision / AI logic.

import { TILE_SIZE } from "./constants.js";
import { BIOME } from "./biomes.js";
import { getSprite } from "./assets.js";

const TRAIL_SHEET = "humanoids_1x1"; // sheet 1014, same as Rust
const TRAIL_TEXTURE_X = 20;          // sprite_frame in species 1136
const TRAIL_TEXTURE_Y = 0;
const TRAIL_FRAMES = 15;
const TRAIL_FPS = 8;                 // frames per second
const TRAIL_LIFESPAN = TRAIL_FRAMES / TRAIL_FPS;

// direction → sprite-sheet row offset (the trail sheet uses the standard
// directional layout, same as other humanoids on sheet 1014).
const DIR_ROW = { up: 1, right: 3, down: 5, left: 7 };

// Tracks the last tile we left a footstep at, per world identity, so we
// don't carry footsteps across teleports.
const lastTileByWorld = new WeakMap();

export function tickTrails(world, player, dt) {
  if (!world) return;
  ensureList(world);
  maybeSpawn(world, player);
  advanceTrails(world, dt);
}

function ensureList(world) {
  if (!world._trails) world._trails = [];
}

function maybeSpawn(world, player) {
  if (!player) return;
  const px = player.tileX | 0;
  const py = player.tileY | 0;
  const last = lastTileByWorld.get(world);
  if (last && last.x === px && last.y === py) return;
  lastTileByWorld.set(world, { x: px, y: py });
  if (last == null) return; // first tick — don't drop a trail before the player has moved
  if (!supportsTrails(world, last.x, last.y)) return;
  world._trails.push({
    x: last.x,
    y: last.y + 1, // sprite sits a tile below feet, like the Rust port
    direction: player.direction || "down",
    timer: 0,
  });
}

function advanceTrails(world, dt) {
  const list = world._trails;
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].timer += dt;
    if (list[i].timer >= TRAIL_LIFESPAN) list.splice(i, 1);
  }
}

function supportsTrails(world, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= world.cols || ty >= world.rows) return false;
  return world.biome[ty][tx] === BIOME.SNOW;
}

export function drawTrails(ctx, world, camera) {
  if (!world?._trails?.length) return;
  let sheet;
  try { sheet = getSprite(TRAIL_SHEET); } catch { return; }
  for (const t of world._trails) {
    const frame = Math.min(TRAIL_FRAMES - 1, Math.floor(t.timer * TRAIL_FPS));
    const row = DIR_ROW[t.direction] ?? DIR_ROW.down;
    const sx = (TRAIL_TEXTURE_X + frame) * TILE_SIZE;
    const sy = (TRAIL_TEXTURE_Y + row) * TILE_SIZE;
    const px = Math.round((t.x - camera.x) * TILE_SIZE);
    const py = Math.round((t.y - camera.y - 1) * TILE_SIZE);
    ctx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE, px, py, TILE_SIZE, TILE_SIZE);
  }
}
