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
import { installShooting, tickShooting, tryShoot } from "./shooting.js";
import { installMelee, tickMelee, tryMelee } from "./melee.js";
import { setGamepadAction } from "./gamepad.js";
import { installAmmoHud, updateAmmoHud } from "./ammoHud.js";
import { tickMobs } from "./mobs.js";
import { tickMonsterFusion } from "./monsters.js";
import { tickMinionSpawning } from "./minions.js";
import { tickCombat } from "./combat.js";
import { tickAfterDialogue } from "./afterDialogue.js";
import { tickPlayerHealth, isPlayerDead, resetPlayerHealth } from "./playerHealth.js";
import { installHealthHud } from "./healthHud.js";
import { installGameOver, isGameOverOpen, showGameOver } from "./gameOver.js";
import { installMessage, isMessageOpen } from "./message.js";
import { installFastTravel, isFastTravelOpen, tickFastTravel, markVisited } from "./fastTravel.js";
import { applyFirstLaunch } from "./firstLaunch.js";
import { loadProgress, saveProgress, clearProgress } from "./save.js";
import { getWorldCache } from "./worldCache.js";
import { setupPuzzles, tickPuzzles } from "./puzzles.js";
import { setupCutscenes, tickCutscenes } from "./cutscenes.js";
import { tickTrails } from "./trails.js";
import { tickPushables } from "./pushables.js";
import { updateVisibleEntities } from "./worldVisibility.js";
import { isCoopMode } from "./coopMode.js";
import { showLoadingScreen, bumpLoadingProgress, hideLoadingScreen } from "./loadingScreen.js";
import { runMigrations } from "./migrations.js";

async function main() {
  showLoadingScreen(5); // assets + species + strings + world + biome sheet bake
  runMigrations();
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
  installMessage();
  applyFirstLaunch();

  const urlWorld = parseInt(new URLSearchParams(location.search).get("world"), 10);
  const saved = Number.isFinite(urlWorld) ? null : loadProgress();
  const startId = Number.isFinite(urlWorld) ? urlWorld : (saved?.worldId ?? STARTING_WORLD_ID);

  const [, speciesRaw, stringsRaw, worldRaw] = await Promise.all([
    loadAssets().then(r => { bumpLoadingProgress("Sprites loaded"); return r; }),
    loadSpecies().then(r => { bumpLoadingProgress("Species loaded"); return r; }),
    loadStrings("en").then(r => { bumpLoadingProgress("Strings loaded"); return r; }),
    loadWorld(startId).then(r => { bumpLoadingProgress("World loaded"); return r; }),
  ]);

  loadSpeciesData(speciesRaw);
  loadStringsData(stringsRaw);
  await composeBiomeSheet();
  bumpLoadingProgress("Ready");
  hideLoadingScreen();

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
  // world.spawnPoint mirrors Rust's world.spawn_point: the tile the player
  // should respawn on after death. This is the world's entry — back
  // teleporter (or any teleporter) for non-starting worlds, STARTING_SPAWN
  // for world 1001 — NOT the player's current position (which may be a
  // mid-dungeon save). transitions.js refreshes this on every travelTo.
  world.spawnPoint = computeEntryTile(world);
  // In co-op, spawn P2 right next to P1 on the same tile by default — the
  // first move will separate them. Rust co-op uses the same "spawn around
  // hero" rule (game_core/src/worlds/world_setup.rs::spawn_coop_players_around_hero).
  const player2 = isCoopMode() ? makeCoopP2(player) : null;
  const state = {
    world,
    player,
    player2,
    camera: createCamera(),
    lastTile: { x: player.tileX, y: player.tileY },
  };
  saveProgress(state);
  let suppressUnloadSave = false;
  window.addEventListener("beforeunload", () => {
    if (suppressUnloadSave) return;
    saveProgress(state);
  });
  if (typeof window !== "undefined") {
    window.save = {
      now: () => saveProgress(state),
      reset: () => { clearProgress(); location.reload(); },
      // Called by menu.js's New Game / Clear-cache handlers *before* they
      // wipe localStorage. Without this guard the beforeunload listener
      // above would re-save the current player position on top of the
      // freshly-cleared save, so the page would reload right back into
      // the world+tile the player just tried to leave.
      suppressUnloadSave: () => { suppressUnloadSave = true; },
    };
  }
  installAutoZoom(canvas, state.camera, hud.el);
  installInteract(() => state);
  installShooting(() => state);
  installMelee(() => state);
  installAmmoHud();
  installHealthHud();
  installFastTravel(() => state);
  setGamepadAction("shoot", () => tryShoot());
  setGamepadAction("melee", () => tryMelee());
  setGamepadAction("interact", () => {
    // Synthesise an interact keypress so interact.js's listener fires
    // without us having to duplicate its "find entity in front" logic.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" }));
  });
  markVisited(state.world.id);
  if (state.world.soundtrack) playTrack(state.world.soundtrack);

  startGameLoop((dt) => {
    const paused = isMenuOpen() || isDialogueOpen() || isGameOverOpen() || isFastTravelOpen() || isMessageOpen();
    const input = pollInput();
    if (!paused) {
      updatePlayer(state.player, input, dt, state.world);
      if (state.player2) {
        const input2 = pollInput(2);
        updatePlayer(state.player2, input2, dt, state.world);
      }
      maybeTeleport(state);
      // Camera locks to the player and feeds the visibility filter that
      // gates per-entity ticks below. Moved here so the entity ticks see
      // the current frame's viewport instead of last frame's.
      updateCamera(state.camera, state.player, state.world);
      updateVisibleEntities(state.world, state.camera);
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
      tickPushables(state.world, dt);
      tickPlayerHealth(dt);
      tickFastTravel(dt);
      if (isPlayerDead()) handleDeath(state);
    } else {
      // When paused, keep the camera tracking the player so on resume
      // there's no jolt, but don't bother re-running the visibility pass
      // (the entity ticks are gated by `paused` above and won't read it).
      updateCamera(state.camera, state.player, state.world);
    }
    tickBiomeAnimation(biomeAnim, dt);
    tickEntities(dt);
    tickInteract();
    // Pass both players to the renderer so P2 sorts correctly with the
    // entity z-stack and not just on top as a separate draw call.
    const renderPlayers = state.player2 ? [state.player, state.player2] : state.player;
    render(renderer, state.world, state.camera, renderPlayers, biomeAnim.frame);
    updateHud(hud, {
      worldId: state.world.id,
      fps: 1 / dt,
      showFps: getSettings().showFps,
    });
    updateAmmoHud();
  });
}

