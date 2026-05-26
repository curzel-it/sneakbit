// Level-to-level transitions.
//
// Teleporter entities (species id 1019) sit on a single tile; when the
// player snaps onto that tile we fade to black, load the destination
// world, reposition the player, and fade back in.
//
// The fade overlay is a DOM element (above the canvas), not painted on
// the canvas — that keeps the renderer ignorant and gives us free
// CSS transitions.

import { loadWorld } from "./data.js";
import { buildWorld, isWalkable, isEntityBlocked } from "./world.js";
import { playSfx } from "./audio.js";
import { playTrack } from "./music.js";
import { getWorldCache } from "./worldCache.js";
import { setupPuzzles } from "./puzzles.js";
import { setupCutscenes } from "./cutscenes.js";

const TELEPORTER_SPECIES_ID = 1019;
const FADE_DURATION_MS = 220;

const DIR_OFFSET = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

let fadeEl = null;
let busy = false;

export function installTransitions() {
  if (fadeEl) return fadeEl;
  fadeEl = document.createElement("div");
  fadeEl.id = "fade";
  Object.assign(fadeEl.style, {
    position: "fixed",
    inset: "0",
    background: "#000",
    opacity: "0",
    pointerEvents: "none",
    transition: `opacity ${FADE_DURATION_MS}ms ease`,
    zIndex: "10",
  });
  document.body.appendChild(fadeEl);
  return fadeEl;
}

export function findTeleporterAt(world, tileX, tileY) {
  if (!world.entities) return null;
  for (const e of world.entities) {
    if (e.species_id !== TELEPORTER_SPECIES_ID) continue;
    if (!e.destination) continue;
    const f = e.frame;
    if (!f) continue;
    if (
      tileX >= f.x && tileX < f.x + f.w &&
      tileY >= f.y && tileY < f.y + f.h
    ) {
      return e;
    }
  }
  return null;
}

// `state` is the game-state container from main.js — at minimum
// `{ world, player }`. We mutate `state.world` and the player position.
export async function travelTo(state, destination) {
  if (busy) return;
  busy = true;
  try {
    const sourceWorldId = state.world?.id ?? 0;
    playSfx("worldChange");
    await fadeOut();
    const raw = await loadWorld(destination.world);
    const world = buildWorld(raw);
    setupPuzzles(world);
    setupCutscenes(world);
    // Bake the static tile layers during the black-screen window so the
    // first rendered frame is already cheap.
    getWorldCache(world);
    state.world = world;
    state.lastTile = { x: state.player.tileX, y: state.player.tileY };
    if (world.soundtrack) playTrack(world.soundtrack);
    const [spawnX, spawnY] = resolveSpawn(world, destination, sourceWorldId);
    // Mirror Rust world.spawn_point: remember the entry tile so that death
    // respawn can drop the player back at the door they came in through,
    // instead of teleporting them all the way to the starting world.
    world.spawnPoint = { x: spawnX, y: spawnY };
    movePlayerTo(state.player, spawnX, spawnY, destination.direction);
    // Co-op: respawn P2 next to P1 in P1's facing direction (Rust's
    // spawn_coop_players_around_hero runs on every world entry). Falls
    // back to stacking on P1 if the offset tile is blocked.
    if (state.player2) repositionCoopP2(state.player2, state.player, world);
    await fadeIn();
  } finally {
    busy = false;
  }
}

