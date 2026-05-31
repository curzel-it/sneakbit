// Local PvP controller: owns the match lifecycle and the per-frame PvP
// glue that the main loop calls into. Split out of main.js so the entry
// file stays a loop and PvP is one feature in one file (per CLAUDE.md).
//
// It reaches the live game state through the `getState` accessor wired in
// at install time (same pattern as installShooting/installInteract), and
// the one piece of main-owned machinery it needs — setLocalPlayers, which
// spawns/despawns local avatars — is injected the same way, so there's no
// import back into main.js.

import { updateCamera, panCameraTo } from "./camera.js?v=20260531b";
import { travelTo, fadeOverlayIn } from "./transitions.js?v=20260531b";
import { cornerSpawnTile, placePvpPlayer } from "./pvpSpawn.js?v=20260531b";
import { resetPlayerHealth, isPlayerDead, getPlayerHp, setPlayerHp } from "./playerHealth.js?v=20260531b";
import { setGameMode, getGameMode, GAME_MODE, isPvp } from "./gameMode.js?v=20260531b";
import { showToast } from "./toast.js?v=20260531b";
import { tr } from "./strings.js?v=20260531b";
import { showMatchResult, isGameOverOpen } from "./gameOver.js?v=20260531b";
import { hideTurnHud } from "./turnHud.js?v=20260531b";
import { refreshHealthHud } from "./healthHud.js?v=20260531b";
import { getRuntimeRole } from "./onlineMode.js?v=20260531b";
import { tryShootForSlot } from "./shooting.js?v=20260531b";
import {
  startMatch as startPvpLogic, rematch as rematchPvpLogic, tickMatch as tickPvpMatch,
  endMatch as endPvpMatch, notifyPlayerDied, cameraPlayerIndex, getMatchResult,
  isMatchOver, playerCount as pvpPlayerCount, getTurn, pvpSlotCanAct,
} from "./pvpMatch.js?v=20260531b";
import { getPvpAmmo, addPvpAmmo, getPvpRangedWeapon, bulletOfWeapon } from "./pvpLoadout.js?v=20260531b";
import { PVP_ARENA_ZONE_ID } from "./constants.js?v=20260531b";

// Where to drop the player when PvP ends if we have no record of where the
// match was started from (Rust default: Duskhaven 1011 @ 59,57). Normally
// exitPvp returns to the captured pre-match spot instead — see pvpReturnDest.
const DUSKHAVEN_ZONE_ID = 1011;

// Injected at install time.
let getState = () => null;
let setLocalPlayers = () => {};

// One-shot death toasts for the active match (cleared on start/rematch).
const pvpDeadToasted = new Set();
// True while the arena is loading (travelTo fade): re-entrancy guard for
// enterArena, and a gate so the per-frame PvP logic doesn't run against the
// not-yet-placed players / old zone.
let pvpEntering = false;
// The zone/tile the player was standing on when the match started, so
// exitPvp can put them back exactly where they came from instead of a fixed
// hub. Null until a match begins (exitPvp then falls back to Duskhaven).
let pvpReturnDest = null;

export function installPvpController(stateGetter, deps = {}) {
  getState = stateGetter || (() => null);
  if (typeof deps.setLocalPlayers === "function") setLocalPlayers = deps.setLocalPlayers;
  installDebugHook();
}

// The player object for a 0-based slot index (0→P1, 1→P2, 2/3→local
// extras). Mirrors the slot layout setLocalPlayers builds.
function playerByIndex(idx0) {
  const state = getState();
  if (!state) return null;
  if (idx0 === 0) return state.player || null;
  if (idx0 === 1) return state.player2 || null;
  if (Array.isArray(state.players)) {
    const s = state.players.find((e) => e.slot === idx0 + 1 && e.playerId == null);
    if (s) return s.player;
  }
  return null;
}

// Every player object regardless of alive/dead — PvP needs to notice the
// frame a player dies (allPlayers filters the dead out).
function allPlayerObjects() {
  const state = getState();
  const out = [];
  if (state?.player) out.push(state.player);
  if (state?.player2) out.push(state.player2);
  if (Array.isArray(state?.players)) {
    for (const s of state.players) if (s.player) out.push(s.player);
  }
  return out;
}

// Mask a slot's input to nothing when it isn't that player's turn (no-op
// outside PvP — pvpSlotCanAct returns true). pollInput is still called by
// the caller first, so the off-turn slot's event queue is drained.
export function pvpGateInput(idx0, raw) {
  return pvpSlotCanAct(idx0 + 1) ? raw : { events: [], held: new Set() };
}

// Who the PvP camera follows: the current/upcoming player, or null when no
// match is running (the caller falls back to the shared camera).
export function pvpCameraTarget() {
  const idx = cameraPlayerIndex();
  return idx != null ? playerByIndex(idx) : null;
}

// Per-frame PvP step (offline/local only): advance the turn machine, toast
// + report any new death, and raise the result screen once resolved.
export function tickPvpFrame(dt) {
  // Arena still loading: players aren't at their corners and HP isn't reset,
  // so don't advance the turn or evaluate deaths against the old zone.
  if (pvpEntering) return;
  tickPvpMatch(dt);
  for (const p of allPlayerObjects()) {
    const idx = p.index | 0;
    if (isPlayerDead(idx) && !pvpDeadToasted.has(idx)) {
      pvpDeadToasted.add(idx);
      showToast(tr("notification.player.died").replace("%PLAYER_NAME%", String(idx + 1)), "longHint");
      notifyPlayerDied(idx);
    }
  }
  if (isMatchOver() && !isGameOverOpen()) {
    showMatchResult(getMatchResult(), onPvpRematch);
  }
}

