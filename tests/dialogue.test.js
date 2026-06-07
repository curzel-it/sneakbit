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
  // Kunai (ammo) + a "kunai.x10" bundle, mirroring data/species.json 7000/7001.
  { id: 7000, entity_type: "Bullet", name: "objects.name.kunai",
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
  { id: 7001, entity_type: "Bundle", name: "objects.name.kunai.x10",
    bundle_contents: [7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000, 7000],
    sprite_frame: { x: 0, y: 0, w: 1, h: 1 } },
]);
loadStringsData({
  "test.item": "Magic Apple",
  "objects.name.kunai.x10": "Kunai x10",
  "dialogue.reward_received": "You received `%s`!",
});

const { resolveEntityDialogue, handleReward } = await import("../js/dialogue.js");
const storage = await import("../js/storage.js");
const inventory = await import("../js/inventory.js");

// --- Ninja "check on the sister" quest regression -------------------------
// Blue (Duskhaven) and black (Aridreach) ninjas both send the player to
// Evergrove to meet their sister Lyria, then reward a kunai skill. The quests
// must be completable in EITHER order. Lyria's "father_introduction" line — the
// shared completion both ninjas accept — is gated on a comma-joined key
// ("blue…,black…") meaning "the player asked about BOTH brothers". That
// multi-condition gate was unported (keyMatches ignored commas), so once the
// black quest was done the blue branch could never advance; restoring the comma
// semantics in storage.js (mirroring Rust) makes either order work with the
// original dialogue data intact.
const { readFileSync } = await import("node:fs");
const { fileURLToPath } = await import("node:url");
const dataDir = fileURLToPath(new URL("../data/", import.meta.url));
const loadEntity = (zone, id) =>
  JSON.parse(readFileSync(`${dataDir}${zone}.json`)).entities.find((e) => e.id === id);
const BLUE_NINJA = loadEntity(10810193, 11200316);
const BLACK_NINJA = loadEntity(11199957, 11200171);
const LYRIA = loadEntity(1001, 10754440);
// The Red Ninja is the kids' father: he hands over the piercing skill only once
// BOTH the blue and black quests are done, via a comma (AND) gate.
const RED_NINJA = loadEntity(11110814, 11201365);
const BLUE_SKILL = "dialogue.answer.quest.ninja_skills.blue_ninja.gain_knife_catcher_skill";
const BLACK_SKILL = "dialogue.answer.quest.ninja_skills.black_ninja.gain_bouncing_knifes_skill";
const PIERCING_SKILL = "dialogue.answer.quest.ninja_skills.red_ninja.gain_piercing_knife_skill";
// "Talk to" an NPC: resolve the matching line and apply its read/reward flag.
const talk = (entity) => {
  const d = resolveEntityDialogue(entity);
  if (d) handleReward(d, 0);
  return d?.text;
};
const runNinjaQuest = (ninja) => { talk(ninja); talk(LYRIA); talk(ninja); };

test("ninja quest: completable blue-first then black", () => {
  storage._resetStorageForTesting();
  runNinjaQuest(BLUE_NINJA);
  runNinjaQuest(BLACK_NINJA);
  assert.equal(storage.getValue(BLUE_SKILL), 1);
  assert.equal(storage.getValue(BLACK_SKILL), 1);
});

test("ninja quest: completable black-first then blue (the reported bug)", () => {
  storage._resetStorageForTesting();
  runNinjaQuest(BLACK_NINJA);
  runNinjaQuest(BLUE_NINJA);
  assert.equal(storage.getValue(BLACK_SKILL), 1);
  assert.equal(storage.getValue(BLUE_SKILL), 1);
});

test("ninja quest: a ninja asks before rewarding (no skip-to-reward)", () => {
  storage._resetStorageForTesting();
  // Finishing the black quest first must not auto-complete the blue one: the
  // blue ninja still asks the player to check on the sister on first contact
  // instead of handing over the skill immediately.
  runNinjaQuest(BLACK_NINJA);
  assert.equal(talk(BLUE_NINJA), "quest.ninja_skills.blue_ninja.please_check_on_sister");
  assert.equal(storage.getValue(BLUE_SKILL), null);
});

