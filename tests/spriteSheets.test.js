// Every sprite_sheet_id the shipped species data references must be mapped
// to an asset name (species.js SHEET_NAMES) that assets.js actually loads.
//
// Regression: sheets 1021 (tentacles) and 1018 (2x3 humanoids) were used by
// shipped species but missing from both maps, so getEntitySheet returned null
// and those entities — the 1009 tentacles, the demon lord, the goddess — drew
// nothing at all. No error, no log; they were simply invisible.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sheetNameFor } from "../js/species.js";
import { spriteNames } from "../js/assets.js";

const species = JSON.parse(
  readFileSync(new URL("../data/species.json", import.meta.url), "utf8"),
);

// Tile sheets are composed at runtime (biomeSheet.js) rather than loaded by
// name, and the blank sheet is the deliberate "draws nothing" placeholder.
const SHEET_BLANK = 1000;
const SHEET_BIOME_TILES = 1002;
const SHEET_CONSTRUCTION_TILES = 1003;
const NOT_LOADED_BY_NAME = new Set([SHEET_BLANK, SHEET_BIOME_TILES, SHEET_CONSTRUCTION_TILES]);

test("every species sprite sheet is mapped and loadable", () => {
  const loadable = new Set(spriteNames());
  const seen = new Set();
  for (const sp of species) {
    const id = sp.sprite_sheet_id;
    if (id == null || NOT_LOADED_BY_NAME.has(id) || seen.has(id)) continue;
    seen.add(id);
    const name = sheetNameFor(id);
    assert.ok(name, `sprite_sheet_id ${id} (e.g. species ${sp.id} "${sp.name}") has no asset name`);
    assert.ok(loadable.has(name), `sheet ${id} maps to "${name}", which assets.js never loads`);
  }
  assert.ok(seen.size > 5, "sanity: the sweep actually saw sheets");
});
