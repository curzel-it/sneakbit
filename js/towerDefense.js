// Tower Defense controller: the run state machine and the per-frame driver for
// ?mode=td. Owns the build → wave → clear → game-over loop, the score + combo,
// the local high score, recruiting/reviving, and the squad's input routing
// (real input to the possessed hero, allyAI to the rest). Like the PvP
// controller it reaches the live game state through an injected getState and
// owns one self-contained frame so main.js's loop just delegates.
//
// Every branch here only runs when isTowerDefenseMode() is true, so the normal
// game is untouched: TD is an additive, transient mode (no save writes, its own
// board, its own HUD).

import { TD_ZONE_ID } from "./constants.js";
import { BIOME } from "./biomes.js";
import { loadZone } from "./data.js";
import { buildZone, isWalkable } from "./zone.js";
import { createPlayer, updatePlayer, updateGuestAvatar } from "./player.js";
import { pollInput } from "./input.js";
import { getSpecies } from "./species.js";
import { addAmmo } from "./inventory.js";
import { resolveLoadout } from "./sessionLoadouts.js";
import { updateAmmoHud } from "./ammoHud.js";
import { openShop, isShopOpen } from "./shop.js";
import { tdShopStock } from "./tdShopStock.js";
import { getNetRole } from "./onlineBootstrap.js";
import { broadcastHostEvent } from "./hostEvents.js";
import { guestSlots } from "./hostGuests.js";
import { setGameMode, GAME_MODE, isTowerDefenseMode } from "./gameMode.js";
import { localPlayerCount, setLocalPlayerCount } from "./coopMode.js";
import { updateCamera } from "./camera.js";
import { sliceCount, getSlices } from "./splitScreen.js";
import { reapplyAutoZoom } from "./zoom.js";
import { resetPlayerHealth, isPlayerDead } from "./playerHealth.js";
import { matchesAction } from "./keyBindings.js";
import { getSettings } from "./settings.js";

import { render, renderViewports } from "./renderer.js";
import { updateHud } from "./hud.js";
import { tickBiomeAnimation } from "./biomeAnimation.js";
import { tickEntities } from "./entities.js";
import { updateVisibleEntities } from "./zoneVisibility.js";
import { tickShooting, tryShootForPlayer } from "./shooting.js";
import { tickMelee, performMeleeSwing } from "./melee.js";
import { tickCombat } from "./combat.js";
import { tickPlayerHealth } from "./playerHealth.js";

import { isMenuOpen } from "./menu.js";
import { isDialogueOpen } from "./dialogue.js";
import { isPartyPanelOpen } from "./partyPanel.js";
import { isAccountPanelOpen } from "./accountPanel.js";
import { showToast } from "./toast.js";
import { playTrack } from "./music.js";
import { getValue, setValue } from "./storage.js";

import { initBoard, getHeroSpawns, getGoal, recomputeField } from "./tdBoard.js";
import {
  generateMap, installMap, resetMaze, paintPath, monsterGrid,
  revealNextObstacles, revealAll, mazeProgress, obstacleBatch,
  pathTilesFlat, revealedObstaclesFlat,
} from "./tdMaze.js";
import {
  setTdEnemyHooks, resetTdEnemies, tickTdEnemies, aliveEnemyCount,
} from "./tdEnemies.js";
import { getEnemies } from "./tdEnemies.js";
import { startWave, tickWaves, isWaveSpawningDone, totalThisWave, resetWaves } from "./tdWaves.js";
import { driveAlly, resetAllyAI, seekVisibleArea } from "./allyAI.js";
import {
  resetHeroSwitch, getActiveHeroIndex, ownerSlotOf, squadPlayers,
  switchHeroForSlot, ensureLiveOwner, ownerSlots, followActiveHero, activeHero,
  ownedHeroPlayer, cameraTargetFor, setOwnership, releaseSlot,
} from "./heroSwitch.js";
import { getCoins, addCoins } from "./wallet.js";
import { enterTdSave } from "./tdSave.js";
import { refreshTouchActions } from "./touch.js";
import {
  installTdHud, showTdHud, hideTdHud, updateTdHud, showTdGameOver,
} from "./tdHud.js";

// — Tuning ————————————————————————————————————————————————————————————————
const START_GOLD = 150;           // enough to recruit a third hero turn 1
const WAVES_PER_MAP = 3;          // waves cleared on a map before it changes
const BUILD_TIME = 30;            // seconds of build phase before auto-start
const EARLY_BONUS_PER_SEC = 2;    // gold for calling the wave early, per second saved
const STIPEND_BASE = 40;          // per-wave starting income
const STIPEND_PER_WAVE = 10;
const WAVE_CLEAR_BONUS = 100;     // score per wave survived
const RECRUIT_BASE_COST = 150;    // doubles per recruit
const STARTING_AMMO = 100;        // rounds a ranged hero spawns with (tunable)
const REVIVE_BASE_COST = 60;      // ×5 mid-wave (locked spec)
const MID_WAVE_REVIVE_MULT = 5;
const COMBO_WINDOW = 3;           // seconds a kill streak survives without a kill
const HIGH_SCORE_KEY = "td.highScore";
const VILLAGE_LIVES = 20;         // breaches the village absorbs before it falls

