// Tower Defense persistent progress — wins, best rounds, and the unique-win
// aggregate that drives tier unlocks. Runs against storage.js's in-memory
// fallback (no localStorage in node), reset between tests.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { _resetStorageForTesting, getValue } from "../js/storage.js";
import { recordMapWin, recordRoundReached, getProgress, resetProgress } from "../js/tdProgress.js";

beforeEach(() => _resetStorageForTesting());

test("first win on a map bumps its count and the unique-win aggregate", () => {
  assert.equal(getProgress().uniqueWins, 0);
  recordMapWin("meadow", 10);
  const p = getProgress();
  assert.equal(p.winsById.meadow, 1);
  assert.equal(p.uniqueWins, 1);
  assert.equal(p.bestById.meadow, 10);
});

test("repeat wins on the same map don't double-count unique wins", () => {
  recordMapWin("meadow", 10);
  recordMapWin("meadow", 10);
  recordMapWin("meadow", 10);
  const p = getProgress();
  assert.equal(p.winsById.meadow, 3, "win count accumulates");
  assert.equal(p.uniqueWins, 1, "unique stays at one distinct map");
});

test("distinct maps each add one unique win", () => {
  recordMapWin("meadow", 10);
  recordMapWin("grove", 10);
  recordMapWin("creek", 11);
  assert.equal(getProgress().uniqueWins, 3);
});

test("best round is monotonic and updates from wins or losses", () => {
  recordRoundReached("ridge", 5);     // died on a loss
  assert.equal(getValue("td.map.ridge.bestRound"), 5);
  recordRoundReached("ridge", 3);     // worse run doesn't lower it
  assert.equal(getValue("td.map.ridge.bestRound"), 5);
  recordMapWin("ridge", 12);          // a win deepens it
  assert.equal(getProgress().bestById.ridge, 12);
});

test("zero/empty inputs are no-ops", () => {
  recordRoundReached("ridge", 0);
  recordMapWin("");
  const p = getProgress();
  assert.equal(p.bestById.ridge, 0);
  assert.equal(p.uniqueWins, 0);
});

test("resetProgress wipes wins/best/unique", () => {
  recordMapWin("meadow", 10);
  recordMapWin("grove", 12);
  resetProgress();
  const p = getProgress();
  assert.equal(p.uniqueWins, 0);
  assert.equal(p.winsById.meadow, 0);
  assert.equal(p.bestById.grove, 0);
});
