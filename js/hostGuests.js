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
import { setNetworkGuestCount, COOP_KEYMAPS } from "./coopMode.js";

const INTENT_TO_DIR = {
  moveUp: "up",
  moveDown: "down",
  moveLeft: "left",
  moveRight: "right",
};

let stateGetter = null;
let p2Factory = null;
const guestSlotByPlayerId = new Map();
const lastSeqByPlayerId = new Map();

// Public: the host's broadcaster reads this so every snapshot/delta
// carries `lastSeq[guestId]`, the highest seq the host has applied for
// each guest. Used by predictedSelf.js on the guest side to decide
// whether prediction is still in lockstep with the authority.
export function getLastSeqMap() {
  const out = {};
  for (const [pid, seq] of lastSeqByPlayerId) out[pid] = seq;
  return out;
}

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
  lastSeqByPlayerId.clear();
}

function onPeerJoined(m, isRejoin) {
  const state = stateGetter?.();
  if (!state) return;
  const slot = m.slot;
  // Phase 5 spawns slot-2 avatars only; the multi-guest extension to
  // P3/P4 lives in Phase 7+ once main.js gains a state.players[] array.
  if (slot !== 2) return;
  guestSlotByPlayerId.set(m.playerId, slot);
  setNetworkGuestCount(guestSlotByPlayerId.size);
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
  setNetworkGuestCount(guestSlotByPlayerId.size);
  if (slot == null) return;
  clearInputState(slot);
  lastSeqByPlayerId.delete(m.playerId);
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
  if (typeof m.seq === "number") {
    const prev = lastSeqByPlayerId.get(from) ?? 0;
    if (m.seq > prev) lastSeqByPlayerId.set(from, m.seq);
  }
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
  if (intent === "interact" || intent === "shoot" || intent === "melee") {
    dispatchActionForSlot(slot, intent);
  }
}

// Synthesises a keydown for the slot's coop-keymap action key. The
// interact / shoot / melee listeners use the same isCoopActive() gate
// (set by setNetworkGuestCount on peer.joined) so the dispatched key
// routes to the right state.player2 / etc.
function dispatchActionForSlot(slot, action) {
  if (typeof window === "undefined") return;
  const km = COOP_KEYMAPS[slot];
  if (!km) return;
  const code = km[action];
  if (!code) return;
  try { window.dispatchEvent(new KeyboardEvent("keydown", { code })); }
  catch { /* ignore — no DOM in tests */ }
}
