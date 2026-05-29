// shouldBeVisible / entityHittableFrame mirror Rust's
// features/entity.rs::should_be_visible and entities/npcs.rs::npc_hittable_frame.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js?v=20260529c";
import { shouldBeVisible, entityHittableFrame, rectOverlapsTile } from "../js/entityVisibility.js?v=20260529c";
import { _setCreativeModeForTesting } from "../js/creativeMode.js?v=20260529c";

loadSpeciesData([
  { id: 3007, entity_type: "Npc",  is_rigid: true, sprite_sheet_id: 1009,
    sprite_frame: { x: 0, y: 0, w: 1, h: 2 } },
  { id: 5000, entity_type: "Tree", is_rigid: true, sprite_sheet_id: 1010,
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);

const storage = await import("../js/storage.js?v=20260529c");

test("shouldBeVisible: no conditions → visible by default", () => {
  storage._resetStorageForTesting();
  assert.equal(shouldBeVisible({ id: 1, species_id: 3007, display_conditions: [] }), true);
  assert.equal(shouldBeVisible({ id: 2, species_id: 3007 }), true);
});

test("shouldBeVisible: first matching condition wins", () => {
  storage._resetStorageForTesting();
  const wizard = {
    id: 10754436,
    species_id: 3007,
    display_conditions: [
      { expected_value: 1, key: "dialogue.answer.x", visible: false },
      { expected_value: 0, key: "always",            visible: true  },
    ],
  };
  assert.equal(shouldBeVisible(wizard), true);
  storage.setValue("dialogue.answer.x", 1);
  assert.equal(shouldBeVisible(wizard), false);
});

test("shouldBeVisible: 'always' with expected_value 0 still matches (default branch)", () => {
  storage._resetStorageForTesting();
  // From 1002.json wizard: hide unless punk has been talked to.
  const wizard = {
    id: 11887215,
    species_id: 3007,
    display_conditions: [
      { expected_value: 1, key: "dialogue.answer.wizard", visible: false },
      { expected_value: 1, key: "dialogue.answer.punk",   visible: true  },
      { expected_value: 0, key: "always",                 visible: false },
    ],
  };
  assert.equal(shouldBeVisible(wizard), false);
  storage.setValue("dialogue.answer.punk", 1);
  assert.equal(shouldBeVisible(wizard), true);
  storage.setValue("dialogue.answer.wizard", 1);
  assert.equal(shouldBeVisible(wizard), false);
});

test("shouldBeVisible: item_collected.<id> hides regardless of conditions", () => {
  storage._resetStorageForTesting();
  const e = { id: 42, species_id: 3007, display_conditions: [] };
  assert.equal(shouldBeVisible(e), true);
  storage.setValue("item_collected.42", 1);
  assert.equal(shouldBeVisible(e), false);
});

test("shouldBeVisible: creative mode shows everything (even collected / story-hidden)", () => {
  storage._resetStorageForTesting();
  // Reproduce the wizard fixture from above — normally hidden until punk
  // dialogue, then re-hidden after talking to wizard.
  const wizard = {
    id: 11887215,
    species_id: 3007,
    display_conditions: [
      { expected_value: 1, key: "dialogue.answer.wizard", visible: false },
      { expected_value: 1, key: "dialogue.answer.punk",   visible: true  },
      { expected_value: 0, key: "always",                 visible: false },
    ],
  };
  // Collected item — would normally be hidden.
  const collected = { id: 99, species_id: 3007, display_conditions: [] };
  storage.setValue("item_collected.99", 1);
  // Outside creative the existing visibility rules apply.
  _setCreativeModeForTesting(false);
  assert.equal(shouldBeVisible(wizard), false);
  assert.equal(shouldBeVisible(collected), false);
  // In creative, both are forced visible.
  _setCreativeModeForTesting(true);
  assert.equal(shouldBeVisible(wizard), true);
  assert.equal(shouldBeVisible(collected), true);
  _setCreativeModeForTesting(false);
});

test("entityHittableFrame: 1x2 NPC shrinks to a feet rect", () => {
  const npc = { species_id: 3007, frame: { x: 10, y: 5, w: 1, h: 2 } };
  const hit = entityHittableFrame(npc);
  assert.equal(hit.x, 10.15);
  assert.equal(hit.y, 6.15);
  assert.ok(Math.abs(hit.w - 0.7) < 1e-9);
  assert.ok(Math.abs(hit.h - 0.65) < 1e-9);
});

test("entityHittableFrame: non-NPC keeps full frame", () => {
  const tree = { species_id: 5000, frame: { x: 4, y: 7, w: 1, h: 1 } };
  const hit = entityHittableFrame(tree);
  assert.deepEqual(hit, { x: 4, y: 7, w: 1, h: 1 });
});

test("rectOverlapsTile: NPC feet block bottom tile but NOT head tile", () => {
  const npc = { species_id: 3007, frame: { x: 10, y: 5, w: 1, h: 2 } };
  const hit = entityHittableFrame(npc);
  // Head tile (10, 5): should be walkable.
  assert.equal(rectOverlapsTile(hit, 10, 5), false);
  // Feet tile (10, 6): blocked.
  assert.equal(rectOverlapsTile(hit, 10, 6), true);
  // Side tiles: free.
  assert.equal(rectOverlapsTile(hit, 9, 6), false);
  assert.equal(rectOverlapsTile(hit, 11, 6), false);
});
