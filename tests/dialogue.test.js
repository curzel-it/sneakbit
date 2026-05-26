// Dialogue conditionals: resolveEntityDialogue picks the first dialogue
// whose key/expected_value combo matches current storage state. Mirrors
// Rust entity.rs::next_dialogue.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadSpeciesData } from "../js/species.js";
import { loadStringsData } from "../js/strings.js";

loadSpeciesData([
  { id: 1, entity_type: "Bullet", sprite_sheet_id: 1014,
    dps: 0, base_speed: 0, name: "test.item",
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);
loadStringsData({
  "test.item": "Magic Apple",
  "dialogue.reward_received": "You received `%s`!",
});

const { resolveEntityDialogue } = await import("../js/dialogue.js");
const storage = await import("../js/storage.js");

test("resolveEntityDialogue: null on empty entity", () => {
  storage._resetStorageForTesting();
  assert.equal(resolveEntityDialogue({}), null);
  assert.equal(resolveEntityDialogue({ dialogues: [] }), null);
  assert.equal(resolveEntityDialogue(null), null);
});

test("resolveEntityDialogue: picks the first dialogue without key", () => {
  storage._resetStorageForTesting();
  const entity = { dialogues: [{ text: "first" }, { text: "second" }] };
  assert.equal(resolveEntityDialogue(entity).text, "first");
});

test("resolveEntityDialogue: 'always' key always matches", () => {
  storage._resetStorageForTesting();
  const entity = { dialogues: [{ text: "hi", key: "always", expected_value: 0 }] };
  assert.equal(resolveEntityDialogue(entity).text, "hi");
});

test("resolveEntityDialogue: gates on expected_value", () => {
  storage._resetStorageForTesting();
  const entity = {
    dialogues: [
      { text: "step2", key: "quest.x", expected_value: 1 },
      { text: "step1", key: "always" },
    ],
  };
  // quest.x is unset → step2 won't match (expected 1 != 0), step1 wins.
  assert.equal(resolveEntityDialogue(entity).text, "step1");

  storage.setValue("quest.x", 1);
  // Now step2's gate is satisfied; it's earlier in the list so it wins.
  assert.equal(resolveEntityDialogue(entity).text, "step2");
});

test("resolveEntityDialogue: expected=0 matches an unset key", () => {
  storage._resetStorageForTesting();
  const entity = {
    dialogues: [{ text: "intro", key: "quest.x", expected_value: 0 }],
  };
  assert.equal(resolveEntityDialogue(entity).text, "intro");
  storage.setValue("quest.x", 1);
  assert.equal(resolveEntityDialogue(entity), null);
});

test("resolveEntityDialogue: progression chain via dialogue_read keys", () => {
  storage._resetStorageForTesting();
  const entity = {
    dialogues: [
      { text: "third",  key: "dialogue_read.second", expected_value: 1 },
      { text: "second", key: "dialogue_read.first",  expected_value: 1 },
      { text: "first",  key: "always" },
    ],
  };
  // No reads yet → only "first" matches.
  assert.equal(resolveEntityDialogue(entity).text, "first");
  storage.setValue("dialogue_read.first", 1);
  assert.equal(resolveEntityDialogue(entity).text, "second");
  storage.setValue("dialogue_read.second", 1);
  assert.equal(resolveEntityDialogue(entity).text, "third");
});
