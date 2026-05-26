// Player state and movement.
//
// Movement model — Gameboy / Pokémon style, tile-locked:
//   * Player occupies an integer tile (tileX, tileY).
//   * A new press of a direction the player is NOT already facing rotates
//     the sprite and starts a short "commit" timer; if the key is released
//     before the timer fires, no step is taken (pure rotate).
//   * A press of the direction the player is already facing commits a
//     step immediately — no rotate delay.
//   * Once a step is in flight, the player slides to the target tile over
//     STEP_DURATION seconds. Presses during a step go into a single-slot
//     queue; on snap the queued direction is consumed and chained without
//     delay. If no input is queued but a direction is still held, that
//     direction chains too. Otherwise the player becomes idle.
//
// (x, y) is the rendered float position. (tileX, tileY) is the canonical
// integer tile and is the source of truth for collision and snapping.

import { ANIMATIONS_FPS, SPRITE_SHEET_HEROES, STARTING_SPAWN } from "./constants.js";
import { isWalkable, isEntityBlocked, hasEnterableTeleporter, isTileSlippery } from "./world.js";
import { playSfx } from "./audio.js";
import { findPushableAt, pushOneTile } from "./pushables.js";
import { findGateAt, tryUnlockGate } from "./gateUnlock.js";

const HERO_BASE_FRAME = { x: 1, y: 1, w: 1, h: 2 };
const HERO_FRAME_COUNT = 4;

const STEP_DURATION = 0.22;        // seconds per tile (~4.5 tiles/s)
const ROTATE_COMMIT_DELAY = 0.06;  // seconds a key must be held to commit a step

// Direction-state → sprite-row offset, multiplied by frame.h to get y.
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

const HOLD_PRIORITY = ["up", "down", "left", "right"];

export function createPlayer() {
  return {
    // Rendered position (floats, equal to tileX/tileY when idle).
    x: STARTING_SPAWN.x,
    y: STARTING_SPAWN.y,
    // Canonical tile position (integers).
    tileX: STARTING_SPAWN.x,
    tileY: STARTING_SPAWN.y,
    // Facing.
    direction: "down",
    // Sprite-sheet metadata.
    sheetId: SPRITE_SHEET_HEROES,
    baseFrame: { ...HERO_BASE_FRAME },
    frameCount: HERO_FRAME_COUNT,
    frameIndex: 0,
    frameTimer: 0,
    moving: false,
    // Step state.
    step: null,           // { fromX, fromY, toX, toY, progress } | null
    queuedDir: null,      // direction to commit at next snap
    pendingDir: null,     // direction whose press is being timed for commit
    pendingTimer: 0,
  };
}

export function updatePlayer(player, input, dt, world) {
  if (player.step) advanceStep(player, input, dt, world);
  else handleIdle(player, input, dt, world);
  updateAnimation(player, dt);
}

// Mirrors Rust update_direction_based_on_keyboard: while standing on a
// slippery tile the player can't change direction; the only available
// state-change is "is the slide blocked? then stop". Returns true if
// the slippery-slide path consumed this tick and the normal idle logic
// should be skipped.
function handleIdleOnIce(player, world) {
  if (!player._sliding) return false;
  // Try to continue sliding in the same direction. If the next tile is
  // blocked we burn off the slide and become idle there.
  if (canEnter(player.tileX + DIR_DELTA[player.direction][0],
               player.tileY + DIR_DELTA[player.direction][1], world, player.direction)) {
    startStep(player, player.direction, world);
  } else {
    player._sliding = false;
  }
  return true;
}

function handleIdle(player, input, dt, world) {
  if (isTileSlippery(world, player.tileX, player.tileY) && handleIdleOnIce(player, world)) return;

  for (const dir of input.events) {
    if (dir === player.direction) {
      // Already facing → commit immediately, clear any pending rotate.
      player.pendingDir = null;
      player.pendingTimer = 0;
      startStep(player, dir, world);
      if (player.step) return;
    } else {
      // Rotate now, start commit timer.
      player.direction = dir;
      player.pendingDir = dir;
      player.pendingTimer = 0;
    }
  }

  if (player.pendingDir) {
    if (!input.held.has(player.pendingDir)) {
      // Released before commit → it was a tap, rotation only.
      player.pendingDir = null;
      player.pendingTimer = 0;
    } else {
      player.pendingTimer += dt;
      if (player.pendingTimer >= ROTATE_COMMIT_DELAY) {
        const dir = player.pendingDir;
        player.pendingDir = null;
        player.pendingTimer = 0;
        startStep(player, dir, world);
      }
    }
  }
}

