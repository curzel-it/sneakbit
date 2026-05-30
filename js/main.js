// Entry point. Wires features together; holds no game logic itself.

import { STARTING_ZONE_ID, STARTING_SPAWN } from "./constants.js?v=20260530a";
import { loadAssets } from "./assets.js?v=20260530a";
import { loadSpecies, loadStrings, loadZone } from "./data.js?v=20260530a";
import { loadStringsData, tr } from "./strings.js?v=20260530a";
import { installDialogue, isDialogueOpen } from "./dialogue.js?v=20260530a";
import { installInteract, tickInteract, tryInteractForSlot } from "./interact.js?v=20260530a";
import { loadSpeciesData } from "./species.js?v=20260530a";
import { composeBiomeSheet } from "./biomeSheet.js?v=20260530a";
import { buildZone } from "./zone.js?v=20260530a";
import { pickCoopSpawn } from "./coopSpawn.js?v=20260530a";
import { initInput, pollInput, clearInputState, clearInputHeld, pushInputPress } from "./input.js?v=20260530a";
import { createPlayer, updatePlayer } from "./player.js?v=20260530a";
import { createCamera, updateCamera, panCameraTo, cameraRectFor } from "./camera.js?v=20260530a";
import { createRenderer, render } from "./renderer.js?v=20260530a";
import { startGameLoop } from "./gameLoop.js?v=20260530a";
import { createBiomeAnimation, tickBiomeAnimation } from "./biomeAnimation.js?v=20260530a";
import { tickEntities } from "./entities.js?v=20260530a";
import { installAutoZoom } from "./zoom.js?v=20260530a";
import { installHud, updateHud } from "./hud.js?v=20260530a";
import { loadAudio } from "./audio.js?v=20260530a";
import { loadSettings, getSettings, resolveLanguage } from "./settings.js?v=20260530a";
import { installMenu, isMenuOpen } from "./menu.js?v=20260530a";
import { installTransitions, findTeleporterAt, travelTo } from "./transitions.js?v=20260530a";
import { checkPickup } from "./pickups.js?v=20260530a";
import { installMusic, playTrack } from "./music.js?v=20260530a";
import { installTouchControls } from "./touch.js?v=20260530a";
import { installToast, showToast } from "./toast.js?v=20260530a";
import { installShooting, tickShooting, tryShoot, tryShootForSlot } from "./shooting.js?v=20260530a";
import { installMelee, tickMelee, tryMelee, tryMeleeForSlot } from "./melee.js?v=20260530a";
import { setGamepadAction } from "./gamepad.js?v=20260530a";
import { pollGuestGamepad } from "./guestInputForwarder.js?v=20260530a";
import { installActiveInputDevice } from "./activeInputDevice.js?v=20260530a";
import { installControllerPresence, isControllerPaused } from "./controllerPresence.js?v=20260530a";
import { installAmmoHud, updateAmmoHud } from "./ammoHud.js?v=20260530a";
import { tickMobs } from "./mobs.js?v=20260530a";
import { tickMonsterFusion } from "./monsters.js?v=20260530a";
import { tickMinionSpawning } from "./minions.js?v=20260530a";
import { tickCombat } from "./combat.js?v=20260530a";
import { tickAfterDialogue } from "./afterDialogue.js?v=20260530a";
import { tickPlayerHealth, isPlayerDead, resetPlayerHealth, getPlayerHp, setPlayerHp } from "./playerHealth.js?v=20260530a";
import { installHealthHud, refreshHealthHud } from "./healthHud.js?v=20260530a";
import { installGameOver, isGameOverOpen, showGameOver, showMatchResult } from "./gameOver.js?v=20260530a";
import { installMessage, isMessageOpen } from "./message.js?v=20260530a";
import { installFastTravel, isFastTravelOpen, tickFastTravel, markVisited } from "./fastTravel.js?v=20260530a";
import { applyFirstLaunch } from "./firstLaunch.js?v=20260530a";
import { loadProgress, saveProgress, clearProgress } from "./save.js?v=20260530a";
import { getZoneCache } from "./zoneCache.js?v=20260530a";
import { setupPuzzles, tickPuzzles } from "./puzzles.js?v=20260530a";
import { setupCutscenes, tickCutscenes } from "./cutscenes.js?v=20260530a";
import { tickTrails } from "./trails.js?v=20260530a";
import { tickPushables } from "./pushables.js?v=20260530a";
import { updateVisibleEntities } from "./zoneVisibility.js?v=20260530a";
import { isCoopMode, setCoopMode, setLocalPlayerCount, localPlayerCount } from "./coopMode.js?v=20260530a";
import { showLoadingScreen, bumpLoadingProgress, hideLoadingScreen } from "./loadingScreen.js?v=20260530a";
import { runMigrations } from "./migrations.js?v=20260530a";
import { installMapEditor } from "./mapEditor.js?v=20260530a";
import { bootstrapOnline, onAnyClose } from "./onlineBootstrap.js?v=20260530a";
import { getMirrorZone, getMirrorPlayers, isMirrorReady, isMirrorDead, refreshMirrorEntities } from "./mirrorWorld.js?v=20260530a";
import { tickPredictedSelf, getPredictedSelf } from "./predictedSelf.js?v=20260530a";
import { getSelfPlayerId } from "./onlineBootstrap.js?v=20260530a";
import { installPartyPanel, isPartyPanelOpen } from "./partyPanel.js?v=20260530a";
import { installHostLaggingOverlay, updateHostLaggingOverlay } from "./hostLaggingOverlay.js?v=20260530a";
import { setHostPaused } from "./hostPauseState.js?v=20260530a";
import { getRuntimeRole, getMode, getJoinCode, setRuntimeRole } from "./onlineMode.js?v=20260530a";
import { switchRole, setStateHandlers } from "./switchRole.js?v=20260530a";
import { installUiTokens } from "./uiTokens.js?v=20260530a";
import { isPvp, setGameMode, getGameMode, GAME_MODE } from "./gameMode.js?v=20260530a";
import {
  startMatch as startPvpLogic, rematch as rematchPvpLogic, tickMatch as tickPvpMatch,
  notifyPlayerDied, cameraPlayerIndex, getMatchResult, isMatchOver, playerCount as pvpPlayerCount,
  getTurn, pvpSlotCanAct,
} from "./pvpMatch.js?v=20260530a";
import { cornerSpawnTile } from "./pvpSpawn.js?v=20260530a";
import { installTurnHud, updateTurnHud, hideTurnHud } from "./turnHud.js?v=20260530a";

