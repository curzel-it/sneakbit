// Tower Defense wave director: how many enemies a wave spawns, of which tier,
// at what cadence, and from which spawn tile. Difficulty rides the berry HP
// ladder — higher-difficulty waves start at a higher tier, stepping through
// every rung so the climb stays smooth. The wave-table math is pure (no
// zone/DOM) so it's unit-testable; only tickWaves touches the world.
//
// The single integer these functions take is an EFFECTIVE DIFFICULTY, not a
// cumulative wave number: the controller derives it per round from the current
// map's difficulty + the round within that map (waves reset to 1 each map,
// Bloons-style), so a fresh map starts easy and later maps start tougher.

import { spawnEnemy } from "./tdEnemies.js";
import { getSpawns } from "./tdBoard.js";

// The berry tiers in ascending strength — every rung included so the base tier
// climbs one step at a time (HP: chokeberry 80 → blackberry 200 → blueberry
// 500 → strawberry 900 → gooseberry 1100). Skipping a rung — as an earlier cut
// did with blackberry — turned wave 3 into a ~6× HP cliff (80 → 500). Enemies
// do NOT fuse in TD (towerDefense disables it), so a spawn's tier is exactly
// what this table emits.
const TIERS = [4003, 4004, 4005, 4006, 4007];

// How many enemies a wave releases. Grows linearly with difficulty so each step
// up is a step up.
export function waveCount(difficulty) {
  return 6 + Math.floor((Math.max(1, difficulty) - 1) * 3);
}

// Seconds between spawns — tightens as difficulty escalates, floored so the
// horde never becomes a single clumped blob.
export function waveInterval(difficulty) {
  return Math.max(0.35, 0.9 - Math.max(1, difficulty) * 0.05);
}

// The ordered list of species ids a wave spawns. Base tier rises every two
// difficulty steps; from difficulty 3 on, every fifth enemy is one tier tougher
// (a mini-elite) to keep the squad honest. Pure — drives tickWaves and tests.
export function buildWaveSpecies(difficulty) {
  const n = waveCount(difficulty);
  const baseIdx = Math.min(TIERS.length - 1, Math.floor((Math.max(1, difficulty) - 1) / 2));
  const out = [];
  for (let i = 0; i < n; i++) {
    const bump = difficulty >= 3 && i % 5 === 4 ? 1 : 0;
    out.push(TIERS[Math.min(TIERS.length - 1, baseIdx + bump)]);
  }
  return out;
}

let plan = [];
let cursor = 0;       // next index in `plan` to spawn
let timer = 0;        // countdown to the next spawn
let interval = 0.9;
let spawnTileCursor = 0;

// `difficulty` is the effective difficulty for this round (see header).
export function startWave(difficulty) {
  plan = buildWaveSpecies(difficulty);
  cursor = 0;
  timer = 0;            // release the first enemy immediately
  interval = waveInterval(difficulty);
  spawnTileCursor = 0;
}

export function resetWaves() {
  plan = [];
  cursor = 0;
  timer = 0;
  interval = 0.9;
  spawnTileCursor = 0;
}

export function tickWaves(zone, dt) {
  if (cursor >= plan.length) return;
  timer -= dt;
  if (timer > 0) return;
  const spawns = getSpawns();
  if (!spawns.length) return;
  const tile = spawns[spawnTileCursor % spawns.length];
  spawnTileCursor++;
  spawnEnemy(zone, tile.x, tile.y, plan[cursor]);
  cursor++;
  timer = interval;
}

export function isWaveSpawningDone() {
  return cursor >= plan.length;
}

export function totalThisWave() {
  return plan.length;
}

export function remainingToSpawn() {
  return Math.max(0, plan.length - cursor);
}
