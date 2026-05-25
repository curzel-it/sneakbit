// Draws the world and the player into a 2D canvas context.
// Coordinates inside this module: world space in tile units coming in,
// pixel space going to the canvas. Conversion lives here only.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { getPlayerSpriteFrame } from "./player.js";

// Biome ids → fill colour, used until proper tile rendering lands.
// Matches the order in scripts/export_biome_tiles.py.
const BIOME_COLORS = [
  "#000000", // 0 Nothing
  "#5fa244", // 1 Grass
  "#3b6fb5", // 2 Water
  "#7a7a7a", // 3 Rock
  "#d8b06b", // 4 Desert (path)
  "#e8eef5", // 5 Snow
  "#5a3a1f", // 6 DarkWood
  "#a07a3a", // 7 LightWood
  "#3a3a3a", // 8 DarkRock
  "#b8d8ea", // 9 Ice
  "#3d7530", // 10 DarkGrass
  "#9a8a72", // 11 RockPlates
  "#d24a1f", // 12 Lava
  "#8a6a32", // 13 Farmland
  "#1f4060", // 14 DarkWater
  "#a87a4a", // 15 DarkSand
];

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export function render(renderer, world, camera, player) {
  const { ctx, canvas } = renderer;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawBiome(ctx, world, camera);
  drawPlayer(ctx, camera, player);
}

function drawBiome(ctx, world, camera) {
  const startCol = Math.max(0, Math.floor(camera.x));
  const startRow = Math.max(0, Math.floor(camera.y));
  const endCol = Math.min(world.cols, Math.ceil(camera.x + camera.w));
  const endRow = Math.min(world.rows, Math.ceil(camera.y + camera.h));

  for (let r = startRow; r < endRow; r++) {
    const row = world.biome[r];
    for (let c = startCol; c < endCol; c++) {
      const id = row[c] | 0;
      ctx.fillStyle = BIOME_COLORS[id] ?? "#222";
      const px = Math.round((c - camera.x) * TILE_SIZE);
      const py = Math.round((r - camera.y) * TILE_SIZE);
      ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }
}

function drawPlayer(ctx, camera, player) {
  const sheet = getSprite("heroes");
  const frame = getPlayerSpriteFrame(player);

  const sx = frame.x * TILE_SIZE;
  const sy = frame.y * TILE_SIZE;
  const sw = frame.w * TILE_SIZE;
  const sh = frame.h * TILE_SIZE;

  // The player is 1 tile wide and 2 tiles tall; align the bottom row with
  // the player's tile position so the feet sit on the cell, head pokes up.
  const px = Math.round((player.x - camera.x) * TILE_SIZE);
  const py = Math.round((player.y - camera.y - 1) * TILE_SIZE);

  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}