// PvP world ids (Rust: arena 1301, exit to Duskhaven 1011 @ 59,57).
const PVP_ARENA_ZONE_ID = 1301;
const DUSKHAVEN_ZONE_ID = 1011;

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
  installTurnHud();
  installMessage();
  if (!bootGuest) applyFirstLaunch();

  // Always load English as the fallback table; load the resolved language on
  // top of it (skip the second fetch when it resolves to English). tr()
  // prefers the active table and falls back to English per-key.
  const lang = resolveLanguage();
  const [, speciesRaw, enRaw, langRaw] = await Promise.all([
    loadAssets().then(r => { bumpLoadingProgress(progressLabel("Sprites loaded")); return r; }),
    loadSpecies().then(r => { bumpLoadingProgress(progressLabel("Species loaded")); return r; }),
    loadStrings("en").then(r => { bumpLoadingProgress(progressLabel("Strings loaded")); return r; }),
    lang === "en" ? Promise.resolve(null) : loadStrings(lang).catch(() => null),
  ]);
  loadSpeciesData(speciesRaw);
  loadStringsData(langRaw ?? enRaw, enRaw);
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
    // Local co-op test/debug hook (mirrors window.save/creative). Lets
    // e2e set the local player count and drive each slot through the real
    // input pipeline + read avatar positions.
    window.coop = {
      setLocalPlayers,
      count: () => localPlayerCount(),
      positions: () => {
        const out = [];
        const add = (p) => p && out.push({ index: p.index | 0, tileX: p.tileX, tileY: p.tileY, direction: p.direction });
        add(state.player);
        add(state.player2);
        for (const s of state.players) add(s.player);
        return out;
      },
      // Single-tile tap: queue one press then drop the held set, so the
      // avatar takes exactly one step (no continuous walk).
      tap: (slot, dir) => { pushInputPress(slot, dir); clearInputHeld(slot); },
    };
    // PvP test/debug hook: start/exit a local match and read the turn +
    // match state the e2e suite asserts on.
    window.pvp = {
      start: (n) => startPvpMatch(n),
      exit: () => exitPvp(),
      // Force a player's death for win/lose tests (HP straight to 0).
      kill: (index) => setPlayerHp(0, index),
      // Fire a shot for the given 1-based slot through the real path.
      shoot: (slot) => tryShootForSlot(slot),
      state: () => ({
        mode: getGameMode(),
        zoneId: state.zone?.id,
        turn: getTurn(),
        liveIndex: cameraPlayerIndex(),
        result: getMatchResult(),
        over: isMatchOver(),
        hp: [0, 1, 2, 3].map((i) => getPlayerHp(i)),
        bullets: (state.zone?.entities || []).filter((e) => e._spawned).length,
      }),
    };
  }
  installAutoZoom(canvas, state.camera, hud.el);
  // Guests don't own the world, world-mutating logic, or the warp graph
  // — so the simulation modules (mapEditor, interact, shooting/melee,
  // fastTravel) stay gated. The HUDs (HP + ammo) DO run on guests: the
  // guestSelfHpSync module mirrors the host's authoritative HP into
  // playerHealth.records[0] and the per-player ammoSet events keep the
  // inventory in lockstep, so the HUDs render the right numbers.
  installAmmoHud();
  installHealthHud();
  installActiveInputDevice();
  installControllerPresence();
  // These listeners stay installed for the lifetime of the page,
  // including during guest sessions — every install fn either gates
  // internally on getNetRole === "guest" or only acts via a tick path
  // that the guest loop never calls. The old `if (!bootGuest)` gate
  // broke deep-link guests on leave: a ?join=CODE tab that switched
  // back to offline via Leave Coop had no shoot/melee/interact/
  // fast-travel/map-editor listeners attached, so those inputs
  // silently did nothing until the page was reloaded into offline
  // (which itself requires manually clearing ?join= from the URL).
  installMapEditor(() => state);
  installInteract(() => state);
  installShooting(() => state);
  installMelee(() => state);
  installFastTravel(() => state);
  setGamepadAction("shoot", () => tryShoot());
  setGamepadAction("melee", () => tryMelee());
  setGamepadAction("interact", () => {
    // Synthesise an interact keypress so interact.js's listener fires
    // without us having to duplicate its "find entity in front" logic.
    window.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyE" }));
  });
  // Local co-op P2-P4 pads drive slots 2-4 through the same per-slot
  // action seams the network guests use, so a 2nd/3rd/4th physical
  // controller fights and interacts as its own player.
  for (const slot of [2, 3, 4]) {
    setGamepadAction("shoot", () => tryShootForSlot(slot), slot);
    setGamepadAction("melee", () => tryMeleeForSlot(slot), slot);
    setGamepadAction("interact", () => tryInteractForSlot(slot), slot);
  }
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
  // offline). Per docs/online-coop.md §Close codes.
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
    // Pause is offline / local co-op only: freeze the sim on any overlay
    // (menu, dialogue, party panel, …) or when the active controller drops.
    // Hosting never freezes the shared world for a local overlay — that
    // would strand guests in a dead zone — so the gate is role-aware.
    const overlayOpen = isMenuOpen() || isDialogueOpen() || isGameOverOpen() || isFastTravelOpen() || isMessageOpen() || isPartyPanelOpen();
    const paused = (overlayOpen || isControllerPaused()) && getRuntimeRole() !== "host";
    // Tell guests when our local sim is frozen so their overlay can
    // show "Host paused the game" instead of the generic "Host
    // lagging…" — the no-op-when-not-host gate in setHostPaused keeps
    // this cheap in offline / local-coop. With the host-online carve-out
    // above this only fires now on a genuine host stall, not a menu.
    setHostPaused(paused);
    const input = pollInput();
    if (!paused) {
      // Online-host + overlay open: the sim keeps running (so guests
      // aren't stranded in a frozen zone), but the host's OWN avatar must
      // not wander off behind the dialog — feed it a neutral input. The
      // network-driven guest slots below keep their live wire input, so
      // guests can still move around while the host sits in a menu.
      // Offline / local co-op never reaches here with an overlay open
      // (that's `paused` → the else branch), so this is host-online only.
      const hostInput = overlayOpen ? { events: [], held: new Set() } : input;
      // Skip the per-player update for dead avatars — pollInput still
      // drains their event queue, so a held key doesn't flood the
      // player on revive. Without this gate a "dead-but-waiting" host
      // would silently walk around invisibly while spectating guests.
      if (!isPlayerDead(0)) updatePlayer(state.player, pvpGateInput(0, hostInput), dt, state.zone);
      if (state.player2) {
        const input2 = pollInput(2);
        if (!isPlayerDead(state.player2.index | 0)) {
          updatePlayer(state.player2, pvpGateInput(1, input2), dt, state.zone);
        }
      }
      for (const s of state.players) {
        const inputN = pollInput(s.slot);
        if (!isPlayerDead(s.player.index | 0)) {
          updatePlayer(s.player, pvpGateInput(s.player.index | 0, inputN), dt, state.zone);
        }
      }
      maybeTeleport(state);
      // Offline / local co-op: the camera averages every live player so
      // co-op players stay on one shared screen (dead players drop out of
      // the average). Online hosts instead follow only the host avatar —
      // each guest renders an independent window centred on themselves, so
      // the host's own window tracks the host. simulationViewports keeps
      // every off-camera guest's region alive (see below).
      applyCamera(dt);
      updateVisibleEntities(state.zone, simulationViewports(state));
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
      // PvP runs its own turn + death + win/lose path; co-op keeps the
      // inline-toast / P1-game-over path.
      if (isPvp()) {
        tickPvpFrame(dt);
      } else {
        // P2 death is handled inline (toast + hide bar). Only P1 death
        // halts the game with the Game Over modal.
        handleCoopDeaths(state);
        handleHostState(state);
      }
    } else {
      // When paused, keep the camera tracking the player so on resume
      // there's no jolt, but don't bother re-running the visibility pass
      // (the entity ticks are gated by `paused` above and won't read it).
      // Same follow-self-vs-averaged rule as the unpaused branch.
      applyCamera(dt);
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
    // Turn HUD: live during a PvP match, hidden during the result screen
    // and outside PvP. Runs outside the pause gate so the countdown is
    // always in sync.
    if (isPvp() && !isMatchOver()) updateTurnHud(getTurn());
    else hideTurnHud();
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
  // Local co-op (P2-P4 on this machine) doesn't combine with online
  // hosting — guests fill those slots. Reset to a single local player and
  // drop any local-only avatars so they can't collide with guest slot
  // assignment. (The UI already hides "Host" while local co-op is on; this
  // is a defensive backstop.)
  setLocalPlayerCount(1);
  if (state.player2 && !state.player2.playerId) { state.player2 = null; state.lastTile2 = null; }
  if (Array.isArray(state.players)) state.players = state.players.filter((e) => e.playerId != null);
  refreshHealthHud();
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
  // Forward this guest's own controller input to the host each frame
  // (no-op when the forwarder isn't installed or no pad is connected).
  pollGuestGamepad();
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
  // Refresh zone.entities with interpolated positions before render.
  // Without this, mobs / pushables / projectiles snap at the broadcaster's
  // 20 Hz tick instead of sliding smoothly. See mirrorWorld.refreshMirrorEntities.
  refreshMirrorEntities();
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
  // Follow-self camera: the guest's window tracks the guest's own avatar,
  // so two players can explore different parts of the same zone. This was
  // unsafe before — a guest wandering off-screen drifted into regions the
  // host wasn't simulating — but the host now simulates a viewport per
  // player (simulationViewports), so the guest's surroundings stay live.
  // Falls back to the averaged-live list until the predicted self exists
  // (early session) so the camera never snaps to nowhere.
  const self = getPredictedSelf();
  const camTarget = self ? [self] : liveGuestCameraPlayers(renderPlayers, mPlayers);
  updateCamera(state.camera, camTarget, mZone);
  updateVisibleEntities(mZone, state.camera);
  render(renderer, mZone, state.camera, renderPlayers, biomeAnim.frame);
  updateHud(hud, {
    zoneId: mZone.id,
    fps: 1 / dt,
    showFps: getSettings().showFps,
  });
  // The chip's count is driven by onInventoryChange, but the icon is
  // lazy-painted on the first updateAmmoHud after the inventory sprite
  // sheet loads. Without this call the chip on the guest path renders
  // its number but never gets its icon.
  updateAmmoHud();
}

