// Entry point. Wires features together; holds no game logic itself.

import { STARTING_ZONE_ID, STARTING_SPAWN } from "./constants.js?v=20260528";
import { loadAssets } from "./assets.js?v=20260528";
import { loadSpecies, loadStrings, loadZone } from "./data.js?v=20260528";
import { loadStringsData, tr } from "./strings.js?v=20260528";
import { installDialogue, isDialogueOpen } from "./dialogue.js?v=20260528";
import { installInteract, tickInteract } from "./interact.js?v=20260528";
import { loadSpeciesData } from "./species.js?v=20260528";
import { composeBiomeSheet } from "./biomeSheet.js?v=20260528";
import { buildZone, isWalkable, isEntityBlocked } from "./zone.js?v=20260528";
import { initInput, pollInput } from "./input.js?v=20260528";
import { createPlayer, updatePlayer } from "./player.js?v=20260528";
import { createCamera, updateCamera } from "./camera.js?v=20260528";
import { createRenderer, render } from "./renderer.js?v=20260528";
import { startGameLoop } from "./gameLoop.js?v=20260528";
import { createBiomeAnimation, tickBiomeAnimation } from "./biomeAnimation.js?v=20260528";
import { tickEntities } from "./entities.js?v=20260528";
import { installAutoZoom } from "./zoom.js?v=20260528";
import { installHud, updateHud } from "./hud.js?v=20260528";
import { loadAudio } from "./audio.js?v=20260528";
import { loadSettings, getSettings } from "./settings.js?v=20260528";
import { installMenu, isMenuOpen } from "./menu.js?v=20260528";
import { installTransitions, findTeleporterAt, travelTo } from "./transitions.js?v=20260528";
import { checkPickup } from "./pickups.js?v=20260528";
import { installMusic, playTrack } from "./music.js?v=20260528";
import { installTouchControls } from "./touch.js?v=20260528";
import { installToast, showToast } from "./toast.js?v=20260528";
import { installShooting, tickShooting, tryShoot } from "./shooting.js?v=20260528";
import { installMelee, tickMelee, tryMelee } from "./melee.js?v=20260528";
import { setGamepadAction } from "./gamepad.js?v=20260528";
import { installAmmoHud, updateAmmoHud } from "./ammoHud.js?v=20260528";
import { tickMobs } from "./mobs.js?v=20260528";
import { tickMonsterFusion } from "./monsters.js?v=20260528";
import { tickMinionSpawning } from "./minions.js?v=20260528";
import { tickCombat } from "./combat.js?v=20260528";
import { tickAfterDialogue } from "./afterDialogue.js?v=20260528";
import { tickPlayerHealth, isPlayerDead, resetPlayerHealth } from "./playerHealth.js?v=20260528";
import { installHealthHud } from "./healthHud.js?v=20260528";
import { installGameOver, isGameOverOpen, showGameOver } from "./gameOver.js?v=20260528";
import { installMessage, isMessageOpen } from "./message.js?v=20260528";
import { installFastTravel, isFastTravelOpen, tickFastTravel, markVisited } from "./fastTravel.js?v=20260528";
import { applyFirstLaunch } from "./firstLaunch.js?v=20260528";
import { loadProgress, saveProgress, clearProgress } from "./save.js?v=20260528";
import { getZoneCache } from "./zoneCache.js?v=20260528";
import { setupPuzzles, tickPuzzles } from "./puzzles.js?v=20260528";
import { setupCutscenes, tickCutscenes } from "./cutscenes.js?v=20260528";
import { tickTrails } from "./trails.js?v=20260528";
import { tickPushables } from "./pushables.js?v=20260528";
import { updateVisibleEntities } from "./zoneVisibility.js?v=20260528";
import { isCoopMode, setCoopMode } from "./coopMode.js?v=20260528";
import { showLoadingScreen, bumpLoadingProgress, hideLoadingScreen } from "./loadingScreen.js?v=20260528";
import { runMigrations } from "./migrations.js?v=20260528";
import { installMapEditor } from "./mapEditor.js?v=20260528";
import { bootstrapOnline, onAnyClose } from "./onlineBootstrap.js?v=20260528";
import { getMirrorZone, getMirrorPlayers, isMirrorReady, isMirrorDead } from "./mirrorWorld.js?v=20260528";
import { tickPredictedSelf, getPredictedSelf } from "./predictedSelf.js?v=20260528";
import { getSelfPlayerId } from "./onlineBootstrap.js?v=20260528";
import { installPartyPanel } from "./partyPanel.js?v=20260528";
import { installHostLaggingOverlay, updateHostLaggingOverlay } from "./hostLaggingOverlay.js?v=20260528";
import { getRuntimeRole, getMode, getJoinCode, setRuntimeRole } from "./onlineMode.js?v=20260528";
import { switchRole, setStateHandlers } from "./switchRole.js?v=20260528";
import { installUiTokens } from "./uiTokens.js?v=20260528";