// Per-tier gold + score (the fusion chain the waves use).
const GOLD_FOR = { 4003: 5, 4004: 7, 4005: 10, 4006: 16, 4007: 24 };
const POINTS_FOR = { 4003: 10, 4004: 14, 4005: 25, 4006: 45, 4007: 70 };
// Lives lost when an enemy of each tier reaches the goal — a fused brute
// breaching costs more than a chokeberry slipping through.
const LEAK_DAMAGE = { 4003: 1, 4004: 1, 4005: 1, 4006: 2, 4007: 3 };
// Display names by squad slot. Must stay aligned with TD_HERO_LOADOUTS in
// sessionLoadouts.js (that table decides each slot's weapon + archetype).
const HERO_NAMES = ["Ninja", "Barbarian", "Bombardier", "Knight"];

// — State ————————————————————————————————————————————————————————————————
let getState = () => null;
let phase = "idle";               // idle | build | wave | gameover
let wave = 0;                     // cumulative across maps — drives the tier ramp
let mapIndex = 0;                 // current map (0-based); harder each step
let waveInMap = 0;                // waves cleared on the current map
let buildTimer = 0;
let score = 0;
let highScore = 0;
let combo = 0;
let comboTimer = 0;
let lives = VILLAGE_LIVES;
let recruitedCount = 0;
let booting = false;

// — Coin purse ———————————————————————————————————————————————————————————
// TD's currency is the game's own coins, kept in a single shared squad purse.
// wallet.js folds every hero index to 0 in TD mode, and tdSave routes those
// coins through the transient run context, so this is one throwaway purse the
// whole squad — loot, the shop, recruit/revive — draws from. Index 0 is the
// fold target.
const TD_PURSE = 0;
function tdCoins() { return getCoins(TD_PURSE); }
function tdEarn(n) { if (n) addCoins(n | 0, TD_PURSE); }
function tdCanAfford(cost) { return tdCoins() >= (cost | 0); }
function tdSpend(cost) {
  const c = cost | 0;
  if (c <= 0) return true;
  if (tdCoins() < c) return false;
  addCoins(-c, TD_PURSE);
  return true;
}

// Stock a freshly-spawned hero with rounds for its ranged weapon, so finite
// ammo doesn't leave a shooter dry on wave 1. Melee-only archetypes resolve to
// ranged: null and get nothing (they have no gun). Lands in the transient TD
// inventory, per hero.
function grantStartingAmmo(hero) {
  const ranged = resolveLoadout(hero).ranged;
  const bullet = ranged ? getSpecies(ranged)?.bullet_species_id : null;
  if (bullet) addAmmo(bullet, STARTING_AMMO, hero.index | 0);
}

// Cached one-shot read of the ?mode=td boot latch — the deep-link equivalent
// of the party panel's Tower Defense button. Mirrors creativeMode's pattern:
// read once at boot, stable for the page lifetime. Guests (?join=…) never TD.
let urlLatch = null;
export function isTowerDefenseUrl() {
  if (urlLatch !== null) return urlLatch;
  if (typeof location === "undefined") { urlLatch = false; return urlLatch; }
  const params = new URLSearchParams(location.search);
  if (params.has("join")) { urlLatch = false; return urlLatch; }
  urlLatch = (params.get("mode") || "").toLowerCase() === "td";
  return urlLatch;
}

export function installTowerDefense(stateGetter) {
  getState = stateGetter || (() => null);
  installTdHud({
    onReady: () => startNextWave({ early: true }),
    onRecruit: recruitHero,
    onRevive: reviveHero,
    onSwitch: switchHero,
    onShop: openTdShop,
    onRestart: restartRun,
  });
  window.addEventListener("keydown", onKey);
  installDebugHook();
}

export function isTowerDefenseBooting() { return booting; }

