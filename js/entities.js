// Renders non-player entities from zone.entities. Each entity has a
// `frame` rect (x, y, w, h) in tile units giving its zone footprint, plus
// a `species_id` and `direction`. Species metadata controls which sprite
// sheet to sample and whether the sprite animates.
//
// Z order mirrors the original Rust core's sorting_key:
//   - z_index === -1 (UNDERLAY) → behind everything else (floor decals
//     like magic circles, so the player stands on top of them);
//   - z_index ===  99 (OVERLAY) → always on top;
//   - otherwise sort by bottom row, then by z_index as a tiebreaker.

import { TILE_SIZE, ANIMATIONS_FPS } from "./constants.js?v=20260528i";
import { getEntitySheet, getSpecies } from "./species.js?v=20260528i";
import { getSprite } from "./assets.js?v=20260528i";
import { getPlayerSpriteFrame } from "./player.js?v=20260528i";
import { SLOT_MELEE, SLOT_RANGED } from "./equipment.js?v=20260528i";
import { resolveLoadout } from "./sessionLoadouts.js?v=20260528i";
import { getMeleeSwingProgress } from "./melee.js?v=20260528i";
import { pushableRenderOffset } from "./pushables.js?v=20260528i";
import { shouldBeVisible } from "./entityVisibility.js?v=20260528i";
import { isCreativeMode } from "./creativeMode.js?v=20260528i";

const Z_INDEX_OVERLAY = 99;
const Z_INDEX_UNDERLAY = -1;
const HERO_SPECIES_ID = 1001;
const FALLBACK_PLAYER_Z_INDEX = 15;

// Directional sheets store 8 rows per sprite:
//   row 0 Up-moving, row 1 Up-still, row 2 Right-moving, row 3 Right-still,
//   row 4 Down-moving, row 5 Down-still, row 6 Left-moving, row 7 Left-still.
const DIR_ROW_STILL  = { up: 1, right: 3, down: 5, left: 7 };
const DIR_ROW_MOVING = { up: 0, right: 2, down: 4, left: 6 };

let animClock = 0;

export function tickEntities(dt) {
  animClock += dt;
}

export function drawEntities(ctx, zone, camera, player) {
  const visible = collect(zone, camera);
  // Accept a single player or an array of players (co-op).
  const players = Array.isArray(player) ? player : (player ? [player] : []);
  for (const p of players) visible.push(makePlayerSortItem(p));
  visible.sort((a, b) => a._sortKey - b._sortKey);
  for (const e of visible) {
    if (e._isPlayer) drawPlayer(ctx, e._player, camera);
    else draw(ctx, e, camera);
  }
}

// Decides whether an entity should render its "moving" sprite row.
// Each AI/owner system tags the entity with a small flag we read here.
function isEntityMoving(e, sp) {
  if (sp.entity_type === "Bullet") return !!e._spawned;
  if (e._ai?.step) return true;
  return false;
}

// In creative mode hint signs render from the inventory sheet at their
// inventory_texture_offset instead of the static_objects placed-sign
// sprite. Returns null when no re-skin applies.
function creativeHintReskin(sp) {
  if (!isCreativeMode()) return null;
  if (sp?.entity_type !== "Hint") return null;
  const off = sp.inventory_texture_offset;
  if (!off) return null;
  return { row: off[0] | 0, col: off[1] | 0 };
}

function makePlayerSortItem(player) {
  return {
    _isPlayer: true,
    _player: player,
    // Mirror Rust update_sorting_key for the hero: bottom row = frame.y +
    // frame.h. Hero sprite is 1×2 with feet at player.y, so frame.y here
    // is conceptually player.y - 1 + 2 = player.y + 1. Keep this in sync
    // with the species data rather than a hard-coded constant.
    _sortKey: sortingKey(player.y + 1, playerZIndex(), false),
  };
}

function playerZIndex() {
  const sp = getSpecies(HERO_SPECIES_ID);
  return sp?.z_index ?? FALLBACK_PLAYER_Z_INDEX;
}

