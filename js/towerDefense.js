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
import { createPlayer, updatePlayer } from "./player.js";
import { pollInput } from "./input.js";
import { setGameMode, GAME_MODE, isTowerDefenseMode } from "./gameMode.js";
import { setLocalPlayerCount } from "./coopMode.js";
import { resetPlayerHealth, isPlayerDead } from "./playerHealth.js";
import { matchesAction } from "./keyBindings.js";
import { getSettings } from "./settings.js";

import { render } from "./renderer.js";
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
} from "./heroSwitch.js";
import { resetGold, getGold, addGold, spendGold, canAfford } from "./arcadeCurrency.js";
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
    setLocalPlayerCount(1);            // one human; the rest of the squad is AI

    resetTdEnemies();
    resetWaves();
    resetAllyAI();
    setTdEnemyHooks({ onKill, onLeak });
    resetGold(START_GOLD);
    resetHeroSwitch(1);
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
    followActiveHero(state);
    if (state.zone?.soundtrack) playTrack(state.zone.soundtrack);
    enterBuild();
    showTdHud();
    // On touch, surface the melee/remove action button — the squad may carry
    // no melee weapon, which would otherwise keep it hidden.
    refreshTouchActions();
    // The ammo chip is meaningless in TD (infinite kunai, no inventory) — hide
    // it so it doesn't show stray "x0" boxes. Restored on the exit reload.
    const ammo = typeof document !== "undefined" && document.getElementById("ammo-hud");
    if (ammo) ammo.style.display = "none";
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
  recomputeField(zone, monsterGrid(zone)); // horde locked to the path
  mapIndex = idx;
  relocateSquad(state);                  // no-op before the squad exists (boot)
}

function spawnSquad(state) {
  const spawns = getHeroSpawns();
  state.players = [];
  state.player = placeHero(createPlayer({ index: 0 }), spawns[0]);
  state.player2 = placeHero(createPlayer({ index: 1 }), freeHeroTile(state, spawns[1] || spawns[0]));
  state.lastTile = { x: state.player.tileX, y: state.player.tileY };
  state.lastTile2 = { x: state.player2.tileX, y: state.player2.tileY };
  resetPlayerHealth(0);
  resetPlayerHealth(1);
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
    if (bonus > 0) { addGold(bonus); showToast(`+${bonus}g early-call bonus`, "hint"); }
  }
  wave += 1;
  startWave(wave);
  phase = "wave";
}

function clearWave() {
  score += WAVE_CLEAR_BONUS * wave;
  addGold(STIPEND_BASE + wave * STIPEND_PER_WAVE);
  const state = getState();
  waveInMap += 1;
  if (waveInMap >= WAVES_PER_MAP) {
    // Map cleared — advance to a fresh, harder map. loadMap rebuilds the zone
    // and relocates + heals the squad; safe here since the wave is fully clear.
    waveInMap = 0;
    showToast(`Map ${mapIndex + 2}`, "hint");
    loadMap(mapIndex + 1);
  } else if (state?.zone) {
    // Same map, next wave: pop a batch of off-path obstacles to crowd the squad.
    revealNextObstacles(state.zone, obstacleBatch(mapIndex));
  }
  enterBuild();
}

function gameOver(reason = "squad") {
  if (phase === "gameover") return;
  phase = "gameover";
  const isNewBest = score > highScore;
  if (isNewBest) { highScore = score; setValue(HIGH_SCORE_KEY, score | 0); }
  const title = reason === "village" ? "Village overrun" : "Squad defeated";
  showTdGameOver({ wave, score, highScore, isNewBest, title });
}

// — Enemy hooks ——————————————————————————————————————————————————————————
function onKill(speciesId) {
  addGold(GOLD_FOR[speciesId] || 5);
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
  return nextRecruitIndex(state) != null && canAfford(recruitCost());
}

function nextRecruitIndex(state) {
  const taken = new Set(squadPlayers(state).map((p) => p.index | 0));
  for (const i of [2, 3]) if (!taken.has(i)) return i;
  return null;
}