// Boot a fresh run: switch mode, load the board, spawn the squad, arm the
// build phase. Called from main's boot path (offline + ?mode=td) and by the
// party panel's Tower Defense button.
export async function startTowerDefense() {
  const state = getState();
  if (!state) return;
  booting = true;
  try {
    setGameMode(GAME_MODE.td);
    // Enter the transient TD save FIRST (before anything reads coins/inventory):
    // a fresh, throwaway purse + empty packs that never touch the real save.
    // Must follow setGameMode so the wallet/inventory/equipment fold rules see
    // TD mode.
    enterTdSave();
    // Honor the current local player count: each local human owns one starting
    // hero, every extra/recruited hero is free (AI). Solo (count 1) = one human.

    resetTdEnemies();
    resetWaves();
    resetAllyAI();
    setTdEnemyHooks({ onKill, onLeak });
    tdEarn(START_GOLD);
    resetHeroSwitch(localPlayerCount());
    recruitedCount = 0;
    mapIndex = 0;
    waveInMap = 0;
    wave = 0;
    score = 0;
    combo = 0;
    comboTimer = 0;
    lives = VILLAGE_LIVES;
    highScore = getValue(HIGH_SCORE_KEY) | 0;

    // Build the first map (zone + sand path + path-only field) then spawn the
    // squad onto its track.
    await loadMap(0);
    spawnSquad(state);
    // Re-derive the split-screen slices + per-slice cameras for the squad size
    // (reapplyAutoZoom's onApply calls recomputeSlices). Single-player stays a
    // single camera; co-op gets one follow-self slice per local hero.
    reapplyAutoZoom();
    followSquadCameras(state);
    if (state.zone?.soundtrack) playTrack(state.zone.soundtrack);
    enterBuild();
    showTdHud();
    // On touch, surface the melee/remove action button — the squad may carry
    // no melee weapon, which would otherwise keep it hidden.
    refreshTouchActions();
    // Ammo is finite now, so the chip matters: make sure it's visible (a prior
    // build hid it) and tracking the active hero's rounds.
    const ammo = typeof document !== "undefined" && document.getElementById("ammo-hud");
    if (ammo) ammo.style.display = "";
    updateAmmoHud();
  } finally {
    booting = false;
  }
}

// Build (or rebuild) the arena for map `idx`: a fresh random sand path, the
// horde's path-only flow field, and a clean obstacle schedule. Safe to call
// mid-run at a map boundary — the previous wave is fully cleared (no live
// enemies to lose) and heroes aren't zone entities, so they survive the swap;
// living heroes are relocated onto the new track and healed.
async function loadMap(idx) {
  const state = getState();
  if (!state) return;
  // The cached base zone stays pristine (loadZone caches it), so generation
  // re-randomises each map. Hero starts come back on the new path.
  const rawZone = { ...(await loadZone(TD_ZONE_ID)) };
  const map = generateMap(rawZone, idx);
  rawZone.td = { ...(rawZone.td || {}), heroSpawns: map.heroSpawns };
  const zone = buildZone(rawZone);
  state.rawZone = rawZone;
  state.zone = zone;
  initBoard(rawZone, zone);
  resetMaze();
  installMap(map);
  paintPath(zone);                       // sand track visible from the start
  revealNextObstacles(zone, obstacleBatch(idx)); // off-path obstacles, fixed for the map's life
  recomputeField(zone, monsterGrid(zone)); // horde locked to the path
  mapIndex = idx;
  relocateSquad(state);                  // no-op before the squad exists (boot)
  broadcastTdMap();                      // online: paint the new track on guests
}

// Spawn the starting squad. Online host: the host owns hero 0, each connected
// guest owns hero slot-1 (reconciled on the first tick). Local / solo: one
// distinct-archetype hero per local player (indices 0..count-1), full HP, on
// the hero-spawn tiles. Generalizes the old hardcoded 2-hero spawn.
function spawnSquad(state) {
  if (getNetRole() === "host") { spawnSquadHost(state); return; }
  const spawns = getHeroSpawns();
  const count = localPlayerCount();
  state.players = [];
  state.player2 = null;
  state.lastTile2 = null;
  for (let i = 0; i < count; i++) {
    const pref = spawns[i % spawns.length] || spawns[0];
    // Hero 0 takes its spawn tile verbatim; later heroes spiral out so they
    // never stack on an already-placed teammate.
    const tile = i === 0 ? { x: pref.x | 0, y: pref.y | 0 } : freeHeroTile(state, pref);
    const hero = placeHero(createPlayer({ index: i }), tile);
    attachHero(state, hero, i);
    resetPlayerHealth(i);
    grantStartingAmmo(hero);
  }
}

// Online host: hero 0 is the host's own avatar; guest heroes (their existing
// playerId-tagged avatars) are placed + owned by reconcileGuestHeroes on the
// first tick and as guests join/leave. Guest avatars are preserved here, not
// recreated, so their playerId/step state survives the TD entry.
function spawnSquadHost(state) {
  const spawns = getHeroSpawns();
  tdGuestSlots = new Set();
  state.player.index = 0;
  placeHero(state.player, { x: spawns[0].x | 0, y: spawns[0].y | 0 });
  state.lastTile = { x: state.player.tileX, y: state.player.tileY };
  resetPlayerHealth(0);
  grantStartingAmmo(state.player);
  setOwnership(1, 0);
}

