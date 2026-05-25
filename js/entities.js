// Renders non-player entities from world.entities. Each entity has a
// `frame` rect (x, y, w, h) in tile units giving its world footprint, plus
// a `species_id` and `direction`. Species metadata controls which sprite
// sheet to sample and whether the sprite animates.
//
// Z order: y+h ascending so taller things tucked in front are drawn after
// the things behind them. The player is drawn separately by the renderer
// using this same convention.

import { TILE_SIZE, ANIMATIONS_FPS } from "./constants.js";
import { getEntitySheet, getSpecies } from "./species.js";
import { getSprite } from "./assets.js";
import { getPlayerSpriteFrame } from "./player.js";

let animClock = 0;

export function tickEntities(dt) {
  animClock += dt;
}

export function drawEntities(ctx, world, camera, player) {
  const visible = collect(world, camera);
  if (player) visible.push(makePlayerSortItem(player));
  visible.sort((a, b) => a._bottom - b._bottom || a._zIndex - b._zIndex);
  for (const e of visible) {
    if (e._isPlayer) drawPlayer(ctx, e._player, camera);
    else draw(ctx, e, camera);
  }
}

function makePlayerSortItem(player) {
  return {
    _isPlayer: true,
    _player: player,
    _bottom: player.y + 1,
    _zIndex: 15,
  };
}

function drawPlayer(ctx, player, camera) {
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

function collect(world, camera) {
  const out = [];
  for (const e of world.entities) {
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    const f = e.frame; if (!f) continue;
    if (f.x + f.w < camera.x || f.y + f.h < camera.y) continue;
    if (f.x > camera.x + camera.w || f.y > camera.y + camera.h) continue;
    e._species = sp;
    e._bottom = f.y + f.h;
    e._zIndex = sp.z_index;
    out.push(e);
  }
  return out;
}

function draw(ctx, e, camera) {
  const sp = e._species;
  const sheet = getEntitySheet(sp);
  if (!sheet) return;

  const { x, y, w, h } = e.frame;
  const frames = Math.max(1, sp.frames);
  const frame = frames > 1 ? Math.floor(animClock * ANIMATIONS_FPS) % frames : 0;
  const dirRow = sp.directional ? dirRowIndex(e.direction) : 0;

  const sx = (sp.texture_x + frame * w) * TILE_SIZE;
  const sy = (sp.texture_y + dirRow * h) * TILE_SIZE;
  const sw = w * TILE_SIZE;
  const sh = h * TILE_SIZE;

  const px = Math.round((x - camera.x) * TILE_SIZE);
  const py = Math.round((y - camera.y) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}

function dirRowIndex(direction) {
  switch ((direction || "Down").toLowerCase()) {
    case "up": return 0;
    case "right": return 1;
    case "down": return 2;
    case "left": return 3;
    default: return 0;
  }
}
