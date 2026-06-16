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

import { TILE_SIZE, ANIMATIONS_FPS } from "./constants.js";
import { getEntitySheet, getSpecies } from "./species.js";
import { getSprite } from "./assets.js";
import { getPlayerSpriteFrame } from "./player.js";
import { SLOT_MELEE, SLOT_RANGED } from "./equipment.js";
import { resolveLoadout } from "./sessionLoadouts.js";
import { getMeleeSwingProgress } from "./melee.js";
import { getShootAnimProgress } from "./shooting.js";
import { getAuraAnimProgress, AURA_SPRITE } from "./knockbackAura.js";
import { pushableRenderOffset } from "./pushables.js";
import { knockbackHopOffset } from "./mobs.js";
import { coinRenderOffset } from "./coinDrops.js";
import { shouldBeVisible } from "./entityVisibility.js";
import { isCreativeMode } from "./creativeMode.js";
import { isDying, DEATH_SPRITE } from "./deathAnimation.js";
import { isVanishing, vanishAlpha, vanishOverlay } from "./vanishEffect.js";
import { isDemandingAttention } from "./npcInterception.js";
import { isGiant } from "./giantMode.js";
import { hasUnlocked as fastTravelUnlocked } from "./fastTravel.js";

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
// On the host, mobs carry their live `_ai.step`. Guests never receive
// `_ai` (it's host-internal), so the snapshot ships a plain `moving`
// boolean instead — without it, mirrored mobs render frame 0 forever
// even while sliding between tiles.
function isEntityMoving(e, sp) {
  if (sp.entity_type === "Bullet") return !!e._spawned;
  if (e._ai?.step) return true;
  if (e.moving) return true;
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
  // Giant mode swaps the hero for a dedicated 3×4 humanoid sprite. The
  // normal-size weapon overlay would float out of place at that scale, so
  // it's skipped for the duration (collision and everything else stay
  // normal-sized — only the rendered sprite changes).
  const giant = isGiant(player);
  const { melee, ranged } = resolveLoadout(player);
  const equipInFront = player.direction === "up"
    || getMeleeSwingProgress(idx) != null
    || getShootAnimProgress(idx) != null;
  if (!giant && !equipInFront) {
    drawEquipment(ctx, player, camera, ranged, SLOT_RANGED);
    drawEquipment(ctx, player, camera, melee, SLOT_MELEE);
  }

  if (giant) {
    drawGiant(ctx, player, camera);
  } else {
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

  if (!giant && equipInFront) {
    drawEquipment(ctx, player, camera, ranged, SLOT_RANGED);
    drawEquipment(ctx, player, camera, melee, SLOT_MELEE);
  }

  // Knockback-aura activation burst, drawn over the hero while it plays.
  drawAuraEffect(ctx, player, camera);
}

// Giant mode renders from a dedicated 3×4 humanoid sheet (humanoids_3x4):
// one humanoid (no skin columns), 8 frames per directional strip, laid out
// in the standard 8-row directional order (DIR_ROW_MOVING/STILL). The sprite
// is kept centred on the hero's 1-wide tile and feet-aligned (bottom at
// player.y + 1) so the unchanged collision tile still sits under the giant's
// feet. Frames ride the shared animClock like any other directional sprite.
const GIANT_TILES_W = 3;
const GIANT_TILES_H = 4;
const GIANT_FRAMES = 8;

function drawGiant(ctx, player, camera) {
  let sheet;
  try { sheet = getSprite("humanoids_3x4"); } catch { return; }
  if (!sheet || !sheet.complete) return;
  const moving = !!player.moving;
  const dir = player.direction || "down";
  const dirRow = (moving ? DIR_ROW_MOVING : DIR_ROW_STILL)[dir] ?? DIR_ROW_STILL.down;
  const frameIdx = moving ? Math.floor(animClock * ANIMATIONS_FPS) % GIANT_FRAMES : 0;
  const sw = GIANT_TILES_W * TILE_SIZE;
  const sh = GIANT_TILES_H * TILE_SIZE;
  const sx = frameIdx * sw;
  const sy = dirRow * sh;
  const px = Math.round((player.x - 1 - camera.x) * TILE_SIZE);
  const py = Math.round((player.y - 3 - camera.y) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}

// The aura's activation animation: a w×h sprite from the weapons sheet
// (AURA_SPRITE), its frame advancing with the activation progress (1.0 at
// start → 0.0 at end), centred on the hero. Progress comes from
// knockbackAura — locally for host players, off the render object for guests.
function drawAuraEffect(ctx, player, camera) {
  const progress = getAuraAnimProgress(player);
  if (progress == null) return;
  let sheet;
  try { sheet = getSprite("weapons"); } catch { return; }
  if (!sheet || !sheet.complete) return;

  const { texX, texY, frames, w, h } = AURA_SPRITE;
  const n = Math.max(1, frames);
  const frameIdx = Math.min(n - 1, Math.floor((1 - progress) * n));
  const sx = (texX + frameIdx * w) * TILE_SIZE;
  const sy = texY * TILE_SIZE;
  const sw = w * TILE_SIZE;
  const sh = h * TILE_SIZE;

  // Hero feet sit at (player.x + 0.5, player.y + 0.5); centre the burst there.
  const wx = player.x + 0.5 - w / 2;
  const wy = player.y + 0.5 - h / 2;
  const px = Math.round((wx - camera.x) * TILE_SIZE);
  const py = Math.round((wy - camera.y) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
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
// When the weapon is mid-use the overlay flips to the absolute attack-row
// strip at ATTACK_ROW_Y[direction] and the source-x frame index advances
// with the cooldown. For the melee slot that's the sword swing in response
// to G (melee.getMeleeSwingProgress); for the ranged slot it's the firing
// animation in response to F (shooting.getShootAnimProgress) — mirroring
// Rust equipment/{melee,ranged}.rs, which both call
// play_equipment_usage_animation while action_cooldown_remaining > 0.
function drawEquipment(ctx, player, camera, weaponId, slot) {
  if (!weaponId) return;
  const sp = getSpecies(weaponId);
  if (!sp) return;
  const sheet = getEntitySheet(sp);
  if (!sheet) return;

  const w = sp.width || 1;
  const h = sp.height || 1;
  const frames = Math.max(1, sp.frames);

  const swing = slot === SLOT_MELEE
    ? getMeleeSwingProgress(player.index | 0)
    : getShootAnimProgress(player.index | 0);
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

// FastTravelLink props swap sprite by global unlock state: a still 1-frame
// dormant portal until fast travel is unlocked (≥4 zones visited), then a
// 4-frame animated active portal. Both share the link's 3×2 footprint.
const FAST_TRAVEL_SPRITE = {
  locked:   { texX: 31, texY: 3, frames: 1 },
  unlocked: { texX: 34, texY: 3, frames: 4 },
};

function fastTravelSpriteOverride(sp) {
  if (sp?.entity_type !== "FastTravelLink") return null;
  return fastTravelUnlocked() ? FAST_TRAVEL_SPRITE.unlocked : FAST_TRAVEL_SPRITE.locked;
}

function draw(ctx, e, camera) {
  const sp = e._species;

  // A dying entity renders the looping fireball strip instead of its own
  // sprite (set up by deathAnimation.startDeathAnimation). The frame index
  // rides the shared animClock so host and guest stay in lockstep without
  // needing the per-entity lifespan in the snapshot.
  if (isDying(e)) { drawDeath(ctx, e, camera); return; }

  // Teleporters and hints are editing aids — the "T"/sign markers only
  // make sense in the map editor. In normal gameplay teleporters are
  // invisible portals and hints are invisible trigger tiles, so skip
  // rendering entirely rather than blitting a placeholder sprite that
  // leaks a stray line or dot onto the map.
  if (!isCreativeMode() &&
      (sp?.entity_type === "Teleporter" || sp?.entity_type === "Hint")) {
    return;
  }

  // Creative-mode hint re-skin: in the Rust core hint signs render from
  // the inventory sheet at their `inventory_texture_offset` instead of
  // the placed-sign sprite on static_objects. Same one-off override here.
  const reskin = creativeHintReskin(sp);
  const sheet = reskin ? getSprite("inventory") : getEntitySheet(sp);
  if (!sheet) return;

  const { x, y, w, h } = e.frame;
  const ftSprite = fastTravelSpriteOverride(sp);
  const frames = reskin ? 1 : (ftSprite ? ftSprite.frames : Math.max(1, sp.frames));
  let frame = 0;
  let dirRow = 0;
  const moving = isEntityMoving(e, sp);
  // Frames advance whenever the sprite has more than one, moving or not —
  // mirrors the Rust core's AnimatedSprite::update (gated only on
  // number_of_frames). Movement selects the row, never whether we animate;
  // gating frames on `moving` froze idle NPCs on their first still frame.
  if (!reskin && frames > 1) {
    frame = Math.floor(animClock * ANIMATIONS_FPS) % frames;
  }
  if (!reskin && sp.directional) {
    const dirKey = (e.direction || "down").toLowerCase();
    const table = moving ? DIR_ROW_MOVING : DIR_ROW_STILL;
    dirRow = table[dirKey] ?? DIR_ROW_STILL.down;
  }

  // "Demands attention" NPCs render the exclamation-mark row (row 8, past the
  // 8 directional rows) and animate it regardless of movement — mirrors the
  // Rust core's update_sprite_for_current_state. (Dying entities never reach
  // here; drawDeath returns above.)
  if (!reskin && isDemandingAttention(e)) {
    dirRow = 8;
    frame = frames > 1 ? Math.floor(animClock * ANIMATIONS_FPS) % frames : 0;
  }

  const offsetX = (e._frameOffsetX | 0);
  // inventory_texture_offset is [row, col]; everything else uses
  // texture_x / texture_y (cols, rows).
  const baseX = reskin ? reskin.col : (ftSprite ? ftSprite.texX : sp.texture_x);
  const baseY = reskin ? reskin.row : (ftSprite ? ftSprite.texY : sp.texture_y);
  const sx = (baseX + offsetX + frame * w) * TILE_SIZE;
  const sy = (baseY + dirRow * h) * TILE_SIZE;
  const sw = w * TILE_SIZE;
  const sh = h * TILE_SIZE;

  // Pushables interpolate their position with a render-time offset so
  // the rock visually slides toward its new tile (already committed in
  // frame.x/y for collision purposes).
  const slide = pushableRenderOffset(e);
  let rx = slide ? x - slide.x : x;
  let ry = slide ? y - slide.y : y;
  // Coins fan out within their tile so a pile reads as separate coins.
  const coinOff = coinRenderOffset(e);
  if (coinOff) { rx += coinOff.x; ry += coinOff.y; }
  // A mob mid-knockback hops a couple pixels off the ground (recoil bounce).
  ry -= knockbackHopOffset(e);
  const px = Math.round((rx - camera.x) * TILE_SIZE);
  const py = Math.round((ry - camera.y) * TILE_SIZE);

  // A vanishing NPC (afterDialogue VanishSmoke/VanishTeleport) fades its
  // body out while the effect strip plays on top of it.
  if (isVanishing(e)) {
    ctx.globalAlpha = vanishAlpha(e);
    ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
    ctx.globalAlpha = 1;
    drawVanishOverlay(ctx, e, camera);
    return;
  }
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}

// Blits the vanish effect strip in front of a fading NPC: a 1×2 column from
// the animated_objects sheet, its frame advancing once (no loop) over the
// fade. Centred horizontally on the NPC and bottom-aligned to its feet.
function drawVanishOverlay(ctx, e, camera) {
  const ov = vanishOverlay(e);
  if (!ov) return;
  const sp = ov.sprite;
  const sheet = getSprite(sp.sheet);
  if (!sheet) return;
  const sx = (sp.texX + ov.frame * sp.w) * TILE_SIZE;
  const sy = sp.texY * TILE_SIZE;
  const sw = sp.w * TILE_SIZE;
  const sh = sp.h * TILE_SIZE;
  const { x, y, w, h } = e.frame;
  const ex = x + (w - sp.w) / 2;
  const ey = y + (h - sp.h);
  const px = Math.round((ex - camera.x) * TILE_SIZE);
  const py = Math.round((ey - camera.y) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
}

// Renders the death fireball: a 1×1 animated strip from the animated_objects
// sheet, cycling DEATH_SPRITE.frames at ANIMATIONS_FPS off the shared clock.
function drawDeath(ctx, e, camera) {
  // Most dying entities use the shared fireball strip, but afterDialogue's
  // vanish effects stash a per-entity sprite on _deathSprite (the art seam).
  const sprite = e._deathSprite || DEATH_SPRITE;
  const sheet = getSprite(sprite.sheet);
  if (!sheet) return;
  const { x, y } = e.frame;
  const frame = Math.floor(animClock * ANIMATIONS_FPS) % sprite.frames;
  const sx = (sprite.texX + frame) * TILE_SIZE;
  const sy = sprite.texY * TILE_SIZE;
  const px = Math.round((x - camera.x) * TILE_SIZE);
  const py = Math.round((y - camera.y) * TILE_SIZE);
  ctx.drawImage(sheet, sx, sy, TILE_SIZE, TILE_SIZE, px, py, TILE_SIZE, TILE_SIZE);
}