// Slot a hero player object into the canonical co-op state shape by its index:
// hero 0 → state.player, hero 1 → state.player2, the rest → state.players[]
// (the same array online guests use). `playerId` is null for local heroes; the
// host passes a guest's id so its avatar carries the network identity.
function attachHero(state, p, index, playerId = null) {
  p.playerId = playerId || null;
  if (playerId) p.slot = index + 1;
  const lt = { x: p.tileX, y: p.tileY };
  if (index === 0) { state.player = p; state.lastTile = lt; }
  else if (index === 1) { state.player2 = p; state.lastTile2 = lt; }
  else state.players.push({ player: p, slot: index + 1, playerId, lastTile: lt });
}

// Online host only: keep each connected guest owning its hero (slot s → hero
// index s-1) as guests join and leave mid-run. A joining guest adopts its
// existing avatar (or one is created on the fly if none is free); a leaving
// guest's slot releases its ownership. Cheap to run every tick — it only acts
// on the join/leave delta tracked in tdGuestSlots.
let tdGuestSlots = new Set();
function reconcileGuestHeroes(state) {
  const current = new Map(guestSlots().map((g) => [g.slot, g.playerId]));
  for (const [slot, playerId] of current) {
    if (tdGuestSlots.has(slot)) continue;
    setupGuestHero(state, slot, playerId);
    tdGuestSlots.add(slot);
  }
  for (const slot of [...tdGuestSlots]) {
    if (current.has(slot)) continue;
    releaseSlot(slot);              // avatar already despawned by hostGuests
    tdGuestSlots.delete(slot);
  }
}

function setupGuestHero(state, slot, playerId) {
  const index = slot - 1;
  const spawns = getHeroSpawns();
  const pref = spawns[index % spawns.length] || spawns[0];
  let hero = squadPlayers(state).find((p) => p.playerId === playerId);
  if (hero) {
    hero.index = index;
    placeHero(hero, freeHeroTile(state, pref, hero));
  } else {
    // Join with no free hero → create one on the fly (additional info #2).
    hero = placeHero(createPlayer({ index }), freeHeroTile(state, pref));
    attachHero(state, hero, index, playerId);
  }
  resetPlayerHealth(index);
  setOwnership(slot, index);
  broadcastTdMap();   // get the new joiner the current track + obstacles at once
}

// On a map change: drop each living hero onto the new path's start tiles and
// heal them to full (the between-maps reward). Downed heroes stay down — still
// revivable from the dock. Does nothing before the squad is spawned (boot).
function relocateSquad(state) {
  const squad = squadPlayers(state);
  if (!squad.length) return;
  const spawns = getHeroSpawns();
  let i = 0;
  for (const hero of squad) {
    const idx = hero.index | 0;
    if (isPlayerDead(idx)) continue;
    placeHero(hero, freeHeroTile(state, spawns[i % spawns.length] || spawns[0], hero));
    resetPlayerHealth(idx);
    i++;
  }
}

function placeHero(p, tile) {
  p.tileX = tile.x; p.tileY = tile.y; p.x = tile.x; p.y = tile.y;
  p.direction = "left"; // face the incoming horde
  p.step = null; p.queuedDir = null; p.pendingDir = null;
  return p;
}

// A live hero (other than `exclude`) is sitting on this tile.
function occupiedByHero(state, x, y, exclude) {
  return squadPlayers(state).some((p) =>
    p !== exclude && !isPlayerDead(p.index | 0) && (p.tileX | 0) === x && (p.tileY | 0) === y);
}

// The preferred tile, or — if it's blocked or already taken by a hero — the
// nearest walkable, hero-free tile spiralling out from it. Keeps
// recruited/revived heroes (and the second starter) from spawning on top of
// the squad, since the heroes-share-a-tile guard only blocks *stepping* onto
// an occupied tile, not spawning onto one.
function freeHeroTile(state, preferred, exclude) {
  const zone = state.zone;
  const px = preferred.x | 0, py = preferred.y | 0;
  const ok = (x, y) =>
    isWalkable(zone, x, y) && !occupiedByHero(state, x, y, exclude);
  if (ok(px, py)) return { x: px, y: py };
  for (let r = 1; r <= 6; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (ok(px + dx, py + dy)) return { x: px + dx, y: py + dy };
      }
    }
  }
  return { x: px, y: py };
}

// — Phase transitions ————————————————————————————————————————————————————
function enterBuild() {
  phase = "build";
  buildTimer = BUILD_TIME;
}

function startNextWave({ early = false } = {}) {
  if (phase !== "build") return;
  // Calling the wave early banks the unused build time as gold (Kingdom Rush
  // convention) — a real trade: more gold now, less time to maze.
  if (early) {
    const bonus = Math.round(Math.max(0, buildTimer) * EARLY_BONUS_PER_SEC);
    if (bonus > 0) { tdEarn(bonus); showToast(`+${bonus} coins — early call`, "hint"); }
  }
  wave += 1;
  startWave(wave);
  phase = "wave";
}

