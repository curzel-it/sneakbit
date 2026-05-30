// PvP match logic — turn ownership, death/win-lose, input gating.

import { test } from "node:test";
import assert from "node:assert/strict";

const { setGameMode, GAME_MODE } = await import("../js/gameMode.js?v=20260530a");
const {
  startMatch, rematch, endMatch, tickMatch, notifyPlayerDied, getTurn, getMatchResult,
  isMatchOver, currentLiveIndex, cameraPlayerIndex, pvpSlotCanAct, playerCount,
} = await import("../js/pvpMatch.js?v=20260530a");

test("startMatch begins at P1 prep, nobody dead, in progress", () => {
  startMatch(2);
  assert.equal(getTurn().kind, "prep");
  assert.equal(getTurn().playerIndex, 0);
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

test("prep has no live slot; camera still tracks the upcoming player", () => {
  startMatch(2);
  assert.equal(currentLiveIndex(), null);
  assert.equal(cameraPlayerIndex(), 0);
});

test("input gating: only the active player's slot acts, and only mid-turn", () => {
  setGameMode(GAME_MODE.pvp);
  startMatch(2);
  // During prep nobody can act.
  assert.equal(pvpSlotCanAct(1), false);
  assert.equal(pvpSlotCanAct(2), false);
  // Run out the 3s prep → P1 (slot 1) is live.
  tickMatch(3);
  assert.equal(getTurn().kind, "player");
  assert.equal(currentLiveIndex(), 0);
  assert.equal(pvpSlotCanAct(1), true);
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

test("active player's death skips their turn", () => {
  startMatch(4);
  tickMatch(3); // prep → P1 active
  assert.equal(getTurn().kind, "player");
  notifyPlayerDied(0); // active player dies
  assert.equal(getTurn().kind, "prep");
  assert.equal(getTurn().playerIndex, 1);
});

test("tickMatch freezes once the match is over", () => {
  startMatch(2);
  notifyPlayerDied(1); // P0 wins
  const before = getTurn();
  tickMatch(100);
  assert.deepEqual(getTurn(), before);
});

test("realtime match has no turn but still tracks deaths + win/lose", () => {
  startMatch(2, false); // realtime variant
  assert.equal(getTurn().kind, "realtime", "no prep/turn in realtime");
  assert.equal(currentLiveIndex(), null);
  assert.equal(cameraPlayerIndex(), null);
  // tick does nothing to the turn, but a death still resolves the match
  tickMatch(100);
  assert.equal(getTurn().kind, "realtime");
  assert.deepEqual(notifyPlayerDied(1), { kind: "winner", playerIndex: 0 });
});

test("endMatch parks the machine in realtime (no stale turn after exit)", () => {
  startMatch(3);
  tickMatch(3); // into P1's active turn
  assert.equal(getTurn().kind, "player");
  endMatch();
  assert.equal(getTurn().kind, "realtime");
  assert.equal(currentLiveIndex(), null);
  assert.equal(cameraPlayerIndex(), null);
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
  assert.equal(getTurn().kind, "prep");
});
