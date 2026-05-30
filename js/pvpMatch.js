// PvP match logic: owns the live turn, the dead-player set, and the match
// result. Pure-ish — it holds match state and drives turns.js, but never
// touches the world, DOM, or player positions (main.js does that). This
// keeps the turn/win-lose rules unit-testable and lets shooting/melee/main
// consult the same source of truth for "whose turn is it."
//
// It subscribes to combat.js's player-vs-player hit event to apply the
// "hit and the clock cuts" clamp, so the gameplay coupling stays one-way
// (combat emits; pvpMatch reacts) with no circular import.

import {
  firstTurn, updatedTurn, turnAfterPlayerDamage, updatedTurnForDeathOfPlayer,
  handleWinLose, currentPlayerIndex,
} from "./turns.js?v=20260530d";
import { isPvp, isTurnBasedPvp, isRealtimePvp } from "./gameMode.js?v=20260530d";
import { onPlayerVsPlayerHit } from "./combat.js?v=20260530d";
import { resetPvpLoadout } from "./pvpLoadout.js?v=20260530d";

let numberOfPlayers = 1;
let turn = firstTurn(false);              // realtime until a match starts
let dead = new Set();
let result = { kind: "inProgress" };
let matchTurnBased = true;                // remembered so rematch re-arms the same way

function inProgress() {
  return result.kind === "inProgress";
}

// Begin a fresh N-player match, nobody dead, in progress. Turn-based starts on
// P1's prep; realtime (turnBased=false) has no turn — everyone acts at once.
// Caller (controller) handles spawns and HP. N clamped to a sane range.
export function startMatch(n, turnBased = true) {
  numberOfPlayers = Math.max(2, Math.min(4, n | 0));
  matchTurnBased = !!turnBased;
  turn = firstTurn(matchTurnBased);
  dead = new Set();
  result = { kind: "inProgress" };
  resetPvpLoadout();
  return result;
}

// Re-arm the same N players for another round (Rust revive()), same variant.
export function rematch() {
  return startMatch(numberOfPlayers, matchTurnBased);
}

// Tear the match down when leaving PvP: park the machine in realtime and
// clear ammo/loadout so stale turn/result/ammo values don't linger past exit.
export function endMatch() {
  numberOfPlayers = 1;
  turn = firstTurn(false);
  dead = new Set();
  result = { kind: "inProgress" };
  resetPvpLoadout();
}

// Advance the countdowns one frame. No-op once the match has resolved so
// the winner screen's countdown doesn't keep rotating turns.
export function tickMatch(dt) {
  if (!inProgress()) return;
  turn = updatedTurn(turn, numberOfPlayers, dt);
}

// Record a player's death: skip the corpse's turn if it was active, then
// recompute win/lose. Returns the (possibly terminal) match result.
// Idempotent per index so a per-frame caller can call it freely.
export function notifyPlayerDied(index) {
  const i = index | 0;
  if (dead.has(i)) return result;
  dead.add(i);
  const next = updatedTurnForDeathOfPlayer(turn, numberOfPlayers, i);
  if (next) turn = next;
  result = handleWinLose("pvp", numberOfPlayers, [...dead]);
  return result;
}

export function getTurn()        { return turn; }
export function getMatchResult() { return result; }
export function isMatchOver()    { return result.kind === "winner" || result.kind === "unknown"; }
export function playerCount()    { return numberOfPlayers; }

// The slot whose movement/actions are live this frame (0-based), or null
// during prep / when no match is running.
export function currentLiveIndex() {
  return currentPlayerIndex(turn);
}

// Who the camera follows: the active player during a turn, or the upcoming
// player during prep (so the "Player X's turn in…" banner matches what's
// centred). Null outside a turn-based match.
export function cameraPlayerIndex() {
  return turn && turn.kind !== "realtime" ? turn.playerIndex : null;
}

// Input gate: a 1-based input slot may act when we're not in turn-based PvP
// (co-op and realtime PvP let everyone act), or when it owns the current active
// turn. During prep nobody acts. Realtime freezes everyone once the match is
// over (the online host isn't paused, so this stops post-match combat).
export function pvpSlotCanAct(slotOneBased) {
  if (isRealtimePvp()) return !isMatchOver();
  if (!isTurnBasedPvp()) return true;
  const live = currentLiveIndex();
  return live !== null && (slotOneBased | 0) - 1 === live;
}

// A landed enemy hit clamps the shooter's (active) turn to ≤2s. The active
// player is the shooter; we clamp when the victim isn't the active player.
onPlayerVsPlayerHit((victimIdx) => {
  if (!isPvp() || !inProgress()) return;
  turn = turnAfterPlayerDamage(turn, victimIdx | 0);
});
