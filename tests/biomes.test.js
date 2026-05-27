import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIOME,
  biomeFromChar,
  biomeToChar,
  biomeIsObstacle,
  biomeIsSame,
  isLiquid,
  isLightGrass,
} from "../js/biomes.js?v=20260527";

test("biomeFromChar maps known chars", () => {
  assert.equal(biomeFromChar("0"), BIOME.NOTHING);
  assert.equal(biomeFromChar("1"), BIOME.GRASS);
  assert.equal(biomeFromChar("2"), BIOME.WATER);
  assert.equal(biomeFromChar("G"), BIOME.LAVA);
  assert.equal(biomeFromChar("J"), BIOME.DARK_WATER);
});

test("biomeFromChar falls back to NOTHING", () => {
  assert.equal(biomeFromChar("?"), BIOME.NOTHING);
  assert.equal(biomeFromChar(""), BIOME.NOTHING);
});

test("isLiquid recognises water/lava/darkwater", () => {
  assert.equal(isLiquid(BIOME.WATER), true);
  assert.equal(isLiquid(BIOME.DARK_WATER), true);
  assert.equal(isLiquid(BIOME.LAVA), true);
  assert.equal(isLiquid(BIOME.GRASS), false);
  assert.equal(isLiquid(BIOME.SAND_PLATES), false);
});

test("biomeIsObstacle blocks water, lava, dark water, nothing", () => {
  for (const b of [BIOME.WATER, BIOME.LAVA, BIOME.DARK_WATER, BIOME.NOTHING]) {
    assert.equal(biomeIsObstacle(b), true, `expected obstacle: ${b}`);
  }
  for (const b of [BIOME.GRASS, BIOME.DESERT, BIOME.ROCK, BIOME.SNOW]) {
    assert.equal(biomeIsObstacle(b), false, `expected walkable: ${b}`);
  }
});

test("biomeIsSame treats only grass as the light-grass equivalence class", () => {
  assert.equal(biomeIsSame(BIOME.GRASS, BIOME.GRASS), true);
  assert.equal(biomeIsSame(BIOME.GRASS, BIOME.DARK_GRASS), false);
  assert.equal(isLightGrass(BIOME.GRASS), true);
  assert.equal(isLightGrass(BIOME.DARK_GRASS), false);
});

test("biomeToChar round-trips with biomeFromChar for every char in the table", () => {
  // The creative-mode map editor depends on this round-trip: it reads a
  // char from raw.biome_tiles.tiles[r][c], translates to an enum id, and
  // later writes the chosen biome back as a char into the same string.
  const chars = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9",
                 "A", "B", "G", "H", "J", "K", "L"];
  for (const ch of chars) {
    const id = biomeFromChar(ch);
    assert.equal(biomeToChar(id), ch, `${ch} → ${id} → expected ${ch}`);
  }
});
