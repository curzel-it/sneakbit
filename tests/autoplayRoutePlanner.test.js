// Fast, always-on guards for routePlanner internals — the slow end-to-end
// route (autoplayRoute.test.js) is AUTOPLAY_WIP-gated and 40s+, so the
// pieces that must never silently regress get their own quick units here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { _extraTalkableExhausted } from "../js/autoplay/routePlanner.js";
import { setValue, _resetStorageForTesting } from "../js/storage.js";

// Defect A: the demon_lord_defeat cutscene's on_end spawns a credits entity
// (id 11974933, dialogue end_game_credits, after_dialogue "Nothing"). Because
// "Nothing" never writes item_collected.<id>, the planner's old
// item_collected-only eviction could never retire it, so it was re-added as an
// `auto` objective every iteration and drainZone's while(true) never exited —
// the post-finale hang. The fix retires it once its dialogue line is read.
const creditsEntity = {
  id: 11974933,
  after_dialogue: "Nothing",
  species_id: 1128,
  dialogues: [{ expected_value: 1, key: "always", reward: null, text: "end_game_credits" }],
};

test("a freshly-spawned story entity is NOT yet exhausted", () => {
  _resetStorageForTesting();
  assert.equal(_extraTalkableExhausted(creditsEntity), false);
});

test("a story entity is exhausted once its dialogue line is read", () => {
  _resetStorageForTesting();
  // handleReward writes this flag on the first (and only) read.
  setValue("dialogue.answer.end_game_credits", 1);
  assert.equal(_extraTalkableExhausted(creditsEntity), true,
    "credits entity must retire after its line is read, or the post-finale loop never exits");
});

test("an entity with no resolvable dialogue is exhausted", () => {
  _resetStorageForTesting();
  assert.equal(_extraTalkableExhausted({ id: 1, dialogues: [] }), true);
});