function recruitHero() {
  const state = getState();
  if (!state || phase !== "build") return;
  const index = nextRecruitIndex(state);
  if (index == null) return;
  if (!spendGold(recruitCost())) { showToast("Not enough gold", "hint"); return; }
  const spawns = getHeroSpawns();
  const tile = freeHeroTile(state, spawns[index % spawns.length] || spawns[0]);
  const p = placeHero(createPlayer({ index }), tile);
  state.players.push({ player: p, slot: index + 1, playerId: null, lastTile: { x: p.tileX, y: p.tileY } });
  resetPlayerHealth(index);
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
  if (!spendGold(reviveCost())) { showToast("Not enough gold", "hint"); return; }
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
  followActiveHero(state);
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
  // The camera follows the active hero — the one the player drives to
  // reposition along the track during build and to fight during a wave.
  followActiveHero(state);
  tickBiomeAnimation(frame.biomeAnim, dt);
  tickEntities(dt);
  const heroes = livingHeroes(state);
  // TD simulates the whole board, not just what's on camera: the camera follows
  // one hero, but off-screen enemies must still take fire and deal damage, and
  // off-screen allies must still fight. Rendering culls independently, so this
  // is sim-only and never draws an off-screen prop.
  updateVisibleEntities(state.zone, state.camera, { all: true });
  render(frame.renderer, state.zone, state.camera, heroes, frame.biomeAnim.frame);
  updateHud(frame.hud, { zoneId: state.zone.id, fps: 1 / dt, showFps: getSettings().showFps });
  updateTdHud(buildModel(state));
}

function simulate(state, dt) {
  // Combo decay.
  if (comboTimer > 0) { comboTimer -= dt; if (comboTimer <= 0) combo = 0; }
  if (phase === "build") {
    buildTimer -= dt;
    if (buildTimer <= 0) startNextWave();
  }

  // Heroes: route input by ownership. A hero owned by a local slot takes that
  // slot's real input; a free (unowned) hero runs on allyAI. Each owner is
  // first nudged off a corpse onto a free living hero if one exists.
  for (const slot of ownerSlots()) ensureLiveOwner(state, slot, isPlayerDead);
  const enemies = getEnemies(state.zone);
  const goal = getGoal();
  const living = squadPlayers(state).filter((h) => !isPlayerDead(h.index | 0));
  for (const hero of living) {
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
  return !canAfford(reviveCost());
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
    .filter(() => canAfford(reviveCost()))
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
    gold: getGold(),
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
      label: nextRecruitIndex(state) == null ? "Squad full" : `Recruit hero (${recruitCost()}g)`,
    },
    buildHint: "Hold the line — obstacles are closing in",
    revives,
  };
}

function phaseLabel() {
  return phase === "build" ? "Build" : phase === "wave" ? "Wave" : phase === "gameover" ? "Defeated" : "—";
}

// — Input ————————————————————————————————————————————————————————————————
function onKey(e) {
  if (!isTowerDefenseMode()) return;
  if (e.repeat) return;
  if (phase === "gameover" || isOverlayOpen()) return;
  const code = e.code;
  // Switch possession: Tab or Q.
  if (code === "Tab" || code === "KeyQ") {
    e.preventDefault();
    switchHero();
    return;
  }
  const state = getState();
  const hero = activeHero(state);
  if (!hero) return;
  // Build phase: there's nothing to fire at — movement (read via pollInput in
  // simulate) just repositions the active hero along the track. The action keys
  // are inert; starting the wave is the dock button only.
  if (phase === "build") return;
  // Wave phase: the action keys fight.
  if (matchesAction("shoot", code, 0)) {
    e.preventDefault();
    tryShootForPlayer(hero);
  } else if (matchesAction("melee", code, 0)) {
    e.preventDefault();
    performMeleeSwing(state, { swinger: hero });
  }
}

function isOverlayOpen() {
  return isMenuOpen() || isDialogueOpen() || isPartyPanelOpen() || isAccountPanelOpen();
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
    startWave: () => startNextWave(),
    state: () => ({ phase, wave, mapIndex, waveInMap, score, highScore, lives, gold: getGold(), combo }),
    gold: (n) => addGold(n | 0),
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
