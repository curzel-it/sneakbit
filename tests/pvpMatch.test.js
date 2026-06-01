// PvP match logic — death tracking, last-player-standing win/lose, input
// gating. PvP is realtime: everyone acts at once, no turns.

import { test } from "node:test";
import assert from "node:assert/strict";

const { setGameMode, GAME_MODE } = await import("../js/gameMode.js");
const {
  startMatch, rematch, endMatch, notifyPlayerDied, getMatchResult,
  isMatchOver, pvpSlotCanAct, playerCount,
} = await import("../js/pvpMatch.js");

test("startMatch begins with nobody dead, in progress", () => {
  startMatch(2);
  assert.equal(playerCount(), 2);
  assert.deepEqual(getMatchResult(), { kind: "inProgress" });
  assert.equal(isMatchOver(), false);
});

test("startMatch clamps player count to 2..4", () => {
  startMatch(1);
  assert.equal(playerCount(), 2);
  startMatch(9);
  assert.equal(playerCount(), 4);
});

test("input gating: everyone acts while the match is live, frozen once it's over", () => {
  setGameMode(GAME_MODE.pvp);
  startMatch(2);
  assert.equal(pvpSlotCanAct(1), true);
  assert.equal(pvpSlotCanAct(2), true);
  notifyPlayerDied(1); // P0 wins → match over
  assert.equal(pvpSlotCanAct(1), false);
  assert.equal(pvpSlotCanAct(2), false);
  setGameMode(GAME_MODE.coop);
});

test("outside PvP every slot can act", () => {
  setGameMode(GAME_MODE.coop);
  startMatch(2);
  assert.equal(pvpSlotCanAct(1), true);
  assert.equal(pvpSlotCanAct(2), true);
});

test("death of the lone opponent ends the match with a winner", () => {
  startMatch(2);
  const r = notifyPlayerDied(1);
  assert.deepEqual(r, { kind: "winner", playerIndex: 0 });
  assert.equal(isMatchOver(), true);
});

test("notifyPlayerDied is idempotent per index", () => {
  startMatch(4);
  notifyPlayerDied(2);
  const r = notifyPlayerDied(2);
  assert.deepEqual(r, { kind: "inProgress" }); // 4-player, one death = still going
});

test("4-player match resolves to the last survivor", () => {
  startMatch(4);
  notifyPlayerDied(0);
  notifyPlayerDied(2);
  assert.equal(isMatchOver(), false);
  const r = notifyPlayerDied(3); // only P1 (index 1) left
  assert.deepEqual(r, { kind: "winner", playerIndex: 1 });
});

test("simultaneous total wipe resolves to unknown winner", () => {
  startMatch(2);
  notifyPlayerDied(0);
  const r = notifyPlayerDied(1);
  assert.deepEqual(r, { kind: "unknown" });
  assert.equal(isMatchOver(), true);
});

test("endMatch clears stale result after exit", () => {
  startMatch(3);
  notifyPlayerDied(1);
  notifyPlayerDied(2);
  assert.equal(isMatchOver(), true);
  endMatch();
  assert.equal(playerCount(), 1);
  assert.deepEqual(getMatchResult(), { kind: "inProgress" });
});

test("rematch re-arms the same player count", () => {
  startMatch(3);
  notifyPlayerDied(1);
  notifyPlayerDied(2);
  assert.equal(isMatchOver(), true);
  rematch();
  assert.equal(playerCount(), 3);
  assert.deepEqual(getMatchResult(), { kind: "inProgress" });
});
