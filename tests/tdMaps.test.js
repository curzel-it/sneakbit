// Tower Defense map roster — the pure data + unlock helpers. No storage, no DOM.
// Proves the roster is well-formed, promotion order is total, and the Bloons-
// style tier gating opens maps strictly by unique-win count.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TIERS, mapRoster, mapById, mapIndexInRoster, firstMapId, nextMapId,
  waveGoalFor, difficultyFor, tierUnlocked, mapUnlocked, unlockSummary,
} from "../js/tdMaps.js";

test("roster is well-formed: unique ids, known tiers, sane goals", () => {
  const roster = mapRoster();
  assert.ok(roster.length >= 3, "has a roster");
  const ids = new Set(roster.map((m) => m.id));
  assert.equal(ids.size, roster.length, "ids are unique");
  const tierIds = new Set(TIERS.map((t) => t.id));
  for (const m of roster) {
    assert.ok(tierIds.has(m.tier), `${m.id} has a known tier`);
    assert.ok(m.waveGoal > 0, `${m.id} has a positive wave goal`);
    assert.ok(m.difficulty >= 0, `${m.id} has a difficulty`);
    assert.ok(typeof m.name === "string" && m.name.length, `${m.id} is named`);
  }
});

test("difficulty rises monotonically across promotion order", () => {
  const roster = mapRoster();
  for (let i = 1; i < roster.length; i++) {
    assert.ok(roster[i].difficulty >= roster[i - 1].difficulty, "non-decreasing difficulty");
  }
});

test("mapById / lookups round-trip; unknown ids are null/sane", () => {
  const first = firstMapId();
  assert.equal(mapById(first).id, first);
  assert.equal(mapIndexInRoster(first), 0);
  assert.equal(mapById("nope"), null);
  assert.equal(mapIndexInRoster("nope"), -1);
  assert.equal(waveGoalFor("nope"), 0);
  assert.equal(difficultyFor("nope"), 0);
  assert.equal(waveGoalFor(first), mapById(first).waveGoal);
});

test("nextMapId walks the roster and ends on null (full victory)", () => {
  const roster = mapRoster();
  for (let i = 0; i < roster.length - 1; i++) {
    assert.equal(nextMapId(roster[i].id), roster[i + 1].id);
  }
  assert.equal(nextMapId(roster[roster.length - 1].id), null, "last map promotes to nothing");
  assert.equal(nextMapId("nope"), null);
});

test("tier gating opens strictly by unique-win count", () => {
  // Beginner is always open; later tiers need the configured unique wins.
  assert.ok(tierUnlocked("beginner", 0));
  const inter = TIERS.find((t) => t.id === "intermediate");
  assert.ok(!tierUnlocked("intermediate", inter.unlockAt - 1), "locked just under threshold");
  assert.ok(tierUnlocked("intermediate", inter.unlockAt), "open at threshold");
  assert.ok(!tierUnlocked("nope", 999));
});

test("mapUnlocked follows the map's tier", () => {
  const beginner = mapRoster().find((m) => m.tier === "beginner");
  const advanced = mapRoster().find((m) => m.tier === "advanced");
  assert.ok(mapUnlocked(beginner.id, { uniqueWins: 0 }), "beginner open from the start");
  assert.ok(!mapUnlocked(advanced.id, { uniqueWins: 0 }), "advanced gated at zero wins");
  assert.ok(mapUnlocked(advanced.id, { uniqueWins: 99 }), "advanced open once earned");
});

test("unlockSummary decorates tiers with state, wins, and best round", () => {
  const progress = { uniqueWins: 3, winsById: { meadow: 2 }, bestById: { meadow: 7 } };
  const summary = unlockSummary(progress);
  assert.equal(summary.length, TIERS.length);
  const beginner = summary.find((t) => t.id === "beginner");
  assert.ok(beginner.unlocked);
  const meadow = beginner.maps.find((m) => m.id === "meadow");
  assert.equal(meadow.wins, 2);
  assert.equal(meadow.bestRound, 7);
  const advanced = summary.find((t) => t.id === "advanced");
  assert.ok(!advanced.unlocked);
  assert.equal(advanced.winsToUnlock, advanced.unlockAt - 3);
});

test("unlockSummary tolerates empty progress", () => {
  const summary = unlockSummary(undefined);
  assert.ok(summary.find((t) => t.id === "beginner").unlocked);
  for (const t of summary) for (const m of t.maps) {
    assert.equal(m.wins, 0);
    assert.equal(m.bestRound, 0);
  }
});
