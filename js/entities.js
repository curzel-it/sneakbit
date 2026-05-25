// Renders non-player entities from world.entities. Each entity has a
// frame {x, y, w, h} in tile units pointing into its sprite sheet, plus a
// species id (used later to look up sheet/animations).
//
// First cut: render statics + monsters/NPCs using whatever sprite sheet
// their species declares. We keep entities sorted by their bottom edge so
// taller sprites overlap correctly with the player.

import { TILE_SIZE } from "./constants.js";
import { getEntitySheet, getSpecies, getDefaultDirection } from "./species.js";

export function drawEntities(ctx, world, camera) {
  if (!world.entities || world.entities.length === 0) return;
  const visible = collectVisible(world, camera);
  visible.sort((a, b) => (a._screenBottom - b._screenBottom));
  for (const e of visible) drawOne(ctx, e, camera);
}

function collectVisible(world, camera) {
  const out = [];
  for (const e of world.entities) {
    if (!e.frame) continue;
    const { x, y, w, h } = e.frame;
    if (x + w < camera.x || y + h < camera.y) continue;
    if (x > camera.x + camera.w || y > camera.y + camera.h) continue;
    e._screenBottom = y + h;
    out.push(e);
  }
  return out;
}

function drawOne(ctx, entity, camera) {
  const species = getSpecies(entity.species_id);
  if (!species) return;
  const sheet = getEntitySheet(species);
  if (!sheet) return;

  const { x, y, w, h } = entity.frame;
  // Animation frame index (just static for now — pick frame 0 of the row).
  const frameIndex = 0;
  // Direction → row offset (species-defined).
  const dir = entity.direction || getDefaultDirection(species);
  const rowOffset = directionRow(species, dir);

  const sx = (species.texture_x + frameIndex * w) * TILE_SIZE;
  const sy = (species.texture_y + rowOffset * h) * TILE_SIZE;
  const sw = w * TILE_SIZE;
  const sh = h * TILE_SIZE;

  // Anchor bottom-left to the entity's tile rect.
  const px = Math.round((x - camera.x) * TILE_SIZE);
  const py = Math.round((y + h - camera.y - h) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}

function directionRow(species, dir) {
  if (!species.directional) return 0;
  switch ((dir || "Down").toLowerCase()) {
    case "up": return 0;
    case "right": return 1;
    case "down": return 2;
    case "left": return 3;
    default: return 0;
  }
}
