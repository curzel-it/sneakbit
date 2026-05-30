import { test } from "node:test";
import assert from "node:assert/strict";

const { _resetStorageForTesting } = await import("../js/storage.js?v=20260530c");
const { saveProgress, loadProgress, clearProgress, hasSavedProgress } =
  await import("../js/save.js?v=20260530c");

function makeState(zoneId, tileX, tileY, direction = "down") {
  return {
    zone: { id: zoneId },
    player: { tileX, tileY, direction },
  };
}

test("loadProgress returns null when no save is present", () => {
  _resetStorageForTesting();
  assert.equal(loadProgress(), null);
  assert.equal(hasSavedProgress(), false);
});

test("saveProgress round-trips zone id + tile + direction", () => {
  _resetStorageForTesting();
  saveProgress(makeState(1042, 11, 7, "left"));
  const got = loadProgress();
  assert.deepEqual(got, { zoneId: 1042, x: 11, y: 7, direction: "left" });
  assert.equal(hasSavedProgress(), true);
});

test("saveProgress coerces floats to ints", () => {
  _resetStorageForTesting();
  saveProgress(makeState(1001, 3.7, 4.9));
  const got = loadProgress();
  assert.equal(got.x, 3);
  assert.equal(got.y, 4);
});

test("saveProgress with an unknown direction skips the direction slot", () => {
  _resetStorageForTesting();
  saveProgress(makeState(1001, 1, 1, "weird"));
  const got = loadProgress();
  assert.equal(got.direction, null);
});

test("clearProgress wipes the save", () => {
  _resetStorageForTesting();
  saveProgress(makeState(1001, 1, 1));
  assert.equal(hasSavedProgress(), true);
  clearProgress();
  assert.equal(loadProgress(), null);
});

test("saveProgress is a no-op without zone or player", () => {
  _resetStorageForTesting();
  saveProgress(null);
  saveProgress({});
  saveProgress({ zone: { id: 1 } });
  assert.equal(loadProgress(), null);
});