function clearWave() {
  score += WAVE_CLEAR_BONUS * wave;
  tdEarn(STIPEND_BASE + wave * STIPEND_PER_WAVE);
  waveInMap += 1;
  if (waveInMap >= WAVES_PER_MAP) {
    // Map cleared — advance to a fresh, harder map. loadMap rebuilds the zone
    // and relocates + heals the squad; safe here since the wave is fully clear.
    waveInMap = 0;
    showToast(`Map ${mapIndex + 2}`, "hint");
    loadMap(mapIndex + 1);
  }
  // Obstacles are placed once at map load and stay fixed for the map's waves,
  // so there's nothing to reveal between waves on the same map.
  enterBuild();
}

let gameOverTitle = "";
function gameOver(reason = "squad") {
  if (phase === "gameover") return;
  phase = "gameover";
  const isNewBest = score > highScore;
  if (isNewBest) { highScore = score; setValue(HIGH_SCORE_KEY, score | 0); }
  gameOverTitle = reason === "village" ? "Village overrun" : "Squad defeated";
  showTdGameOver({ wave, score, highScore, isNewBest, title: gameOverTitle });
  // Push the final state so guests swap their HUD for the defeat card.
  if (getNetRole() === "host") broadcastHostEvent("tdState", { model: buildModel(getState()) });
}

// — Enemy hooks ——————————————————————————————————————————————————————————
function onKill(speciesId) {
  tdEarn(GOLD_FOR[speciesId] || 5);
  combo += 1;
  comboTimer = COMBO_WINDOW;
  score += Math.round((POINTS_FOR[speciesId] || 10) * comboMultiplier());
}

function onLeak(speciesId) {
  // An enemy reached the village. It costs lives (more for fused brutes) and
  // breaks the kill streak; the run only ends once the village is overrun.
  combo = 0;
  comboTimer = 0;
  lives -= LEAK_DAMAGE[speciesId] || 1;
  if (lives <= 0) {
    lives = 0;
    gameOver("village");
    return;
  }
  showToast(`Village breached — ${lives} ${lives === 1 ? "life" : "lives"} left`, "hint");
}

function comboMultiplier() {
  return 1 + Math.min(combo, 20) * 0.1; // up to 3×
}

// — Economy actions ——————————————————————————————————————————————————————
function recruitCost() {
  return RECRUIT_BASE_COST * Math.pow(2, recruitedCount);
}

function canRecruit(state) {
  return nextRecruitIndex(state) != null && tdCanAfford(recruitCost());
}

function nextRecruitIndex(state) {
  const taken = new Set(squadPlayers(state).map((p) => p.index | 0));
  for (const i of [0, 1, 2, 3]) if (!taken.has(i)) return i;
  return null;
}

function recruitHero() {
  const state = getState();
  if (!state || phase !== "build") return;
  const index = nextRecruitIndex(state);
  if (index == null) return;
  if (!tdSpend(recruitCost())) { showToast("Not enough coins", "hint"); return; }
  const spawns = getHeroSpawns();
  const tile = freeHeroTile(state, spawns[index % spawns.length] || spawns[0]);
  const hero = placeHero(createPlayer({ index }), tile);
  attachHero(state, hero, index);
  resetPlayerHealth(index);
  grantStartingAmmo(hero);
  recruitedCount += 1;
}

function reviveCost() {
  return REVIVE_BASE_COST * (phase === "wave" ? MID_WAVE_REVIVE_MULT : 1);
}

function downedHeroes(state) {
  return squadPlayers(state).filter((p) => isPlayerDead(p.index | 0));
}

function reviveHero(index) {
  const state = getState();
  if (!state) return;
  if (!isPlayerDead(index | 0)) return;
  if (!tdSpend(reviveCost())) { showToast("Not enough coins", "hint"); return; }
  const hero = squadPlayers(state).find((p) => (p.index | 0) === (index | 0));
  if (!hero) return;
  const spawns = getHeroSpawns();
  placeHero(hero, freeHeroTile(state, spawns[(index | 0) % spawns.length] || spawns[0], hero));
  resetPlayerHealth(index | 0);
}

function switchHero(slot = 1) {
  const state = getState();
  if (!state || phase === "gameover") return;
  switchHeroForSlot(state, slot, isPlayerDead);
  followSquadCameras(state);
}

// Open the regular shop UI stocked with the TD catalog, buying for the hero the
// player is currently driving: weapons/ammo/consumables land on that hero, and
// coins come from the shared squad purse (wallet folds every hero to index 0 in
// TD). isShopOpen() feeds isOverlayOpen below, so the sim pauses while shopping.
function openTdShop() {
  const state = getState();
  if (!state || phase === "gameover") return;
  openShop(tdShopStock(), getActiveHeroIndex() | 0);
}

