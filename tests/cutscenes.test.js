import { test } from "node:test";
import assert from "node:assert/strict";

const { setupCutscenes, tickCutscenes, startCutsceneByKey, endCutsceneByKey } =
  await import("../js/cutscenes.js?v=20260529b");
const storage = await import("../js/storage.js?v=20260529b");

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

function makeZone(cutsceneRaws) {
  return {
    id: 1,
    cols: 20, rows: 20,
    entities: [],
    _cutscenesRaw: cutsceneRaws,
  };
}

test("setupCutscenes builds runtime state from raw JSON", () => {
  storage._resetStorageForTesting();
  const zone = makeZone([makeRaw()]);
  setupCutscenes(zone);
  assert.equal(zone.cutscenes.length, 1);
  assert.equal(zone.cutscenes[0].key, "demo_cutscene");
  assert.equal(zone.cutscenes[0]._isPlaying, false);
  assert.equal(zone.cutscenes[0]._hidden, false);
});

test("setupCutscenes marks already-played cutscenes hidden", () => {
  storage._resetStorageForTesting();
  storage.setValue("demo_cutscene", 1);
  const zone = makeZone([makeRaw()]);
  setupCutscenes(zone);
  assert.equal(zone.cutscenes[0]._hidden, true);
});

test("tickCutscenes triggers when player steps on trigger tile", () => {
  storage._resetStorageForTesting();
  const zone = makeZone([makeRaw()]);
  setupCutscenes(zone);
  tickCutscenes(zone, { tileX: 0, tileY: 0 }, 0.05);
  assert.equal(zone.cutscenes[0]._isPlaying, false);
  tickCutscenes(zone, { tileX: 5, tileY: 5 }, 0.05);
  assert.equal(zone.cutscenes[0]._isPlaying, true);
});

test("tickCutscenes finishes after one full play, persists, and spawns on_end entities", () => {
  storage._resetStorageForTesting();
  const zone = makeZone([makeRaw()]);
  setupCutscenes(zone);
  // Step on the trigger.
  tickCutscenes(zone, { tileX: 5, tileY: 5 }, 0);
  // Advance 5 frames worth (number_of_frames in play_sprite).
  const oneSec = 1; // > 5 * (1/ANIMATIONS_FPS)
  tickCutscenes(zone, { tileX: 5, tileY: 5 }, oneSec);
  assert.equal(zone.cutscenes[0]._isPlaying, false);
  assert.equal(zone.cutscenes[0]._hidden, true);
  assert.equal(storage.getValue("demo_cutscene"), 1);
  assert.equal(zone.entities.length, 1, "on_end entity inserted");
  assert.equal(zone.entities[0].species_id, 999);
});

test("tickCutscenes is a no-op when the zone has no cutscenes", () => {
  storage._resetStorageForTesting();
  const zone = makeZone([]);
  setupCutscenes(zone);
  // Should not throw.
  tickCutscenes(zone, { tileX: 0, tileY: 0 }, 0.05);
  assert.equal(zone.cutscenes.length, 0);
});

test("startCutsceneByKey flips _isPlaying without a tile match", () => {
  storage._resetStorageForTesting();
  const zone = makeZone([makeRaw()]);
  setupCutscenes(zone);
  startCutsceneByKey(zone, "demo_cutscene");
  assert.equal(zone.cutscenes[0]._isPlaying, true);
  assert.equal(zone.cutscenes[0]._frameIndex, 0);
});

test("startCutsceneByKey ignores unknown keys and already-hidden entries", () => {
  storage._resetStorageForTesting();
  storage.setValue("demo_cutscene", 1);
  const zone = makeZone([makeRaw()]);
  setupCutscenes(zone);
  startCutsceneByKey(zone, "demo_cutscene");
  assert.equal(zone.cutscenes[0]._isPlaying, false, "hidden cutscenes do not re-play");
  startCutsceneByKey(zone, "no.such.key");
  // No throw, no mutation.
});

test("endCutsceneByKey clears playing state without spawning on_end (host owns that)", () => {
  storage._resetStorageForTesting();
  const zone = makeZone([makeRaw()]);
  setupCutscenes(zone);
  startCutsceneByKey(zone, "demo_cutscene");
  endCutsceneByKey(zone, "demo_cutscene");
  assert.equal(zone.cutscenes[0]._isPlaying, false);
  assert.equal(zone.cutscenes[0]._hidden, true);
  assert.equal(zone.entities.length, 0, "guest must not duplicate on_end entities");
});

test("tickCutscenes in mirror mode skips auto-trigger and never finishes", () => {
  storage._resetStorageForTesting();
  const zone = makeZone([makeRaw()]);
  setupCutscenes(zone);
  // Standing on the trigger tile should NOT start the cutscene in mirror mode.
  tickCutscenes(zone, { tileX: 5, tileY: 5 }, 0.05, { mirror: true });
  assert.equal(zone.cutscenes[0]._isPlaying, false);
  // Once the host says "start", we advance the play sprite locally.
  startCutsceneByKey(zone, "demo_cutscene");
  tickCutscenes(zone, null, 1, { mirror: true });
  // Mirror tick clamps at last frame instead of finishing — onEnd must
  // stay empty, and we wait for event:cutsceneEnd to actually retire it.
  assert.equal(zone.cutscenes[0]._isPlaying, true);
  assert.equal(zone.entities.length, 0);
});