function advanceStep(player, input, dt, world) {
  // Any press during a step replaces the queued direction (last-wins),
  // EXCEPT while sliding on ice — slippery surfaces commit you to the
  // current direction until you hit a wall.
  const slidingOnIce = isTileSlippery(world, player.tileX, player.tileY);
  if (!slidingOnIce) {
    for (const dir of input.events) player.queuedDir = dir;
  }

  const step = player.step;
  step.progress += dt / STEP_DURATION;

  if (step.progress < 1) {
    const t = step.progress;
    player.x = step.fromX + (step.toX - step.fromX) * t;
    player.y = step.fromY + (step.toY - step.fromY) * t;
    return;
  }

  // Snap to target tile.
  player.tileX = step.toX;
  player.tileY = step.toY;
  player.x = step.toX;
  player.y = step.toY;
  player.step = null;

  // If we just landed on (or stayed on) a slippery tile, the next tick
  // will auto-chain in the same direction via handleIdleOnIce. Mark
  // momentum so we don't have to re-derive it.
  if (isTileSlippery(world, player.tileX, player.tileY)) {
    player._sliding = true;
    return;
  }
  player._sliding = false;

  // Normal chaining: queued > held.
  let nextDir = player.queuedDir;
  player.queuedDir = null;
  if (!nextDir) {
    for (const d of HOLD_PRIORITY) {
      if (input.held.has(d)) { nextDir = d; break; }
    }
  }
  if (nextDir) {
    // Chain: face and step immediately, no commit delay.
    player.direction = nextDir;
    startStep(player, nextDir, world);
  }
}

function startStep(player, dir, world) {
  const [dx, dy] = DIR_DELTA[dir];
  const toX = player.tileX + dx;
  const toY = player.tileY + dy;
  player.direction = dir;
  if (!canEnter(toX, toY, world, dir)) return;
  player.step = {
    fromX: player.tileX,
    fromY: player.tileY,
    toX,
    toY,
    progress: 0,
  };
  playSfx("stepTaken", { volume: 0.5, jitter: 0.08 });
}

function canEnter(tx, ty, world, dir) {
  // Interior door tiles sit on a NOTHING biome tile — the player is meant
  // to leave through them, so a teleporter on an otherwise-unwalkable tile
  // overrides the biome obstacle (it already overrides rigid building tiles
  // for entries; same idea in reverse for exits).
  const onTeleporter = hasEnterableTeleporter(world, tx, ty);
  if (!onTeleporter && !isWalkable(world, tx, ty)) return false;
  // Pushables: if there's one in front, try to shove it one tile in the
  // same direction. On success the player steps in; on failure they bounce.
  const pushable = findPushableAt(world, tx, ty);
  if (pushable) {
    return pushOneTile(world, pushable, dir);
  }
  // Locked gates: if the player has a matching key, consume it and open
  // the gate permanently. Otherwise the gate blocks like any rigid entity.
  const gate = findGateAt(world, tx, ty);
  if (gate && !gate._open) {
    if (tryUnlockGate(gate)) return true;
    return false;
  }
  if (isEntityBlocked(world, tx, ty)) return false;
  return true;
}

function updateAnimation(player, dt) {
  player.moving = player.step != null;
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

// Source rect into the heroes sprite sheet, in tile units.
export function getPlayerSpriteFrame(player) {
  const { baseFrame, direction, moving, frameIndex } = player;
  const rowOffset = DIRECTION_ROW[direction][moving ? "moving" : "still"];
  return {
    x: baseFrame.x + frameIndex * baseFrame.w,
    y: baseFrame.y + rowOffset * baseFrame.h,
    w: baseFrame.w,
    h: baseFrame.h,
  };
}
