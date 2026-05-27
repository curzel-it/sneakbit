// Host-side bookkeeping for connected guests: spawns a P-slot avatar in
// the host's local world on peer.joined, routes the guest's `input`
// frames into the existing input pipeline as if they were a local-coop
// keyboard, and cleans up on peer.left / peer.ghosted.
//
// Slot 2 spawns into state.player2 (matches the local-coop second-player
// shape used by pickups/combat/camera). Slots 3 and 4 spawn into
// state.players[] entries — same wrapper shape the snapshot broadcaster
// already expects { player, slot, playerId }. main.js's tick loop walks
// state.players[] alongside player/player2 so all four slots move and
// participate in pickups/combat.

import { getNetRole, getNet } from "./onlineBootstrap.js?v=20260527b";
import { pushInputPress, clearInputHeld, clearInputState } from "./input.js?v=20260527b";
import { setNetworkGuestCount, COOP_KEYMAPS } from "./coopMode.js?v=20260527b";

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
let unsubs = [];
// Light cheat resistance: minimum gap between consecutive same-action
// intents from a single guest. The honest human input limit on these
// keys is ~5/sec at most; anything faster is either a stuck key on the
// guest or a tampered client trying to spam attacks on the host's
// world. Caps are intentionally generous so a fast tapper doesn't
// notice them. Movement intents are NOT throttled here — they're
// state-derived (last one wins), so a flood is self-suppressing and
// the input pipeline already costs ~nothing per call.
const ACTION_COOLDOWN_MS = {
  shoot:    180,
  melee:    180,
  interact: 250,
};
// playerId → { intent → lastAppliedMs }
const lastActionAtByGuest = new Map();

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
  uninstallHostGuests();
  stateGetter = typeof getState === "function" ? getState : () => getState;
  p2Factory = opts.makeCoopP2;
  const net = opts.net || getNet();
  if (!net) return false;
  unsubs.push(net.on("peer.joined", (m) => onPeerJoined(m, false)));
  unsubs.push(net.on("peer.rejoined", (m) => onPeerJoined(m, true)));
  unsubs.push(net.on("peer.left", onPeerLeft));
  unsubs.push(net.on("peer.ghosted", onPeerGhosted));
  unsubs.push(net.on("input", onInput));
  return true;
}

// Production teardown — paired with installHostGuests; safe to call when
// nothing is installed. Drops net subscriptions, the slot map and the
// per-guest ack buckets, and zeroes the coopMode network-guest count so
// isCoopActive() reverts to "single-player + maybe local-coop" semantics.
export function uninstallHostGuests() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  stateGetter = null;
  p2Factory = null;
  guestSlotByPlayerId.clear();
  lastSeqByPlayerId.clear();
  lastActionAtByGuest.clear();
  setNetworkGuestCount(0);
}

// Test seam alias — kept so existing tests still link.
export const _uninstallHostGuestsForTesting = uninstallHostGuests;

function onPeerJoined(m, _isRejoin) {
  const state = stateGetter?.();
  if (!state) return;
  const slot = m.slot;
  if (slot < 2 || slot > 4) return;
  guestSlotByPlayerId.set(m.playerId, slot);
  setNetworkGuestCount(guestSlotByPlayerId.size);
  if (slot === 2) { spawnSlot2(state, m); return; }
  spawnExtraSlot(state, m, slot);
}

function spawnSlot2(state, m) {
  if (state.player2) {
    state.player2.playerId = m.playerId;
    state.player2.slot = 2;
    return;
  }
  if (!p2Factory) return;
  const p2 = p2Factory(state.player, state.zone, { index: 1 });
  p2.playerId = m.playerId;
  p2.slot = 2;
  state.player2 = p2;
  state.lastTile2 = { x: p2.tileX, y: p2.tileY };
}

function spawnExtraSlot(state, m, slot) {
  if (!state.players) state.players = [];
  const existing = state.players.find((s) => s.slot === slot);
  if (existing) {
    existing.playerId = m.playerId;
    existing.player.playerId = m.playerId;
    existing.player.slot = slot;
    return;
  }
  if (!p2Factory) return;
  const p = p2Factory(state.player, state.zone, { index: slot - 1 });
  p.playerId = m.playerId;
  p.slot = slot;
  state.players.push({
    player: p,
    slot,
    playerId: m.playerId,
    lastTile: { x: p.tileX, y: p.tileY },
  });
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
    return;
  }
  if (Array.isArray(state.players)) {
    state.players = state.players.filter((s) => s.slot !== slot);
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
  applyIntent(slot, m.intent, from);
}

function applyIntent(slot, intent, from) {
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
    if (!actionCooldownOk(from, intent)) return;
    dispatchActionForSlot(slot, intent);
  }
}

// Returns true if the action is allowed (and stamps the timer); false
// if the same guest spammed this intent inside the cooldown window.
// Per-guest, per-intent — a guest who legitimately alternates
// shoot/melee at high speed isn't throttled by a single shared bucket.
function actionCooldownOk(from, intent, now = Date.now()) {
  const min = ACTION_COOLDOWN_MS[intent];
  if (!min) return true;
  let timers = lastActionAtByGuest.get(from);
  if (!timers) { timers = {}; lastActionAtByGuest.set(from, timers); }
  const last = timers[intent] ?? 0;
  if (now - last < min) return false;
  timers[intent] = now;
  return true;
}

export function _resetActionCooldownsForTesting() {
  lastActionAtByGuest.clear();
}
export function _getActionCooldownsForTesting() { return lastActionAtByGuest; }

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
