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

import { getNetRole, getNet } from "./onlineBootstrap.js";
import { clearInputHeld, clearInputState } from "./input.js";
import { setNetworkGuestCount } from "./coopMode.js";
import { tryShootForSlot } from "./shooting.js";
import { tryMeleeForSlot } from "./melee.js";
import { tryInteractForSlot } from "./interact.js";
import { isPlayerDead } from "./playerHealth.js";
import { isPvp } from "./gameMode.js";
import { cornerSpawnTile } from "./pvpSpawn.js";
import { notifyPlayerDied } from "./pvpMatch.js";
import { applyNetStep, setGuestAckSink } from "./player.js";

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
  unsubs.push(net.on("move", onMove));
  // Resolved guest steps advance the per-guest lastSeq through this sink,
  // fired by player.updateGuestAvatar at the exact snap (and on a queued-
  // step reject) so (tile, seq) stay a consistent pair for the broadcaster.
  setGuestAckSink(ackStep);
  return true;
}

// Production teardown — paired with installHostGuests; safe to call when
// nothing is installed. Drops net subscriptions, the slot map and the
// per-guest ack buckets, and zeroes the coopMode network-guest count so
// isCoopActive() reverts to "single-player + maybe local-coop" semantics.
export function uninstallHostGuests() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  setGuestAckSink(null);
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
  // PvP: a mid-match drop counts as a death so last-player-standing can still
  // resolve (otherwise numberOfPlayers stays N and the match hangs).
  if (isPvp()) notifyPlayerDied(slot - 1);
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

// Action intents only (movement is now op:"move" — see onMove). The
// blanket lastSeq advance that used to live here is gone: under guest-
// authoritative movement only a *resolved step* touches lastSeq (accept at
// snap, reject immediately), so actions/faces share the seq counter but
// must not bump the ack.
function onInput(m) {
  if (!m || typeof m.intent !== "string") return;
  const from = m.from;
  if (!from) return;
  const slot = guestSlotByPlayerId.get(from);
  if (!slot) return;
  applyIntent(slot, m.intent, from, m);
}

function applyIntent(slot, intent, from, msg) {
  if (intent !== "interact" && intent !== "shoot" && intent !== "melee") return;
  // Range first — actionCooldownOk has the side effect of stamping the
  // bucket, so checking it before a definite reject would lock out a
  // legit guest who mashes the button during death animation.
  if (!actionRangeOk(slot)) return;
  if (!actionCooldownOk(from, intent)) return;
  // Face the way the action fires before dispatch so ordering vs a face
  // update can't matter — the guest ships `d` on every action intent.
  if (typeof msg?.d === "string") {
    const avatar = playerForSlot(stateGetter?.(), slot);
    if (avatar) avatar.direction = msg.d;
  }
  dispatchActionForSlot(slot, intent);
}

// Guest committed tile-step / face update. The host validates legality
// (adjacency from-tile + canEnter via applyNetStep) and executes; it no
// longer runs movement decisions for guest avatars. See
// guest-authoritative-movement.md.
function onMove(m) {
  if (!m || typeof m.k !== "string") return;
  const from = m.from;
  if (!from) return;
  const slot = guestSlotByPlayerId.get(from);
  if (!slot) return;
  const state = stateGetter?.();
  if (!state) return;
  const avatar = playerForSlot(state, slot);
  if (!avatar) return;
  const dead = isPlayerDead(avatar.index | 0);
  if (m.k === "face") {
    // Faces never touch lastSeq (not reconciled). A dead guest doesn't turn.
    if (!dead && !avatar.step && typeof m.d === "string") avatar.direction = m.d;
    return;
  }
  if (m.k !== "step") return;
  if (dead) { ackStep(from, m.seq); return; }   // reject: tile unchanged, lastSeq advances
  onStep(avatar, m, from, state.zone);
}

function onStep(avatar, m, from, zone) {
  const { fx, fy, tx, ty, d, seq } = m;
  // From-tile check: the commit must originate at the avatar's chain tip
  // (its current tile when idle, or the target of the last in-flight/queued
  // step). After a host displacement the guest commits from a stale tile
  // for ~1 RTT; those reject until the next delta snaps it.
  const tip = chainTip(avatar);
  if (fx !== tip.x || fy !== tip.y) { ackStep(from, seq); return; }   // reject
  if (avatar.step) {
    // Mid-step: queue for consumption at the snap. lastSeq waits until it
    // resolves (accept→snap, or reject) in updateGuestAvatar.
    avatar.netQueuedSteps.push({ d, tx, ty, seq });
    return;
  }
  // Idle: execute now. Accept iff a step was produced and its target is the
  // tile the guest claimed; ack waits for the snap. Otherwise reject.
  if (applyNetStep(avatar, d, zone)
      && avatar.step.toX === tx && avatar.step.toY === ty) {
    avatar.netStepSeq = seq;
  } else {
    avatar.step = null;
    ackStep(from, seq);
  }
}

// The avatar's chain tip — where its next committed step must start from.
function chainTip(avatar) {
  const q = avatar.netQueuedSteps;
  if (q && q.length) { const t = q[q.length - 1]; return { x: t.tx, y: t.ty }; }
  if (avatar.step) return { x: avatar.step.toX, y: avatar.step.toY };
  return { x: avatar.tileX, y: avatar.tileY };
}

// Advance a guest's lastSeq to a resolved step's seq (monotonic). Shared by
// the reject paths here and player.updateGuestAvatar's accept/queued-reject
// snaps via setGuestAckSink.
function ackStep(from, seq) {
  if (typeof seq !== "number") return;
  const prev = lastSeqOut[from] ?? 0;
  if (seq > prev) lastSeqOut[from] = seq;
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
