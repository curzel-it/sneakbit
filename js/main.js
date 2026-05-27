// Entry point. Wires features together; holds no game logic itself.

import { STARTING_ZONE_ID, STARTING_SPAWN } from "./constants.js";
import { loadAssets } from "./assets.js";
import { loadSpecies, loadStrings, loadZone } from "./data.js";
import { loadStringsData, tr } from "./strings.js";
import { installDialogue, isDialogueOpen } from "./dialogue.js";
import { installInteract, tickInteract } from "./interact.js";
import { loadSpeciesData } from "./species.js";
import { composeBiomeSheet } from "./biomeSheet.js";
import { buildZone, isWalkable, isEntityBlocked } from "./zone.js";
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
import { installToast, showToast } from "./toast.js";
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
import { getZoneCache } from "./zoneCache.js";
import { setupPuzzles, tickPuzzles } from "./puzzles.js";
import { setupCutscenes, tickCutscenes } from "./cutscenes.js";
import { tickTrails } from "./trails.js";
import { tickPushables } from "./pushables.js";
import { updateVisibleEntities } from "./zoneVisibility.js";
import { isCoopMode } from "./coopMode.js";
import { showLoadingScreen, bumpLoadingProgress, hideLoadingScreen } from "./loadingScreen.js";
import { runMigrations } from "./migrations.js";
import { installMapEditor } from "./mapEditor.js";
import { bootstrapOnline } from "./onlineBootstrap.js";
import { installSnapshotBroadcaster } from "./snapshotBroadcaster.js";

