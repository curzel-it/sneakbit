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

import { getNetRole, getNet } from "./onlineBootstrap.js?v=20260531c";
import { pushInputPress, clearInputHeld, clearInputState, setNetworkHeld, pushPressEvent } from "./input.js?v=20260531c";
import { setNetworkGuestCount } from "./coopMode.js?v=20260531c";
import { tryShootForSlot } from "./shooting.js?v=20260531c";
import { tryMeleeForSlot } from "./melee.js?v=20260531c";
import { tryInteractForSlot } from "./interact.js?v=20260531c";
import { isPlayerDead } from "./playerHealth.js?v=20260531c";
import { isPvp, isRealtimePvp } from "./gameMode.js?v=20260531c";
import { cornerSpawnTile } from "./pvpSpawn.js?v=20260531c";
import { notifyPlayerDied } from "./pvpMatch.js?v=20260531c";

const INTENT_TO_DIR = {
  moveUp: "up",
  moveDown: "down",
  moveLeft: "left",
  moveRight: "right",
};

let stateGetter = null;
let p2Factory = null;
const guestSlotByPlayerId = new Map();
// Plain object kept in lockstep with the per-guest highest applied seq.
// The broadcaster reads it ~20 times/sec via getLastSeqMap(); rebuilding
// a fresh object on every read was producing observable GC churn. We
// maintain `lastSeqOut` incrementally — set on input, delete on
// peer.left — so getLastSeqMap() is now a constant-time reference.
const lastSeqOut = Object.create(null);
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
//
// Returns the live module-level object — callers must not mutate it.
// The broadcaster serializes the snapshot synchronously so reuse is
// safe; nothing buffers this reference across ticks.
export function getLastSeqMap() {
  return lastSeqOut;
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
  for (const k of Object.keys(lastSeqOut)) delete lastSeqOut[k];
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
  pvpCornerPlace(state, p2, 1);
  p2.playerId = m.playerId;
  p2.slot = 2;
  state.player2 = p2;
  state.lastTile2 = { x: p2.tileX, y: p2.tileY };
}

