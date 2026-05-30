// turns.js — port of Rust turns.rs / turns_use_case.rs. Pure turn machine.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  TURN_DURATION, TURN_PREP_DURATION, TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE,
  MAX_PLAYERS, PLAYER1_INDEX,
  realTimeTurn, prepTurn, playerTurn, firstTurn, updatedTurn,
  turnAfterPlayerDamage, updatedTurnForDeathOfPlayer, handleWinLose,
  currentPlayerIndex,
} = await import("../js/turns.js?v=20260530e");

test("constants match the Rust core", () => {
  assert.equal(TURN_DURATION, 10.0);
  assert.equal(TURN_PREP_DURATION, 3.0);
  assert.equal(TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE, 2.0);
  assert.equal(MAX_PLAYERS, 4);
  assert.equal(PLAYER1_INDEX, 0);
});

test("firstTurn: pvp starts at P1 prep, otherwise realtime", () => {
  assert.deepEqual(firstTurn(true), prepTurn(0));
  assert.equal(firstTurn(false).kind, "realtime");
});

test("one-player match freezes the machine", () => {
  const t = playerTurn(0);
  assert.deepEqual(updatedTurn(t, 1, 100), t);
});

test("realtime never advances", () => {
  assert.deepEqual(updatedTurn(realTimeTurn(), 4, 999), realTimeTurn());
});

test("prep counts down then flips to the active turn", () => {
  let t = prepTurn(0);
  t = updatedTurn(t, 2, 1.0);
  assert.equal(t.kind, "prep");
  assert.ok(Math.abs(t.timeRemaining - 2.0) < 1e-9);
  t = updatedTurn(t, 2, 5.0); // overshoot
  assert.equal(t.kind, "player");
  assert.equal(t.playerIndex, 0);
  assert.equal(t.timeRemaining, TURN_DURATION);
});

test("active turn counts down then hands to next player's prep", () => {
  let t = playerTurn(0);
  t = updatedTurn(t, 2, 4.0);
  assert.equal(t.kind, "player");
  assert.ok(Math.abs(t.timeRemaining - 6.0) < 1e-9);
  t = updatedTurn(t, 2, 100); // expire
  assert.equal(t.kind, "prep");
  assert.equal(t.playerIndex, 1);
  assert.equal(t.timeRemaining, TURN_PREP_DURATION);
});

test("last player's turn wraps back to P1", () => {
  const t = updatedTurn(playerTurn(3), 4, 100);
  assert.equal(t.kind, "prep");
  assert.equal(t.playerIndex, 0);
});

test("hit-clamp: damaging an enemy cuts the turn to <=2s and flags it", () => {
  const t = turnAfterPlayerDamage(playerTurn(0), 1); // P0 hits P1
  assert.equal(t.timeRemaining, TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE);
  assert.equal(t.didReduce, true);
});

test("hit-clamp does not extend an already-short turn", () => {
  const short = { ...playerTurn(0), timeRemaining: 1.0 };
  const t = turnAfterPlayerDamage(short, 1);
  assert.equal(t.timeRemaining, 1.0);
  assert.equal(t.didReduce, true);
});

test("hit-clamp is a no-op for self-damage and during prep", () => {
  assert.deepEqual(turnAfterPlayerDamage(playerTurn(2), 2), playerTurn(2));
  assert.deepEqual(turnAfterPlayerDamage(prepTurn(0), 1), prepTurn(0));
});

test("active player's death skips to the next player's prep", () => {
  const next = updatedTurnForDeathOfPlayer(playerTurn(0), 2, 0);
  assert.ok(next);
  assert.equal(next.kind, "prep");
  assert.equal(next.playerIndex, 1);
});

test("death of a non-active player does not change the turn", () => {
  assert.equal(updatedTurnForDeathOfPlayer(playerTurn(0), 4, 2), null);
  assert.equal(updatedTurnForDeathOfPlayer(prepTurn(0), 4, 0), null);
});

test("handleWinLose pvp: resolves to the lone survivor", () => {
  assert.deepEqual(handleWinLose("pvp", 2, []), { kind: "inProgress" });
  assert.deepEqual(handleWinLose("pvp", 2, [0]), { kind: "winner", playerIndex: 1 });
  assert.deepEqual(handleWinLose("pvp", 4, [1, 2, 3]), { kind: "winner", playerIndex: 0 });
});

test("handleWinLose pvp: unknown winner on simultaneous wipe", () => {
  assert.deepEqual(handleWinLose("pvp", 2, [0, 1]), { kind: "unknown" });
});

test("handleWinLose coop: gameOver only when P1 dies", () => {
  assert.deepEqual(handleWinLose("coop", 2, [1]), { kind: "inProgress" });
  assert.deepEqual(handleWinLose("coop", 2, [0]), { kind: "gameOver" });
});

test("currentPlayerIndex: index during a turn, null during prep", () => {
  assert.equal(currentPlayerIndex(playerTurn(2)), 2);
  assert.equal(currentPlayerIndex(prepTurn(2)), null);
  assert.equal(currentPlayerIndex(realTimeTurn()), null);
});
