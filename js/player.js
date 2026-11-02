// Player state and free movement.
//
// The hero moves continuously in any direction at its species speed; (x, y)
// are floats in tile units and (tileX, tileY) is the tile under the hitbox
// centre, kept for everything that still thinks in tiles (teleporters,
// pickups, cutscene triggers, saves). Sprites keep four-way facing. Collision
// is in heroCollision.js; on ice the hero slides in a straight line until it
// hits something or leaves the ice.

import { ANIMATIONS_FPS, SPRITE_SHEET_HEROES, STARTING_SPAWN } from "./constants.js";
import { isTileSlippery } from "./zone.js";
import { playSfx } from "./audio.js";
import { findPushableAt, pushOneTile } from "./pushables.js";
import { findLockedTeleporterAt } from "./transitions.js";
import { showToast } from "./toast.js";
import { isCreativeMode } from "./creativeMode.js";
import { speedMultiplier } from "./speedMode.js";
import { resolveSkinColumn } from "./skins.js";
import { getSpecies } from "./species.js";
import { moveHero } from "./heroCollision.js";

const HERO_BASE_FRAME = { x: 1, y: 1, w: 1, h: 2 };
const HERO_FRAME_COLUMN_STRIDE = 4;
const HERO_FRAME_COUNT = 4;

function heroFrameForIndex(index) {
  return {
    ...HERO_BASE_FRAME,
    x: HERO_BASE_FRAME.x + (index | 0) * HERO_FRAME_COLUMN_STRIDE,
  };
}

const HERO_SPECIES_ID = 1001;
const SPEED_PER_BASE_SPEED = 1.125;
const FALLBACK_SPEED = 4.5;
const FOOTSTEP_DISTANCE = 1;
const PUSH_COOLDOWN = 0.25;
const PUSH_ALIGNMENT = 0.35;
const LOCKED_TOAST_COOLDOWN = 1.5;
const DIAGONAL_FACING_HYSTERESIS = 0.25;

const DIRECTION_ROW = {
  up:    { moving: 0, still: 1 },
  right: { moving: 2, still: 3 },
  down:  { moving: 4, still: 5 },
  left:  { moving: 6, still: 7 },
};

const DIR_DELTA = {
  up:    [0, -1],
  down:  [0,  1],
  left:  [-1, 0],
  right: [ 1,  0],
};

export function createPlayer(opts = {}) {
  const index = opts.index | 0;
  return {
    index,
    x: STARTING_SPAWN.x,
    y: STARTING_SPAWN.y,
    tileX: STARTING_SPAWN.x,
    tileY: STARTING_SPAWN.y,
    direction: "down",
    sheetId: SPRITE_SHEET_HEROES,
    baseFrame: heroFrameForIndex(index),
    frameCount: HERO_FRAME_COUNT,
    frameIndex: 0,
    frameTimer: 0,
    moving: false,
    /** @type {null | "up" | "down" | "left" | "right"} */
    _slide: null,
    _holdGate: false,
    _walked: 0,
    _pushCooldown: 0,
    _lockedToastCooldown: 0,
    /** @type {null | { x: number, y: number, d: string }} */
    _pushed: null,
  };
}

/** Hero speed in tiles per second. */
export function heroSpeed(player) {
  const sp = getSpecies(HERO_SPECIES_ID);
  const base = sp?.base_speed > 0 ? sp.base_speed * SPEED_PER_BASE_SPEED : FALLBACK_SPEED;
  const creative = isCreativeMode() ? 2 : 1;
  return base * creative * speedMultiplier(player);
}

/** Normalised movement intent from analog axes or held directions. */
export function inputVector(input) {
  let x = 0, y = 0;
  if (input?.ax || input?.ay) {
    x = input.ax || 0;
    y = input.ay || 0;
  } else if (input?.held) {
    if (input.held.has("left")) x -= 1;
    if (input.held.has("right")) x += 1;
    if (input.held.has("up")) y -= 1;
    if (input.held.has("down")) y += 1;
  }
  const len = Math.hypot(x, y);
  if (len > 1) { x /= len; y /= len; }
  return { x, y };
}

/** Four-way facing for a movement vector; near-diagonals keep `current`. */
export function facingFor(vx, vy, current) {
  const ax = Math.abs(vx), ay = Math.abs(vy);
  if (ax === 0 && ay === 0) return current;
  const h = vx > 0 ? "right" : "left";
  const v = vy > 0 ? "down" : "up";
  if (ax > 0 && ay > 0 && Math.abs(ax - ay) <= DIAGONAL_FACING_HYSTERESIS * Math.max(ax, ay)) {
    if (current === h || current === v) return current;
  }
  return ax >= ay ? h : v;
}

const FROZEN_INPUT = { events: [], held: new Set() };

