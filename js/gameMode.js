// The active game mode — the port's mirror of Rust's `GameMode` enum
// (game_core/src/multiplayer/modes.rs). It is the single in-memory source
// of truth other features consult to gate PvP behavior: forced friendly
// fire (combat.js), 1000-HP players (playerHealth.js) and a last-player-
// standing match (pvpMatch.js).
//
// Leaf module: no imports, so health/combat can depend on it without
// cycles. Creative mode is still owned by creativeMode.js (a URL flag);
// this module only tracks coop-vs-pvp at runtime and defaults to coop.

export const GAME_MODE = {
  coop: "coop",       // RealTimeCoOp — the normal game
  creative: "creative",
  pvp: "pvp",         // realtime deathmatch (local or online)
  td: "td",           // tower defense — solo/offline squad defense (?mode=td)
};

// Rust: GameMode PvP.player_hp() == 1000 (vs 100 elsewhere).
export const PVP_PLAYER_HP = 1000;

let current = GAME_MODE.coop;
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

export function setGameMode(mode) {
  if (mode === GAME_MODE.coop || mode === GAME_MODE.creative ||
      mode === GAME_MODE.pvp || mode === GAME_MODE.td) {
    current = mode;
  }
  return current;
}

// Rust `allows_pvp()` — drives 1000 HP, forced friendly fire, scavenge, and
// last-player-standing win/lose. PvP is always realtime: everyone acts at once.
export function isPvp() {
  return current === GAME_MODE.pvp;
}

// Rust `player_hp()`.
export function pvpPlayerHp() {
  return PVP_PLAYER_HP;
}

// Tower Defense — a solo/offline squad-defense run reached via ?mode=td (or
// the party panel's Tower Defense button). Like PvP it's an additive,
// transient mode: every TD-only branch is gated behind this getter so the
// normal game / co-op / creative paths are untouched when it's absent.
export function isTowerDefenseMode() {
  return current === GAME_MODE.td;
}
