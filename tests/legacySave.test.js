// Importing a save from the pre-rewrite (Rust core) builds. The old engine
// wrote a flat { key: u32 } JSON object to save.json; this asserts the key
// translation, the settings carried alongside it, the one-shot import decision
// and the all-or-nothing apply.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  translateLegacySave, legacySaveHasProgress, applyLegacySave, importLegacySave,
  legacyImportDecision, legacySettingsPatch,
} from "../js/legacySave.js";
import { getValue, setValue, _resetStorageForTesting } from "../js/storage.js";

// A realistic slice of a Rust save.json.
const LEGACY = {
  build_number: 7,
  latest_world: 1011,
  previous_world: 1001,
  always: 1,
  is_mobile: 0,
  fullscreen: 1,
  language: 1,
  "desktop_only.game_settings.music_disabled": 1,
  "world.visited.1001": 1,
  "world.visited.1011": 1,
  "player.0.currently_equipped_ranged_weapon": 1160,
  "player.0.currently_equipped_melee_weapon": 1159,
  "player.1.currently_equipped_melee_weapon": 1164,
  "player.0.inventory.amount.7000": 12,
  "dialogue.answer.lore.011.hero_profecy.part_1": 1,
  "item_collected.12984092": 1,
  "npc_interactions.3008": 1,
  "lock_override.99": 2,
  pressure_plate_down_yellow: 1,
  "skill.knockback_aura.owned": 1,
};

test("renamed keys land on their modern names", () => {
  const { kv } = translateLegacySave(LEGACY);
  assert.equal(kv.latest_zone, 1011, "latest_world → latest_zone");
  assert.equal(kv.latest_world, undefined);
  assert.equal(kv["did_visit.1001"], 1, "world.visited.<id> → did_visit.<id>");
  assert.equal(kv["did_visit.1011"], 1);
  assert.equal(kv["world.visited.1001"], undefined);
  assert.equal(kv["player.0.equipped.ranged"], 1160);
  assert.equal(kv["player.0.equipped.melee"], 1159);
  assert.equal(kv["player.1.equipped.melee"], 1164);
  assert.equal(kv["player.0.currently_equipped_ranged_weapon"], undefined);
});

test("keys that already match are copied through untouched", () => {
  const { kv } = translateLegacySave(LEGACY);
  assert.equal(kv["player.0.inventory.amount.7000"], 12);
  assert.equal(kv["dialogue.answer.lore.011.hero_profecy.part_1"], 1);
  assert.equal(kv["item_collected.12984092"], 1);
  assert.equal(kv["npc_interactions.3008"], 1);
  assert.equal(kv["lock_override.99"], 2);
  assert.equal(kv.pressure_plate_down_yellow, 1);
  assert.equal(kv["skill.knockback_aura.owned"], 1);
});

test("device-local and engine-private keys are dropped", () => {
  const { kv, skipped } = translateLegacySave(LEGACY);
  for (const k of ["build_number", "previous_world", "always", "is_mobile", "fullscreen",
                   "language", "desktop_only.game_settings.music_disabled"]) {
    assert.equal(kv[k], undefined, `${k} must not be imported`);
  }
  assert.equal(skipped, 7);
});

test("the `always` key the old iOS build seeded files with is not progress", () => {
  // A player who installed the old game and never played still has a save.json
  // — RustConfig.swift wrote {"always": 1} on first launch. Importing that as a
  // real key would be harmless but wrong; treating the file as progress would
  // not be, so it must translate to nothing importable.
  assert.throws(() => translateLegacySave({ always: 1 }), /no importable progress/);
});

test("importing build_number would skip our own migration ladder", () => {
  // The Rust ladder's version number means nothing here: carried over, it
  // would stamp the save as already-migrated and the latest_world → latest_zone
  // step would never run for anyone whose file predates the rename.
  const { kv } = translateLegacySave({ build_number: 99, latest_world: 1011 });
  assert.equal(kv.build_number, undefined);
});

test("non-numeric values are counted, not written", () => {
  const { kv, invalid, imported } = translateLegacySave({
    latest_world: 1011, junk: "nope", other: null,
  });
  assert.equal(kv.junk, undefined);
  assert.equal(kv.other, undefined);
  assert.equal(invalid, 2);
  assert.equal(imported, 1);
});

test("rejects input that isn't a SneakBit save", () => {
  assert.throws(() => translateLegacySave(null), /expected a JSON object/);
  assert.throws(() => translateLegacySave([1, 2]), /expected a JSON object/);
  assert.throws(() => translateLegacySave({}), /empty/);
  assert.throws(() => translateLegacySave({ build_number: 3 }), /no importable progress/);
});