async function main() {
  bootstrapOnline();
  showLoadingScreen(5); // assets + species + strings + zone + biome sheet bake
  runMigrations();
  initInput();
  loadSettings();
  loadAudio();
  const hud = installHud();
  // installMenu accepts a state getter so the creative-mode "Save zone"
  // / "Export zone" / "Reset zone" actions can read state.rawZone and
  // state.zone?.id at click time. `state` isn't assigned yet here —
  // that's fine, the closure resolves it lazily when the user clicks.
  installMenu(() => state);
  installTransitions();
  installMusic();
  installDialogue();
  installToast();
  installTouchControls();
  installGameOver();
  installMessage();
  applyFirstLaunch();

  const urlZone = parseInt(new URLSearchParams(location.search).get("zone"), 10);
  const saved = Number.isFinite(urlZone) ? null : loadProgress();
  const startId = Number.isFinite(urlZone) ? urlZone : (saved?.zoneId ?? STARTING_ZONE_ID);

  const [, speciesRaw, stringsRaw, zoneRaw] = await Promise.all([
    loadAssets().then(r => { bumpLoadingProgress("Sprites loaded"); return r; }),
    loadSpecies().then(r => { bumpLoadingProgress("Species loaded"); return r; }),
    loadStrings("en").then(r => { bumpLoadingProgress("Strings loaded"); return r; }),
    loadZone(startId).then(r => { bumpLoadingProgress("Zone loaded"); return r; }),
  ]);

  loadSpeciesData(speciesRaw);
  loadStringsData(stringsRaw);
  await composeBiomeSheet();
  bumpLoadingProgress("Ready");
  hideLoadingScreen();

  const canvas = document.getElementById("game");
  const renderer = createRenderer(canvas);
  const biomeAnim = createBiomeAnimation();
  const zone = buildZone(zoneRaw);
  setupPuzzles(zone);
  setupCutscenes(zone);
  getZoneCache(zone); // pre-bake static tile layers before first paint
  const player = createPlayer();
  // Restore the saved spawn first; otherwise (URL override / no save) fall
  // back to the entry teleporter on non-default zones. The hard-coded
  // STARTING_SPAWN only fits zone 1001.
  if (saved && saved.x != null && saved.y != null) {
    applySavedSpawn(player, zone, saved);
  } else if (startId !== STARTING_ZONE_ID) {
    snapToEntry(player, zone);
  }
  // zone.spawnPoint mirrors Rust's zone.spawn_point: the tile the player
  // should respawn on after death. This is the zone's entry — back
  // teleporter (or any teleporter) for non-starting zones, STARTING_SPAWN
  // for zone 1001 — NOT the player's current position (which may be a
  // mid-dungeon save). transitions.js refreshes this on every travelTo.
  zone.spawnPoint = computeEntryTile(zone);
  // In co-op, spawn P2 right next to P1 on the same tile by default — the
  // first move will separate them. Rust co-op uses the same "spawn around
  // hero" rule (game_core/src/worlds/world_setup.rs::spawn_coop_players_around_hero).
  const player2 = isCoopMode() ? makeCoopP2(player, zone) : null;
  const state = {
    zone,
    // Creative mode needs the raw JSON kept around — the editor mutates
    // it directly and re-runs buildZone(raw) to refresh derived state,
    // and transitions.js flushes it to IndexedDB on every teleport.
    rawZone: zoneRaw,
    player,
    player2,
    camera: createCamera(),
    lastTile: { x: player.tileX, y: player.tileY },
    lastTile2: player2 ? { x: player2.tileX, y: player2.tileY } : null,
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
      // the zone+tile the player just tried to leave.
      suppressUnloadSave: () => { suppressUnloadSave = true; },
    };
  }
  installAutoZoom(canvas, state.camera, hud.el);
  installMapEditor(() => state);
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
  markVisited(state.zone.id);
  if (state.zone.soundtrack) playTrack(state.zone.soundtrack);

  // In host mode this samples the live world at 20 Hz and emits sparse
  // deltas to every guest, plus a full snapshot whenever a guest joins.
  // No-op in offline / guest mode.
  installSnapshotBroadcaster(() => state);

  startGameLoop((dt) => {
    const paused = isMenuOpen() || isDialogueOpen() || isGameOverOpen() || isFastTravelOpen() || isMessageOpen();
    const input = pollInput();
    if (!paused) {
      updatePlayer(state.player, input, dt, state.zone);
      if (state.player2) {
        const input2 = pollInput(2);
        updatePlayer(state.player2, input2, dt, state.zone);
      }
      maybeTeleport(state);
      // Camera averages every live player so co-op players stay on screen.
      // Dead co-op players drop out of the average so the camera doesn't
      // anchor to where they fell. Single-player still passes one target.
      const liveForCamera = livePlayersForCamera(state);
      updateCamera(state.camera, liveForCamera, state.zone);
      updateVisibleEntities(state.zone, state.camera);
      tickShooting(dt);
      tickMelee(dt);
      tickMobs(state.zone, state.player, dt);
      tickMonsterFusion(state.zone);
      tickMinionSpawning(state.zone, state.player, dt);
      // Combat now iterates every live player for melee monster damage
      // resolution; bullets carry _playerIndex for catcher refunds and
      // friendly-fire gating.
      tickCombat(state.zone, allPlayers(state), dt);
      tickAfterDialogue(state.zone, dt);
      tickPuzzles(state.zone, state.player);
      tickCutscenes(state.zone, state.player, dt);
      tickTrails(state.zone, state.player, dt);
      tickPushables(state.zone, dt);
      tickPlayerHealth(dt);
      tickFastTravel(dt);
      // P2 death is handled inline (toast + hide bar). Only P1 death
      // halts the game with the Game Over modal.
      handleCoopDeaths(state);
      if (isPlayerDead(0)) handleDeath(state);
    } else {
      // When paused, keep the camera tracking the player so on resume
      // there's no jolt, but don't bother re-running the visibility pass
      // (the entity ticks are gated by `paused` above and won't read it).
      updateCamera(state.camera, livePlayersForCamera(state), state.zone);
    }
    tickBiomeAnimation(biomeAnim, dt);
    tickEntities(dt);
    tickInteract();
    // Pass live players to the renderer so P2 sorts correctly with the
    // entity z-stack and not just on top as a separate draw call. Dead
    // co-op players are filtered out so they vanish from the screen
    // until the next zone transition respawns them.
    const renderPlayers = livePlayersForCamera(state);
    render(renderer, state.zone, state.camera, renderPlayers, biomeAnim.frame);
    updateHud(hud, {
      zoneId: state.zone.id,
      fps: 1 / dt,
      showFps: getSettings().showFps,
    });
    updateAmmoHud();
  });
}