// Build the co-op second player. Shares everything with P1 (sprite,
// step duration, etc) — the only differences are the starting tile
// (one to the right of P1, fallback to same tile) and a fresh
// direction. Inventory / HP are global so no per-player state needed
// on these fields here.
function makeCoopP2(p1) {
  const p2 = createPlayer();
  p2.tileX = p1.tileX;
  p2.tileY = p1.tileY;
  p2.x = p1.x;
  p2.y = p1.y;
  p2.direction = "down";
  return p2;
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

// Mirrors Rust world_setup::destination_x_y with source=0 (no back-link):
// 1001 has a hard-coded entry tile, every other world falls back to any
// teleporter, then to the world centre. Used to seed world.spawnPoint
// when there's no incoming travelTo to derive it from.
function computeEntryTile(world) {
  if (world.id === STARTING_WORLD_ID) {
    return { x: STARTING_SPAWN.x, y: STARTING_SPAWN.y };
  }
  const tele = (world.entities || []).find(e => e.species_id === 1019 && e.frame);
  if (tele) return { x: tele.frame.x, y: tele.frame.y };
  return {
    x: Math.max(0, Math.floor(world.cols / 2)),
    y: Math.max(0, Math.floor(world.rows / 2)),
  };
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
    // Mirror Rust engine.revive(): teleport to the current world's
    // spawn_point (the door the player came in through), not the global
    // starting world. travelTo reloads the world fresh so ephemeral
    // entities reset just like Rust's full teleport reload.
    const sp = state.world?.spawnPoint
      ?? { x: STARTING_SPAWN.x, y: STARTING_SPAWN.y };
    const worldId = state.world?.id ?? STARTING_WORLD_ID;
    const dest = { world: worldId, x: sp.x, y: sp.y, direction: "Down" };
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
    // World data stores destination.y as the Rust frame.y (sprite TOP)
    // while travelTo / player.tileY work in feet-tile space — bump by 1
    // so the player drops onto the floor in front of the destination
    // door instead of clipping a tile high. EXCEPTION: (0, 0) is a
    // magic value telling resolveSpawn to look up the back-teleporter
    // in the destination world (covers house interiors); +1 here would
    // become (0, 1) and the magic-value check would miss, dumping the
    // player on the top-left corner of the interior on a wall tile.
    const d = tele.destination;
    const dx = d?.x ?? 0;
    const dy = d?.y ?? 0;
    const dest = (dx === 0 && dy === 0)
      ? { ...d }
      : { ...d, y: dy + 1 };
    travelTo(state, dest).then(() => {
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