// — Per-frame driver ——————————————————————————————————————————————————————
// Owns the whole TD frame (sim + render). main's loop delegates here when the
// mode is active. `frame` carries the renderer/hud/biome objects main owns.
export function tickTowerDefense(dt, frame) {
  const state = getState();
  if (!state?.zone) return;
  const paused = isOverlayOpen();

  if (!paused && phase !== "gameover") {
    simulate(state, dt);
  }
  // Each player's camera follows the hero they drive (during build to
  // reposition along the track, during a wave to fight). Solo / online-host =
  // one shared camera; local co-op = one follow-self slice per player.
  followSquadCameras(state);
  tickBiomeAnimation(frame.biomeAnim, dt);
  tickEntities(dt);
  const heroes = livingHeroes(state);
  // TD simulates the whole board, not just what's on camera: the cameras follow
  // the heroes, but off-screen enemies must still take fire and deal damage, and
  // off-screen allies must still fight. Rendering culls independently, so this
  // is sim-only and never draws an off-screen prop.
  updateVisibleEntities(state.zone, state.camera, { all: true });
  if (sliceCount() > 1) {
    renderViewports(frame.renderer, state.zone, squadViewports(state), heroes, frame.biomeAnim.frame);
  } else {
    render(frame.renderer, state.zone, state.camera, heroes, frame.biomeAnim.frame, {
      focusPlayer: cameraTargetFor(state, 1) || state.player,
    });
  }
  updateHud(frame.hud, { zoneId: state.zone.id, fps: 1 / dt, showFps: getSettings().showFps });
  // Keep the ammo chip on the hero the player is currently driving (switching
  // heroes doesn't fire an inventory/equipment change, so refresh it here).
  updateAmmoHud();
  updateTdHud(buildModel(state));
  maybeBroadcastTdState(state, dt);
}

// Online host: push the HUD model to guests so they can render a read-only TD
// HUD. Throttled to ~5 Hz, but fired immediately whenever the phase flips so a
// build→wave transition lands without lag. Enemies (zone entities) and the mode
// already ride the 20 Hz snapshot stream, so this is the only TD-specific wire.
let tdBroadcastTimer = 0;
let tdBroadcastPhase = "";
let tdMapResendTimer = 0;
function maybeBroadcastTdState(state, dt) {
  if (getNetRole() !== "host") return;
  tdBroadcastTimer += dt;
  if (phase !== tdBroadcastPhase || tdBroadcastTimer >= 0.2) {
    tdBroadcastPhase = phase;
    tdBroadcastTimer = 0;
    broadcastHostEvent("tdState", { model: buildModel(state) });
  }
  // Resend the map a couple times a second. It's static per map and idempotent
  // on the guest, so this just guarantees a late joiner (or one whose mirror
  // zone hadn't loaded when the map first broadcast) eventually paints the path.
  tdMapResendTimer += dt;
  if (tdMapResendTimer >= 2) { tdMapResendTimer = 0; broadcastTdMap(); }
}

// The sand path + revealed obstacles don't ride the snapshot stream, so the
// host ships them as flat tile arrays for the guest to paint onto its mirror.
function broadcastTdMap() {
  if (getNetRole() !== "host") return;
  broadcastHostEvent("tdMap", { path: pathTilesFlat(), obstacles: revealedObstaclesFlat() });
}

// Point each camera at the hero its slot drives. Split-screen: per-slice camera
// follows slot i+1's owned hero. Single slice: the shared camera follows slot 1.
function followSquadCameras(state) {
  if (sliceCount() > 1 && Array.isArray(state.cameras)) {
    for (let i = 0; i < state.cameras.length; i++) {
      const hero = cameraTargetFor(state, i + 1) || state.player;
      if (hero) updateCamera(state.cameras[i], hero, state.zone);
    }
    return;
  }
  followActiveHero(state);
}

// Per-slice draw descriptors: each slice's rect + camera follow slot i+1's
// hero, and its darkness cone tracks that hero. The full living-hero list is
// drawn into every slice so teammates appear in each other's view.
function squadViewports(state) {
  return getSlices().map((s, i) => ({
    rectPx: s.rectPx,
    camera: state.cameras[i] ?? state.camera,
    focusPlayer: cameraTargetFor(state, i + 1) || state.player,
  }));
}