// Build the co-op second player. Mirrors Rust world_setup.rs's
// spawn_coop_players_around_hero: P2 spawns one tile in P1's facing
// direction so the two players don't overlap, falling back to the same
// tile when the offset is blocked. createPlayer({ index: 1 }) selects
// the second hero column from the heroes sheet so P2 is visually
// distinct from P1.
const DIR_DELTA = {
  up:    [ 0, -1],
  down:  [ 0,  1],
  left:  [-1,  0],
  right: [ 1,  0],
};

function makeCoopP2(p1, zone) {
  const p2 = createPlayer({ index: 1 });
  const [dx, dy] = DIR_DELTA[p1.direction] ?? DIR_DELTA.down;
  const candX = p1.tileX + dx;
  const candY = p1.tileY + dy;
  const okX = candX >= 0 && candX < zone.cols;
  const okY = candY >= 0 && candY < zone.rows;
  const useOffset = okX && okY
    && isWalkable(zone, candX, candY)
    && !isEntityBlocked(zone, candX, candY);
  const sx = useOffset ? candX : p1.tileX;
  const sy = useOffset ? candY : p1.tileY;
  p2.tileX = sx;
  p2.tileY = sy;
  p2.x = sx;
  p2.y = sy;
  p2.direction = "down";
  return p2;
}

function snapToEntry(player, zone) {
  const tele = (zone.entities || []).find(e => e.species_id === 1019 && e.frame);
  let x = tele?.frame.x ?? 0;
  let y = tele?.frame.y ?? 0;
  if (!Number.isFinite(x) || !Number.isFinite(y)) { x = 1; y = 1; }
  x = Math.max(0, Math.min(zone.cols - 1, x));
  y = Math.max(0, Math.min(zone.rows - 1, y));
  player.tileX = x; player.tileY = y;
  player.x = x; player.y = y;
}

// Mirrors Rust world_setup::destination_x_y with source=0 (no back-link):
// 1001 has a hard-coded entry tile, every other zone falls back to any
// teleporter, then to the zone centre. Used to seed zone.spawnPoint
// when there's no incoming travelTo to derive it from.
function computeEntryTile(zone) {
  if (zone.id === STARTING_ZONE_ID) {
    return { x: STARTING_SPAWN.x, y: STARTING_SPAWN.y };
  }
  const tele = (zone.entities || []).find(e => e.species_id === 1019 && e.frame);
  if (tele) return { x: tele.frame.x, y: tele.frame.y };
  return {
    x: Math.max(0, Math.floor(zone.cols / 2)),
    y: Math.max(0, Math.floor(zone.rows / 2)),
  };
}

function applySavedSpawn(player, zone, saved) {
  const x = Math.max(0, Math.min(zone.cols - 1, saved.x));
  const y = Math.max(0, Math.min(zone.rows - 1, saved.y));
  player.tileX = x; player.tileY = y;
  player.x = x; player.y = y;
  if (saved.direction) player.direction = saved.direction;
}

