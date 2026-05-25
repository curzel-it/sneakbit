import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BIOME,
  biomeFromChar,
  biomeIsObstacle,
  biomeIsSame,
  isLiquid,
  isLightGrass,
} from "../js/biomes.js";

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
