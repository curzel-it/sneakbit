// Level-to-level transitions.
//
// Teleporter entities (species id 1019) sit on a single tile; when the
// player snaps onto that tile we fade to black, load the destination
// zone, reposition the player, and fade back in.
//
// The fade overlay is a DOM element (above the canvas), not painted on
// the canvas — that keeps the renderer ignorant and gives us free
// CSS transitions.

import { loadZone } from "./data.js?v=20260529b";
import { buildZone, isWalkable, isEntityBlocked } from "./zone.js?v=20260529b";
import { playSfx } from "./audio.js?v=20260529b";
import { playTrack } from "./music.js?v=20260529b";
import { getZoneCache } from "./zoneCache.js?v=20260529b";
import { setupPuzzles } from "./puzzles.js?v=20260529b";
import { setupCutscenes } from "./cutscenes.js?v=20260529b";
import { isCreativeMode } from "./creativeMode.js?v=20260529b";
import { putBufferedZone } from "./zoneBuffer.js?v=20260529b";
import { resetPlayerHealth, isPlayerDead } from "./playerHealth.js?v=20260529b";

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

export function findTeleporterAt(zone, tileX, tileY) {
  if (!zone.entities) return null;
  for (const e of zone.entities) {
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
// `{ zone, player }`. We mutate `state.zone` and the player position.
export async function travelTo(state, destination) {
  if (busy) return;
  busy = true;
  try {
    const sourceZoneId = state.zone?.id ?? 0;
    // Creative mode persists the source zone's raw JSON to the
    // IndexedDB override buffer before we tear down, so map-editor
    // mutations made on the way out survive the zone transition (Rust
    // engine.save() runs on every teleport in creative). Awaited so the
    // write actually flushes before we lose the source reference.
    if (isCreativeMode() && sourceZoneId && state.rawZone) {
      try { await putBufferedZone(sourceZoneId, state.rawZone); }
      catch (e) { console.warn("creative: failed to buffer zone on teleport", e); }
    }
    playSfx("zoneChange");
    await fadeOut();
    const raw = await loadZone(destination.zone);
    const zone = buildZone(raw);
    setupPuzzles(zone);
    setupCutscenes(zone);
    // Bake the static tile layers during the black-screen window so the
    // first rendered frame is already cheap.
    getZoneCache(zone);
    state.zone = zone;
    // Keep the raw JSON next to the built zone so the creative editor
    // can mutate it in place and re-run buildZone() to refresh derived
    // state. Non-creative play also keeps it around — cheap, and the
    // save-on-teleport path above is the only consumer.
    state.rawZone = raw;
    state.lastTile = { x: state.player.tileX, y: state.player.tileY };
    if (state.player2) {
      state.lastTile2 = { x: state.player2.tileX, y: state.player2.tileY };
    }
    if (Array.isArray(state.players)) {
      for (const s of state.players) {
        s.lastTile = { x: s.player.tileX, y: s.player.tileY };
      }
    }
    if (zone.soundtrack) playTrack(zone.soundtrack);
    const [spawnX, spawnY] = resolveSpawn(zone, destination, sourceZoneId);
    // Mirror Rust zone.spawn_point: remember the entry tile so that death
    // respawn can drop the player back at the door they came in through,
    // instead of teleporting them all the way to the starting zone.
    zone.spawnPoint = { x: spawnX, y: spawnY };
    movePlayerTo(state.player, spawnX, spawnY, destination.direction);
    // Co-op: respawn P2 next to P1 in P1's facing direction (Rust's
    // spawn_coop_players_around_hero runs on every zone entry). Falls
    // back to stacking on P1 if the offset tile is blocked. A dead P2
    // is brought back to life by the zone reload — matches Rust's
    // dead_players being cleared on every zone entry.
    // P1 (host) revive-on-zone-change. The offline death flow already
    // resets host HP via handleDeath's onContinue, but in online co-op
    // we let the sim keep running while only the host is dead (guests
    // can still play), and a guest stepping through a teleporter is
    // the natural revival trigger. Without this the host would be
    // teleported to the new zone's spawn but stay at hp=0 — still
    // "dead", still invisible, still spectating.
    {
      const hostWasDead = isPlayerDead(state.player.index | 0);
      if (hostWasDead) resetPlayerHealth(state.player.index | 0);
    }
    if (state.player2) {
      const wasDead = isPlayerDead(state.player2.index | 0);
      repositionCoopP2(state.player2, state.player, zone);
      if (wasDead) resetPlayerHealth(state.player2.index | 0);
    }
    if (Array.isArray(state.players)) {
      for (const s of state.players) {
        const wasDead = isPlayerDead(s.player.index | 0);
        repositionCoopP2(s.player, state.player, zone);
        s.lastTile = { x: s.player.tileX, y: s.player.tileY };
        if (wasDead) resetPlayerHealth(s.player.index | 0);
      }
    }
    await fadeIn();
  } finally {
    busy = false;
  }
}

// Mirrors world_setup.rs::destination_x_y. When the source teleporter
// stores (0, 0) the engine looks up the destination zone's teleporter
// that points back at us; we then step the player one tile *out* of
// that teleporter (typically down) so they don't immediately retrigger
// it and so they stand visually in front of the door, not on it.
//
// Convention: destination.x, destination.y are in the feet/tile space —
// same as player.tileX/tileY. Callers reading from zone data (where Y
// is the Rust frame.y, i.e. the TOP of the 1×2 sprite) must add 1
// before calling travelTo — main.js::maybeTeleport does this for the
// in-zone teleporter path. The death-respawn path in main.js passes
// zone.spawnPoint, which is already feet-tile (set by travelTo on the
// previous entry, or seeded by computeEntryTile on initial load).
function resolveSpawn(zone, destination, sourceZoneId) {
  const ox = destination.x ?? 0;
  const oy = destination.y ?? 0;
  if (ox === 0 && oy === 0) {
    const back = findTeleporterBack(zone, sourceZoneId) ?? findAnyTeleporter(zone);
    if (back) return stepOutOf(zone, back, destination.direction);
    return [Math.floor(zone.cols / 2), Math.floor(zone.rows / 2)];
  }
  return [
    clamp(ox, 0, zone.cols - 1),
    clamp(oy, 0, zone.rows - 1),
  ];
}

// Pick a tile adjacent to the back teleporter's frame that the player
// can stand on. Tries the destination's stated direction first (or down
// as the natural "out of the door" default), then falls back to other
// directions, finally to the teleporter tile itself.
function stepOutOf(zone, frame, direction) {
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
    if (tx < 0 || ty < 0 || tx >= zone.cols || ty >= zone.rows) continue;
    if (!isWalkable(zone, tx, ty)) continue;
    if (isEntityBlocked(zone, tx, ty)) continue;
    return [tx, ty];
  }
  return [frame.x, frame.y];
}

function findTeleporterBack(zone, sourceZoneId) {
  if (!zone.entities || !sourceZoneId) return null;
  for (const e of zone.entities) {
    if (e.species_id !== TELEPORTER_SPECIES_ID) continue;
    if (e.destination?.zone !== sourceZoneId) continue;
    if (e.frame) return e.frame;
  }
  return null;
}

function findAnyTeleporter(zone) {
  if (!zone.entities) return null;
  for (const e of zone.entities) {
    if (e.species_id === TELEPORTER_SPECIES_ID && e.frame) return e.frame;
  }
  return null;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// Place P2 one tile in P1's facing direction, falling back to the same
// tile as P1 if the offset is blocked / out of bounds. Matches Rust
// world_setup::spawn_coop_players_around_hero.
function repositionCoopP2(p2, p1, zone) {
  const off = DIR_OFFSET[p1.direction] ?? DIR_OFFSET.down;
  const candX = p1.tileX + off[0];
  const candY = p1.tileY + off[1];
  const inBounds = candX >= 0 && candY >= 0
    && candX < zone.cols && candY < zone.rows;
  const free = inBounds
    && isWalkable(zone, candX, candY)
    && !isEntityBlocked(zone, candX, candY);
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

// Exposed so guestEvents.js can drive the same fade overlay on
// host-initiated zone changes — the guest doesn't own the transition,
// the host's event:zoneChange tells the guest to fade.
export function fadeOverlayOut() { return fadeOut(); }
export function fadeOverlayIn() { return fadeIn(); }
export const FADE_OVERLAY_MS = FADE_DURATION_MS;

function setFade(target) {
  return new Promise((resolve) => {
    if (!fadeEl) return resolve();
    fadeEl.style.opacity = String(target);
    setTimeout(resolve, FADE_DURATION_MS);
  });
}