// Swap the mirror's copy of the guest's own avatar with predictedSelf so
// the local input → render path is round-trip-free. Everyone else stays
// interpolated. The self is placed FIRST so it lands at player[0], which
// render() uses as the deterministic centre for the CantSeeShit light
// cone — with a follow-self camera the cone must track the self, not
// whichever player happened to come first in mirror order.
function buildGuestRenderPlayers(mPlayers) {
  const selfId = getSelfPlayerId();
  const predicted = getPredictedSelf();
  if (!selfId || !predicted) return mPlayers;
  const out = [predicted];
  for (const p of mPlayers) {
    if (p.playerId !== selfId) out.push(p);
  }
  return out;
}

// Camera input for the guest: the render list minus dead players, so a
// downed co-op partner stops dragging the shared centre toward its
// tombstone. Deadness comes from the mirror's per-player hp (synced by
// the host). The predicted self carries no hp, so we read the self's hp
// from the matching mirror entry by playerId. If everyone's dead we fall
// back to the full list so the camera doesn't snap to nowhere.
function liveGuestCameraPlayers(renderPlayers, mPlayers) {
  const deadIds = new Set();
  for (const p of mPlayers) {
    if (typeof p.hp === "number" && p.hp <= 0) deadIds.add(p.playerId);
  }
  if (!deadIds.size) return renderPlayers;
  const live = renderPlayers.filter((p) => !deadIds.has(p.playerId));
  return live.length ? live : renderPlayers;
}