function drawPlayer(ctx, player, camera) {
  // Equipment overlay z-order mirrors Rust equipment/basics.rs::should_be_over_hero:
  // facing Up draws weapons in front of the hero (handle/barrel visible past
  // the shoulder); facing Left/Right/Down draws them behind so the hero's
  // body occludes the part of the weapon that should be on the far side.
  //
  // Loadout sourced via resolveLoadout(player), so online co-op renders
  // each guest's actual gear instead of the local user's. In single-player
  // and local-coop the lookup falls back to local equipment by index.
  const idx = player.index | 0;
  const { melee, ranged } = resolveLoadout(player);
  const equipInFront = player.direction === "up" || getMeleeSwingProgress(idx) != null;
  if (!equipInFront) {
    drawEquipment(ctx, player, camera, ranged, SLOT_RANGED);
    drawEquipment(ctx, player, camera, melee, SLOT_MELEE);
  }

  const sheet = getSprite("heroes");
  const frame = getPlayerSpriteFrame(player);
  const sx = frame.x * TILE_SIZE;
  const sy = frame.y * TILE_SIZE;
  const sw = frame.w * TILE_SIZE;
  const sh = frame.h * TILE_SIZE;
  const px = Math.round((player.x - camera.x) * TILE_SIZE);
  const py = Math.round((player.y - camera.y - 1) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);

  if (equipInFront) {
    drawEquipment(ctx, player, camera, ranged, SLOT_RANGED);
    drawEquipment(ctx, player, camera, melee, SLOT_MELEE);
  }
}

// Absolute sprite-sheet rows used by Rust's
// equipment/basics.rs::play_equipment_usage_animation. Same for every
// 4-tile-tall weapon (sword / AR15 / cannon / shield), keyed on the
// player's facing direction. Each row is a 4-frame strip along x.
const ATTACK_ROW_Y = { up: 37, right: 41, down: 45, left: 49 };

// Renders one equipped weapon (sword, AR15, …) overlaid on the player.
// Zone offset (-1.5, -2.0) and direction-row selection mirror Rust
// equipment/basics.rs::update_equipment_position and the standard 8-row
// directional sprite layout. Skips weapons whose sprite sheet isn't loaded
// (e.g. the kunai launcher, which has no in-zone overlay sprite).
//
// When the player is mid-swing (melee.getMeleeSwingProgress > 0 and this
// is the melee slot) the overlay flips to the absolute attack-row strip
// at ATTACK_ROW_Y[direction] and the source-x frame index advances with
// the cooldown — that's the sword swing animation the player expects to
// see in response to G.
function drawEquipment(ctx, player, camera, weaponId, slot) {
  if (!weaponId) return;
  const sp = getSpecies(weaponId);
  if (!sp) return;
  const sheet = getEntitySheet(sp);
  if (!sheet) return;

  const w = sp.width || 1;
  const h = sp.height || 1;
  const frames = Math.max(1, sp.frames);

  const swing = slot === SLOT_MELEE ? getMeleeSwingProgress(player.index | 0) : null;
  let sourceY, frameIdx;
  if (swing != null) {
    sourceY = (ATTACK_ROW_Y[player.direction] ?? ATTACK_ROW_Y.down) * TILE_SIZE;
    // swing is 1.0 at start, 0.0 at end → frame counts forward over the strip.
    frameIdx = Math.min(frames - 1, Math.floor((1 - swing) * frames));
  } else {
    const dirRow = (player.moving ? DIR_ROW_MOVING : DIR_ROW_STILL)[player.direction]
      ?? DIR_ROW_STILL.down;
    sourceY = (sp.texture_y + dirRow * h) * TILE_SIZE;
    frameIdx = player.moving && frames > 1
      ? Math.floor(animClock * ANIMATIONS_FPS) % frames
      : 0;
  }

  const sx = (sp.texture_x + frameIdx * w) * TILE_SIZE;
  const sw = w * TILE_SIZE;
  const sh = h * TILE_SIZE;

  // Player's top-left in zone coords is (player.x, player.y - 1) because
  // the hero is a 1×2 sprite with feet at (x, y). Equipment frame is offset
  // (-1.5, -1.0) from that.
  const wx = player.x - 1.5;
  const wy = player.y - 2.0;
  const px = Math.round((wx - camera.x) * TILE_SIZE);
  const py = Math.round((wy - camera.y) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sourceY, sw, sh, px, py, sw, sh);
}

