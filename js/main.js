// Entry point. Wires features together; holds no game logic itself.

import { STARTING_WORLD_ID } from "./constants.js";
import { loadAssets } from "./assets.js";
import { loadSpecies, loadStrings, loadWorld } from "./data.js";
import { loadStringsData } from "./strings.js";
import { installDialogue, isDialogueOpen } from "./dialogue.js";
import { installInteract } from "./interact.js";
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

  const [, speciesRaw, stringsRaw, worldRaw] = await Promise.all([
    loadAssets(),
    loadSpecies(),
    loadStrings("en"),
    loadWorld(STARTING_WORLD_ID),
  ]);

  loadSpeciesData(speciesRaw);
  loadStringsData(stringsRaw);
  await composeBiomeSheet();

  const canvas = document.getElementById("game");
  const renderer = createRenderer(canvas);
  const biomeAnim = createBiomeAnimation();
  const state = {
    world: buildWorld(worldRaw),
    player: createPlayer(),
    camera: createCamera(),
    lastTile: { x: -1, y: -1 },
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
    render(renderer, state.world, state.camera, state.player, biomeAnim.frame);
    updateHud(hud, {
      worldId: state.world.id,
      fps: 1 / dt,
      showFps: getSettings().showFps,
    });
  });
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
