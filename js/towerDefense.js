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
import { loadZone } from "./data.js";
import { buildZone } from "./zone.js";
import { createPlayer, updatePlayer } from "./player.js";
import { pollInput, clearInputState } from "./input.js";
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

import { initBoard, getHeroSpawns, getGoal, recomputeField, resetBoard } from "./tdBoard.js";
import {
  setTdEnemyHooks, resetTdEnemies, tickTdEnemies, aliveEnemyCount,
} from "./tdEnemies.js";
import { getEnemies } from "./tdEnemies.js";
import { startWave, tickWaves, isWaveSpawningDone, totalThisWave, resetWaves } from "./tdWaves.js";
import { driveAlly } from "./allyAI.js";
import {
  resetHeroSwitch, getActiveHeroIndex, isActiveHero, squadPlayers,
  cycleActiveHero, ensureLiveActive, followActiveHero, activeHero,
} from "./heroSwitch.js";
import { resetGold, getGold, addGold, spendGold, canAfford } from "./arcadeCurrency.js";
import {
  installBuild, placeDefaultItem, placeSelected, setSelectedItem, getPaletteModel,
  buildHintText, resetBuild, getPlacedObstacleCount,
} from "./tdBuild.js";
import {
  installTdHud, showTdHud, hideTdHud, updateTdHud, showTdGameOver,
} from "./tdHud.js";

// — Tuning ————————————————————————————————————————————————————————————————
const START_GOLD = 150;           // enough to recruit a third hero turn 1 if you skip walls
const BUILD_TIME = 30;            // seconds of build phase before auto-start
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
let wave = 0;
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
    onReady: startNextWave,
    onRecruit: recruitHero,
    onRevive: reviveHero,
    onSwitch: switchHero,
    onRestart: restartRun,
    onExit: exitRun,
    onSelectItem: setSelectedItem,
  });
  installBuild(getState, {
    isBuildPhase: () => phase === "build",
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
    const rawZone = await loadZone(TD_ZONE_ID);
    const zone = buildZone(rawZone);
    state.rawZone = rawZone;
    state.zone = zone;
    initBoard(rawZone, zone);
    recomputeField(zone);

    resetTdEnemies();
    resetWaves();
    resetBuild();
    setTdEnemyHooks({ onKill, onLeak });
    resetGold(START_GOLD);
    resetHeroSwitch(0);
    spawnSquad(state);
    recruitedCount = 0;
    wave = 0;
    score = 0;
    combo = 0;
    comboTimer = 0;
    lives = VILLAGE_LIVES;
    highScore = getValue(HIGH_SCORE_KEY) | 0;

    followActiveHero(state);
    if (zone.soundtrack) playTrack(zone.soundtrack);
    enterBuild();
    showTdHud();
    // The ammo chip is meaningless in TD (infinite kunai, no inventory) — hide
    // it so it doesn't show stray "x0" boxes. Restored on the exit reload.
    const ammo = typeof document !== "undefined" && document.getElementById("ammo-hud");
    if (ammo) ammo.style.display = "none";
  } finally {
    booting = false;
  }
}

function spawnSquad(state) {
  const spawns = getHeroSpawns();
  state.player = placeHero(createPlayer({ index: 0 }), spawns[0]);
  state.player2 = placeHero(createPlayer({ index: 1 }), spawns[1] || spawns[0]);
  state.players = [];
  state.lastTile = { x: state.player.tileX, y: state.player.tileY };
  state.lastTile2 = { x: state.player2.tileX, y: state.player2.tileY };
  resetPlayerHealth(0);
  resetPlayerHealth(1);
}

function placeHero(p, tile) {
  p.tileX = tile.x; p.tileY = tile.y; p.x = tile.x; p.y = tile.y;
  p.direction = "left"; // face the incoming horde
  p.step = null; p.queuedDir = null; p.pendingDir = null;
  return p;
}

// — Phase transitions ————————————————————————————————————————————————————
function enterBuild() {
  phase = "build";
  buildTimer = BUILD_TIME;
}

function startNextWave() {
  if (phase !== "build") return;
  wave += 1;
  startWave(wave);
  phase = "wave";
}

function clearWave() {
  score += WAVE_CLEAR_BONUS * wave;
  addGold(STIPEND_BASE + wave * STIPEND_PER_WAVE);
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
  const tile = spawns[index % spawns.length] || spawns[0];
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
  placeHero(hero, spawns[(index | 0) % spawns.length] || spawns[0]);
  resetPlayerHealth(index | 0);
}