function simulate(state, dt) {
  // Combo decay.
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }
  if (phase === "build") {
    buildTimer -= dt;
    if (buildTimer <= 0) startNextWave();
  }

  // Online host: keep guest ownership in sync with who's connected.
  if (getNetRole() === "host") reconcileGuestHeroes(state);

  // Heroes: route by ownership. A guest-owned hero (carries a playerId) is
  // animated from the steps the guest streams — the host is authoritative but
  // never decides its movement. A hero owned by a *local* slot takes that
  // slot's real input. A free (unowned) hero runs on allyAI. Local owners are
  // first nudged off a corpse onto a free living hero if one exists.
  for (const slot of ownerSlots()) {
    const owned = ownedHeroPlayer(state, slot);
    if (owned && !owned.playerId) ensureLiveOwner(state, slot, isPlayerDead);
  }
  const enemies = getEnemies(state.zone);
  const goal = getGoal();
  const living = squadPlayers(state).filter((h) => !isPlayerDead(h.index | 0));
  for (const hero of living) {
    if (hero.playerId) {
      // Guest-owned: advance the committed step the guest committed (host
      // executes it via hostGuests.onMove; updateGuestAvatar animates it).
      updateGuestAvatar(hero, dt, state.zone);
      continue;
    }
    const slot = ownerSlotOf(hero.index | 0);
    if (slot != null) {
      // Local human drives this hero directly in both phases — during build to
      // reposition along the track, during a wave to fight and dodge.
      updatePlayer(hero, pollInput(slot), dt, state.zone);
      continue;
    }
    // Free heroes are AI-driven and never step onto another hero's tile (no
    // stacking). The maze is auto-generated now, so between waves there's
    // nothing to build — idle allies just regroup toward the player's view;
    // during a wave they fight.
    const input = phase === "build"
      ? seekVisibleArea(state, hero)
      : driveAlly(state, hero, { enemies, goal });
    updatePlayer(hero, input, dt, state.zone, {
      blockedTile: (tx, ty) => heroOnTile(living, hero, tx, ty),
    });
  }

  // World ticks. Two systems are intentionally NOT run: mobs.js (TD enemies
  // seek the goal via the flow field, not the player) and monster fusion
  // (difficulty comes from the deliberate tdWaves tier ramp; spontaneous
  // fusion would tier enemies up off-screen, the very thing its viewport gate
  // guards against, and double-dips on the wave progression).
  tickShooting(dt);
  tickMelee(dt);
  if (phase === "wave") {
    tickWaves(state.zone, dt);
    tickTdEnemies(state.zone, dt);
  }
  tickCombat(state.zone, livingHeroes(state), dt);
  tickPlayerHealth(dt);

  // Lose checks. Leak is handled by the onLeak hook inside tickTdEnemies.
  if (squadWiped(state)) gameOver("squad");

  // Wave clear.
  if (phase === "wave" && isWaveSpawningDone() && aliveEnemyCount(state.zone) === 0) {
    clearWave();
  }
}

function squadWiped(state) {
  const squad = squadPlayers(state);
  if (!squad.length) return false;
  const anyAlive = squad.some((p) => !isPlayerDead(p.index | 0));
  if (anyAlive) return false;
  // Everyone's down — only a wipe if no downed hero can be revived.
  return !tdCanAfford(reviveCost());
}

function livingHeroes(state) {
  return squadPlayers(state).filter((p) => !isPlayerDead(p.index | 0));
}

// Is a hero other than `self` standing on — or mid-step toward — tile (tx, ty)?
// Allies use this to refuse a step that would stack them onto another hero
// (heroes aren't zone entities, so isEntityBlocked never sees them).
function heroOnTile(heroes, self, tx, ty) {
  for (const h of heroes) {
    if (h === self) continue;
    if ((h.tileX | 0) === tx && (h.tileY | 0) === ty) return true;
    if (h.step && (h.step.toX | 0) === tx && (h.step.toY | 0) === ty) return true;
  }
  return false;
}

function buildModel(state) {
  const revives = downedHeroes(state)
    .filter(() => tdCanAfford(reviveCost()))
    .map((p) => ({ index: p.index | 0, name: HERO_NAMES[p.index | 0] || "Hero", cost: reviveCost() }));
  const active = activeHero(state);
  return {
    wave,
    map: mapIndex + 1,
    phase: phaseLabel(),
    score,
    highScore,
    lives,
    maxLives: VILLAGE_LIVES,
    coins: tdCoins(),
    countdown: phase === "build" ? Math.max(0, buildTimer) : null,
    countdownMax: BUILD_TIME,
    earlyBonus: phase === "build" ? Math.round(Math.max(0, buildTimer) * EARLY_BONUS_PER_SEC) : 0,
    alive: aliveEnemyCount(state.zone),
    total: phase === "wave" ? totalThisWave() : 0,
    activeHeroName: active ? (HERO_NAMES[active.index | 0] || "Hero") : "—",
    canSwitch: squadPlayers(state).filter((p) => !isPlayerDead(p.index | 0)).length > 1,
    recruit: {
      cost: recruitCost(),
      can: canRecruit(state),
      full: nextRecruitIndex(state) == null,
      label: nextRecruitIndex(state) == null ? "Squad full" : `Recruit hero (${recruitCost()})`,
    },
    buildHint: "Hold the line — obstacles are closing in",
    revives,
    gameOverTitle,
  };
}

function phaseLabel() {
  return phase === "build" ? "Build" : phase === "wave" ? "Wave" : phase === "gameover" ? "Defeated" : "—";
}

