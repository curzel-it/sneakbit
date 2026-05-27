// Host-only: samples the live game state at 20 Hz and emits sparse
// `delta` frames over the net module. Sends a fresh full `snapshot` on
// every peer.joined / peer.rejoined so newcomers get the authoritative
// world without waiting for things to change. The host's own game tick
// is untouched — the broadcaster only reads.
//
// The broadcaster also keeps a per-entity signature so unchanged things
// stop after one delta, fitting the 50–100 KB/s budget called out in
// docs/server.md at the snapshot section.

import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js?v=20260527b";
import { getPlayerHp } from "./playerHealth.js?v=20260527b";
import { getLastSeqMap } from "./hostGuests.js?v=20260527b";

export const BROADCAST_INTERVAL_MS = 50;

let timer = null;
let stateGetter = null;
let tickCount = 0;
let lastPlayerSigs = new Map();
let lastEntitySigs = new Map();
let knownEntityIds = new Set();
let unsubs = [];
let lastZoneId = null;

export function installSnapshotBroadcaster(getState, opts = {}) {
  if (getNetRole() !== "host") return false;
  stopSnapshotBroadcaster();
  stateGetter = getState;
  const intervalMs = opts.intervalMs ?? BROADCAST_INTERVAL_MS;
  const net = opts.net ?? getNet();
  if (!net) return false;
  unsubs.push(net.on("peer.joined", () => sendFullSnapshot(net)));
  unsubs.push(net.on("peer.rejoined", () => sendFullSnapshot(net)));
  timer = setInterval(() => broadcastDelta(net), intervalMs);
  return true;
}

export function stopSnapshotBroadcaster() {
  if (timer) { clearInterval(timer); timer = null; }
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  lastPlayerSigs.clear();
  lastEntitySigs.clear();
  knownEntityIds = new Set();
  tickCount = 0;
  lastZoneId = null;
}

export function _broadcastDeltaForTesting(net, state) {
  return buildDelta(state);
}

export function _snapshotForTesting(state) {
  return buildSnapshot(state);
}

function broadcastDelta(net) {
  if (!net?.isConnected?.()) return;
  const state = stateGetter?.();
  if (!state?.zone) return;
  // Zone changed under us (travelTo completed). Send event:zoneChange
  // first so guests can fade their own overlay, THEN ship a fresh full
  // snapshot — the diff machinery isn't useful when the entity set has
  // been wholesale replaced.
  if (lastZoneId !== state.zone.id) {
    // Order matters: emit event:zoneChange first so guests can start
    // their fade-out overlay BEFORE the new-zone snapshot arrives and
    // mirrorWorld swaps zones underneath them. Otherwise the guest sees
    // an unblended mid-frame jump as the world is replaced.
    net.send({
      op: "event",
      kind: "zoneChange",
      zoneId: state.zone.id,
      fromZoneId: lastZoneId,
    });
    sendFullSnapshot(net);
    return;
  }
  const msg = buildDelta(state);
  if (!msg) return;
  net.send(msg);
}

function sendFullSnapshot(net) {
  if (!net?.isConnected?.()) return;
  const state = stateGetter?.();
  if (!state?.zone) return;
  const msg = buildSnapshot(state);
  net.send(msg);
}

function buildDelta(state) {
  const players = playerDeltas(state);
  const { changed: entities, removed } = entityDeltas(state);
  if (!players.length && !entities.length && !removed.length) return null;
  const msg = {
    op: "delta",
    t: tickCount++,
    zoneId: state.zone.id,
    players,
    entities,
    lastSeq: getLastSeqMap(),
  };
  if (removed.length) msg.removed = { entities: removed };
  return msg;
}