function switchHero() {
  const state = getState();
  if (!state || phase === "gameover") return;
  cycleActiveHero(state, isPlayerDead);
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

  // Heroes: real input to the active hero, allyAI to the rest.
  ensureLiveActive(state, isPlayerDead);
  const enemies = getEnemies(state.zone);
  const goal = getGoal();
  const humanInput = pollInput(1);
  for (const hero of squadPlayers(state)) {
    const idx = hero.index | 0;
    if (isPlayerDead(idx)) continue;
    const input = isActiveHero(idx) ? humanInput : driveAlly(state, hero, { enemies, goal });
    updatePlayer(hero, input, dt, state.zone);
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

function buildModel(state) {
  const revives = downedHeroes(state)
    .filter(() => canAfford(reviveCost()))
    .map((p) => ({ index: p.index | 0, name: HERO_NAMES[p.index | 0] || "Hero", cost: reviveCost() }));
  const active = activeHero(state);
  return {
    wave,
    phase: phaseLabel(),
    score,
    highScore,
    lives,
    maxLives: VILLAGE_LIVES,
    gold: getGold(),
    countdown: phase === "build" ? Math.max(0, buildTimer) : null,
    alive: aliveEnemyCount(state.zone),
    total: phase === "wave" ? totalThisWave() : 0,
    activeHeroName: active ? (HERO_NAMES[active.index | 0] || "Hero") : "—",
    canSwitch: squadPlayers(state).filter((p) => !isPlayerDead(p.index | 0)).length > 1,
    recruit: {
      cost: recruitCost(),
      can: canRecruit(state),
      label: nextRecruitIndex(state) == null ? "Squad full" : `Recruit hero (${recruitCost()}g)`,
    },
    palette: getPaletteModel(),
    buildHint: buildHintText(),
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
  if (matchesAction("shoot", code, 0)) {
    e.preventDefault();
    tryShootForPlayer(hero);
  } else if (matchesAction("melee", code, 0)) {
    e.preventDefault();
    performMeleeSwing(state, { swinger: hero });
  } else if (code === "Enter" && phase === "build") {
    e.preventDefault();
    startNextWave();
  }
}

function isOverlayOpen() {
  return isMenuOpen() || isDialogueOpen() || isPartyPanelOpen() || isAccountPanelOpen();
}

// — Exit / restart ————————————————————————————————————————————————————————
function restartRun() {
  hideTdHud();
  startTowerDefense();
}

// Leave TD entirely: drop the ?mode=td latch and reload into the normal game.
// A reload guarantees a clean offline state without re-threading every TD
// mutation back out by hand.
function exitRun() {
  setGameMode(GAME_MODE.coop);
  hideTdHud();
  resetTdState();
  if (typeof location !== "undefined") location.assign(location.pathname);
}

function resetTdState() {
  phase = "idle";
  wave = 0; score = 0; combo = 0; comboTimer = 0; lives = VILLAGE_LIVES; recruitedCount = 0;
  for (const slot of [1, 2, 3, 4]) clearInputState(slot);
  resetTdEnemies();
  resetWaves();
  resetBoard();
}

// — Debug hook ————————————————————————————————————————————————————————————
function installDebugHook() {
  if (typeof window === "undefined") return;
  window.td = {
    start: () => startTowerDefense(),
    startWave: () => startNextWave(),
    state: () => ({ phase, wave, score, highScore, lives, gold: getGold(), combo }),
    gold: (n) => addGold(n | 0),
    addWaves: (n) => { wave += (n | 0); },
    enemies: () => { const s = getState(); return s?.zone ? getEnemies(s.zone).length : 0; },
    squad: () => squadPlayers(getState()).length,
    activeIndex: () => getActiveHeroIndex(),
    place: (x, y) => placeDefaultItem(x | 0, y | 0),
    select: (id) => setSelectedItem(id),
    placeItem: (id, x, y) => { setSelectedItem(id); return placeSelected(x | 0, y | 0); },
    obstacles: () => getPlacedObstacleCount(),
    recruit: () => recruitHero(),
    killAll: () => {
      const state = getState();
      for (const e of getEnemies(state.zone)) e._dying = true;
    },
    win: () => clearWave(),
    lose: () => gameOver(),
  };
}
