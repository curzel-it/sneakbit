// Global dialogue reachability: starting from a virgin save, repeatedly
// talking to every NPC in the world (and letting cutscenes fire) must
// eventually surface every dialogue line in the data — except the
// explicitly reviewed exceptions below. A line silently joining the
// unreachable set is how quest softlocks slip in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadWorldFromDisk } from "../tools/autoplayWorld.mjs";
import { discoverWorld } from "../js/autoplay/worldIndex.js";
import { buildZoneModel } from "../js/autoplay/worldModel.js";
import { exhaustDialogues, exhaustEntityDialogue } from "../js/autoplay/dialogueSim.js";
import { getSpecies } from "../js/species.js";
import { getValue, setValue, _resetStorageForTesting } from "../js/storage.js";
import { getAmmo } from "../js/inventory.js";

const world = discoverWorld(loadWorldFromDisk().loadRawZone);
const models = new Map([...world.zones].map(([id, raw]) => [id, buildZoneModel(raw)]));

// Lines the pure dialogue fixed-point can't reach yet. These belong to
// multi-NPC quest webs (ninja-sister, punk/silver hero arc, Dr Voss's
// manafren research, the sword quest) whose advancement depends on
// gameplay state the dialogue sim alone doesn't reproduce — cross-NPC
// ordering, monster-kill / quest-event flags, and full route progression.
// dialogueSim reads the other ~hundreds of lines correctly; tightening
// this set is tracked with the puzzle-solver / route-planner work. Each
// stays until the richer simulation reaches it.
const UNREACHABLE_DIALOGUE_WHITELIST = new Set([
  "lore.012.hunted_pub.he_always_comes_back",
  "lore.016.fisherman_tales.1",
  "lore.019.grimsun_basin.key_found",
  "lore.025.stonehenge_second_entrance_found",
  "quest.hero.finale.a",
  "quest.hero.finale.c",
  "quest.hero.punk.lets_see_who_gets_them_first",
  "quest.hero.punk.no_use_killing_monsters",
  "quest.hero.punk.the_problem",
  "quest.hero.silver.i_am_punk_father",
  "quest.hero.silver.i_failed",
  "quest.manafren_research.dr_voss.introduction",
  "quest.manafren_research.dr_voss.thanks_for_the_info",
  "quest.manafren_research.dr_voss.thanks_for_the_info_still_working_on_it",
  "quest.manafren_research.dr_voss.waiting_for_info",
  "quest.manafren_research.priestess.thanks_for_the_info",
  "quest.ninja_skills.lyria.thats_my_brother_black",
  "quest.ninja_skills.lyria.thats_my_brother_blue",
  "quest.sword.a_thing_of_beauty",
  "quest.sword.thats_my_sword",
]);

// All talkable entities plus cutscene on_end spawns, with every cutscene
// assumed to have fired (the route test proves the triggers themselves
// are reachable; this test isolates flag-space reachability).
function collectEntities() {
  const entities = [];
  for (const model of models.values()) {
    for (const t of model.talkables) entities.push(t.entity);
    for (const c of model.cutscenes) {
      setValue(c.key, 1);
      for (const e of c.onEnd) {
        if ((e.dialogues ?? []).length > 0) entities.push(e);
      }
    }
  }
  return entities;
}

// Every dialogue text on non-Hint entities in discovered zones (the
// universe this test must cover). Hint texts are walk-over toasts with
// their own read-flag mechanism, not talk dialogues.
function collectUniverse() {
  const universe = new Set();
  for (const [, raw] of world.zones) {
    for (const e of raw.entities ?? []) {
      if (getSpecies(e.species_id)?.entity_type === "Hint") continue;
      for (const d of e.dialogues ?? []) {
        if (d?.text) universe.add(d.text);
      }
    }
    for (const c of raw.cutscenes ?? []) {
      for (const e of c.on_end ?? []) {
        for (const d of e.dialogues ?? []) {
          if (d?.text) universe.add(d.text);
        }
      }
    }
  }
  return universe;
}

test("every dialogue line is reachable from a fresh save (or whitelisted)", () => {
  _resetStorageForTesting();
  const entities = collectEntities();
  const { linesRead } = exhaustDialogues(entities);
  const universe = collectUniverse();

  const unreachable = [...universe]
    .filter((text) => !linesRead.has(text) && !UNREACHABLE_DIALOGUE_WHITELIST.has(text))
    .sort();
  assert.deepEqual(unreachable, [],
    `${unreachable.length} dialogue lines unreachable:\n${unreachable.join("\n")}`);

  const stale = [...UNREACHABLE_DIALOGUE_WHITELIST].filter((t) => linesRead.has(t));
  assert.deepEqual(stale, [], `whitelisted lines are now reachable, prune them: ${stale}`);
});

test("comma-AND gated lines resolve (ninja sister quest)", () => {
  _resetStorageForTesting();
  const entities = collectEntities();
  const { linesRead } = exhaustDialogues(entities);
  const lyriaLines = [...linesRead].filter((t) => t.startsWith("quest.ninja_skills.lyria."));
  assert.ok(lyriaLines.length > 0, "no lyria quest line was read");
  // At least one line in the world is comma-gated and reachable.
  let sawCommaGate = false;
  for (const model of models.values()) {
    for (const t of model.talkables) {
      for (const d of t.entity.dialogues ?? []) {
        if (d?.key?.includes(",") && linesRead.has(d.text)) sawCommaGate = true;
      }
    }
  }
  assert.ok(sawCommaGate, "no comma-AND gated line was reached");
});

test("dialogue rewards are granted exactly once", () => {
  _resetStorageForTesting();
  // Find a rewarding dialogue in the data and exhaust its owner twice.
  let owner = null;
  let rewarded = null;
  outer:
  for (const model of models.values()) {
    for (const t of model.talkables) {
      for (const d of t.entity.dialogues ?? []) {
        if (d?.reward && (d.key === "always" || !d.key)) {
          owner = t.entity;
          rewarded = d;
          break outer;
        }
      }
    }
  }
  if (!owner) return; // no unconditional rewarding dialogue in data — fine
  const sp = getSpecies(rewarded.reward);
  const grantedSpecies = sp?.bundle_contents?.length ? sp.bundle_contents[0] : rewarded.reward;
  const per = sp?.bundle_contents?.length
    ? sp.bundle_contents.filter((id) => id === grantedSpecies).length
    : 1;
  exhaustEntityDialogue(owner);
  const afterFirst = getAmmo(grantedSpecies);
  assert.ok(afterFirst >= per, "reward not granted");
  // Clear the answer flag so the same line resolves again, then re-talk:
  // the one-shot dialogue.reward flag must prevent a second grant.
  setValue(`dialogue.answer.${rewarded.text}`, null);
  exhaustEntityDialogue(owner);
  assert.equal(getAmmo(grantedSpecies), afterFirst, "reward granted twice");
  assert.equal(getValue(`dialogue.reward.${rewarded.text}`), 1);
});
