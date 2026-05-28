import { test } from "node:test";
import assert from "node:assert/strict";
import { BIOME } from "../js/biomes.js?v=20260528b";
import { biomeTextureCol, NUM_COMBOS } from "../js/biomeTiles.js?v=20260528b";

const N = BIOME.NOTHING;

test("uniform tile (all same neighbors) renders the pure base", () => {
  const c = biomeTextureCol(BIOME.GRASS, BIOME.GRASS, BIOME.GRASS, BIOME.GRASS, BIOME.GRASS);
  assert.equal(c, 0);
});

test("light grass always renders filled (no border)", () => {
  const c = biomeTextureCol(BIOME.GRASS, BIOME.ROCK, BIOME.ROCK, BIOME.ROCK, BIOME.ROCK);
  assert.equal(c, 0);
});

test("liquid self renders filled even with grass next door", () => {
  const c = biomeTextureCol(BIOME.WATER, BIOME.GRASS, BIOME.GRASS, BIOME.GRASS, BIOME.GRASS);
  assert.equal(c, 0);
});

test("neighbor of nothing draws filled (no border into the void)", () => {
  const c = biomeTextureCol(BIOME.DESERT, N, N, N, N);
  assert.equal(c, 0);
});

test("desert with water on the up side picks the liquid overlay", () => {
  // self=desert, up=water, others=desert. Best neighbor = water on UP only.
  const c = biomeTextureCol(BIOME.DESERT, BIOME.WATER, BIOME.DESERT, BIOME.DESERT, BIOME.DESERT);
  // overlap = water(0) * NUM_COMBOS + combo(UP=0) + 1 = 1
  assert.equal(c, BIOME.WATER * NUM_COMBOS + 0 + 1);
});

test("desert surrounded by water picks combo 12 (all four)", () => {
  const c = biomeTextureCol(BIOME.DESERT, BIOME.WATER, BIOME.WATER, BIOME.WATER, BIOME.WATER);
  // overlap = water * NUM_COMBOS + combo(all=12) + 1
  assert.equal(c, BIOME.WATER * NUM_COMBOS + 12 + 1);
});

test("snow on rock — rock wins, but pair is in the filled list", () => {
  // self=rock, up=snow → would normally overlap, but (Rock, Snow) is filled.
  const c = biomeTextureCol(BIOME.ROCK, BIOME.SNOW, BIOME.ROCK, BIOME.ROCK, BIOME.ROCK);
  assert.equal(c, 0);
});

test("dark sand vs snow → filled (paired)", () => {
  const c = biomeTextureCol(BIOME.DARK_SAND, BIOME.SNOW, BIOME.SNOW, BIOME.SNOW, BIOME.SNOW);
  assert.equal(c, 0);
});

test("water on the right of desert chooses combo 1 (RIGHT)", () => {
  const c = biomeTextureCol(BIOME.DESERT, BIOME.DESERT, BIOME.WATER, BIOME.DESERT, BIOME.DESERT);
  assert.equal(c, BIOME.WATER * NUM_COMBOS + 1 + 1);
});
