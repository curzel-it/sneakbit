// Entry point. Wires features together; holds no game logic itself.

import { STARTING_ZONE_ID, STARTING_SPAWN, PVP_ARENA_ZONE_ID } from "./constants.js";
import { loadAssets } from "./assets.js";
import { loadSpecies, loadStrings, loadZone } from "./data.js";
import { loadStringsData, tr } from "./strings.js";
import { installDialogue, isDialogueOpen } from "./dialogue.js";
import { installInteract, tickInteract, tryInteractForSlot } from "./interact.js";
import { loadSpeciesData } from "./species.js";
import { composeBiomeSheet } from "./biomeSheet.js";
import { buildZone, isTeleporterLocked } from "./zone.js";
import { pickCoopSpawn } from "./coopSpawn.js";
import { initInput, pollInput, clearInputState, clearInputHeld, pushInputPress } from "./input.js";
import { createPlayer, updatePlayer, updateGuestAvatar } from "./player.js";
import { createCamera, updateCamera, cameraRectFor } from "./camera.js";
import { createRenderer, render, renderViewports } from "./renderer.js";
import { startGameLoop } from "./gameLoop.js";
import { createBiomeAnimation, tickBiomeAnimation } from "./biomeAnimation.js";
import { tickEntities } from "./entities.js";
import { installAutoZoom, reapplyAutoZoom } from "./zoom.js";
import { sliceCount, recomputeSlices, getSlices } from "./splitScreen.js";
import { installHud, updateHud } from "./hud.js";
import { loadAudio } from "./audio.js";
import { loadSettings, getSettings, resolveLanguage } from "./settings.js";
import { installMenu, isMenuOpen } from "./menu.js";
import { installTransitions, findTeleporterAt, travelTo } from "./transitions.js";
import { checkPickup } from "./pickups.js";
import { installMusic, playTrack } from "./music.js";
import { installTouchControls, setInteractPrompt, updateTouchCombat } from "./touch.js";
import { installToast, showToast } from "./toast.js";
import { installShooting, tickShooting, tryShoot, tryShootForSlot } from "./shooting.js";
import { installMelee, tickMelee, tryMelee, tryMeleeForSlot } from "./melee.js";
import { installWeaponSelect, cycleWeapon } from "./weaponSelect.js";
import { SLOT_RANGED, SLOT_MELEE } from "./equipment.js";
import { setGamepadAction } from "./gamepad.js";
import { pollGuestGamepad } from "./guestInputForwarder.js";
import { installActiveInputDevice } from "./activeInputDevice.js";
import { installControllerPresence, isControllerPaused } from "./controllerPresence.js";
import { installAmmoHud, updateAmmoHud } from "./ammoHud.js";
import { installCoinHud, updateCoinHud } from "./coinHud.js";
import { seedStartingCoins } from "./wallet.js";
import { tickMobs } from "./mobs.js";
import { tickMonsterFusion } from "./monsters.js";
import { tickMinionSpawning } from "./minions.js";
import { tickCombat } from "./combat.js";
import { tickAfterDialogue } from "./afterDialogue.js";
import { tickNpcInterception, isInterceptionActive } from "./npcInterception.js";
import { tickPlayerHealth, isPlayerDead, resetPlayerHealth } from "./playerHealth.js";
import { tickKnockbackAura, resetKnockbackAura } from "./knockbackAura.js";
import { installHealthHud, refreshHealthHud } from "./healthHud.js";
import { installGiantTimerBar } from "./giantTimerBar.js";
import { installGameOver, isGameOverOpen, showGameOver } from "./gameOver.js";
import { installShop, isShopOpen } from "./shop.js";
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
import { isCoopMode, setCoopMode, setLocalPlayerCount, localPlayerCount } from "./coopMode.js";
import { showLoadingScreen, bumpLoadingProgress, hideLoadingScreen } from "./loadingScreen.js";
import { runMigrations } from "./migrations.js";
import { installMapEditor } from "./mapEditor.js";
import { bootstrapOnline, onAnyClose } from "./onlineBootstrap.js";
import { getMirrorZone, getMirrorPlayers, isMirrorReady, isMirrorDead, refreshMirrorEntities } from "./mirrorWorld.js";
import { tickPredictedSelf, getPredictedSelf } from "./predictedSelf.js";
import { tickLocalEffects } from "./localEffects.js";
import { getSelfPlayerId } from "./onlineBootstrap.js";
import { installPartyPanel, isPartyPanelOpen } from "./partyPanel.js";
import { installAccountPanel, isAccountPanelOpen } from "./accountPanel.js";
import { installCloudSave } from "./cloudSave.js";
import { installHostLaggingOverlay, updateHostLaggingOverlay } from "./hostLaggingOverlay.js";
import { setHostPaused } from "./hostPauseState.js";
import { getRuntimeRole, getMode, getJoinCode, setRuntimeRole } from "./onlineMode.js";
import { switchRole, setStateHandlers } from "./switchRole.js";
import { installUiTokens } from "./uiTokens.js";
import { isPvp, isPvpHostSetup, isTowerDefenseMode } from "./gameMode.js";
import { codesFor } from "./keyBindings.js";
import {
  installPvpController, pvpGateInput, tickPvpFrame,
} from "./pvpController.js";
import { installOnlineDeathmatch, tickHostFrame as tickOnlineDeathmatch } from "./onlineDeathmatch.js";
import { installTowerDefense, startTowerDefense, isTowerDefenseUrl, tickTowerDefense } from "./towerDefense.js";

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
  // Account UI is lazy + offline-tolerant: it installs here (so the pause
  // menu's "Account" row and the ?reset=… deep link work) but makes no
  // blocking network call at boot.
  installAccountPanel();
  // Cloud saves: lazy + offline-tolerant. Pulls on sign-in, debounced-pushes
  // on progress change. No-op while signed out; never blocks boot.
  installCloudSave();
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
  installShop();
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
    const cam = createCamera();
    state = { zone: null, rawZone: null, player: null, player2: null, players: [], camera: cam, cameras: [cam] };
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
    flushPendingProgress();
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
      // Live split-screen geometry: one entry per slice with its backing-pixel
      // rect and its camera's tile dimensions. Lets e2e assert the layout
      // (count + arrangement) for a given window size + player count.
      slices: () => getSlices().map((s, i) => ({
        rectPx: s.rectPx,
        camW: state.cameras[i]?.w ?? null,
        camH: state.cameras[i]?.h ?? null,
      })),
    };
  }
  // PvP controller owns the match lifecycle + per-frame glue (and installs
  // its own window.pvp debug hook). Wire it to the live state and the local
  // avatar spawner here.
  installPvpController(() => state, { setLocalPlayers });
  installOnlineDeathmatch(() => state);
  // Tower Defense is offline-only and additive: it installs here (HUD,
  // barricade placement, input routing, debug hook) but does nothing until a
  // run boots via ?mode=td or the party panel.
  installTowerDefense(() => state);
  installAutoZoom(canvas, state.camera, hud.el, () => recomputeSlices(canvas, state));
  // Guests don't own the world, world-mutating logic, or the warp graph
  // — so the simulation modules (mapEditor, interact, shooting/melee,
  // fastTravel) stay gated. The HUDs (HP + ammo) DO run on guests: the
  // guestSelfHpSync module mirrors the host's authoritative HP into
  // playerHealth.records[0] and the per-player ammoSet events keep the
  // inventory in lockstep, so the HUDs render the right numbers.
  installAmmoHud();
  installCoinHud();
  // Grant the one-time starting purse before the HUD's first paint so a fresh
  // save reads 50 rather than flashing 0. Idempotent on a seeded save.
  seedStartingCoins();
  installHealthHud();
  installGiantTimerBar();
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
  installWeaponSelect({
    isBlocked: () =>
      isMenuOpen() || isDialogueOpen() || isGameOverOpen() || isShopOpen() ||
      isFastTravelOpen() || isMessageOpen() || isPartyPanelOpen() || isAccountPanelOpen() ||
      isInterceptionActive(),
  });
  setGamepadAction("shoot", () => {
    // In Tower Defense the Shoot button fires the active hero during a wave;
    // build-phase presses are inert (onKey ignores them). Synthesise the key so
    // towerDefense.onKey routes it through possession.
    if (isTowerDefenseMode()) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: codesFor("shoot")[0] || "KeyF" }));
      return;
    }
    tryShoot();
  });
  setGamepadAction("melee", () => {
    // In Tower Defense Melee swings the active hero during a wave (build-phase
    // presses are inert). Synthesise the key so towerDefense.onKey routes it to
    // the active hero. melee.js's own listener no-ops in TD, so no double swing.
    if (isTowerDefenseMode()) {
      window.dispatchEvent(new KeyboardEvent("keydown", { code: codesFor("melee")[0] || "KeyG" }));
      return;
    }
    tryMelee();
  });
  setGamepadAction("interact", () => {
    // Synthesise an interact keypress so interact.js's listener fires
    // without us having to duplicate its "find entity in front" logic.
    // (In the TD build phase this is also how Interact places a barrel.)
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
  // Weapon-cycle pads, one per local slot (melee wired but unbound by
  // default). cycleWeapon takes the 0-based local player index.
  for (const slot of [1, 2, 3, 4]) {
    const idx = slot - 1;
    setGamepadAction("rangedNext", () => cycleWeapon(SLOT_RANGED, idx, +1), slot);
    setGamepadAction("rangedPrev", () => cycleWeapon(SLOT_RANGED, idx, -1), slot);
    setGamepadAction("meleeNext",  () => cycleWeapon(SLOT_MELEE,  idx, +1), slot);
    setGamepadAction("meleePrev",  () => cycleWeapon(SLOT_MELEE,  idx, -1), slot);
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

  // ?mode=td deep-link: boot straight into a Tower Defense run (offline only —
  // never combines with a host/guest session). Replaces the loaded zone +
  // player with the TD board + squad; the loop branch below drives it.
  if (getRuntimeRole() === "offline" && isTowerDefenseUrl()) {
    await startTowerDefense();
  }

  startGameLoop((dt) => {
    if (getRuntimeRole() === "guest") {
      tickGuestFrame(dt, state, renderer, hud, biomeAnim);
      return;
    }
    // Tower Defense owns its whole frame (sim + render) — like the guest path.
    if (isTowerDefenseMode()) {
      tickTowerDefense(dt, { renderer, hud, biomeAnim });
      return;
    }
    // Pause is offline / local co-op only: freeze the sim on any overlay
    // (menu, dialogue, party panel, …) or when the active controller drops.
    // Hosting never freezes the shared world for a local overlay — that
    // would strand guests in a dead zone — so the gate is role-aware.
    const overlayOpen = isMenuOpen() || isDialogueOpen() || isGameOverOpen() || isShopOpen() || isFastTravelOpen() || isMessageOpen() || isPartyPanelOpen() || isAccountPanelOpen();
    const localPause = (overlayOpen || isControllerPaused()) && getRuntimeRole() !== "host";
    // While a host is still setting up an Online PvP match (sending invite
    // links, before "Start match"), freeze the host's own world so monsters
    // don't roam during setup. This is host-local: setHostPaused stays tied to
    // localPause so we don't flash a spurious "host paused" overlay to guests
    // (who haven't joined the arena yet anyway).
    const paused = localPause || isPvpHostSetup();
    // Tell guests when our local sim is frozen so their overlay can
    // show "Host paused the game" instead of the generic "Host
    // lagging…" — the no-op-when-not-host gate in setHostPaused keeps
    // this cheap in offline / local-coop. With the host-online carve-out
    // above this only fires now on a genuine host stall, not a menu.
    setHostPaused(localPause);
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
      // Network-guest avatars (playerId set) own their own tile path: the
      // host only animates committed steps via updateGuestAvatar — never
      // runs movement decisions for them (guest-authoritative-movement.md).
      // Local-coop slots (playerId null) still run the full input-driven
      // updatePlayer.
      if (state.player2) {
        if (state.player2.playerId) {
          updateGuestAvatar(state.player2, dt, state.zone);
        } else {
          const input2 = pollInput(2);
          if (!isPlayerDead(state.player2.index | 0)) {
            updatePlayer(state.player2, pvpGateInput(1, input2), dt, state.zone);
          }
        }
      }
      for (const s of state.players) {
        if (s.playerId) {
          updateGuestAvatar(s.player, dt, state.zone);
        } else {
          const inputN = pollInput(s.slot);
          if (!isPlayerDead(s.player.index | 0)) {
            updatePlayer(s.player, pvpGateInput(s.player.index | 0, inputN), dt, state.zone);
          }
        }
      }
      maybeTeleport(state);
      // Offline / local co-op: the camera averages every live player so
      // co-op players stay on one shared screen (dead players drop out of
      // the average). Online hosts instead follow only the host avatar —
      // each guest renders an independent window centred on themselves, so
      // the host's own window tracks the host. simulationViewports keeps
      // every off-camera guest's region alive (see below).
      applyCamera();
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
      // Passive knockback aura: reacts to the damage tickCombat just resolved
      // (low HP + enemy in range) before health regen runs.
      tickKnockbackAura(state.zone, allPlayers(state), dt);
      tickAfterDialogue(state.zone, dt);
      tickNpcInterception(state, dt);
      tickPuzzles(state.zone, state.player);
      tickCutscenes(state.zone, state.player, dt);
      tickTrails(state.zone, state.player, dt);
      tickPushables(state.zone, dt);
      tickPlayerHealth(dt);
      tickFastTravel(dt);
      // PvP runs its own death + win/lose path; co-op keeps the inline-toast /
      // P1-game-over path. Online PvP is host-authoritative (onlineDeathmatch);
      // the offline/local arena uses pvpController. Both are realtime.
      if (isPvp()) {
        if (getRuntimeRole() === "offline") tickPvpFrame();
        else tickOnlineDeathmatch(dt);
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
      applyCamera();
    }
    tickBiomeAnimation(biomeAnim, dt);
    tickEntities(dt);
    setInteractPrompt(tickInteract());
    updateTouchCombat();
    // Pass live players to the renderer so P2 sorts correctly with the
    // entity z-stack and not just on top as a separate draw call. Dead
    // co-op players are filtered out so they vanish from the screen
    // until the next zone transition respawns them. Online hosts include
    // every guest avatar here — the host's camera follows only its own
    // avatar, but the host's screen still needs to render the guests (or
    // "host can't see guests" lingers).
    const renderPlayers = livePlayersForRender(state);
    if (sliceCount() > 1) {
      renderViewports(renderer, state.zone, buildViewports(state), renderPlayers, biomeAnim.frame);
    } else {
      // Pin the darkness cone to state.player explicitly: renderPlayers drops
      // dead avatars, so on death the live-player array is empty and the cone
      // would otherwise lose its center. state.player persists through death,
      // so the limited-visibility overlay stays centered on the corpse instead
      // of vanishing (and the renderer never dereferences an undefined focus).
      render(renderer, state.zone, state.camera, renderPlayers, biomeAnim.frame, {
        focusPlayer: state.player,
      });
    }
    updateHud(hud, {
      zoneId: state.zone.id,
      fps: 1 / dt,
      showFps: getSettings().showFps,
      player: state.player,
    });
    updateAmmoHud();
    updateCoinHud();
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
  let saved = Number.isFinite(urlZone) ? null : loadProgress();
  // Guard against a save polluted by an older build that persisted the PvP
  // arena: never boot into it. Drop the save so we fall back to the starting
  // zone, as if no progress existed. (An explicit ?zone=1301 still works.)
  if (saved?.zoneId === PVP_ARENA_ZONE_ID) saved = null;
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
  // The slice-camera array is preserved too, with cameras[0] kept as the
  // alias of the stable camera (recomputeSlices re-derives the rest).
  const camera = state?.camera ?? createCamera();
  const cameras = Array.isArray(state?.cameras) ? state.cameras : [camera];
  cameras[0] = camera;
  state = {
    zone,
    rawZone: zoneRaw,
    player,
    player2,
    players: [],
    camera,
    cameras,
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
  // Decay melee swing cooldowns on the guest too. The guest's own swing is
  // predicted locally (predictGuestSwing) and remote swings arrive via the
  // mirror (snapshot sw/swd → melee.setSwingAnimation); without this tick
  // the cooldown never drains, so the swing animation would freeze at its
  // first frame and never finish.
  tickMelee(dt);
  // Same for the predicted-self firing pose (predictGuestShoot arms it).
  // tickShooting no-ops its bullet advance while the guest's local zone is
  // wiped; here it just drains the fire-anim timer so the pose finishes.
  tickShooting(dt);
  // Age out the guest's local cosmetic flashes (muzzle flash, etc).
  tickLocalEffects(dt);
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
  // Freeze the predicted self while a modal dialogue is open (the host
  // pauses its own tick) or while this guest is dead — a dead guest must
  // neither move nor stream step commits. The guest's own HP lands at
  // playerHealth index 0 via guestSelfHpSync, so that's the death seam here.
  if (!isDialogueOpen() && !isPlayerDead(0)) tickPredictedSelf(dt);
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
    player: self,
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
  // The predicted self carries no hp/aura (host-authoritative); pull the
  // aura activation progress from the matching mirror entry so the guest
  // sees its own knockback-aura burst play out.
  const mirrorSelf = mPlayers.find((p) => p.playerId === selfId);
  predicted.auraAnim = mirrorSelf ? mirrorSelf.auraAnim : null;
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
  // Re-derive the split-screen slices + per-slice cameras for the new count
  // (reapplyAutoZoom re-runs the zoom apply, whose onApply calls
  // recomputeSlices) before the HUD re-anchors its bars to the slices.
  reapplyAutoZoom();
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
      resetKnockbackAura();
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

// Local players in slot order (P1, P2, P3, P4), INCLUDING dead ones —
// split-screen maps slice i to player i and keeps a downed player's slice
// on their corpse rather than re-flowing the grid. Online guests
// (playerId != null) are excluded; split-screen is local-only.
function orderedLocalPlayers(state) {
  const out = [];
  if (state.player) out.push(state.player);
  if (state.player2) out.push(state.player2);
  if (Array.isArray(state.players)) {
    const extras = state.players
      .filter((e) => e.playerId == null && e.player)
      .sort((a, b) => a.slot - b.slot);
    for (const e of extras) out.push(e.player);
  }
  return out;
}

// Per-slice draw descriptors for renderViewports: each slice's pixel rect, its
// own camera, and the player its darkness cone tracks. The full live-player
// list is drawn into every slice by the renderer, so partners still appear.
function buildViewports(state) {
  const slices = getSlices();
  const players = orderedLocalPlayers(state);
  return slices.map((s, i) => ({
    rectPx: s.rectPx,
    camera: state.cameras[i] ?? state.camera,
    focusPlayer: players[i] ?? state.player,
  }));
}

// Which viewports the host simulates. Offline / local co-op gate entity
// ticks to the single shared camera, exactly as before. Online hosts
// also union a camera-sized rect centred on each off-camera guest, so a
// guest who wandered away from the host doesn't walk into frozen mobs /
// pickups the host wasn't ticking. Returns a single camera (legacy path)
// or an array; updateVisibleEntities accepts both.
function simulationViewports(state) {
  // Split-screen local co-op: tick entities visible to ANY slice so a
  // partner who wandered into their own slice keeps live mobs / pickups.
  if (sliceCount() > 1) return state.cameras;
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

// Snap the camera(s) to follow the player(s). The followed player moves
// slowly, so a snap-follow reads as smooth.
function applyCamera() {
  // Split-screen local multiplayer (co-op or PvP): each slice's camera
  // follows its own player (dead included — the slice holds on the corpse).
  if (sliceCount() > 1) {
    const players = orderedLocalPlayers(state);
    for (let i = 0; i < state.cameras.length; i++) {
      updateCamera(state.cameras[i], players[i] ?? state.player, state.zone);
    }
    return;
  }
  // Single slice: online host and offline single-player both follow their
  // own avatar. (Online guests run their own camera in tickGuestFrame.)
  updateCamera(state.camera, state.player, state.zone);
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
  // Teleporters: any player triggers a transition so whoever steps onto
  // the tile moves everyone to the new zone. This covers P1, local offline
  // P2, online guest P2 (with a playerId) and any slot-3/4 network guest —
  // travelTo repositions the rest of the party around the trigger.
  let teleEntity = null;
  if (p1Moved) {
    teleEntity = findTeleporterAt(zone, player.tileX, player.tileY);
  }
  if (!teleEntity && p2Moved) {
    teleEntity = findTeleporterAt(zone, player2.tileX, player2.tileY);
  }
  if (!teleEntity) {
    for (const s of extras) {
      teleEntity = findTeleporterAt(zone, s.player.tileX, s.player.tileY);
      if (teleEntity) break;
    }
  }
  const tele = teleEntity;
  // Locked teleporters never transition — collision keeps the player off
  // the tile, but guard here too in case a spawn/co-op reposition lands a
  // player on one. Treat a locked teleporter as "no teleporter".
  if (tele && !isTeleporterLocked(tele)) {
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
      flushPendingProgress();
    });
  } else {
    persistProgressThrottled();
  }
}

// Persist the player's "home" position — but never while in a PvP match.
// The arena (zone 1301) is transient: persisting it would boot the next
// page load straight into the arena instead of the world the player
// actually lives in. PvP exit travels back to the captured pre-match spot
// (pvpController / onlineDeathmatch), so the save can stay frozen at the
// real world through the whole match. Online guests don't reach here (their
// state is wiped); online co-op hosts DO save, so a host keeps the zone they
// walked to during a session.
function persistProgress() {
  if (isPvp()) return;
  saveProgress(state);
}

// Coalesce the high-frequency per-tile-step save. Walking commits a step
// ~4.5×/s, and each saveProgress writes 3-4 storage keys whose change events
// each drive cloudSave to re-serialize + hash the whole save synchronously
// (even when signed out) — ~15 serialize/hash cycles per second of walking.
// Saving the player's tile is cheap to defer: a throttled save (at most once
// per window) bounds the worst-case staleness to ~1s while the
// zone-change and beforeunload paths below stay immediate, so a clean exit or
// teleport never loses position. Matches the original "persist on zone change"
// design intent (see save.js header); per-step was always over-eager.
const POSITION_SAVE_THROTTLE_MS = 1000;
let pendingSaveTimer = null;
function persistProgressThrottled() {
  if (isPvp()) return;
  if (pendingSaveTimer) return; // a save is already scheduled — coalesce into it
  pendingSaveTimer = setTimeout(() => {
    pendingSaveTimer = null;
    persistProgress();
  }, POSITION_SAVE_THROTTLE_MS);
}
// Cancel any pending throttled save and persist the current position now.
// Used by the zone-change and page-unload paths, where the save must land
// immediately (and the just-saved state supersedes whatever was pending).
function flushPendingProgress() {
  if (pendingSaveTimer) { clearTimeout(pendingSaveTimer); pendingSaveTimer = null; }
  persistProgress();
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById("hud");
  if (el) el.textContent = `Error: ${err.message}`;
});
