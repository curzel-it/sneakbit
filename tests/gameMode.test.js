// gameMode.js — runtime coop/creative/pvp flag mirroring Rust's GameMode.

import { test } from "node:test";
import assert from "node:assert/strict";

const { GAME_MODE, PVP_PLAYER_HP, getGameMode, setGameMode, isPvp, pvpPlayerHp } =
  await import("../js/gameMode.js");

test("defaults to coop, not pvp", () => {
  setGameMode(GAME_MODE.coop);
  assert.equal(getGameMode(), "coop");
  assert.equal(isPvp(), false);
});

test("setGameMode switches to pvp and back", () => {
  setGameMode(GAME_MODE.pvp);
  assert.equal(getGameMode(), "pvp");
  assert.equal(isPvp(), true);
  setGameMode(GAME_MODE.coop);
  assert.equal(isPvp(), false);
});

test("setGameMode ignores unknown values", () => {
  setGameMode(GAME_MODE.pvp);
  setGameMode("bogus");
  assert.equal(getGameMode(), "pvp");
  setGameMode(GAME_MODE.coop);
});

test("pvp player hp is 1000", () => {
  assert.equal(PVP_PLAYER_HP, 1000);
  assert.equal(pvpPlayerHp(), 1000);
});