test("legacySaveHasProgress distinguishes real progress from noise", () => {
  assert.equal(legacySaveHasProgress({ latest_zone: 1011 }), true);
  assert.equal(legacySaveHasProgress({ "item_collected.5": 1 }), true);
  assert.equal(legacySaveHasProgress({ "player.0.inventory.amount.7000": 3 }), true);
  assert.equal(legacySaveHasProgress({ "player.0.equipped.melee": 1159 }), false);
  assert.equal(legacySaveHasProgress({}), false);
  assert.equal(legacySaveHasProgress(null), false);
});

test("apply replaces the kv namespace rather than merging into it", () => {
  _resetStorageForTesting();
  setValue("latest_zone", 1001);
  setValue("dialogue.answer.only_in_this_build", 1);

  const { kv } = translateLegacySave(LEGACY);
  applyLegacySave(kv);

  assert.equal(getValue("latest_zone"), 1011, "imported value wins");
  assert.equal(getValue("dialogue.answer.only_in_this_build"), null,
    "progress absent from the imported save is cleared, not left behind");
  assert.equal(getValue("player.0.inventory.amount.7000"), 12);
});

test("importLegacySave takes raw file text", () => {
  _resetStorageForTesting();
  const stats = importLegacySave(JSON.stringify(LEGACY));
  assert.equal(getValue("latest_zone"), 1011);
  assert.ok(stats.imported > 10);
  assert.throws(() => importLegacySave("{not json"), /valid JSON/);
});

// — the one-shot decision ——————————————————————————————————————————————————

test("a fresh install with a legacy save imports it", () => {
  assert.equal(
    legacyImportDecision({ hasLocalSave: false, legacyHasProgress: true }),
    "import",
  );
});

test("a save in this build always wins over the old one", () => {
  assert.equal(
    legacyImportDecision({ hasLocalSave: true, legacyHasProgress: true }),
    "skip",
  );
});

test("nothing to import is a decision too", () => {
  // "skip" tells the caller to stamp the marker, so the boot stops looking.
  // That is what keeps a later New Game — which clears latest_zone and would
  // otherwise read as "no local save" — from resurrecting the old playthrough.
  assert.equal(
    legacyImportDecision({ hasLocalSave: false, legacyHasProgress: false }),
    "skip",
  );
  assert.equal(
    legacyImportDecision({ hasLocalSave: true, legacyHasProgress: false }),
    "skip",
  );
});

// — settings carried across ————————————————————————————————————————————————

test("desktop audio toggles come out of the save file itself", () => {
  // The old desktop build stored them inverted: 1 means disabled.
  const patch = legacySettingsPatch({
    "desktop_only.game_settings.music_disabled": 1,
    "desktop_only.game_settings.sound_effects_disabled": 0,
  }, null);
  assert.equal(patch.musicVolume, 0);
  assert.equal(patch.sfxVolume, undefined, "sfx was on; keep this build's default");
  assert.equal(patch.muted, false);
});

test("mobile audio toggles come from the shell's native prefs", () => {
  const patch = legacySettingsPatch({ latest_world: 1011 }, { sfx: false, music: true });
  assert.equal(patch.sfxVolume, 0);
  assert.equal(patch.musicVolume, undefined);
  assert.equal(patch.muted, false);
});

test("a player who had all sound off stays muted", () => {
  const patch = legacySettingsPatch({}, { sfx: false, music: false });
  assert.equal(patch.sfxVolume, 0);
  assert.equal(patch.musicVolume, 0);
  assert.equal(patch.muted, true);
});

test("a returning player with sound on gets unmuted", () => {
  // This build starts muted and firstLaunch.js persists that. Without the
  // explicit false, everyone importing a save would come back to silence.
  assert.equal(legacySettingsPatch({}, null).muted, false);
  assert.equal(legacySettingsPatch({}, { sfx: true, music: true }).muted, false);
});

test("language maps off the old enum", () => {
  assert.equal(legacySettingsPatch({ language: 0 }, null).language, "auto");
  assert.equal(legacySettingsPatch({ language: 1 }, null).language, "en");
  assert.equal(legacySettingsPatch({ language: 2 }, null).language, "it");
  assert.equal(legacySettingsPatch({ language: 9 }, null).language, undefined,
    "a language we don't ship leaves the setting alone");
  assert.equal(legacySettingsPatch({}, null).language, undefined);
});
