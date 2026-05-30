import { test } from "node:test";
import assert from "node:assert/strict";
import { CONSTRUCTION } from "../js/constructions.js?v=20260530b";
import { constructionTextureRow } from "../js/constructionTiles.js?v=20260530b";

const ANY = CONSTRUCTION.NOTHING;

test("isolated tile (no same neighbors) → row 1 (single)", () => {
  assert.equal(constructionTextureRow(CONSTRUCTION.FOREST, ANY, ANY, ANY, ANY), 1);
});

test("fully surrounded → row 15 (interior)", () => {
  const F = CONSTRUCTION.FOREST;
  assert.equal(constructionTextureRow(F, F, F, F, F), 15);
});

test("same left + right only → row 0 (horizontal middle)", () => {
  const F = CONSTRUCTION.FOREST;
  assert.equal(constructionTextureRow(F, ANY, F, ANY, F), 0);
});

test("same up + down only → row 4 (vertical middle)", () => {
  const F = CONSTRUCTION.FOREST;
  assert.equal(constructionTextureRow(F, F, ANY, F, ANY), 4);
});

test("same left only → row 2 (right end)", () => {
  const F = CONSTRUCTION.FOREST;
  assert.equal(constructionTextureRow(F, ANY, ANY, ANY, F), 2);
});

test("same right only → row 3 (left end)", () => {
  const F = CONSTRUCTION.FOREST;
  assert.equal(constructionTextureRow(F, ANY, F, ANY, ANY), 3);
});
