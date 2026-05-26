// Entry point. Wires features together; holds no game logic itself.

import { STARTING_WORLD_ID, STARTING_SPAWN } from "./constants.js";
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
import { checkPickup } from "./pickups.js";
import { installMusic, playTrack } from "./music.js";
import { installTouchControls } from "./touch.js";
import { installToast } from "./toast.js";
import { installShooting, tickShooting } from "./shooting.js";
import { installMelee, tickMelee } from "./melee.js";
import { installAmmoHud, updateAmmoHud } from "./ammoHud.js";
import { tickMobs } from "./mobs.js";
import { tickMonsterFusion } from "./monsters.js";
import { tickMinionSpawning } from "./minions.js";
import { tickCombat } from "./combat.js";
import { tickAfterDialogue } from "./afterDialogue.js";
import { tickPlayerHealth, isPlayerDead, resetPlayerHealth } from "./playerHealth.js";
import { installHealthHud } from "./healthHud.js";
import { installGameOver, isGameOverOpen, showGameOver } from "./gameOver.js";
import { installFastTravel, isFastTravelOpen, tickFastTravel, markVisited } from "./fastTravel.js";
import { applyFirstLaunch } from "./firstLaunch.js";
import { loadProgress, saveProgress, clearProgress } from "./save.js";
import { getWorldCache } from "./worldCache.js";
import { setupPuzzles, tickPuzzles } from "./puzzles.js";
import { setupCutscenes, tickCutscenes } from "./cutscenes.js";
import { tickTrails } from "./trails.js";

async function main() {
  initInput();
  loadSettings();
  loadAudio();
  const hud = installHud();
  installMenu();
  installTransitions();
  installMusic();
  installDialogue();
  installToast();
  installTouchControls();
  installGameOver();
  applyFirstLaunch();

  const urlWorld = parseInt(new URLSearchParams(location.search).get("world"), 10);
  const saved = Number.isFinite(urlWorld) ? null : loadProgress();
  const startId = Number.isFinite(urlWorld) ? urlWorld : (saved?.worldId ?? STARTING_WORLD_ID);
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
  setupPuzzles(world);
  setupCutscenes(world);
  getWorldCache(world); // pre-bake static tile layers before first paint
  const player = createPlayer();
  // Restore the saved spawn first; otherwise (URL override / no save) fall
  // back to the entry teleporter on non-default worlds. The hard-coded
  // STARTING_SPAWN only fits world 1001.
  if (saved && saved.x != null && saved.y != null) {
    applySavedSpawn(player, world, saved);
  } else if (startId !== STARTING_WORLD_ID) {
    snapToEntry(player, world);
  }
  const state = {
    world,
    player,
    camera: createCamera(),
    lastTile: { x: player.tileX, y: player.tileY },
  };
  saveProgress(state);
  window.addEventListener("beforeunload", () => saveProgress(state));
  if (typeof window !== "undefined") {
    window.save = {
      now: () => saveProgress(state),
      reset: () => { clearProgress(); location.reload(); },
    };
  }
  installAutoZoom(canvas, state.camera, hud.el);
  installInteract(() => state);
  installShooting(() => state);
  installMelee(() => state);
  installAmmoHud();
  installHealthHud();
  installFastTravel(() => state);
  markVisited(state.world.id);
  if (state.world.soundtrack) playTrack(state.world.soundtrack);

  startGameLoop((dt) => {
    const paused = isMenuOpen() || isDialogueOpen() || isGameOverOpen() || isFastTravelOpen();
    const input = pollInput();
    if (!paused) {
      updatePlayer(state.player, input, dt, state.world);
      maybeTeleport(state);
      tickShooting(dt);
      tickMelee(dt);
      tickMobs(state.world, state.player, dt);
      tickMonsterFusion(state.world);
      tickMinionSpawning(state.world, state.player, dt);
      tickCombat(state.world, state.player, dt);
      tickAfterDialogue(state.world, dt);
      tickPuzzles(state.world, state.player);
      tickCutscenes(state.world, state.player, dt);
      tickTrails(state.world, state.player, dt);
      tickPlayerHealth(dt);
      tickFastTravel(dt);
      if (isPlayerDead()) handleDeath(state);
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
    updateAmmoHud();
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

function applySavedSpawn(player, world, saved) {
  const x = Math.max(0, Math.min(world.cols - 1, saved.x));
  const y = Math.max(0, Math.min(world.rows - 1, saved.y));
  player.tileX = x; player.tileY = y;
  player.x = x; player.y = y;
  if (saved.direction) player.direction = saved.direction;
}

let dying = false;
function handleDeath(state) {
  if (dying) return;
  dying = true;
  showGameOver(() => {
    const dest = { world: STARTING_WORLD_ID, x: STARTING_SPAWN.x, y: STARTING_SPAWN.y, direction: "Down" };
    travelTo(state, dest).then(() => {
      resetPlayerHealth();
      dying = false;
    });
  });
}

function maybeTeleport(state) {
  const { player, world, lastTile } = state;
  if (player.tileX === lastTile.x && player.tileY === lastTile.y) return;
  lastTile.x = player.tileX;
  lastTile.y = player.tileY;
  checkPickup(state);
  const tele = findTeleporterAt(world, player.tileX, player.tileY);
  if (tele) {
    travelTo(state, tele.destination).then(() => {
      markVisited(state.world.id);
      saveProgress(state);
    });
  } else {
    saveProgress(state);
  }
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById("hud");
  if (el) el.textContent = `Error: ${err.message}`;
});