export function updatePlayer(player, input, dt, zone) {
  if (player._frozen) input = FROZEN_INPUT;
  player._pushCooldown = Math.max(0, (player._pushCooldown || 0) - dt);
  player._lockedToastCooldown = Math.max(0, (player._lockedToastCooldown || 0) - dt);
  let v = inputVector(input);
  if (player._holdGate) {
    if (input.events.length === 0 && (v.x || v.y)) v = { x: 0, y: 0 };
    else player._holdGate = false;
  }
  if (!v.x && !v.y && input.events.length && !player._slide) {
    player.direction = input.events[input.events.length - 1];
  }
  const onIce = isTileSlippery(zone, player.tileX, player.tileY);
  if (!onIce) player._slide = null;
  else if (!player._slide && (v.x || v.y)) startSlide(player, v);
  if (player._slide) {
    const [sx, sy] = DIR_DELTA[player._slide];
    v = { x: sx, y: sy };
  }
  const speed = heroSpeed(player);
  const dx = v.x * speed * dt;
  const dy = v.y * speed * dt;
  const fromX = player.x, fromY = player.y;
  if (dx || dy) {
    if (!player._slide) player.direction = facingFor(v.x, v.y, player.direction);
    const { blockedX, blockedY } = moveHero(zone, player, dx, dy);
    if (blockedX || blockedY) onBlocked(player, zone, v, blockedX, blockedY);
  }
  syncTile(player);
  const travelled = Math.hypot(player.x - fromX, player.y - fromY);
  if (player._slide && travelled < 1e-6) player._slide = null;
  player.moving = travelled > 1e-6 && !player._slide;
  if (player.moving) {
    player._walked += travelled;
    if (player._walked >= FOOTSTEP_DISTANCE) {
      player._walked -= FOOTSTEP_DISTANCE;
      playSfx("stepTaken", { volume: 0.5, jitter: 0.08 });
    }
  }
  updateAnimation(player, dt);
}

function startSlide(player, v) {
  const dir = facingFor(v.x, v.y, player.direction);
  player._slide = dir;
  player.direction = dir;
  if (dir === "left" || dir === "right") player.y = Math.round(player.y);
  else player.x = Math.round(player.x);
}

function onBlocked(player, zone, v, blockedX, blockedY) {
  const horizontal = Math.abs(v.x) >= Math.abs(v.y);
  const tile = horizontal ? blockedX : blockedY;
  if (!tile) return;
  const [tx, ty] = tile;
  if (!isCreativeMode() && findLockedTeleporterAt(zone, tx, ty)) {
    if (player._lockedToastCooldown <= 0) {
      showToast("This door is locked.", "regular");
      player._lockedToastCooldown = LOCKED_TOAST_COOLDOWN;
    }
    return;
  }
  if (player._pushCooldown > 0) return;
  const pushable = findPushableAt(zone, tx, ty);
  if (!pushable || pushable._slide) return;
  const misalign = horizontal ? Math.abs(player.y - ty) : Math.abs(player.x - tx);
  if (misalign > PUSH_ALIGNMENT) return;
  const dir = horizontal ? (v.x > 0 ? "right" : "left") : (v.y > 0 ? "down" : "up");
  if (pushOneTile(zone, pushable, dir)) {
    player._pushCooldown = PUSH_COOLDOWN;
    player._pushed = { x: tx, y: ty, d: dir };
  }
}

/** Recomputes the tile under the hitbox centre from the float position. */
export function syncTile(player) {
  player.tileX = Math.round(player.x);
  player.tileY = Math.round(player.y);
}

/** Places a player on a position, dropping any slide. */
export function placePlayer(player, x, y) {
  player.x = x;
  player.y = y;
  player._slide = null;
  syncTile(player);
}

// Stop the player dead and park it on the centre of its tile, so an NPC
// walking over for an interception stops exactly one tile away.
export function haltPlayer(player) {
  player._slide = null;
  player.moving = false;
  player.x = player.tileX;
  player.y = player.tileY;
}

// Host-side update for a network guest's avatar: the guest owns its position
// (hostGuests.js applies each validated update), so only animate.
export function updateGuestAvatar(player, dt) {
  updateAnimation(player, dt);
}

function updateAnimation(player, dt) {
  if (!player.moving) {
    player.frameIndex = 0;
    player.frameTimer = 0;
    return;
  }
  player.frameTimer += dt;
  const framePeriod = 1 / ANIMATIONS_FPS;
  while (player.frameTimer >= framePeriod) {
    player.frameTimer -= framePeriod;
    player.frameIndex = (player.frameIndex + 1) % player.frameCount;
  }
}

// Source rect into the heroes sprite sheet, in tile units. The column is
// resolved per-draw from the equipped skin (skins.js), so this one seam
// recolors every avatar: local, local-coop and networked mirror copies.
export function getPlayerSpriteFrame(player) {
  const { baseFrame, direction, moving, frameIndex } = player;
  const rowOffset = DIRECTION_ROW[direction][moving ? "moving" : "still"];
  return {
    x: resolveSkinColumn(player) + frameIndex * baseFrame.w,
    y: baseFrame.y + rowOffset * baseFrame.h,
    w: baseFrame.w,
    h: baseFrame.h,
  };
}
