// Footstep trails. When the player steps onto a snow tile a footstep
// sprite is dropped at their previous footprint; it cycles through its
// 15 animation frames and despawns. Lightweight: trails are kept in a
// per-zone list separate from `zone.entities` so they don't show up
// in collision / AI logic.

import { TILE_SIZE } from "./constants.js?v=20260528f";
import { BIOME } from "./biomes.js?v=20260528f";
import { getSprite } from "./assets.js?v=20260528f";

const TRAIL_SHEET = "humanoids_1x1"; // sheet 1014, same as Rust
const TRAIL_TEXTURE_X = 20;          // sprite_frame in species 1136
const TRAIL_TEXTURE_Y = 0;
const TRAIL_FRAMES = 15;
const TRAIL_FPS = 8;                 // frames per second
const TRAIL_LIFESPAN = TRAIL_FRAMES / TRAIL_FPS;

// direction → sprite-sheet row offset (the trail sheet uses the standard
// directional layout, same as other humanoids on sheet 1014).
const DIR_ROW = { up: 1, right: 3, down: 5, left: 7 };

// Tracks the last tile we left a footstep at, per zone identity, so we
// don't carry footsteps across teleports.
const lastTileByZone = new WeakMap();

export function tickTrails(zone, player, dt) {
  if (!zone) return;
  ensureList(zone);
  maybeSpawn(zone, player);
  advanceTrails(zone, dt);
}

function ensureList(zone) {
  if (!zone._trails) zone._trails = [];
}

function maybeSpawn(zone, player) {
  if (!player) return;
  const px = player.tileX | 0;
  const py = player.tileY | 0;
  const last = lastTileByZone.get(zone);
  if (last && last.x === px && last.y === py) return;
  lastTileByZone.set(zone, { x: px, y: py });
  if (last == null) return; // first tick — don't drop a trail before the player has moved
  if (!supportsTrails(zone, last.x, last.y)) return;
  zone._trails.push({
    x: last.x,
    y: last.y + 1, // sprite sits a tile below feet, like the Rust port
    direction: player.direction || "down",
    timer: 0,
  });
}

function advanceTrails(zone, dt) {
  const list = zone._trails;
  for (let i = list.length - 1; i >= 0; i--) {
    list[i].timer += dt;
    if (list[i].timer >= TRAIL_LIFESPAN) list.splice(i, 1);
  }
}

function supportsTrails(zone, tx, ty) {
  if (tx < 0 || ty < 0 || tx >= zone.cols || ty >= zone.rows) return false;
  return zone.biome[ty][tx] === BIOME.SNOW;
}

export function drawTrails(ctx, zone, camera) {
  if (!zone?._trails?.length) return;
  let sheet;
  try { sheet = getSprite(TRAIL_SHEET); } catch { return; }
  for (const t of zone._trails) {
    const frame = Math.min(TRAIL_FRAMES - 1, Math.floor(t.timer * TRAIL_FPS));
    const row = DIR_ROW[t.direction] ?? DIR_ROW.down;
    const sx = (TRAIL_TEXTURE_X + frame) * TILE_SIZE;
    const sy = (TRAIL_TEXTURE_Y + row) * TILE_SIZE;
    const px = Math.round((t.x - camera.x) * TILE_SIZE);
    const py = Math.round((t.y - camera.y - 1) * TILE_SIZE);
    ctx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE, px, py, TILE_SIZE, TILE_SIZE);
  }
}
