// Realtime online PvP (deathmatch) — the HOST-side match controller. The
// online counterpart of pvpController.js: same arena, 1000 HP, scavenge, and
// last-player-standing win/lose (all via the shared pvp modules), but realtime
// (no turns) and host-authoritative. Guests don't run this — they forward input
// and render the mirror world, learning the match via the pvpStart / pvpResult
// events and the normal snapshot stream.
//
// Reaches game state through an injected getState() (installOnlineDeathmatch),
// mirroring pvpController so there's no import back into main.js.

import { setGameMode, getGameMode, GAME_MODE, setPvpHostSetup } from "./gameMode.js";
import { getNetRole } from "./onlineBootstrap.js";
import { switchRole } from "./switchRole.js";
import { broadcastHostEvent } from "./hostEvents.js";
import { showToast } from "./toast.js";
import { travelTo, fadeOverlayIn } from "./transitions.js";
import { cornerSpawnTile, placePvpPlayer } from "./pvpSpawn.js";
import {
  startMatch as startPvpLogic, rematch as rematchPvpLogic, endMatch as endPvpMatch,
  notifyPlayerDied, getMatchResult, isMatchOver,
} from "./pvpMatch.js";
import { resetPlayerHealth, isPlayerDead, getPlayerHp, setPlayerHp } from "./playerHealth.js";
import { showMatchResult, isGameOverOpen, hideGameOver } from "./gameOver.js";
import { refreshHealthHud } from "./healthHud.js";
import { updateCamera } from "./camera.js";
import { PVP_ARENA_ZONE_ID } from "./constants.js";

// Fallback exit destination if we have no record of the pre-match zone
// (Rust default: Duskhaven 1011 @ 59,57). Normally exit() returns to the
// captured co-op zone instead — see returnDest.
const DUSKHAVEN_ZONE_ID = 1011;

let getState = () => null;
// True while the arena is loading: gate the per-frame logic (like pvpController).
let dmEntering = false;
// The host's zone/tile when the match started, so exit() returns the party
// to the co-op world they left rather than a fixed hub. Guests follow via
// the zoneChange + snapshot stream. Null until a match begins.
let returnDest = null;
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


// Every local player avatar in index order (host=0, then guest slots).
function orderedPlayers(state) {
  const out = [];
  if (state?.player) out.push(state.player);
  if (state?.player2) out.push(state.player2);
  if (Array.isArray(state?.players)) for (const s of state.players) if (s.player) out.push(s.player);
  return out;
}

// (Re)load the arena and scatter every player to a corner at full HP. Reloading
// each round restores the scavenge pickups; ephemeralState keeps the arena from
// persisting collection into the host's save. zoneChange + the fresh snapshot
// carry the guests along automatically.
async function setupArena() {
  if (dmEntering) return;
  dmEntering = true;
  // Set once we've actually loaded the arena: gates the fade-in so a no-op
  // travelTo (busy guard, screen owned by another transition) isn't revealed
  // by us, while a load that placed players at their corners always is.
  let revealArena = false;
  try {
    const state = getState();
    // skipFadeIn: keep the screen black through the corner scatter below so
    // players are never shown at travelTo's centre fallback before they jump
    // to their corners. We fade in ourselves once everyone is placed.
    await travelTo(state, { zone: PVP_ARENA_ZONE_ID, x: 0, y: 0, direction: "Down" }, { skipFadeIn: true });
    // travelTo silently no-ops if a transition is already in flight (its
    // `busy` guard). Bail rather than arm the match on — and mark ephemeral —
    // the wrong (story) zone.
    if (state.zone?.id !== PVP_ARENA_ZONE_ID) return;
    revealArena = true;
    state.zone.ephemeralState = true;
    dmDeadToasted.clear();
    for (const p of orderedPlayers(state)) {
      const idx = p.index | 0;
      resetPlayerHealth(idx);
      placePvpPlayer(state, p, cornerSpawnTile(state.zone, idx));
    }
    updateCamera(state.camera, state.player, state.zone); // host follows own avatar
    refreshHealthHud();
  } finally {
    dmEntering = false;
    if (revealArena) fadeOverlayIn();
  }
}

// Host action: start a realtime deathmatch with everyone currently connected.
export async function startMatch() {
  if (getNetRole() !== "host") return;
  const state = getState();
  if (!state?.zone || !state.player) return;
  // Size the match from the avatars actually present (host + spawned guests),
  // not the network guest counter — they can disagree mid-join, and a phantom
  // player would make last-player-standing unresolvable.
  const n = orderedPlayers(state).length;
  if (n < 2) { showToast("Wait for a friend to join before starting PvP.", "hint"); return; }
  if (isGameOverOpen()) hideGameOver(); // clear any lingering overlay before arming
  // Remember the co-op zone so exit() returns everyone here, not a fixed hub.
  returnDest = {
    zone: state.zone.id,
    x: state.player.tileX | 0,
    y: state.player.tileY | 0,
    direction: state.player.direction,
  };
  setGameMode(GAME_MODE.pvp);
  broadcastHostEvent("pvpStart", {});
  startPvpLogic(n);
  await setupArena();
}

// Per-frame (host only): notice deaths, resolve last-player-standing, and on a
// terminal result broadcast it + show the local result screen.
export function tickHostFrame() {
  if (dmEntering || getNetRole() !== "host") return;
  const state = getState();
  // Stop scanning deaths once the match is over so a post-resolution kill (the
  // host isn't paused, so combat keeps ticking) can't drift the result.
  if (!isMatchOver()) {
    for (const p of orderedPlayers(state)) {
      const idx = p.index | 0;
      if (isPlayerDead(idx) && !dmDeadToasted.has(idx)) {
        dmDeadToasted.add(idx);
        notifyPlayerDied(idx); // snapshotBroadcaster already emits the death event
      }
    }
  }
  if (isMatchOver() && !isGameOverOpen()) {
    const r = getMatchResult();
    broadcastHostEvent("pvpResult", { kind: r.kind, playerIndex: r.playerIndex | 0 });
    showMatchResult(r, onRematch, { onExit: exitToSinglePlayer });
  }
}

// Host rematch: re-arm + re-broadcast pvpStart, then reload the arena fresh.
function onRematch() {
  rematchPvpLogic();
  broadcastHostEvent("pvpStart", {});
  setupArena();
}

// Host "Back to single player" from the result screen: end the match (returns
// the party to the co-op world + tells guests via pvpEnd) then drop the online
// session entirely, landing the host back in their offline save. The guest
// follows host.close → session.closed → offline. Mirrors
// partyPanel.endOnlineSession, reachable straight from the result dialog.
async function exitToSinglePlayer() {
  setPvpHostSetup(false);
  await exit();
  try { await switchRole("offline"); }
  catch (e) { console.error("[deathmatch] switchRole(offline)", e); }
}

// Host ends the match: back to co-op. Broadcasts pvpEnd so guests dismiss the
// result/death overlay; their game mode self-heals to coop via the snapshot.
export async function exit() {
  setGameMode(GAME_MODE.coop);
  endPvpMatch();
  dmDeadToasted.clear();
  if (isGameOverOpen()) hideGameOver(); // close the host's own result screen
  broadcastHostEvent("pvpEnd", {});
  const state = getState();
  if (!state?.zone) return;
  const dest = returnDest ?? { zone: DUSKHAVEN_ZONE_ID, x: 59, y: 57, direction: "Down" };
  returnDest = null;
  await travelTo(state, dest);
  resetPlayerHealth();
  refreshHealthHud();
}
