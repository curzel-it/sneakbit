// Entry point. Wires features together; holds no game logic itself.

import { STARTING_WORLD_ID } from "./constants.js";
import { loadAssets } from "./assets.js";
import { loadSpecies, loadStrings, loadWorld } from "./data.js";
import { loadStringsData } from "./strings.js";
import { installDialogue, isDialogueOpen } from "./dialogue.js";
import { installInteract, tickInteract } from "./interact.js";
import { loadSpeciesData } from "./species.js";
import { composeBiomeSheet } from "./biomeSheet.js";
import { buildWorld } from "./world.js";
import { initInput, pollInput } from "./input.js";
import { createPlayer, updatePlayer } from "./player.js";
import { createCamera, updateCamera } from "./camera.js";
import { createRenderer, render } from "./renderer.js";
import { startGameLoop } from "./gameLoop.js";
import { createBiomeAnimation, tickBiomeAnimation } from "./biomeAnimation.js";
import { tickEntities } from "./entities.js";
import { installAutoZoom } from "./zoom.js";
import { installHud, updateHud } from "./hud.js";
import { loadAudio } from "./audio.js";
import { loadSettings, getSettings } from "./settings.js";
import { installMenu, isMenuOpen } from "./menu.js";
import { installTransitions, findTeleporterAt, travelTo } from "./transitions.js";
import { installMusic, playTrack } from "./music.js";
import { installTouchControls } from "./touch.js";

async function main() {
  initInput();
  loadSettings();
  loadAudio();
  const hud = installHud();
  installMenu();
  installTransitions();
  installMusic();
  installDialogue();
  installTouchControls();

  const startId = parseInt(new URLSearchParams(location.search).get("world"), 10) || STARTING_WORLD_ID;
  const [, speciesRaw, stringsRaw, worldRaw] = await Promise.all([
    loadAssets(),
    loadSpecies(),
    loadStrings("en"),
    loadWorld(startId),
  ]);

  loadSpeciesData(speciesRaw);
  loadStringsData(stringsRaw);
  await composeBiomeSheet();

  const canvas = document.getElementById("game");
  const renderer = createRenderer(canvas);
  const biomeAnim = createBiomeAnimation();
  const world = buildWorld(worldRaw);
  const player = createPlayer();
  // If the URL pointed us at a non-default world the hard-coded spawn
  // is likely off the map; place the player at the first teleporter (a
  // typical entry portal) or fall back to a safe in-bounds tile.
  if (startId !== STARTING_WORLD_ID) snapToEntry(player, world);
  const state = {
    world,
    player,
    camera: createCamera(),
    lastTile: { x: player.tileX, y: player.tileY },
  };
  installAutoZoom(canvas, state.camera, hud.el);
  installInteract(() => state);
  if (state.world.soundtrack) playTrack(state.world.soundtrack);

  startGameLoop((dt) => {
    const paused = isMenuOpen() || isDialogueOpen();
    const input = pollInput();
    if (!paused) {
      updatePlayer(state.player, input, dt, state.world);
      maybeTeleport(state);
    }
    updateCamera(state.camera, state.player, state.world);
    tickBiomeAnimation(biomeAnim, dt);
    tickEntities(dt);
    tickInteract();
    render(renderer, state.world, state.camera, state.player, biomeAnim.frame);
    updateHud(hud, {
      worldId: state.world.id,
      fps: 1 / dt,
      showFps: getSettings().showFps,
    });
  });
}

function snapToEntry(player, world) {
  const tele = (world.entities || []).find(e => e.species_id === 1019 && e.frame);
  let x = tele?.frame.x ?? 0;
  let y = tele?.frame.y ?? 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) { x = 1; y = 1; }
  x = Math.max(0, Math.min(world.cols - 1, x));
  y = Math.max(0, Math.min(world.rows - 1, y));
  player.tileX = x; player.tileY = y;
  player.x = x; player.y = y;
}

function maybeTeleport(state) {
  const { player, world, lastTile } = state;
  if (player.tileX === lastTile.x && player.tileY === lastTile.y) return;
  lastTile.x = player.tileX;
  lastTile.y = player.tileY;
  const tele = findTeleporterAt(world, player.tileX, player.tileY);
  if (tele) travelTo(state, tele.destination);
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById("hud");
  if (el) el.textContent = `Error: ${err.message}`;
});