// Live game state. Module-level so switchRole's state-handlers (and the
// beforeunload listener / window.save shim) can read and mutate it
// through stable references. Single instance for the page's lifetime;
// rebuilt in place on host/guest → offline transitions.
let state = null;

async function main() {
  // Land the shared CSS variables before any feature stylesheet that
  // references them is injected.
  installUiTokens();
  bootstrapOnline();             // seeds runtime role from URL; doesn't install role modules
  installPartyPanel();
  installHostLaggingOverlay();
  // `?join=CODE` tabs with a *well-formed* code are guests for the
  // lifetime of the page — they never own a local save and shouldn't
  // touch localStorage's identity bits, run the first-launch tutorial,
  // render an HP/ammo HUD off the wrong source, or open the
  // fast-travel/map-editor against a zone they don't own. A malformed
  // `?join=…` (or `?join=` with nothing) keeps the page in offline mode
  // so the party panel can still take a code from the user — without
  // that fallback, the game loop later reads a null player.tileX. The
  // runtime equivalent (offline → guest via party panel) is handled
  // per-feature in switchRole / menu gating.
  const bootGuest = getMode() === "guest" && !!getJoinCode();
  // Fewer steps on the guest path — no migrations, no offline-state
  // zone load, no first-launch toast. Loading screen also swaps to a
  // "Connecting to host…" label everywhere.
  showLoadingScreen(bootGuest ? 4 : 5);
  const progressLabel = (label) => bootGuest ? "Connecting to host…" : label;
  if (!bootGuest) runMigrations();
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
  if (!bootGuest) applyFirstLaunch();

  const [, speciesRaw, stringsRaw] = await Promise.all([
    loadAssets().then(r => { bumpLoadingProgress(progressLabel("Sprites loaded")); return r; }),
    loadSpecies().then(r => { bumpLoadingProgress(progressLabel("Species loaded")); return r; }),
    loadStrings("en").then(r => { bumpLoadingProgress(progressLabel("Strings loaded")); return r; }),
  ]);
  loadSpeciesData(speciesRaw);
  loadStringsData(stringsRaw);
  await composeBiomeSheet();

  // Build the offline state up front so the page is always ready to
  // render *something* — even guests fall back to offline view when a
  // session ends. switchRole later wipes/rebuilds these fields in place
  // when transitioning between roles. Guests skip the build: no
  // STARTING_ZONE_ID load, no loadProgress, no zone bake. They get a
  // bare stub with just a camera so installAutoZoom has something to
  // bind to.
  if (bootGuest) {
    state = { zone: null, rawZone: null, player: null, player2: null, players: [], camera: createCamera() };
  } else {
    await initOfflineState();
  }
  bumpLoadingProgress(progressLabel("Ready"));
  hideLoadingScreen();

  const canvas = document.getElementById("game");
  const renderer = createRenderer(canvas);
  const biomeAnim = createBiomeAnimation();
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
  // Guests don't own the world, the inventory, or the warp graph — and
  // their local HUD would render against the wrong data source if it
  // were installed (HP from playerHealth.js's local state, ammo from
  // inventory.js's local store, neither of which match the host's
  // view). The mapEditor gate is also defense-in-depth: today only
  // creative mode opens it, but that creative-mode check shouldn't be
  // load-bearing for "is this person allowed to edit the host's zones."
  if (!bootGuest) {
    installMapEditor(() => state);
    installInteract(() => state);
    installShooting(() => state);
    installMelee(() => state);
    installAmmoHud();
    installHealthHud();
    installFastTravel(() => state);
  }
  setGamepadAction("shoot", () => tryShoot());
  setGamepadAction("melee", () => tryMelee());
  setGamepadAction("interact", () => {
    // Synthesise an interact keypress so interact.js's listener fires
    // without us having to duplicate its "find entity in front" logic.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" }));
  });
  if (state.zone) {
    markVisited(state.zone.id);
    if (state.zone.soundtrack) playTrack(state.zone.soundtrack);
  }

  // Wire switchRole's state-handler registry so role transitions can
  // rebuild / wipe the world state. Done BEFORE the boot deep-link
  // dispatch so a ?host=1 / ?join=CODE entry has working callbacks.
  setStateHandlers({
    onEnterOffline: rebuildOfflineState,
    onEnterHost: tagHostPlayerId,
    onEnterGuest: wipeGuestState,
    stateGetter: () => state,
    p2Factory: makeCoopP2,
  });

  // 4005 = "kicked by host". net.js already suppresses auto-reconnect on
  // this code; here we surface the UX side (toast + drop back to
  // offline). Per docs/server.md §Close codes.
  onAnyClose(({ code }) => {
    if (code !== 4005) return;
    showToast("You were removed from the session", "longHint");
    switchRole("offline").catch((e) => console.error("[kick] switchRole(offline)", e));
  });

  // Honor the boot URL. resolveMode already seeded runtimeRole in
  // bootstrapOnline; the explicit setRuntimeRole("offline") fires
  // subscribers (status chip, party panel) on the offline path too so
  // they paint the initial empty state.
  const urlRole = getMode();
  if (urlRole === "host") {
    await switchRole("host");
  } else if (urlRole === "guest" && getJoinCode()) {
    await switchRole("guest", { code: getJoinCode() });
  } else {
    setRuntimeRole("offline");
  }

  startGameLoop((dt) => {
    if (getRuntimeRole() === "guest") {
      tickGuestFrame(dt, state, renderer, hud, biomeAnim);
      return;
    }
    const paused = isMenuOpen() || isDialogueOpen() || isGameOverOpen() || isFastTravelOpen() || isMessageOpen();
    const input = pollInput();
    if (!paused) {
      updatePlayer(state.player, input, dt, state.zone);
      if (state.player2) {
        const input2 = pollInput(2);
        updatePlayer(state.player2, input2, dt, state.zone);
      }
      for (const s of state.players) {
        const inputN = pollInput(s.slot);
        updatePlayer(s.player, inputN, dt, state.zone);
      }
      maybeTeleport(state);
      // Camera averages every live player so co-op players stay on screen.
      // Dead co-op players drop out of the average so the camera doesn't
      // anchor to where they fell. Single-player still passes one target.
      // For online hosts the camera only follows the host (each guest has
      // their own viewport via their mirror).
      const liveForCamera = livePlayersForCamera(state);
      updateCamera(state.camera, liveForCamera, state.zone);
      updateVisibleEntities(state.zone, state.camera);
      tickShooting(dt);
      tickMelee(dt);
      tickMobs(state.zone, allPlayers(state), dt);
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
    // until the next zone transition respawns them. Online hosts include
    // every guest avatar here — livePlayersForCamera narrows the camera
    // target down to the host themselves, but the host's screen still
    // needs to render the guests (or "host can't see guests" lingers).
    const renderPlayers = livePlayersForRender(state);
    render(renderer, state.zone, state.camera, renderPlayers, biomeAnim.frame);
    updateHud(hud, {
      zoneId: state.zone.id,
      fps: 1 / dt,
      showFps: getSettings().showFps,
    });
    updateAmmoHud();
  });
}

let mirrorDeathHandled = false;
function maybeFallBackToOffline() {
  if (mirrorDeathHandled) return;
  if (!isMirrorDead()) return;
  mirrorDeathHandled = true;
  showToast("Lost host — going offline", "longHint");
  // Transition in-place instead of reloading the page. switchRole's
  // offline setup re-runs initOfflineState via the registered handler,
  // so the player lands back in their own save world cleanly.
  switchRole("offline").then(() => { mirrorDeathHandled = false; });
}

// Build the initial offline state from local save + the configured zone.
// Module-level `state` is populated here; consumers that captured `()
// => state` keep working because they read the binding lazily.
async function initOfflineState() {
  const urlZone = parseInt(new URLSearchParams(location.search).get("zone"), 10);
  const saved = Number.isFinite(urlZone) ? null : loadProgress();
  const startId = Number.isFinite(urlZone) ? urlZone : (saved?.zoneId ?? STARTING_ZONE_ID);
  const zoneRaw = await loadZone(startId).then(r => { bumpLoadingProgress("Zone loaded"); return r; });
  const zone = buildZone(zoneRaw);
  setupPuzzles(zone);
  setupCutscenes(zone);
  getZoneCache(zone);
  const player = createPlayer();
  if (saved && saved.x != null && saved.y != null) {
    applySavedSpawn(player, zone, saved);
  } else if (startId !== STARTING_ZONE_ID) {
    snapToEntry(player, zone);
  }
  zone.spawnPoint = computeEntryTile(zone);
  const player2 = isCoopMode() ? makeCoopP2(player, zone) : null;
  // Preserve camera across role switches — the existing camera object
  // captured by installAutoZoom etc. must remain referentially stable.
  const camera = state?.camera ?? createCamera();
  state = {
    zone,
    rawZone: zoneRaw,
    player,
    player2,
    players: [],
    camera,
    lastTile: { x: player.tileX, y: player.tileY },
    lastTile2: player2 ? { x: player2.tileX, y: player2.tileY } : null,
  };
  saveProgress(state);
}

// switchRole onEnterOffline callback. Re-runs the offline-state build so
// a player coming back from a session lands on whatever their local save
// said, untouched by the session. Differs from initOfflineState only in
// that it can be called multiple times — initOfflineState already
// handles re-entry correctly via the same code path.
async function rebuildOfflineState() {
  await initOfflineState();
  markVisited(state.zone.id);
  if (state.zone.soundtrack) playTrack(state.zone.soundtrack);
}

// switchRole onEnterGuest callback. The guest's view comes from the
// mirror; the local sim doesn't run. Wipe state.zone/player so a stale
// tick can't accidentally read host-world data that isn't there, and
// drop any saved-progress side-effects the offline beforeunload listener
// might otherwise dispatch (saveProgress no-ops on missing zone/player).
function wipeGuestState() {
  if (!state) return;
  state.zone = null;
  state.rawZone = null;
  state.player = null;
  state.player2 = null;
  state.players = [];
  state.lastTile = null;
  state.lastTile2 = null;
}

// switchRole onEnterHost callback. Tags the host's local avatar with
// the server-assigned playerId so entities.js can find the display
// name. If welcome hasn't arrived yet (first open WS), the tag is
// applied later via the welcome handler in onlineBootstrap — entities
// label fallback is graceful in the meantime.
function tagHostPlayerId() {
  if (!state?.player) return;
  const pid = getSelfPlayerId();
  if (pid) state.player.playerId = pid;
}

// Guest-mode tick: skips simulation entirely (the host owns the world)
// and renders from the mirror. The mirror's zone arrives with the first
// snapshot; until then the canvas stays blank with the loading-screen
// overlay still visible. predictedSelf is advanced each frame so the
// guest's own avatar moves locally with zero perceived latency; on
// snapshot/delta we snap it back to whatever the host says.
function tickGuestFrame(dt, state, renderer, hud, biomeAnim) {
  maybeFallBackToOffline();
  updateHostLaggingOverlay();
  const mZone = getMirrorZone();
  tickBiomeAnimation(biomeAnim, dt);
  tickEntities(dt);
  if (!isMirrorReady() || !mZone) {
    updateHud(hud, {
      zoneId: mZone?.id ?? null,
      fps: 1 / dt,
      showFps: getSettings().showFps,
    });
    return;
  }
  // Pause the predicted self while the host has a modal dialogue open —
  // the host pauses its own tick, so any movement the guest predicts now
  // will rubber-band back the instant the host resumes. Gating here also
  // means the on-screen overlay is the only thing reacting to input,
  // which matches what the host sees.
  if (!isDialogueOpen()) tickPredictedSelf(dt);
  // Advance any cutscenes the host told us are playing. mirror:true
  // suppresses auto-trigger (host owns that) and skips finishCutscene
  // (we wait for event:cutsceneEnd instead, to avoid double-spawning
  // onEnd entities that the host's snapshot will already mirror in).
  tickCutscenes(mZone, null, dt, { mirror: true });
  const mPlayers = getMirrorPlayers();
  const renderPlayers = buildGuestRenderPlayers(mPlayers);
  if (!renderPlayers.length) {
    updateHud(hud, { zoneId: mZone.id, fps: 1 / dt, showFps: getSettings().showFps });
    return;
  }
  // Each guest plays on their own device — centre on their own avatar
  // rather than averaging across every mirrored player (which would
  // drag the view halfway to the host).
  const cameraTarget = pickGuestCameraTarget(renderPlayers);
  updateCamera(state.camera, cameraTarget, mZone);
  updateVisibleEntities(mZone, state.camera);
  render(renderer, mZone, state.camera, renderPlayers, biomeAnim.frame);
  updateHud(hud, {
    zoneId: mZone.id,
    fps: 1 / dt,
    showFps: getSettings().showFps,
  });
}

// Picks which mirror player the camera should follow on the guest side
// — the predicted-self entry if it's in the render list, otherwise the
// first mirrored player (only the host has joined, etc.). Returning a
// single player keeps updateCamera off the "average every coord" path.
function pickGuestCameraTarget(renderPlayers) {
  const selfId = getSelfPlayerId();
  if (selfId) {
    const self = renderPlayers.find((p) => p.playerId === selfId);
    if (self) return self;
  }
  return renderPlayers[0];
}

// Swap the mirror's copy of the guest's own avatar with predictedSelf so
// the local input → render path is round-trip-free. Everyone else stays
// interpolated.
function buildGuestRenderPlayers(mPlayers) {
  const selfId = getSelfPlayerId();
  const predicted = getPredictedSelf();
  if (!selfId || !predicted) return mPlayers;
  const out = [];
  let injected = false;
  for (const p of mPlayers) {
    if (p.playerId === selfId) {
      out.push(predicted);
      injected = true;
    } else {
      out.push(p);
    }
  }
  if (!injected) out.push(predicted);
  return out;
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

// Spawn-tile search: try the tile in front of P1 first, then the other
// three cardinals, finally fall back to P1's own tile if every neighbor
// is walled / occupied. Walking the four neighbors (instead of just the
// front tile) keeps hot-toggle from dropping P2 on top of P1 in tight
// corridors where the front tile happens to be solid.
function pickP2Spawn(p1, zone) {
  const dirs = ["up", "down", "left", "right"];
  const order = [p1.direction, ...dirs.filter((d) => d !== p1.direction)];
  for (const d of order) {
    const [dx, dy] = DIR_DELTA[d] ?? [0, 0];
    const x = p1.tileX + dx;
    const y = p1.tileY + dy;
    if (x < 0 || x >= zone.cols || y < 0 || y >= zone.rows) continue;
    if (!isWalkable(zone, x, y)) continue;
    if (isEntityBlocked(zone, x, y)) continue;
    return { x, y };
  }
  return { x: p1.tileX, y: p1.tileY };
}

function makeCoopP2(p1, zone, opts = {}) {
  const p2 = createPlayer({ index: opts.index ?? 1 });
  const { x: sx, y: sy } = pickP2Spawn(p1, zone);
  p2.tileX = sx;
  p2.tileY = sy;
  p2.x = sx;
  p2.y = sy;
  p2.direction = "down";
  return p2;
}

// Hot-toggle entry points for the party panel. Spawning / despawning P2
// reuses the same makeCoopP2 helper that initOfflineState calls at boot;
// per-frame consumers (input, melee/shoot/interact, HUD, inventory) all
// already gate on isCoopMode() or state.player2, so the flip takes
// effect on the next tick without further wiring. travelTo re-applies
// the coop spawn rule on zone transitions, so a hot-toggled P2 survives
// teleporters.
export function enableLocalCoop() {
  if (!state?.zone || !state.player) return;
  if (state.player2) return;
  setCoopMode(true);
  state.player2 = makeCoopP2(state.player, state.zone);
  state.lastTile2 = { x: state.player2.tileX, y: state.player2.tileY };
  p2DeathToasted = false;
}

export function disableLocalCoop() {
  if (!state) return;
  if (!state.player2 && !isCoopMode()) return;
  setCoopMode(false);
  state.player2 = null;
  state.lastTile2 = null;
  p2DeathToasted = false;
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
  if (Array.isArray(state.players)) {
    for (const s of state.players) {
      if (s.player && !isPlayerDead(s.player.index | 0)) out.push(s.player);
    }
  }
  return out;
}

// Camera follows live players (dead P2 doesn't drag the centre off).
// In local co-op both players share one screen so we average over every
// live player to keep them both in view. In online co-op the host and
// each guest see the world on separate devices, so the camera should
// stay centred on the local player — averaging would push the host's
// view halfway to wherever the guest is standing.
function livePlayersForCamera(state) {
  if (getRuntimeRole() === "host") {
    // Online host: only follow the host's own avatar. Guests render the
    // world from their own mirror with predictedSelf at the centre.
    return state.player ? [state.player] : [];
  }
  const live = allPlayers(state);
  // If everyone's dead the camera freezes on P1's last position so the
  // Game Over overlay doesn't snap to (0, 0).
  return live.length ? live : (state.player ? [state.player] : []);
}

// What the renderer draws on the host/offline screen. Distinct from the
// camera helper because the host's camera deliberately ignores guests
// (so the view doesn't slide to wherever they walk) but the host must
// still see them on-screen as fellow avatars. Earlier this reused
// livePlayersForCamera for both, which meant the host's screen drew
// only itself even though state.player2/state.players were being
// simulated and broadcast — guests saw the host but the host saw an
// empty world. Dead avatars are filtered out so a downed co-op player
// vanishes until the next revive (same rule as before for offline).
function livePlayersForRender(state) {
  return allPlayers(state);
}

function maybeTeleport(state) {
  const { player, player2, zone, lastTile, lastTile2 } = state;
  const p1Moved = player.tileX !== lastTile.x || player.tileY !== lastTile.y;
  const p2Moved = player2 && lastTile2
    && (player2.tileX !== lastTile2.x || player2.tileY !== lastTile2.y);
  // Track movement for any slot-3/4 network guest; entries carry their
  // own lastTile so the trigger logic doesn't have to special-case them.
  const extras = [];
  if (Array.isArray(state.players)) {
    for (const s of state.players) {
      if (!s.lastTile) s.lastTile = { x: s.player.tileX, y: s.player.tileY };
      if (s.player.tileX !== s.lastTile.x || s.player.tileY !== s.lastTile.y) {
        extras.push(s);
      }
    }
  }
  if (!p1Moved && !p2Moved && extras.length === 0) return;
  if (p1Moved) {
    lastTile.x = player.tileX;
    lastTile.y = player.tileY;
  }
  if (p2Moved) {
    lastTile2.x = player2.tileX;
    lastTile2.y = player2.tileY;
  }
  for (const s of extras) {
    s.lastTile.x = s.player.tileX;
    s.lastTile.y = s.player.tileY;
  }
  // Pickups: scan once with both players in play so whichever player
  // stepped onto the pickup tile wins it.
  checkPickup(state);
  // Teleporters: P1 always triggers; an online guest (P2 with a
  // playerId, or any slot-3/4 entry) also triggers so the spec's "guest
  // steps on teleporter → both move to the new zone" works. Local-only
  // P2 (no playerId) still follows P1 like before, so local co-op
  // behaves the same.
  let teleEntity = null;
  if (p1Moved) {
    teleEntity = findTeleporterAt(zone, player.tileX, player.tileY);
  }
  if (!teleEntity && p2Moved && player2?.playerId) {
    teleEntity = findTeleporterAt(zone, player2.tileX, player2.tileY);
  }
  if (!teleEntity) {
    for (const s of extras) {
      teleEntity = findTeleporterAt(zone, s.player.tileX, s.player.tileY);
      if (teleEntity) break;
    }
  }
  const tele = teleEntity;
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