let dying = false;
function handleDeath(state) {
  if (dying) return;
  dying = true;
  showGameOver(() => {
    // Mirror Rust engine.revive(): teleport to the current zone's
    // spawn_point (the door the player came in through), not the global
    // starting zone. travelTo reloads the zone fresh so ephemeral
    // entities reset just like Rust's full teleport reload.
    const sp = state.zone?.spawnPoint
      ?? { x: STARTING_SPAWN.x, y: STARTING_SPAWN.y };
    const zoneId = state.zone?.id ?? STARTING_ZONE_ID;
    const dest = { zone: zoneId, x: sp.x, y: sp.y, direction: "Down" };
    travelTo(state, dest).then(() => {
      // Revive resets every player's HP (P1 + P2) and the death flags
      // — the next tick treats P2 as alive again next to P1 (the
      // co-op spawn rule re-applied inside travelTo).
      resetPlayerHealth();
      p2DeathToasted = false;
      dying = false;
    });
  });
}

// One-shot toast latch for P2 death — the game keeps running so the
// per-frame death check would re-fire every tick without it.
let p2DeathToasted = false;
function handleCoopDeaths(state) {
  if (!state.player2) return;
  const p2Dead = isPlayerDead(state.player2.index | 0);
  if (p2Dead && !p2DeathToasted) {
    p2DeathToasted = true;
    const tmpl = tr("notification.player.died");
    const msg = tmpl.replace("%PLAYER_NAME%", "2");
    showToast(msg, "longHint");
  }
  if (!p2Dead && p2DeathToasted) {
    // Defensive: a heal somewhere brought P2 back to life mid-zone.
    // Drop the latch so a future death re-toasts.
    p2DeathToasted = false;
  }
}

// Returns every live player as an array, suitable for systems that
// want to act on each player (pickups, combat).
function allPlayers(state) {
  const out = [];
  if (state.player && !isPlayerDead(state.player.index | 0)) out.push(state.player);
  if (state.player2 && !isPlayerDead(state.player2.index | 0)) out.push(state.player2);
  return out;
}

// Camera follows live players (dead P2 doesn't drag the centre off).
// Single-player always returns [P1].
function livePlayersForCamera(state) {
  const live = allPlayers(state);
  // If everyone's dead the camera freezes on P1's last position so the
  // Game Over overlay doesn't snap to (0, 0).
  return live.length ? live : (state.player ? [state.player] : []);
}

function maybeTeleport(state) {
  const { player, player2, zone, lastTile, lastTile2 } = state;
  const p1Moved = player.tileX !== lastTile.x || player.tileY !== lastTile.y;
  const p2Moved = player2 && lastTile2
    && (player2.tileX !== lastTile2.x || player2.tileY !== lastTile2.y);
  if (!p1Moved && !p2Moved) return;
  if (p1Moved) {
    lastTile.x = player.tileX;
    lastTile.y = player.tileY;
  }
  if (p2Moved) {
    lastTile2.x = player2.tileX;
    lastTile2.y = player2.tileY;
  }
  // Pickups: scan once with both players in play so whichever player
  // stepped onto the pickup tile wins it.
  checkPickup(state);
  // Teleporters: only P1 triggers zone transitions — matches Rust's
  // co-op rule where the zone reload always recenters on P1.
  if (!p1Moved) return;
  const tele = findTeleporterAt(zone, player.tileX, player.tileY);
  if (tele) {
    // Zone data stores destination.y as the Rust frame.y (sprite TOP)
    // while travelTo / player.tileY work in feet-tile space — bump by 1
    // so the player drops onto the floor in front of the destination
    // door instead of clipping a tile high. EXCEPTION: (0, 0) is a
    // magic value telling resolveSpawn to look up the back-teleporter
    // in the destination zone (covers house interiors); +1 here would
    // become (0, 1) and the magic-value check would miss, dumping the
    // player on the top-left corner of the interior on a wall tile.
    const d = tele.destination;
    const dx = d?.x ?? 0;
    const dy = d?.y ?? 0;
    const dest = (dx === 0 && dy === 0)
      ? { ...d }
      : { ...d, y: dy + 1 };
    travelTo(state, dest).then(() => {
      markVisited(state.zone.id);
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