function collect(zone, camera) {
  const out = [];
  for (const e of zone.entities) {
    if (e._invisible) continue;
    if (!e._spawned && !shouldBeVisible(e)) continue;
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
// even when their bottom row is below the player's. Exported for tests.
export function sortingKey(bottom, zIndex, isPushable) {
  let z;
  if (zIndex === Z_INDEX_OVERLAY) z = 20_000_000;
  else if (zIndex === Z_INDEX_UNDERLAY) z = 0;
  else z = 10_000_000;
  const a = 10_000 * Math.floor(bottom);
  const b = (zIndex === Z_INDEX_OVERLAY || zIndex === Z_INDEX_UNDERLAY) ? 0 : zIndex * 10;
  const p = isPushable ? 1 : 0;
  // Rust casts to u32 at the end. We don't need the cast in JS but we DO
  // want negative z_index values to land sensibly: a non-UNDERLAY entity
  // with z_index = -5 (unusual but legal) should still bucket as normal
  // and just trail negative tiebreakers under same-row peers.
  return z + a + b + p;
}

function draw(ctx, e, camera) {
  const sp = e._species;

  // Creative-mode hint re-skin: in the Rust core hint signs render from
  // the inventory sheet at their `inventory_texture_offset` instead of
  // the placed-sign sprite on static_objects. Same one-off override here.
  const reskin = creativeHintReskin(sp);
  const sheet = reskin ? getSprite("inventory") : getEntitySheet(sp);
  if (!sheet) return;

  const { x, y, w, h } = e.frame;
  const frames = reskin ? 1 : Math.max(1, sp.frames);
  let frame = 0;
  let dirRow = 0;
  const moving = isEntityMoving(e, sp);
  if (!reskin && sp.directional) {
    const dirKey = (e.direction || "down").toLowerCase();
    const table = moving ? DIR_ROW_MOVING : DIR_ROW_STILL;
    dirRow = table[dirKey] ?? DIR_ROW_STILL.down;
    if (moving && frames > 1) {
      frame = Math.floor(animClock * ANIMATIONS_FPS) % frames;
    }
  } else if (!reskin && frames > 1) {
    frame = Math.floor(animClock * ANIMATIONS_FPS) % frames;
  }

  const offsetX = (e._frameOffsetX | 0);
  // inventory_texture_offset is [row, col]; everything else uses
  // texture_x / texture_y (cols, rows).
  const baseX = reskin ? reskin.col : sp.texture_x;
  // Teleporters use a different sprite row in non-creative — Rust
  // setup_teleporter assigns 6 normally and 5 in creative. species.json
  // ships with the creative row (5), so add +1 for the non-creative
  // "placed teleporter" art.
  const teleporterRowShift =
    !reskin && sp?.entity_type === "Teleporter" && !isCreativeMode() ? 1 : 0;
  const baseY = reskin ? reskin.row : sp.texture_y + teleporterRowShift;
  const sx = (baseX + offsetX + frame * w) * TILE_SIZE;
  const sy = (baseY + dirRow * h) * TILE_SIZE;
  const sw = w * TILE_SIZE;
  const sh = h * TILE_SIZE;

  // Pushables interpolate their position with a render-time offset so
  // the rock visually slides toward its new tile (already committed in
  // frame.x/y for collision purposes).
  const slide = pushableRenderOffset(e);
  const rx = slide ? x - slide.x : x;
  const ry = slide ? y - slide.y : y;
  const px = Math.round((rx - camera.x) * TILE_SIZE);
  const py = Math.round((ry - camera.y) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}
