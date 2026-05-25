// Draws the world and player into a 2D canvas context.
// Layer order: biome → construction → entities → player.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { getBiomeSheet } from "./biomeSheet.js";
import { NUM_BIOMES } from "./biomes.js";
import { CONSTRUCTION } from "./constructions.js";
import { getPlayerSpriteFrame } from "./player.js";
import { drawEntities } from "./entities.js";

export function createRenderer(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  return { canvas, ctx };
}

export function render(renderer, world, camera, player, biomeFrame) {
  const { ctx, canvas } = renderer;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  drawBiome(ctx, world, camera, biomeFrame | 0);
  drawConstructions(ctx, world, camera);
  drawEntities(ctx, world, camera);
  drawPlayer(ctx, camera, player);
}

function tileWindow(world, camera) {
  const startCol = Math.max(0, Math.floor(camera.x));
  const startRow = Math.max(0, Math.floor(camera.y));
  const endCol = Math.min(world.cols, Math.ceil(camera.x + camera.w));
  const endRow = Math.min(world.rows, Math.ceil(camera.y + camera.h));
  return { startCol, startRow, endCol, endRow };
}

function drawBiome(ctx, world, camera, frame) {
  const sheet = getBiomeSheet();
  const { startCol, startRow, endCol, endRow } = tileWindow(world, camera);
  const rowOffset = frame * NUM_BIOMES;

  for (let r = startRow; r < endRow; r++) {
    const biomeRow = world.biome[r];
    const colRow = world.biomeCol[r];
    for (let c = startCol; c < endCol; c++) {
      const b = biomeRow[c];
      const sheetCol = colRow[c];
      const sx = sheetCol * TILE_SIZE;
      const sy = (b + rowOffset) * TILE_SIZE;
      const px = Math.round((c - camera.x) * TILE_SIZE);
      const py = Math.round((r - camera.y) * TILE_SIZE);
      ctx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE, px, py, TILE_SIZE, TILE_SIZE);
    }
  }
}

function drawConstructions(ctx, world, camera) {
  const sheet = getSprite("tilesConstructions");
  const { startCol, startRow, endCol, endRow } = tileWindow(world, camera);

  for (let r = startRow; r < endRow; r++) {
    const conRow = world.construction[r];
    const rowIdx = world.constructionRow[r];
    for (let c = startCol; c < endCol; c++) {
      const id = conRow[c];
      if (id === CONSTRUCTION.NOTHING) continue;
      const sx = id * TILE_SIZE;
      const sy = rowIdx[c] * TILE_SIZE;
      const px = Math.round((c - camera.x) * TILE_SIZE);
      const py = Math.round((r - camera.y) * TILE_SIZE);
      ctx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE, px, py, TILE_SIZE, TILE_SIZE);
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

  const px = Math.round((player.x - camera.x) * TILE_SIZE);
  const py = Math.round((player.y - camera.y - 1) * TILE_SIZE);

  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}