// (Re)load the arena, scatter N players to the corners at full HP, and snap
// the camera to P1. Reloading on every match/rematch restores the scavenge
// pickups (and monsters) that were consumed; ephemeralState keeps the arena
// from persisting "item collected" flags into the player's save.
async function enterArena(n) {
  // Re-entrancy guard: a second trigger (rapid rematch, gamepad confirm)
  // while a load is in flight would otherwise sail past travelTo's `busy`
  // guard and corner-place players against the not-yet-swapped zone.
  if (pvpEntering) return;
  pvpEntering = true;
  // Set once the arena has loaded — gates the fade-in so a no-op travelTo
  // (busy guard) isn't revealed by us, but a successful load always is.
  let revealArena = false;
  try {
    const state = getState();
    // skipFadeIn: stay black through the corner scatter so players aren't
    // shown at travelTo's centre fallback before they jump to their corners.
    await travelTo(state, { zone: PVP_ARENA_ZONE_ID, x: 0, y: 0, direction: "Down" }, { skipFadeIn: true });
    if (state.zone?.id !== PVP_ARENA_ZONE_ID) return;
    revealArena = true;
    state.zone.ephemeralState = true;
    pvpDeadToasted.clear();
    for (let i = 0; i < n; i++) {
      resetPlayerHealth(i);
      placePvpPlayer(state, playerByIndex(i), cornerSpawnTile(state.zone, i));
    }
    // Snap to P1's corner so the first frame doesn't pan from the old zone.
    updateCamera(state.camera, playerByIndex(0), state.zone);
    refreshHealthHud();
  } finally {
    pvpEntering = false;
    if (revealArena) fadeOverlayIn();
  }
}

// Rematch: re-arm the turn machine + loadout, then reload the arena fresh.
function onPvpRematch() {
  rematchPvpLogic();
  enterArena(pvpPlayerCount());
}

// Start a local N-player PvP match: switch mode, spawn the players, travel
// to the arena (world 1301), then scatter them to the corners at full HP.
export async function startPvpMatch(n) {
  const state = getState();
  if (!state?.zone || !state.player) return;
  // Phase A is offline-only: starting PvP while hosting/guesting would
  // teleport the host into the arena and strand the guests. The menu
  // already hides the entry off-offline; this guards the programmatic path.
  if (getRuntimeRole() !== "offline") {
    showToast("Leave the online session before starting PvP", "longHint");
    return;
  }
  n = Math.max(2, Math.min(4, n | 0));
  // Remember where we came from so exitPvp can return here, not a fixed hub.
  pvpReturnDest = {
    zone: state.zone.id,
    x: state.player.tileX | 0,
    y: state.player.tileY | 0,
    direction: state.player.direction,
  };
  setGameMode(GAME_MODE.pvp);
  setLocalPlayers(n);
  startPvpLogic(n);
  await enterArena(n);
}

// Leave PvP: back to co-op single-player, returning to where the match was
// started from (Duskhaven only if we somehow have no record).
export async function exitPvp() {
  const state = getState();
  if (!state?.zone) return;
  setGameMode(GAME_MODE.coop);
  endPvpMatch();            // park the turn machine + clear loadout
  setLocalPlayers(1);
  hideTurnHud();
  pvpDeadToasted.clear();
  const dest = pvpReturnDest ?? { zone: DUSKHAVEN_ZONE_ID, x: 59, y: 57, direction: "Down" };
  pvpReturnDest = null;
  await travelTo(state, dest);
  resetPlayerHealth();     // all records back to the coop cap (clears stale P2-4)
  refreshHealthHud();
}

// Whether a PvP match is currently active (menu uses it to swap entry/exit
// items).
export function isPvpActive() { return isPvp(); }

// PvP test/debug hook (mirrors window.coop): start/exit a local match and
// read the turn + match state the e2e suite asserts on.
function installDebugHook() {
  if (typeof window === "undefined") return;
  window.pvp = {
    start: (n) => startPvpMatch(n),
    exit: () => exitPvp(),
    // Force a player's death for win/lose tests (HP straight to 0).
    kill: (index) => setPlayerHp(0, index),
    // Fire a shot for the given 1-based slot through the real path.
    shoot: (slot) => tryShootForSlot(slot),
    // Grant PvP ammo of a caliber to a 0-based player index (tests).
    giveAmmo: (index, bulletId, n) => addPvpAmmo(index, bulletId, n),
    // Read a player's count for a specific caliber (tests).
    ammoOf: (index, bulletId) => getPvpAmmo(index, bulletId),
    // Drop a 0-based player onto a tile (tests — e.g. onto a pickup).
    // Leaves lastTile stale on purpose so the next frame registers it as
    // movement and runs the pickup check (real play walks onto pickups).
    warp: (index, x, y) => {
      const p = playerByIndex(index);
      if (!p) return;
      p.tileX = x; p.tileY = y; p.x = x; p.y = y;
      p.step = null; p.queuedDir = null; p.pendingDir = null;
    },
    state: () => {
      const state = getState();
      return {
        mode: getGameMode(),
        zoneId: state?.zone?.id,
        turn: getTurn(),
        liveIndex: cameraPlayerIndex(),
        result: getMatchResult(),
        over: isMatchOver(),
        hp: [0, 1, 2, 3].map((i) => getPlayerHp(i)),
        weapon: [0, 1, 2, 3].map((i) => getPvpRangedWeapon(i)),
        // Ammo for each player's currently equipped weapon (what the HUD shows).
        ammo: [0, 1, 2, 3].map((i) => getPvpAmmo(i, bulletOfWeapon(getPvpRangedWeapon(i)))),
        bullets: (state?.zone?.entities || []).filter((e) => e._spawned).length,
      };
    },
  };
}
