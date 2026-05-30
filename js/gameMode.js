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
// PvP has two delivery variants that share all the PvP knobs (1000 HP, forced
// friendly fire, scavenge): the local TURN-BASED arena, and an online REALTIME
// deathmatch where everyone acts at once. `realtime` distinguishes them; it's
// only meaningful while the mode is pvp.
let realtime = false;
// Host-local freeze for the Online PvP setup phase: true while the host is
// sending out invite links, before clicking "Start match". Cleared when the
// match starts or the session ends. Never broadcast to guests.
let pvpHostSetup = false;

export function setPvpHostSetup(active) {
  pvpHostSetup = !!active;
}

export function isPvpHostSetup() {
  return pvpHostSetup;
}

export function getGameMode() {
  return current;
}

// setGameMode("pvp", { realtime: true }) selects the realtime variant. The flag
// is cleared whenever we leave pvp (or enter turn-based pvp) so it can't leak.
export function setGameMode(mode, opts = {}) {
  if (mode === GAME_MODE.coop || mode === GAME_MODE.creative || mode === GAME_MODE.pvp) {
    current = mode;
    realtime = mode === GAME_MODE.pvp ? !!opts.realtime : false;
  }
  return current;
}

// Rust `allows_pvp()` — true for both PvP variants (drives 1000 HP, FF, scavenge).
export function isPvp() {
  return current === GAME_MODE.pvp;
}

// Online realtime deathmatch: no turns, every player acts simultaneously.
export function isRealtimePvp() {
  return current === GAME_MODE.pvp && realtime;
}

// Local turn-based arena: the turn machine + per-turn input gating + turn HUD.
export function isTurnBasedPvp() {
  return current === GAME_MODE.pvp && !realtime;
}

// Rust `player_hp()`.
export function pvpPlayerHp() {
  return PVP_PLAYER_HP;
}
