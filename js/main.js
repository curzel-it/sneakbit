// Entry point. Wires features together; holds no game logic itself.

import { STARTING_WORLD_ID } from "./constants.js";
import { loadAssets } from "./assets.js";
import { loadSpecies, loadWorld } from "./data.js";
import { loadSpeciesData } from "./species.js";
import { composeBiomeSheet } from "./biomeSheet.js";
import { buildWorld } from "./world.js";
import { initInput, pollInput } from "./input.js";
import { createPlayer, updatePlayer } from "./player.js";
import { createCamera, updateCamera } from "./camera.js";
import { createRenderer, render } from "./renderer.js";
import { startGameLoop } from "./gameLoop.js";
import { createBiomeAnimation, tickBiomeAnimation } from "./biomeAnimation.js";
import { installAutoZoom } from "./zoom.js";
import { installHud, updateHud } from "./hud.js";

async function main() {
  initInput();
  const hud = installHud();

  const [, speciesRaw, worldRaw] = await Promise.all([
    loadAssets(),
    loadSpecies(),
    loadWorld(STARTING_WORLD_ID),
  ]);

  loadSpeciesData(speciesRaw);
  composeBiomeSheet();

  const world = buildWorld(worldRaw);
  const player = createPlayer();
  const camera = createCamera();
  const canvas = document.getElementById("game");
  const renderer = createRenderer(canvas);
  const biomeAnim = createBiomeAnimation();
  installAutoZoom(canvas, camera, hud.el);

  startGameLoop((dt) => {
    const input = pollInput();
    updatePlayer(player, input, dt, world);
    updateCamera(camera, player, world);
    tickBiomeAnimation(biomeAnim, dt);
    render(renderer, world, camera, player, biomeAnim.frame);
    updateHud(hud, { worldId: world.id, fps: 1 / dt });
  });
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById("hud");
  if (el) el.textContent = `Error: ${err.message}`;
});
