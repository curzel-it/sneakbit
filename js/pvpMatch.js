// PvP match logic: owns the live player count, the dead-player set, and the
// match result. Pure-ish — it holds match state and resolves last-player-
// standing, but never touches the world, DOM, or player positions (the
// controllers do that). This keeps the win/lose rules unit-testable and lets
// shooting/melee/main consult the same source of truth for "is the match over."
//
// PvP is realtime: every player acts at once. There is no turn machine — a
// match ends when all but one player is dead.

import { isPvp } from "./gameMode.js";
import { resetPvpLoadout } from "./pvpLoadout.js";

let numberOfPlayers = 1;
let dead = new Set();
let result = { kind: "inProgress" };

function inProgress() {
  return result.kind === "inProgress";
}

// Rust `handle_win_lose` (PvP arm). A winner emerges once all but one player
// is dead; UnknownWinner if none survive (simultaneous death). N clamped to a
// sane range by the caller.
function computeResult(deadPlayers, n) {
  if (deadPlayers.length < n - 1) return { kind: "inProgress" };
  for (let i = 0; i < n; i++) {
    if (!deadPlayers.includes(i)) return { kind: "winner", playerIndex: i };
  }
  return { kind: "unknown" };
}

// Begin a fresh N-player match: nobody dead, in progress. Caller (controller)
// handles spawns and HP. N clamped to a sane range.
export function startMatch(n) {
  numberOfPlayers = Math.max(2, Math.min(4, n | 0));
  dead = new Set();
  result = { kind: "inProgress" };
  resetPvpLoadout();
  return result;
}

// Re-arm the same N players for another round (Rust revive()).
export function rematch() {
  return startMatch(numberOfPlayers);
}

// Tear the match down when leaving PvP so stale result/death values don't
// linger past exit.
export function endMatch() {
  numberOfPlayers = 1;
  dead = new Set();
  result = { kind: "inProgress" };
  resetPvpLoadout();
}

// Record a player's death, then recompute win/lose. Returns the (possibly
// terminal) match result. Idempotent per index so a per-frame caller can
// call it freely.
export function notifyPlayerDied(index) {
  const i = index | 0;
  if (dead.has(i)) return result;
  dead.add(i);
  result = computeResult([...dead], numberOfPlayers);
  return result;
}

export function getMatchResult() { return result; }
export function isMatchOver()    { return result.kind === "winner" || result.kind === "unknown"; }
export function playerCount()    { return numberOfPlayers; }

// Input gate: a 1-based input slot may act unless the match is over. Outside
// PvP (co-op/creative) everyone always acts. Freezing on match-over stops
// post-match combat while the result screen is up (the online host isn't
// paused, so combat would otherwise keep ticking).
export function pvpSlotCanAct(_slotOneBased) {
  return !isPvp() || !isMatchOver();
}