// — Input ————————————————————————————————————————————————————————————————
// TD owns every action key (shooting.js / melee.js early-return in TD mode), so
// this routes shoot / melee / switch per local player. Each local slot drives
// its owned hero: P1 keeps its rebindable keys (+ Tab/Q to switch), P2..P4 use
// their co-op keymaps, and each slot's interact key cycles it to a free hero.
function onKey(e) {
  if (!isTowerDefenseMode()) return;
  if (e.repeat) return;
  if (phase === "gameover" || isOverlayOpen()) return;
  const code = e.code;
  const state = getState();
  if (!state) return;
  const count = localPlayerCount();
  // Switch possession: Tab/Q cycles P1; each slot's interact key cycles itself.
  if (code === "Tab" || code === "KeyQ") {
    e.preventDefault();
    switchHero(1);
    return;
  }
  for (let slot = 1; slot <= count; slot++) {
    if (matchesAction("interact", code, slot - 1)) {
      e.preventDefault();
      switchHero(slot);
      return;
    }
  }
  // Build phase: there's nothing to fire at — movement (read via pollInput in
  // simulate) just repositions heroes along the track. The action keys are
  // inert; starting the wave is the dock button only.
  if (phase === "build") return;
  // Wave phase: the action keys fight, routed to each slot's owned hero.
  for (let slot = 1; slot <= count; slot++) {
    const hero = ownedHeroPlayer(state, slot);
    if (!hero) continue;
    if (matchesAction("shoot", code, slot - 1)) {
      e.preventDefault();
      tryShootForPlayer(hero);
      return;
    }
    if (matchesAction("melee", code, slot - 1)) {
      e.preventDefault();
      performMeleeSwing(state, { swinger: hero });
      return;
    }
  }
}

function isOverlayOpen() {
  return isMenuOpen() || isDialogueOpen() || isPartyPanelOpen() || isAccountPanelOpen() || isShopOpen();
}

// — Restart ——————————————————————————————————————————————————————————————
function restartRun() {
  hideTdHud();
  startTowerDefense();
}

// — Debug hook ————————————————————————————————————————————————————————————
function installDebugHook() {
  if (typeof window === "undefined") return;
  window.td = {
    start: () => startTowerDefense(),
    startCoop: (n) => { setLocalPlayerCount(n | 0); return startTowerDefense(); },
    players: () => localPlayerCount(),
    slices: () => sliceCount(),
    ownerSlot: (i) => ownerSlotOf(i | 0),
    startWave: () => startNextWave(),
    state: () => ({ phase, wave, mapIndex, waveInMap, score, highScore, lives, coins: tdCoins(), combo }),
    coins: (n) => tdEarn(n | 0),
    addWaves: (n) => { wave += (n | 0); },
    enemies: () => { const s = getState(); return s?.zone ? getEnemies(s.zone).length : 0; },
    enemyTiles: () => {
      const s = getState();
      if (!s?.zone) return [];
      return getEnemies(s.zone).map((e) => ({ x: e.frame.x | 0, y: e.frame.y | 0 }));
    },
    // How many live monsters are standing OFF the sand path (should stay 0 — the
    // horde is confined to the track). The goal tile is open ground, so exclude
    // an enemy sitting exactly on it.
    enemyOffPath: () => {
      const s = getState();
      if (!s?.zone) return 0;
      const g = getGoal();
      let n = 0;
      for (const e of getEnemies(s.zone)) {
        const x = e.frame.x | 0, y = (e.frame.y | 0) + Math.max(0, (e.frame.h | 0) - 1);
        if (g && x === g.x && y === g.y) continue;
        if (s.zone.biome[y]?.[x] !== BIOME.DESERT) n++;
      }
      return n;
    },
    squad: () => squadPlayers(getState()).length,
    activeIndex: () => getActiveHeroIndex(),
    heroTiles: () => squadPlayers(getState())
      .filter((p) => !isPlayerDead(p.index | 0))
      .map((p) => ({ i: p.index | 0, x: p.tileX | 0, y: p.tileY | 0 })),
    maze: () => mazeProgress(),
    revealAll: () => { const s = getState(); return s?.zone ? revealAll(s.zone) : 0; },
    map: () => ({ mapIndex, waveInMap, wavesPerMap: WAVES_PER_MAP }),
    nextMap: () => loadMap(mapIndex + 1),
    sandCount: () => {
      const s = getState();
      if (!s?.zone) return 0;
      let n = 0;
      for (const row of s.zone.biome) for (const b of row) if (b === BIOME.DESERT) n++;
      return n;
    },
    goal: () => getGoal(),
    recruit: () => recruitHero(),
    killAll: () => {
      const state = getState();
      for (const e of getEnemies(state.zone)) e._dying = true;
    },
    win: () => clearWave(),
    lose: () => gameOver(),
  };
}
