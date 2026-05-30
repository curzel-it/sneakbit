// Realtime online PvP (deathmatch) — the HOST-side match controller. The
// online counterpart of pvpController.js: same arena, 1000 HP, scavenge, and
// last-player-standing win/lose (all via the shared pvp modules), but realtime
// (no turns) and host-authoritative. Guests don't run this — they forward input
// and render the mirror world, learning the match via the pvpStart / pvpResult
// events and the normal snapshot stream.
//
// Reaches game state through an injected getState() (installOnlineDeathmatch),
// mirroring pvpController so there's no import back into main.js.

import { setGameMode, getGameMode, GAME_MODE } from "./gameMode.js?v=20260530a";
import { getNetRole } from "./onlineBootstrap.js?v=20260530a";
import { getNetworkGuestCount } from "./coopMode.js?v=20260530a";
import { broadcastHostEvent } from "./hostEvents.js?v=20260530a";
import { showToast } from "./toast.js?v=20260530a";
import { travelTo } from "./transitions.js?v=20260530a";
import { cornerSpawnTile } from "./pvpSpawn.js?v=20260530a";
import {
  startMatch as startPvpLogic, rematch as rematchPvpLogic, endMatch as endPvpMatch,
  notifyPlayerDied, getMatchResult, isMatchOver,
} from "./pvpMatch.js?v=20260530a";
import { resetPlayerHealth, isPlayerDead, getPlayerHp, setPlayerHp } from "./playerHealth.js?v=20260530a";
import { showMatchResult, isGameOverOpen } from "./gameOver.js?v=20260530a";
import { refreshHealthHud } from "./healthHud.js?v=20260530a";
import { updateCamera } from "./camera.js?v=20260530a";

const PVP_ARENA_ZONE_ID = 1301;
const DUSKHAVEN_ZONE_ID = 1011;

let getState = () => null;
// True while the arena is loading: gate the per-frame logic (like pvpController).
let dmEntering = false;
// One-shot death bookkeeping per match (cleared on each setup).
const dmDeadToasted = new Set();

export function installOnlineDeathmatch(stateGetter) {
  getState = stateGetter || (() => null);
  installDebugHook();
}

// Host-side test/debug hook (mirrors window.pvp/window.coop). Lets the e2e
// start a match and read host match state.
function installDebugHook() {
  if (typeof window === "undefined") return;
  window.deathmatch = {
    start: () => startMatch(),
    exit: () => exit(),
    kill: (index) => setPlayerHp(0, index),
    state: () => {
      const state = getState();
      return {
        mode: getGameMode(),
        zoneId: state?.zone?.id,
        over: isMatchOver(),
        result: getMatchResult(),
        hp: [0, 1, 2, 3].map((i) => getPlayerHp(i)),
        players: orderedPlayers(state).map((p) => ({
          index: p.index | 0, tileX: p.tileX, tileY: p.tileY, hp: getPlayerHp(p.index | 0),
        })),
      };
    },
  };
}

export function isOnlineDeathmatchHost() {
  return getNetRole() === "host";
}

// Every local player avatar in index order (host=0, then guest slots).
function orderedPlayers(state) {
  const out = [];
  if (state?.player) out.push(state.player);
  if (state?.player2) out.push(state.player2);
  if (Array.isArray(state?.players)) for (const s of state.players) if (s.player) out.push(s.player);
  return out;
}

function placeAt(state, player, tile) {
  player.tileX = tile.x; player.tileY = tile.y; player.x = tile.x; player.y = tile.y;
  player.step = null; player.queuedDir = null; player.pendingDir = null;
  player.pendingTimer = 0; player._sliding = false;
  player.direction = "down";
  if (player === state.player) state.lastTile = { x: tile.x, y: tile.y };
  else if (player === state.player2) state.lastTile2 = { x: tile.x, y: tile.y };
  else {
    const s = state.players?.find((e) => e.player === player);
    if (s) s.lastTile = { x: tile.x, y: tile.y };
  }
}

// (Re)load the arena and scatter every player to a corner at full HP. Reloading
// each round restores the scavenge pickups; ephemeralState keeps the arena from
// persisting collection into the host's save. zoneChange + the fresh snapshot
// carry the guests along automatically.
async function setupArena() {
  if (dmEntering) return;
  dmEntering = true;
  try {
    const state = getState();
    await travelTo(state, { zone: PVP_ARENA_ZONE_ID, x: 0, y: 0, direction: "Down" });
    state.zone.ephemeralState = true;
    dmDeadToasted.clear();
    for (const p of orderedPlayers(state)) {
      const idx = p.index | 0;
      resetPlayerHealth(idx);
      placeAt(state, p, cornerSpawnTile(state.zone, idx));
    }
    updateCamera(state.camera, state.player, state.zone); // host follows own avatar
    refreshHealthHud();
  } finally {
    dmEntering = false;
  }
}

function playerCount(state) {
  // Host + connected guests (each guest owns one avatar slot).
  return 1 + getNetworkGuestCount();
}

// Host action: start a realtime deathmatch with everyone currently connected.
export async function startMatch() {
  if (getNetRole() !== "host") return;
  const state = getState();
  if (!state?.zone || !state.player) return;
  const n = playerCount(state);
  if (n < 2) { showToast("Wait for a friend to join before starting PvP.", "hint"); return; }
  setGameMode(GAME_MODE.pvp, { realtime: true });
  broadcastHostEvent("pvpStart", {});
  startPvpLogic(n, /* turnBased */ false);
  await setupArena();
}

// Per-frame (host only): notice deaths, resolve last-player-standing, and on a
// terminal result broadcast it + show the local result screen.
export function tickHostFrame() {
  if (dmEntering || !isRealtimeMatchRunning()) return;
  const state = getState();
  for (const p of orderedPlayers(state)) {
    const idx = p.index | 0;
    if (isPlayerDead(idx) && !dmDeadToasted.has(idx)) {
      dmDeadToasted.add(idx);
      notifyPlayerDied(idx); // snapshotBroadcaster already emits the death event
    }
  }
  if (isMatchOver() && !isGameOverOpen()) {
    const r = getMatchResult();
    broadcastHostEvent("pvpResult", { kind: r.kind, playerIndex: r.playerIndex | 0 });
    showMatchResult(r, onRematch);
  }
}

function isRealtimeMatchRunning() {
  return getNetRole() === "host";
}

// Host rematch: re-arm + re-broadcast pvpStart, then reload the arena fresh.
function onRematch() {
  rematchPvpLogic();
  broadcastHostEvent("pvpStart", {});
  setupArena();
}

// Host ends the match: back to co-op. (Minimal — guests resync via the next
// snapshot; a richer "return to lobby" flow is a later polish.)
export async function exit() {
  setGameMode(GAME_MODE.coop);
  endPvpMatch();
  dmDeadToasted.clear();
  const state = getState();
  if (!state?.zone) return;
  await travelTo(state, { zone: DUSKHAVEN_ZONE_ID, x: 59, y: 57, direction: "Down" });
  resetPlayerHealth();
  refreshHealthHud();
}
