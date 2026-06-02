// Tower Defense wave-table escalation: count grows, cadence tightens, and the
// tier curve climbs with the wave number. Pure math — no zone, no DOM.

import { test } from "node:test";
import assert from "node:assert/strict";

import { waveCount, waveInterval, buildWaveSpecies } from "../js/tdWaves.js";

test("wave count grows monotonically with the wave number", () => {
  assert.equal(waveCount(1), 6);
  assert.ok(waveCount(2) > waveCount(1));
  assert.ok(waveCount(10) > waveCount(5));
});

test("spawn interval tightens and is floored", () => {
  assert.ok(waveInterval(2) < waveInterval(1));
  assert.ok(waveInterval(50) >= 0.35);
});

test("buildWaveSpecies returns waveCount ids, all valid fusion tiers", () => {
  const valid = new Set([4003, 4005, 4006, 4007]);
  for (const w of [1, 3, 6, 12]) {
    const list = buildWaveSpecies(w);
    assert.equal(list.length, waveCount(w));
    for (const id of list) assert.ok(valid.has(id), `tier ${id} valid`);
  }
});

test("later waves start at strictly tougher base tiers", () => {
  const baseOf = (w) => Math.min(...buildWaveSpecies(w));
  assert.ok(baseOf(5) > baseOf(1));
  assert.ok(baseOf(7) >= baseOf(5));
});

test("from wave 3 on, mini-elites (one tier up) appear", () => {
  const w = 6;
  const list = buildWaveSpecies(w);
  const tiers = new Set(list);
  assert.ok(tiers.size >= 2, "wave mixes a base tier with elites");
});