// Mirrors world_setup.rs::destination_x_y. When the source teleporter
// stores (0, 0) the engine looks up the destination world's teleporter
// that points back at us; we then step the player one tile *out* of
// that teleporter (typically down) so they don't immediately retrigger
// it and so they stand visually in front of the door, not on it.
//
// Convention: destination.x, destination.y are in the feet/tile space —
// same as player.tileX/tileY. Callers reading from world data (where Y
// is the Rust frame.y, i.e. the TOP of the 1×2 sprite) must add 1
// before calling travelTo — main.js::maybeTeleport does this for the
// in-world teleporter path. The death-respawn path in main.js passes
// world.spawnPoint, which is already feet-tile (set by travelTo on the
// previous entry, or seeded by computeEntryTile on initial load).
function resolveSpawn(world, destination, sourceWorldId) {
  const ox = destination.x ?? 0;
  const oy = destination.y ?? 0;
  if (ox === 0 && oy === 0) {
    const back = findTeleporterBack(world, sourceWorldId) ?? findAnyTeleporter(world);
    if (back) return stepOutOf(world, back, destination.direction);
    return [Math.floor(world.cols / 2), Math.floor(world.rows / 2)];
  }
  return [
    clamp(ox, 0, world.cols - 1),
    clamp(oy, 0, world.rows - 1),
  ];
}

// Pick a tile adjacent to the back teleporter's frame that the player
// can stand on. Tries the destination's stated direction first (or down
// as the natural "out of the door" default), then falls back to other
// directions, finally to the teleporter tile itself.
function stepOutOf(world, frame, direction) {
  const preferred = direction && direction !== "None"
    ? direction.toLowerCase()
    : "down";
  const order = [preferred, "down", "up", "left", "right"];
  const seen = new Set();
  for (const dir of order) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const off = DIR_OFFSET[dir];
    if (!off) continue;
    const tx = (off[0] >= 0 ? frame.x + frame.w - 1 : frame.x) + off[0];
    const ty = (off[1] >= 0 ? frame.y + frame.h - 1 : frame.y) + off[1];
    if (tx < 0 || ty < 0 || tx >= world.cols || ty >= world.rows) continue;
    if (!isWalkable(world, tx, ty)) continue;
    if (isEntityBlocked(world, tx, ty)) continue;
    return [tx, ty];
  }
  return [frame.x, frame.y];
}

function findTeleporterBack(world, sourceWorldId) {
  if (!world.entities || !sourceWorldId) return null;
  for (const e of world.entities) {
    if (e.species_id !== TELEPORTER_SPECIES_ID) continue;
    if (e.destination?.world !== sourceWorldId) continue;
    if (e.frame) return e.frame;
  }
  return null;
}

function findAnyTeleporter(world) {
  if (!world.entities) return null;
  for (const e of world.entities) {
    if (e.species_id === TELEPORTER_SPECIES_ID && e.frame) return e.frame;
  }
  return null;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Place P2 one tile in P1's facing direction, falling back to the same
// tile as P1 if the offset is blocked / out of bounds. Matches Rust
// world_setup::spawn_coop_players_around_hero.
function repositionCoopP2(p2, p1, world) {
  const off = DIR_OFFSET[p1.direction] ?? DIR_OFFSET.down;
  const candX = p1.tileX + off[0];
  const candY = p1.tileY + off[1];
  const inBounds = candX >= 0 && candY >= 0
    && candX < world.cols && candY < world.rows;
  const free = inBounds
    && isWalkable(world, candX, candY)
    && !isEntityBlocked(world, candX, candY);
  movePlayerTo(p2, free ? candX : p1.tileX, free ? candY : p1.tileY, p1.direction);
}

function movePlayerTo(player, tileX, tileY, direction) {
  player.tileX = tileX;
  player.tileY = tileY;
  player.x = tileX;
  player.y = tileY;
  player.step = null;
  player.queuedDir = null;
  player.pendingDir = null;
  player.pendingTimer = 0;
  // Strip any in-flight slide momentum from ice — keeps the respawned
  // player from immediately stepping off in whatever direction they
  // were sliding when they died.
  player._sliding = false;
  if (direction && direction !== "None") {
    player.direction = direction.toLowerCase();
  }
}

function fadeOut() { return setFade(1); }
function fadeIn() { return setFade(0); }

function setFade(target) {
  return new Promise((resolve) => {
    if (!fadeEl) return resolve();
    fadeEl.style.opacity = String(target);
    setTimeout(resolve, FADE_DURATION_MS);
  });
}
