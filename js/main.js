// Entry point. Wires features together; holds no game logic itself.

import { STARTING_WORLD_ID } from "./constants.js";
import { loadAssets } from "./assets.js";
import { loadWorld } from "./data.js";
import { buildWorld } from "./world.js";
import { initInput, pollInput } from "./input.js";
import { createPlayer, updatePlayer } from "./player.js";
import { createCamera, updateCamera } from "./camera.js";
import { createRenderer, render } from "./renderer.js";
import { startGameLoop } from "./gameLoop.js";

async function main() {
  initInput();

  const [, worldRaw] = await Promise.all([
    loadAssets(),
    loadWorld(STARTING_WORLD_ID),
  ]);

  const world = buildWorld(worldRaw);
  const player = createPlayer();
  const camera = createCamera();
  const renderer = createRenderer(document.getElementById("game"));

  startGameLoop((dt) => {
    const input = pollInput();
    updatePlayer(player, input, dt, world);
    updateCamera(camera, player, world);
    render(renderer, world, camera, player);
  });
}

main().catch((err) => {
  console.error(err);
  document.getElementById("hud").textContent = `Error: ${err.message}`;
});
