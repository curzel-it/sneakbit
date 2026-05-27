// Host-side bookkeeping for connected guests: spawns a P-slot avatar in
// the host's local world on peer.joined, routes the guest's `input`
// frames into the existing input pipeline as if they were a local-coop
// keyboard, and cleans up on peer.left / peer.ghosted.
//
// One file, one responsibility — the snapshot broadcaster sees the
// resulting avatars via state.player2/etc and ships them like any other
// local-coop player.

import { getNetRole, getNet } from "./onlineBootstrap.js";
import { pushInputPress, clearInputHeld, clearInputState } from "./input.js";

const INTENT_TO_DIR = {
  moveUp: "up",
  moveDown: "down",
  moveLeft: "left",
  moveRight: "right",
};

let stateGetter = null;
let p2Factory = null;
const guestSlotByPlayerId = new Map();

export function installHostGuests(getState, opts = {}) {
  if (getNetRole() !== "host" && !opts.force) return false;
  stateGetter = typeof getState === "function" ? getState : () => getState;
  p2Factory = opts.makeCoopP2;
  const net = opts.net || getNet();
  if (!net) return false;
  net.on("peer.joined", (m) => onPeerJoined(m, false));
  net.on("peer.rejoined", (m) => onPeerJoined(m, true));
  net.on("peer.left", onPeerLeft);
  net.on("peer.ghosted", onPeerGhosted);
  net.on("input", onInput);
  return true;
}

// Test seam — drop everything so a fresh test gets a clean slate.
export function _uninstallHostGuestsForTesting() {
  stateGetter = null;
  p2Factory = null;
  guestSlotByPlayerId.clear();
}

function onPeerJoined(m, isRejoin) {
  const state = stateGetter?.();
  if (!state) return;
  const slot = m.slot;
  // Phase 5 spawns slot-2 avatars only; the multi-guest extension to
  // P3/P4 lives in Phase 7+ once main.js gains a state.players[] array.
  if (slot !== 2) return;
  guestSlotByPlayerId.set(m.playerId, slot);
  if (state.player2) {
    // Same slot reused on a reconnect: just rebind the playerId.
    state.player2.playerId = m.playerId;
    state.player2.slot = slot;
    return;
  }
  if (!p2Factory) return;
  const p2 = p2Factory(state.player, state.zone);
  p2.playerId = m.playerId;
  p2.slot = slot;
  state.player2 = p2;
  state.lastTile2 = { x: p2.tileX, y: p2.tileY };
}

function onPeerLeft(m) {
  const slot = guestSlotByPlayerId.get(m.playerId);
  guestSlotByPlayerId.delete(m.playerId);
  if (slot == null) return;
  clearInputState(slot);
  const state = stateGetter?.();
  if (!state) return;
  if (slot === 2) {
    state.player2 = null;
    state.lastTile2 = null;
  }
}

function onPeerGhosted(_m) {
  // The guest's avatar stays put per spec — just release any held keys
  // so the host's tick doesn't keep stepping a disconnected guest.
  for (const slot of guestSlotByPlayerId.values()) clearInputHeld(slot);
}

function onInput(m) {
  if (!m || typeof m.intent !== "string") return;
  const from = m.from;
  if (!from) return;
  const slot = guestSlotByPlayerId.get(from);
  if (!slot) return;
  applyIntent(slot, m.intent);
}

function applyIntent(slot, intent) {
  const dir = INTENT_TO_DIR[intent];
  if (dir) {
    // Movement intents are absolute "I'm now pressing X only": wipe the
    // slot's keyboard state and synthesise a fresh press. Otherwise a
    // moveDown→moveLeft transition would leave the host's tick chasing
    // "down" forever because the HOLD_PRIORITY in player.js prefers up/down.
    clearInputState(slot);
    pushInputPress(slot, dir);
    return;
  }
  if (intent === "stopMove") { clearInputHeld(slot); return; }
  // interact / shoot / melee arrive in Phase 7 — fall through for now.
}
