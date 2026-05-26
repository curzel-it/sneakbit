// Renders non-player entities from world.entities. Each entity has a
// `frame` rect (x, y, w, h) in tile units giving its world footprint, plus
// a `species_id` and `direction`. Species metadata controls which sprite
// sheet to sample and whether the sprite animates.
//
// Z order mirrors the original Rust core's sorting_key:
//   - z_index === -1 (UNDERLAY) → behind everything else (floor decals
//     like magic circles, so the player stands on top of them);
//   - z_index ===  99 (OVERLAY) → always on top;
//   - otherwise sort by bottom row, then by z_index as a tiebreaker.

import { TILE_SIZE, ANIMATIONS_FPS } from "./constants.js";
import { getEntitySheet, getSpecies } from "./species.js";
import { getSprite } from "./assets.js";
import { getPlayerSpriteFrame } from "./player.js";

const Z_INDEX_OVERLAY = 99;
const Z_INDEX_UNDERLAY = -1;
const PLAYER_Z_INDEX = 15;

// Directional sheets store 8 rows per sprite:
//   row 0 Up-moving, row 1 Up-still, row 2 Right-moving, row 3 Right-still,
//   row 4 Down-moving, row 5 Down-still, row 6 Left-moving, row 7 Left-still.
const DIR_ROW_STILL = { up: 1, right: 3, down: 5, left: 7 };

let animClock = 0;

export function tickEntities(dt) {
  animClock += dt;
}

export function drawEntities(ctx, world, camera, player) {
  const visible = collect(world, camera);
  if (player) visible.push(makePlayerSortItem(player));
  visible.sort((a, b) => a._sortKey - b._sortKey);
  for (const e of visible) {
    if (e._isPlayer) drawPlayer(ctx, e._player, camera);
    else draw(ctx, e, camera);
  }
}

function makePlayerSortItem(player) {
  return {
    _isPlayer: true,
    _player: player,
    _sortKey: sortingKey(player.y + 1, PLAYER_Z_INDEX, false),
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
    e._sortKey = sortingKey(f.y + f.h, sp.z_index, sp.entity_type === "PushableObject");
    out.push(e);
  }
  return out;
}

// Mirrors Entity::update_sorting_key in the Rust core. Packs underlay /
// normal / overlay into separate buckets so floor decals stay underneath
// even when their bottom row is below the player's.
function sortingKey(bottom, zIndex, isPushable) {
  let z;
  if (zIndex === Z_INDEX_OVERLAY) z = 20_000_000;
  else if (zIndex === Z_INDEX_UNDERLAY) z = 0;
  else z = 10_000_000;
  const a = 10_000 * Math.floor(bottom);
  const b = (zIndex === Z_INDEX_OVERLAY || zIndex === Z_INDEX_UNDERLAY) ? 0 : zIndex * 10;
  const p = isPushable ? 1 : 0;
  return z + a + b + p;
}

function draw(ctx, e, camera) {
  const sp = e._species;
  const sheet = getEntitySheet(sp);
  if (!sheet) return;

  const { x, y, w, h } = e.frame;
  const frames = Math.max(1, sp.frames);
  // Animation rules:
  //   * Directional NPCs we don't yet simulate movement for stay on the
  //     "still" row (frame 0) of their facing direction.
  //   * Stationary Bullets (placed kunai in world data) keep frame 0; they
  //     only spin when actually flying — once shooting lands, in-flight
  //     bullets will animate per-frame.
  //   * Other multi-frame sprites cycle on the global anim clock.
  let frame = 0;
  let dirRow = 0;
  if (sp.directional) {
    dirRow = DIR_ROW_STILL[(e.direction || "down").toLowerCase()] ?? DIR_ROW_STILL.down;
  } else if (sp.entity_type === "Bullet") {
    // Player-thrown bullets carry _spawned and spin while flying; placed
    // bullets in world data sit on frame 0.
    if (e._spawned && frames > 1) frame = Math.floor(animClock * ANIMATIONS_FPS) % frames;
  } else if (frames > 1) {
    frame = Math.floor(animClock * ANIMATIONS_FPS) % frames;
  }

  const sx = (sp.texture_x + frame * w) * TILE_SIZE;
  const sy = (sp.texture_y + dirRow * h) * TILE_SIZE;
  const sw = w * TILE_SIZE;
  const sh = h * TILE_SIZE;

  const px = Math.round((x - camera.x) * TILE_SIZE);
  const py = Math.round((y - camera.y) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}
