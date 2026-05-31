// gameMode.js — runtime coop/creative/pvp flag mirroring Rust's GameMode.

import { test } from "node:test";
import assert from "node:assert/strict";

const { GAME_MODE, PVP_PLAYER_HP, getGameMode, setGameMode, isPvp, isRealtimePvp, isTurnBasedPvp, pvpPlayerHp } =
  await import("../js/gameMode.js?v=20260531b");

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

test("pvp defaults to turn-based; realtime flag opts into the realtime variant", () => {
  setGameMode(GAME_MODE.pvp);
  assert.equal(isPvp(), true);
  assert.equal(isTurnBasedPvp(), true);
  assert.equal(isRealtimePvp(), false);

  setGameMode(GAME_MODE.pvp, { realtime: true });
  assert.equal(isPvp(), true, "both variants are PvP (1000 HP / FF / scavenge)");
  assert.equal(isRealtimePvp(), true);
  assert.equal(isTurnBasedPvp(), false);
  setGameMode(GAME_MODE.coop);
});

test("realtime flag is cleared when leaving pvp", () => {
  setGameMode(GAME_MODE.pvp, { realtime: true });
  assert.equal(isRealtimePvp(), true);
  setGameMode(GAME_MODE.coop);
  assert.equal(isRealtimePvp(), false);
  setGameMode(GAME_MODE.pvp); // turn-based, no opts → flag stays cleared
  assert.equal(isRealtimePvp(), false);
  assert.equal(isTurnBasedPvp(), true);
  setGameMode(GAME_MODE.coop);
});
