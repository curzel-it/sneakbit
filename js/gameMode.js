// The active game mode — the port's mirror of Rust's `GameMode` enum
// (game_core/src/multiplayer/modes.rs). It is the single in-memory source
// of truth other features consult to gate PvP behavior: forced friendly
// fire (combat.js), 1000-HP players (playerHealth.js), turn-gated input
// and a current-player camera (main.js / pvpMatch.js).
//
// Leaf module: no imports, so health/combat can depend on it without
// cycles. Creative mode is still owned by creativeMode.js (a URL flag);
// this module only tracks coop-vs-pvp at runtime and defaults to coop.

export const GAME_MODE = {
  coop: "coop",       // RealTimeCoOp — the normal game
  creative: "creative",
  pvp: "pvp",         // TurnBasedPvp
};

// Rust: GameMode::TurnBasedPvp.player_hp() == 1000 (vs 100 elsewhere).
export const PVP_PLAYER_HP = 1000;

let current = GAME_MODE.coop;

export function getGameMode() {
  return current;
}

export function setGameMode(mode) {
  if (mode === GAME_MODE.coop || mode === GAME_MODE.creative || mode === GAME_MODE.pvp) {
    current = mode;
  }
  return current;
}

// Rust `allows_pvp()` / `is_turn_based()` — both true only for TurnBasedPvp.
export function isPvp() {
  return current === GAME_MODE.pvp;
}

// Rust `player_hp()`.
export function pvpPlayerHp() {
  return PVP_PLAYER_HP;
}
