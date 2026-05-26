import { test } from "node:test";
import assert from "node:assert/strict";

const { setupCutscenes, tickCutscenes } = await import("../js/cutscenes.js");
const storage = await import("../js/storage.js");

function makeRaw() {
  return {
    key: "demo_cutscene",
    idle_sprite: { sheet_id: 1020, number_of_frames: 4,
      frame: { x: 0, y: 0, w: 1, h: 1 } },
    play_sprite: { sheet_id: 1020, number_of_frames: 5,
      frame: { x: 0, y: 0, w: 1, h: 1 } },
    frame: { x: 10, y: 10, w: 1, h: 1 },
    trigger_position: [5, 5],
    on_end: [
      { species_id: 999, frame: { x: 6, y: 6, w: 1, h: 1 } },
    ],
  };
}

function makeWorld(cutsceneRaws) {
  return {
    id: 1,
    cols: 20, rows: 20,
    entities: [],
    _cutscenesRaw: cutsceneRaws,
  };
}

test("setupCutscenes builds runtime state from raw JSON", () => {
  storage._resetStorageForTesting();
  const world = makeWorld([makeRaw()]);
  setupCutscenes(world);
  assert.equal(world.cutscenes.length, 1);
  assert.equal(world.cutscenes[0].key, "demo_cutscene");
  assert.equal(world.cutscenes[0]._isPlaying, false);
  assert.equal(world.cutscenes[0]._hidden, false);
});

test("setupCutscenes marks already-played cutscenes hidden", () => {
  storage._resetStorageForTesting();
  storage.setValue("demo_cutscene", 1);
  const world = makeWorld([makeRaw()]);
  setupCutscenes(world);
  assert.equal(world.cutscenes[0]._hidden, true);
});

test("tickCutscenes triggers when player steps on trigger tile", () => {
  storage._resetStorageForTesting();
  const world = makeWorld([makeRaw()]);
  setupCutscenes(world);
  tickCutscenes(world, { tileX: 0, tileY: 0 }, 0.05);
  assert.equal(world.cutscenes[0]._isPlaying, false);
  tickCutscenes(world, { tileX: 5, tileY: 5 }, 0.05);
  assert.equal(world.cutscenes[0]._isPlaying, true);
});

test("tickCutscenes finishes after one full play, persists, and spawns on_end entities", () => {
  storage._resetStorageForTesting();
  const world = makeWorld([makeRaw()]);
  setupCutscenes(world);
  // Step on the trigger.
  tickCutscenes(world, { tileX: 5, tileY: 5 }, 0);
  // Advance 5 frames worth (number_of_frames in play_sprite).
  const oneSec = 1; // > 5 * (1/ANIMATIONS_FPS)
  tickCutscenes(world, { tileX: 5, tileY: 5 }, oneSec);
  assert.equal(world.cutscenes[0]._isPlaying, false);
  assert.equal(world.cutscenes[0]._hidden, true);
  assert.equal(storage.getValue("demo_cutscene"), 1);
  assert.equal(world.entities.length, 1, "on_end entity inserted");
  assert.equal(world.entities[0].species_id, 999);
});

test("tickCutscenes is a no-op when the world has no cutscenes", () => {
  storage._resetStorageForTesting();
  const world = makeWorld([]);
  setupCutscenes(world);
  // Should not throw.
  tickCutscenes(world, { tileX: 0, tileY: 0 }, 0.05);
  assert.equal(world.cutscenes.length, 0);
});