function buildSnapshot(state) {
  // Reset signatures so the next delta only sends changes from this
  // snapshot's baseline.
  lastPlayerSigs.clear();
  lastEntitySigs.clear();
  knownEntityIds = new Set();
  lastZoneId = state.zone.id;
  const players = playersOf(state).map(serializePlayer).filter(Boolean);
  const entities = (state.zone?.entities || []).map(serializeEntity).filter(Boolean);
  for (const p of players) lastPlayerSigs.set(p.playerId, sigPlayer(p));
  for (const e of entities) {
    lastEntitySigs.set(e.id, sigEntity(e));
    knownEntityIds.add(e.id);
  }
  return {
    op: "snapshot",
    t: tickCount++,
    zoneId: state.zone.id,
    players,
    entities,
    lastSeq: getLastSeqMap(),
  };
}

function playerDeltas(state) {
  const changed = [];
  for (const slot of playersOf(state)) {
    const p = serializePlayer(slot);
    if (!p) continue;
    const sig = sigPlayer(p);
    if (lastPlayerSigs.get(p.playerId) !== sig) {
      lastPlayerSigs.set(p.playerId, sig);
      changed.push(p);
    }
  }
  return changed;
}

function entityDeltas(state) {
  const changed = [];
  const seen = new Set();
  for (const raw of state.zone?.entities || []) {
    const e = serializeEntity(raw);
    if (!e) continue;
    seen.add(e.id);
    const sig = sigEntity(e);
    if (lastEntitySigs.get(e.id) !== sig) {
      lastEntitySigs.set(e.id, sig);
      changed.push(e);
    }
  }
  const removed = [];
  for (const id of knownEntityIds) {
    if (!seen.has(id)) {
      removed.push(id);
      lastEntitySigs.delete(id);
    }
  }
  knownEntityIds = seen;
  return { changed, removed };
}

// state.player is the host's own avatar; state.player2/etc. are the
// guest avatars spawned by hostGuests.js — each carries the guest's
// playerId so we can address it on the wire.
function playersOf(state) {
  const out = [];
  if (state.player) {
    out.push({
      player: state.player,
      slot: 1,
      playerId: getSelfPlayerId(),
    });
  }
  if (state.player2 && state.player2.playerId) {
    out.push({
      player: state.player2,
      slot: state.player2.slot ?? 2,
      playerId: state.player2.playerId,
    });
  }
  if (Array.isArray(state.players)) {
    for (const s of state.players) {
      if (s?.player && s?.playerId) out.push(s);
    }
  }
  return out;
}

function serializePlayer({ player, slot, playerId }) {
  if (!playerId || !player) return null;
  return {
    playerId,
    slot,
    index: player.index | 0,
    x: round3(player.x),
    y: round3(player.y),
    tileX: player.tileX,
    tileY: player.tileY,
    direction: player.direction,
    moving: !!player.moving,
    hp: round3(getPlayerHp(player.index | 0)),
  };
}

function serializeEntity(e) {
  if (!e || e.id == null) return null;
  const out = { id: e.id };
  if (e.species_id != null) out.species_id = e.species_id;
  if (e.frame) {
    out.frame = { x: e.frame.x, y: e.frame.y, w: e.frame.w, h: e.frame.h };
  }
  if (e.hp != null) out.hp = e.hp;
  if (e._open != null) out._open = !!e._open;
  if (e._dead) out._dead = true;
  if (e._spawned) out._spawned = true;
  if (e.direction) out.direction = e.direction;
  return out;
}

function sigPlayer(p) {
  return [
    p.tileX, p.tileY,
    p.x, p.y,
    p.direction,
    p.moving ? 1 : 0,
    p.hp,
    p.slot,
  ].join("|");
}

function sigEntity(e) {
  const f = e.frame || {};
  return [
    e.species_id ?? "",
    f.x ?? "", f.y ?? "", f.w ?? "", f.h ?? "",
    e.hp ?? "",
    e._open ? 1 : 0,
    e._dead ? 1 : 0,
    e._spawned ? 1 : 0,
    e.direction ?? "",
  ].join("|");
}

function round3(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return n;
  return Math.round(n * 1000) / 1000;
}