// In PvP a guest spawns at its own map corner instead of next to the host
// (a match start re-scatters everyone anyway; this covers a late joiner).
function pvpCornerPlace(state, player, idx0) {
  if (!isPvp()) return;
  const tile = cornerSpawnTile(state.zone, idx0);
  player.tileX = tile.x; player.tileY = tile.y; player.x = tile.x; player.y = tile.y;
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
  pvpCornerPlace(state, p, slot - 1);
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
  delete lastSeqOut[m.playerId];
  // Realtime PvP: a mid-match drop counts as a death so last-player-standing
  // can still resolve (otherwise numberOfPlayers stays N and the match hangs).
  if (isRealtimePvp()) notifyPlayerDied(slot - 1);
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

function onPeerGhosted(m) {
  // The guest's avatar stays put per spec — release any held keys for
  // JUST this slot so the host's tick doesn't keep stepping the ghosted
  // guest. Earlier this iterated every slot in the session — a single
  // ghosted peer would freeze the input of every other guest until they
  // re-pressed their movement keys, which felt like a "co-op got
  // disconnected" hitch even though the other peers were fine.
  if (!m || !m.playerId) return;
  const slot = guestSlotByPlayerId.get(m.playerId);
  if (slot) clearInputHeld(slot);
}

function onInput(m) {
  if (!m || typeof m.intent !== "string") return;
  const from = m.from;
  if (!from) return;
  const slot = guestSlotByPlayerId.get(from);
  if (!slot) return;
  if (typeof m.seq === "number") {
    const prev = lastSeqOut[from] ?? 0;
    if (m.seq > prev) lastSeqOut[from] = m.seq;
  }
  applyIntent(slot, m.intent, from, m);
}

function applyIntent(slot, intent, from, msg) {
  const held = Array.isArray(msg?.held) ? msg.held : null;
  const dir = INTENT_TO_DIR[intent];
  if (dir) {
    if (held) {
      // New wire (forwarder ≥ 20260528i): the guest ships its full held
      // set with every movement intent. Mirror it exactly so the host's
      // HOLD_PRIORITY chains via the same direction the guest's
      // predicted self picks locally. The intent is queued as a fresh
      // press event so rotate / queuedDir timing matches a real keydown.
      setNetworkHeld(slot, held);
      pushPressEvent(slot, dir);
    } else {
      // Legacy wire (no held field): preserve the old absolute-press
      // semantics. Without `held` we can't reconstruct multi-key state,
      // so the safest fallback is "this is the only direction held."
      clearInputState(slot);
      pushInputPress(slot, dir);
    }
    return;
  }
  if (intent === "holdSync") {
    // Held set shrank but isn't empty (user released one of multiple
    // held keys). Update the host's view without pushing a press event
    // — the user didn't press anything new. Skip silently if the wire
    // didn't include held; an empty holdSync would be ambiguous.
    if (held) setNetworkHeld(slot, held);
    return;
  }
  if (intent === "stopMove") { clearInputHeld(slot); return; }
  if (intent === "interact" || intent === "shoot" || intent === "melee") {
    // Range first — actionCooldownOk has the side effect of stamping the
    // bucket, so checking it before a definite reject would lock out a
    // legit guest who mashes the button during death animation.
    if (!actionRangeOk(slot)) return;
    if (!actionCooldownOk(from, intent)) return;
    dispatchActionForSlot(slot, intent);
  }
}

// Range / state sanity check — second half of the "light cheat
// resistance" pair next to the cooldown bucket. Blocks shoot/melee/
// interact intents when the slot's actor isn't currently in a state
// where they could plausibly act:
//   - the slot's avatar exists in the host's local state (the wire
//     identified the guest, but the host might have already despawned
//     them on peer.left if the intent races the disconnect)
//   - hp > 0 (a dead avatar can't fire)
//   - tile coords are inside the current zone (defends against a
//     malicious client somehow nudging the host's avatar off-grid via
//     prior movement intents)
// The downstream tryShoot/tryMelee/tryInteract paths also enforce
// state-correct rules, but bouncing the intent here avoids spinning
// the local sim's per-action machinery for a clearly bogus request.
function actionRangeOk(slot) {
  const state = stateGetter?.();
  if (!state) return false;
  const player = playerForSlot(state, slot);
  if (!player) return false;
  if (isPlayerDead(player.index | 0)) return false;
  const zone = state.zone;
  if (!zone) return false;
  const cols = zone.cols | 0;
  const rows = zone.rows | 0;
  if (cols <= 0 || rows <= 0) return false;
  const tx = player.tileX | 0;
  const ty = player.tileY | 0;
  if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) return false;
  return true;
}

function playerForSlot(state, slot) {
  if (slot === 2) return state.player2 || null;
  if (slot < 2 || slot > 4) return null;
  if (!Array.isArray(state.players)) return null;
  const s = state.players.find((e) => e.slot === slot);
  return s ? s.player : null;
}

let actionDispatch = {
  shoot:    tryShootForSlot,
  melee:    tryMeleeForSlot,
  interact: tryInteractForSlot,
};

// Test seam: swap action dispatchers for assertion-friendly stubs.
// Pass undefined values to restore defaults; `{}` is a no-op.
export function _setActionDispatchForTesting(overrides) {
  actionDispatch = {
    shoot:    overrides?.shoot    ?? tryShootForSlot,
    melee:    overrides?.melee    ?? tryMeleeForSlot,
    interact: overrides?.interact ?? tryInteractForSlot,
  };
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

// Routes the guest's action intent straight to the matching module's
// per-slot entry point. Replaces an earlier path that synthesised a
// `new KeyboardEvent("keydown", { code: COOP_KEYMAPS[slot][action] })`
// and let the shoot/melee/interact key listeners re-derive the slot —
// brittle (every binding rename had a second place to update), DOM-
// dependent (couldn't run in Node tests without a window stub), and
// went through the global event bus for no benefit.
function dispatchActionForSlot(slot, action) {
  const fn = actionDispatch[action];
  if (fn) fn(slot);
}