// Build the co-op second player. Mirrors Rust world_setup.rs's
// spawn_coop_players_around_hero: pickCoopSpawn places P2 on the
// nearest walkable tile to P1, preferring P1's facing direction.
// createPlayer({ index: 1 }) selects the second hero column from the
// heroes sheet so P2 is visually distinct from P1.
function makeCoopP2(p1, zone, opts = {}) {
  const p2 = createPlayer({ index: opts.index ?? 1 });
  const { x: sx, y: sy } = pickCoopSpawn(p1, zone);
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
// Set the number of LOCAL players sharing this machine (1-4). Spawns or
// despawns avatars to match: P2 stays in state.player2 (kept special);
// P3/P4 are state.players[] entries with playerId:null (the same array
// online guests use, so loop / camera / render / travel / per-slot combat
// all work unchanged — local 4-player is offline-only, so it never shares
// that array with guests). Newly spawned players get full HP; despawned
// players have their input slot cleared.
export function setLocalPlayers(n) {
  if (!state?.zone || !state.player) return;
  n = Math.min(4, Math.max(1, n | 0));
  setLocalPlayerCount(n);

  if (n >= 2 && !state.player2) {
    state.player2 = makeCoopP2(state.player, state.zone, { index: 1 });
    state.lastTile2 = { x: state.player2.tileX, y: state.player2.tileY };
    resetPlayerHealth(1);
  } else if (n < 2 && state.player2) {
    state.player2 = null;
    state.lastTile2 = null;
    clearInputState(2);
  }

  ensureLocalExtra(3, n >= 3);
  ensureLocalExtra(4, n >= 4);
  deathToasted.clear();
  refreshHealthHud();
}

// Spawn/despawn a local P3/P4 entry in state.players. Only ever touches
// entries with playerId == null so online guests (which carry a playerId)
// are never disturbed.
function ensureLocalExtra(slot, want) {
  const idx = slot - 1;
  const existing = state.players.find((e) => e.slot === slot && e.playerId == null);
  if (want && !existing) {
    const p = makeCoopP2(state.player, state.zone, { index: idx });
    state.players.push({ player: p, slot, playerId: null, lastTile: { x: p.tileX, y: p.tileY } });
    resetPlayerHealth(idx);
  } else if (!want && existing) {
    state.players = state.players.filter((e) => !(e.slot === slot && e.playerId == null));
    clearInputState(slot);
  }
}

// Back-compat thin wrappers (party panel / any other callers).
export function enableLocalCoop() { setLocalPlayers(2); }
export function disableLocalCoop() { setLocalPlayers(1); }

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

// Three flags model the host's death lifecycle:
//   hostDying              — traditional gameOver flow is in motion
//                            (overlay shown, awaiting Continue + travelTo).
//   hostWaitingForRevive   — host is dead but online guests are alive,
//                            so the sim keeps ticking and the host
//                            spectates until a teleporter revives them
//                            (mirror of offline P2's "wait for zone
//                            change" rule, extended to the host).
//   hostDeathToasted       — one-shot latch for the "you died"
//                            notification so it doesn't spam every tick
//                            that the host stays dead.
let hostDying = false;
let hostWaitingForRevive = false;
let hostDeathToasted = false;

// True when at least one online-guest avatar in the host's local world
// is still alive. Local-coop P2 is excluded — local coop shares one
// screen so the offline behavior (P1 death → full pause + Continue)
// stays correct there.
function hasLiveOnlineGuests(state) {
  if (state.player2?.playerId && !isPlayerDead(state.player2.index | 0)) return true;
  if (Array.isArray(state.players)) {
    for (const s of state.players) {
      if (s.player?.playerId && !isPlayerDead(s.player.index | 0)) return true;
    }
  }
  return false;
}

function handleHostState(state) {
  const hostDead = isPlayerDead(0);
  if (!hostDead) {
    // Clear latent waiting/toasted state so a future death re-toasts.
    hostWaitingForRevive = false;
    hostDeathToasted = false;
    return;
  }
  // Online co-op: keep the sim running so live guests can keep playing
  // and trigger the next zone change (which revives the host via
  // transitions.js). The full-screen gameOver overlay would pause the
  // host's local tick — and a paused host = no world updates = guests
  // freeze. A toast announces the death without blocking the tick.
  if (hasLiveOnlineGuests(state)) {
    hostWaitingForRevive = true;
    if (!hostDeathToasted) {
      hostDeathToasted = true;
      showToast("You died — waiting for a teammate to find a teleporter", "longHint");
    }
    return;
  }
  // Solo (or with local-coop P2 only): traditional gameOver — full
  // overlay, Continue button, travelTo + revive everyone on commit.
  hostWaitingForRevive = false;
  if (hostDying) return;
  hostDying = true;
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
      deathToasted.clear();
      hostDeathToasted = false;
      hostDying = false;
    });
  });
}

