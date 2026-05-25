// Level-to-level transitions.
//
// Teleporter entities (species id 1019) sit on a single tile; when the
// player snaps onto that tile we fade to black, load the destination
// world, reposition the player, and fade back in.
//
// The fade overlay is a DOM element (above the canvas), not painted on
// the canvas — that keeps the renderer ignorant and gives us free
// CSS transitions.

import { STARTING_SPAWN } from "./constants.js";
import { loadWorld } from "./data.js";
import { buildWorld } from "./world.js";
import { playSfx } from "./audio.js";

const TELEPORTER_SPECIES_ID = 1019;
const FADE_DURATION_MS = 220;

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
    playSfx("doorOpen", { volume: 0.7 });
    await fadeOut();
    const raw = await loadWorld(destination.world);
    const world = buildWorld(raw);
    state.world = world;
    const spawnX = destination.x ?? STARTING_SPAWN.x;
    const spawnY = destination.y ?? STARTING_SPAWN.y;
    movePlayerTo(state.player, spawnX, spawnY, destination.direction);
    await fadeIn();
  } finally {
    busy = false;
  }
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
