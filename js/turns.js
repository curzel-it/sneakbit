// Turn machine for turn-based PvP — a faithful port of
// game_core/src/multiplayer/turns.rs + turns_use_case.rs. Pure: every
// function takes the current turn (and counts) and returns the next one,
// no I/O and no module state, so it mirrors the Rust unit tests directly.
// pvpMatch.js owns the live turn value and drives this each frame.
//
// A turn is a tagged object:
//   { kind: "realtime" }                              // co-op only, never advances
//   { kind: "prep",   playerIndex, timeRemaining, didReduce }
//   { kind: "player", playerIndex, timeRemaining, didReduce }
// `didReduce` mirrors `did_reduce_due_to_ranged_weapon_usage`.

// Constants — game_core/src/constants.rs.
export const TURN_DURATION = 10.0;
export const TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE = 2.0;
export const TURN_PREP_DURATION = 3.0;
export const MAX_PLAYERS = 4;
export const PLAYER1_INDEX = 0;

export function realTimeTurn() {
  return { kind: "realtime" };
}

export function prepTurn(playerIndex) {
  return { kind: "prep", playerIndex, timeRemaining: TURN_PREP_DURATION, didReduce: false };
}

export function playerTurn(playerIndex) {
  return { kind: "player", playerIndex, timeRemaining: TURN_DURATION, didReduce: false };
}

// Rust `TurnsUseCase::first_turn`. `pvp` true → start with P1's prep,
// otherwise the real-time (co-op/creative) turn that never advances.
export function firstTurn(pvp) {
  return pvp ? prepTurn(PLAYER1_INDEX) : realTimeTurn();
}

// Rust `TurnsUseCase::updated_turn`. Counts the active timer down; flips
// prep→player at zero and player→next-player's-prep at zero, wrapping
// last→P1. NOTE (matches Rust): rotation does NOT skip dead players — a
// dead slot still gets an idle prep+turn. The active player's *own* death
// is the only early skip, handled by updatedTurnForDeathOfPlayer.
export function updatedTurn(turn, numberOfPlayers, dt) {
  // A one-player match freezes the machine (Rust early-return).
  if (numberOfPlayers === 1) return turn;

  if (turn.kind === "realtime") return turn;

  const timeLeft = turn.timeRemaining - dt;

  if (turn.kind === "prep") {
    if (timeLeft <= 0) return playerTurn(turn.playerIndex);
    return { ...turn, timeRemaining: timeLeft };
  }

  // kind === "player"
  if (timeLeft <= 0) {
    const next = turn.playerIndex === numberOfPlayers - 1 ? PLAYER1_INDEX : turn.playerIndex + 1;
    return prepTurn(next);
  }
  return { ...turn, timeRemaining: timeLeft };
}

// Rust `update_turn_after_player_damage` — the hit-and-the-clock-cuts
// rule. When the active player damages a *different* player, clamp the
// turn to ≤2s and flag the reduction. No-op during prep/realtime or when
// you only hit yourself.
export function turnAfterPlayerDamage(turn, damagedPlayer) {
  if (turn.kind !== "player") return turn;
  if (turn.playerIndex === damagedPlayer) return turn;
  return {
    ...turn,
    timeRemaining: Math.min(turn.timeRemaining, TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE),
    didReduce: true,
  };
}

// Rust `updated_turn_for_death_of_player`. If the player who just died was
// the active one, advance past the corpse (Rust uses dt = TURN_DURATION*2
// to guarantee the timer hits zero). Returns the next turn, or null when
// nothing should change (the dead player wasn't acting).
export function updatedTurnForDeathOfPlayer(turn, numberOfPlayers, deadPlayerIndex) {
  if (turn.kind !== "player") return null;
  if (turn.playerIndex !== deadPlayerIndex) return null;
  return updatedTurn(turn, numberOfPlayers, TURN_DURATION * 2.0);
}

// Rust `handle_win_lose`. `mode` is a GAME_MODE string. PvP resolves to a
// winner once all but one player is dead (UnknownWinner if none survive,
// e.g. simultaneous death). Co-op only produces GameOver when P1 dies.
// Returns { kind: "winner"|"unknown"|"gameOver"|"inProgress", playerIndex? }.
export function handleWinLose(mode, numberOfPlayers, deadPlayers) {
  if (mode === "pvp") {
    if (deadPlayers.length >= numberOfPlayers - 1) {
      for (let i = 0; i < numberOfPlayers; i++) {
        if (!deadPlayers.includes(i)) return { kind: "winner", playerIndex: i };
      }
      return { kind: "unknown" };
    }
    return { kind: "inProgress" };
  }
  if (mode === "coop") {
    return deadPlayers.includes(PLAYER1_INDEX) ? { kind: "gameOver" } : { kind: "inProgress" };
  }
  return { kind: "inProgress" }; // creative
}

// The slot whose input is live this frame: the active player during a
// `player` turn, null during prep/realtime (Rust `currently_active_players`
// returns [] during prep — the "where's the controller?!" pause).
export function currentPlayerIndex(turn) {
  return turn && turn.kind === "player" ? turn.playerIndex : null;
}