// One-shot toast latches keyed by player index — the game keeps running
// so the per-frame death check would re-fire every tick without them.
// Covers every co-op teammate (local P2-P4 and, when hosting, guests).
const deathToasted = new Set();
function handleCoopDeaths(state) {
  const mates = [];
  if (state.player2) mates.push(state.player2);
  if (Array.isArray(state.players)) {
    for (const s of state.players) if (s.player) mates.push(s.player);
  }
  for (const p of mates) {
    const idx = p.index | 0;
    const dead = isPlayerDead(idx);
    if (dead && !deathToasted.has(idx)) {
      deathToasted.add(idx);
      const msg = tr("notification.player.died").replace("%PLAYER_NAME%", String(idx + 1));
      showToast(msg, "longHint");
    } else if (!dead && deathToasted.has(idx)) {
      // Defensive: a heal brought them back mid-zone. Drop the latch so a
      // future death re-toasts.
      deathToasted.delete(idx);
    }
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
// Both local and online co-op share the same averaging rule: keep every
// live player on screen. Online tried a per-device "follow self" camera
// at first, but a guest who wandered off the host's view could move into
// regions that aren't being updated (entities, mobs, pickups) — sharing
// one camera prevents that drift.
function livePlayersForCamera(state) {
  const live = allPlayers(state);
  // If everyone's dead the camera freezes on P1's last position so the
  // Game Over overlay doesn't snap to (0, 0).
  return live.length ? live : (state.player ? [state.player] : []);
}

// Who the host's window follows. Online hosts track only their own
// avatar (guests have their own independent windows); offline / local
// co-op keep the shared averaged camera so split-keyboard partners stay
// on one screen.
function hostCameraTarget(state) {
  if (getRuntimeRole() === "host") return state.player;
  return livePlayersForCamera(state);
}

// Which viewports the host simulates. Offline / local co-op gate entity
// ticks to the single shared camera, exactly as before. Online hosts
// also union a camera-sized rect centred on each off-camera guest, so a
// guest who wandered away from the host doesn't walk into frozen mobs /
// pickups the host wasn't ticking. Returns a single camera (legacy path)
// or an array; updateVisibleEntities accepts both.
function simulationViewports(state) {
  if (getRuntimeRole() !== "host") return state.camera;
  const cams = [state.camera];
  const { w, h } = state.camera;
  for (const p of allPlayers(state)) {
    if (p === state.player) continue;
    cams.push(cameraRectFor(p, w, h));
  }
  return cams;
}

// What the renderer draws on the host/offline screen. Dead avatars are
// filtered out so a downed co-op player vanishes until the next revive.
function livePlayersForRender(state) {
  return allPlayers(state);
}

// ── PvP (local) ────────────────────────────────────────────────────────
// One-shot death toasts for the active match (cleared on start/rematch).
const pvpDeadToasted = new Set();

// The player object for a 0-based slot index (0→P1, 1→P2, 2/3→local
// extras). Mirrors the slot layout setLocalPlayers builds.
function playerByIndex(state, idx0) {
  if (idx0 === 0) return state.player || null;
  if (idx0 === 1) return state.player2 || null;
  if (Array.isArray(state.players)) {
    const s = state.players.find((e) => e.slot === idx0 + 1 && e.playerId == null);
    if (s) return s.player;
  }
  return null;
}

// Every player object regardless of alive/dead — PvP needs to notice the
// frame a player dies (allPlayers filters the dead out).
function allPlayerObjects(state) {
  const out = [];
  if (state.player) out.push(state.player);
  if (state.player2) out.push(state.player2);
  if (Array.isArray(state.players)) {
    for (const s of state.players) if (s.player) out.push(s.player);
  }
  return out;
}

// Mask a slot's input to nothing when it isn't that player's turn (no-op
// outside PvP — pvpSlotCanAct returns true). pollInput is still called by
// the caller first, so the off-turn slot's event queue is drained.
function pvpGateInput(idx0, raw) {
  return pvpSlotCanAct(idx0 + 1) ? raw : { events: [], held: new Set() };
}

// PvP follows the current/upcoming player; everything else keeps the
// shared averaged (or host-self) camera.
function cameraTarget(state) {
  if (isPvp()) {
    const idx = cameraPlayerIndex();
    const p = idx != null ? playerByIndex(state, idx) : null;
    if (p) return p;
  }
  return hostCameraTarget(state);
}

// PvP eases the camera between far-apart corners; everything else snaps
// (the followed player moves slowly, so a snap-follow reads as smooth).
function applyCamera(dt) {
  const target = cameraTarget(state);
  if (isPvp()) panCameraTo(state.camera, target, state.zone, dt);
  else updateCamera(state.camera, target, state.zone);
}

// Drop a player onto a tile and resync the teleport bookkeeping so
// maybeTeleport doesn't immediately fire on the jump.
function placePvpPlayer(state, idx0, tile) {
  const p = playerByIndex(state, idx0);
  if (!p || !tile) return;
  p.tileX = tile.x; p.tileY = tile.y; p.x = tile.x; p.y = tile.y;
  p.step = null; p.queuedDir = null; p.pendingDir = null; p.pendingTimer = 0;
  p._sliding = false;
  p.direction = "down";
  if (idx0 === 0) state.lastTile = { x: tile.x, y: tile.y };
  else if (idx0 === 1 && state.lastTile2) state.lastTile2 = { x: tile.x, y: tile.y };
  else {
    const s = state.players?.find((e) => e.slot === idx0 + 1 && e.playerId == null);
    if (s) s.lastTile = { x: tile.x, y: tile.y };
  }
}

// Per-frame PvP step (offline/local only): advance the turn machine, toast
// + report any new death, and raise the result screen once resolved.
function tickPvpFrame(dt) {
  tickPvpMatch(dt);
  for (const p of allPlayerObjects(state)) {
    const idx = p.index | 0;
    if (isPlayerDead(idx) && !pvpDeadToasted.has(idx)) {
      pvpDeadToasted.add(idx);
      showToast(tr("notification.player.died").replace("%PLAYER_NAME%", String(idx + 1)), "longHint");
      notifyPlayerDied(idx);
    }
  }
  if (isMatchOver() && !isGameOverOpen()) {
    showMatchResult(getMatchResult(), onPvpRematch);
  }
}

// Rematch: re-arm the turn machine, full-heal, re-spawn at corners.
function onPvpRematch() {
  rematchPvpLogic();
  pvpDeadToasted.clear();
  const n = pvpPlayerCount();
  for (let i = 0; i < n; i++) {
    resetPlayerHealth(i);
    placePvpPlayer(state, i, cornerSpawnTile(state.zone, i));
  }
  refreshHealthHud();
}

// Start a local N-player PvP match: switch mode, spawn the players, travel
// to the arena (world 1301), then scatter them to the corners at full HP.
export async function startPvpMatch(n) {
  if (!state?.zone || !state.player) return;
  // Phase A is offline-only: starting PvP while hosting/guesting would
  // teleport the host into the arena and strand the guests. The menu
  // already hides the entry off-offline; this guards the programmatic path.
  if (getRuntimeRole() !== "offline") {
    showToast("Leave the online session before starting PvP", "longHint");
    return;
  }
  n = Math.max(2, Math.min(4, n | 0));
  setGameMode(GAME_MODE.pvp);
  setLocalPlayers(n);
  await travelTo(state, { zone: PVP_ARENA_ZONE_ID, x: 0, y: 0, direction: "Down" });
  pvpDeadToasted.clear();
  for (let i = 0; i < n; i++) {
    resetPlayerHealth(i);
    placePvpPlayer(state, i, cornerSpawnTile(state.zone, i));
  }
  startPvpLogic(n);
  // Snap to P1's corner so the first frame doesn't pan from the old zone.
  updateCamera(state.camera, playerByIndex(state, 0), state.zone);
  refreshHealthHud();
}

// Leave PvP: back to co-op single-player at Duskhaven.
export async function exitPvp() {
  if (!state?.zone) return;
  setGameMode(GAME_MODE.coop);
  setLocalPlayers(1);
  hideTurnHud();
  pvpDeadToasted.clear();
  await travelTo(state, { zone: DUSKHAVEN_ZONE_ID, x: 59, y: 57, direction: "Down" });
  resetPlayerHealth(0);
  refreshHealthHud();
}

// Whether a PvP match is currently active (menu uses it to swap entry/exit
// items).
export function isPvpActive() { return isPvp(); }

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