test("ninja quest: a stuck save recovers by revisiting Lyria", () => {
  storage._resetStorageForTesting();
  // A save left stuck by the unported comma gate: black done, blue asked, but
  // Lyria's shared "both brothers" intro was never reachable for the blue path.
  storage.setValue("dialogue.answer.quest.ninja_skills.black_ninja.please_check_on_sister", 1);
  storage.setValue("dialogue.answer.quest.ninja_skills.blue_ninja.please_check_on_sister", 1);
  storage.setValue("dialogue.answer.quest.ninja_skills.lyria.thats_my_brother_black", 1);
  storage.setValue(BLACK_SKILL, 1);
  // The exact recovery the player attempts: talk to Lyria, then the blue ninja.
  talk(LYRIA);
  talk(BLUE_NINJA);
  assert.equal(storage.getValue(BLUE_SKILL), 1);
});

const runKidQuest = (kid) => { talk(kid); talk(LYRIA); talk(kid); };

test("red ninja: only rewards the piercing skill once BOTH kids are done", () => {
  storage._resetStorageForTesting();
  // First contact with neither kid done → he just frets about his children.
  assert.equal(talk(RED_NINJA), "quest.ninja_skills.red_ninja.please_check_on_my_kids");
  assert.equal(storage.getValue(PIERCING_SKILL), null);
  // One kid is not enough — the comma gate is AND.
  runKidQuest(BLUE_NINJA);
  assert.equal(talk(RED_NINJA), "quest.ninja_skills.red_ninja.please_check_on_my_kids");
  assert.equal(storage.getValue(PIERCING_SKILL), null);
  // Both kids done → he teaches the piercing skill.
  runKidQuest(BLACK_NINJA);
  assert.equal(talk(RED_NINJA), "quest.ninja_skills.red_ninja.gain_piercing_knife_skill");
  assert.equal(storage.getValue(PIERCING_SKILL), 1);
});

test("red ninja: post-reward visits show the 'about the skill' flavor", () => {
  storage._resetStorageForTesting();
  runKidQuest(BLUE_NINJA);
  runKidQuest(BLACK_NINJA);
  talk(RED_NINJA); // grants the skill
  assert.equal(talk(RED_NINJA), "quest.ninja_skills.red_ninja.about_piercing_knife_skill");
  assert.equal(talk(RED_NINJA), "quest.ninja_skills.red_ninja.about_piercing_knife_skill");
});

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

test("handleReward: a bundle reward expands into its contents (10 kunai, not 1 bundle)", () => {
  storage._resetStorageForTesting();
  // The haunted-pub empty seat grants reward 7001 (kunai.x10). The player must
  // end up with 10 usable kunai (7000), not a single un-shootable bundle entry.
  const before = inventory.getAmmo(7000, 0);
  handleReward({ text: "lore.012.hunted_pub.he_always_comes_back", reward: 7001 }, 0);
  assert.equal(inventory.getAmmo(7000, 0), before + 10, "10 kunai granted");
  assert.equal(inventory.getAmmo(7001, 0), 0, "no raw bundle in inventory");
});

test("handleReward: the reward is one-time per dialogue text", () => {
  storage._resetStorageForTesting();
  const text = "lore.012.hunted_pub.he_always_comes_back";
  handleReward({ text, reward: 7001 }, 0);
  const after = inventory.getAmmo(7000, 0);
  // Talking again must not re-grant — mirrors Rust has_dialogue_reward_been_collected.
  handleReward({ text, reward: 7001 }, 0);
  assert.equal(inventory.getAmmo(7000, 0), after, "no second payout");
});

test("handleReward: marks the dialogue read so downstream gates resolve", () => {
  storage._resetStorageForTesting();
  handleReward({ text: "some.dialogue" }, 0);
  assert.equal(storage.getValue("dialogue.answer.some.dialogue"), 1);
});

test("resolveEntityDialogue: progression chain via dialogue.answer keys", () => {
  storage._resetStorageForTesting();
  const entity = {
    dialogues: [
      { text: "third",  key: "dialogue.answer.second", expected_value: 1 },
      { text: "second", key: "dialogue.answer.first",  expected_value: 1 },
      { text: "first",  key: "always" },
    ],
  };
  // No reads yet → only "first" matches.
  assert.equal(resolveEntityDialogue(entity).text, "first");
  storage.setValue("dialogue.answer.first", 1);
  assert.equal(resolveEntityDialogue(entity).text, "second");
  storage.setValue("dialogue.answer.second", 1);
  assert.equal(resolveEntityDialogue(entity).text, "third");
});
