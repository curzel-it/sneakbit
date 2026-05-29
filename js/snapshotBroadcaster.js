// Host-only: samples the live game state at 20 Hz and emits sparse
// `delta` frames over the net module. Sends a fresh full `snapshot` on
// every peer.joined / peer.rejoined so newcomers get the authoritative
// world without waiting for things to change. The host's own game tick
// is untouched — the broadcaster only reads.
//
// The broadcaster also keeps a per-entity signature so unchanged things
// stop after one delta, fitting the 50–100 KB/s budget called out in
// docs/online-coop.md at the snapshot section.

import { getNet, getNetRole, getSelfPlayerId } from "./onlineBootstrap.js?v=20260529d";
import { getPlayerHp } from "./playerHealth.js?v=20260529d";
import { getLastSeqMap } from "./hostGuests.js?v=20260529d";
import { broadcastHostEvent } from "./hostEvents.js?v=20260529d";
import { shouldBeVisible } from "./entityVisibility.js?v=20260529d";

export const BROADCAST_INTERVAL_MS = 50;

// Quiescent-world keepalive. When buildDelta finds nothing changed the
// host would otherwise fall silent, and the guest's mirror crosses
// STALE_MS (mirrorWorld, 300 ms) and falsely flashes "Host lagging…".
// After this many consecutive empty ticks we ship an empty `delta` so
// the mirror's lastFrameAt keeps advancing. 4 * 50 ms = 200 ms, well
// inside the staleness window. Reusing the `delta` op means it rides the
// existing DataChannel/relay path with no new wire op and the mirror's
// handleDelta refreshes lastFrameAt with zero state churn.
const KEEPALIVE_TICKS = 4;

let timer = null;
let stateGetter = null;
let tickCount = 0;
let quietTicks = 0;
let lastPlayerSigs = new Map();
let lastEntitySigs = new Map();
let knownEntityIds = new Set();
let unsubs = [];
let lastZoneId = null;
// Per-playerId last-broadcast hp. Used by emitHpTransitions to fire a
// single event:death (or event:respawn) on a 0-crossing — the snapshot
// already ships hp as a number, but discrete UI flips (guest's gameOver
// overlay, audio sting) want a rising-edge signal, not a steady-state.
let lastHpByPlayerId = new Map();

export function installSnapshotBroadcaster(getState, opts = {}) {
  if (getNetRole() !== "host") return false;
  stopSnapshotBroadcaster();
  stateGetter = getState;
  const intervalMs = opts.intervalMs ?? BROADCAST_INTERVAL_MS;
  const net = opts.net ?? getNet();
  if (!net) return false;
  unsubs.push(net.on("peer.joined", () => sendFullSnapshot(net)));
  unsubs.push(net.on("peer.rejoined", () => sendFullSnapshot(net)));
  // Guest-driven resync: when a guest's mirror has gone stale (no
  // delta for >1s) it asks the host for a fresh baseline. The relay
  // routes the request to us host-bound. Reuse sendFullSnapshot so the
  // snapshot fans out to every guest — refreshing other lagging
  // mirrors at no extra cost.
  unsubs.push(net.on("guest.resync", () => sendFullSnapshot(net)));
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
  lastHpByPlayerId.clear();
  tickCount = 0;
  quietTicks = 0;
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
    // travelTo() revives every dead guest as part of zone entry (mirror
    // of offline coop's revive-on-zone-change). Emit event:respawn for
    // them BEFORE sendFullSnapshot — buildSnapshot wipes lastHpByPlayerId,
    // so the 0→nonzero edge would otherwise be lost and the guest's
    // "Waiting for the host…" overlay would stay up in the new zone.
    emitRespawnsForRevivedPlayers(state);
    sendFullSnapshot(net);
    quietTicks = 0;
    return;
  }
  const msg = buildDelta(state);
  if (!msg) {
    // Nothing changed this tick. Keep the guest's mirror fresh with a
    // periodic empty delta (see KEEPALIVE_TICKS) so it doesn't flash
    // "Host lagging…" whenever the world goes quiet.
    if (++quietTicks >= KEEPALIVE_TICKS) {
      net.send(buildKeepalive(state));
      quietTicks = 0;
    }
    return;
  }
  quietTicks = 0;
  net.send(msg);
}

// Keepalive sent during quiescence (buildDelta found nothing changed).
// Carries every player's authoritative position — cheap, a handful of
// bytes per player — so the guest's predicted-self reconciliation keeps
// running even when no sig changed. This is the load-bearing half of the
// stuck-avatar fix: a player jammed against a blocker has a frozen
// tile/direction, so it's filtered out of buildDelta and, with both
// avatars otherwise quiescent, the host would emit only empty keepalives.
// Without its position here the guest can't tell its avatar diverged and
// predicted runs away unbounded (the 24-tile snap from the tree/loop
// repro). Entities stay empty — they're the bandwidth bulk and a
// genuinely static entity needs no refresh. The mirror ingests these
// positions; for a non-moving avatar that's a no-op lerp (same tile).
function buildKeepalive(state) {
  return {
    op: "delta",
    t: tickCount++,
    zoneId: state.zone.id,
    players: playersOf(state).map(serializePlayer).filter(Boolean),
    entities: [],
    lastSeq: getLastSeqMap(),
  };
}

function sendFullSnapshot(net) {
  if (!net?.isConnected?.()) return;
  const state = stateGetter?.();
  if (!state?.zone) return;
  const msg = buildSnapshot(state);
  net.send(msg);
}

function buildDelta(state) {
  const { changed, all } = playerDeltas(state);
  const { changed: entities, removed } = entityDeltas(state);
  // Decision to send is still sig-gated (changed players / entities), but
  // the payload carries ALL players so an unchanged-but-present avatar
  // (e.g. one stuck on a blocker while the host's own avatar moves) still
  // reaches the guest for reconciliation.
  if (!changed.length && !entities.length && !removed.length) return null;
  const msg = {
    op: "delta",
    t: tickCount++,
    zoneId: state.zone.id,
    players: all,
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
  serializeEntityResetWarnings();
  lastZoneId = state.zone.id;
  const players = playersOf(state).map(serializePlayer).filter(Boolean);
  const entities = (state.zone?.entities || []).map(serializeEntity).filter(Boolean);
  for (const p of players) lastPlayerSigs.set(p.playerId, sigPlayer(p));
  for (const e of entities) {
    lastEntitySigs.set(e.id, sigEntity(e));
    knownEntityIds.add(e.id);
  }
  // Seed hp baselines on a full snapshot. We do NOT emit transitions
  // here — a fresh joiner shouldn't replay every death/respawn that
  // happened before they connected.
  lastHpByPlayerId.clear();
  for (const p of players) lastHpByPlayerId.set(p.playerId, p.hp);
  return {
    op: "snapshot",
    t: tickCount++,
    zoneId: state.zone.id,
    players,
    entities,
    lastSeq: getLastSeqMap(),
  };
}

// Returns { changed, all }. `changed` drives whether a delta fires at all
// (the sig-diff that keeps bandwidth down); `all` is what actually ships.
// We send every player's position whenever we send anything, because a
// player stuck against a blocker on the host has a frozen sig and would
// otherwise never reach the guest — leaving the guest's predicted self to
// run away unbounded until the player finally moves. Players are a handful
// of bytes each; entities (the bulk) keep their changed-only treatment.
function playerDeltas(state) {
  const changed = [];
  const all = [];
  for (const slot of playersOf(state)) {
    const p = serializePlayer(slot);
    if (!p) continue;
    all.push(p);
    const sig = sigPlayer(p);
    if (lastPlayerSigs.get(p.playerId) !== sig) {
      lastPlayerSigs.set(p.playerId, sig);
      changed.push(p);
    }
  }
  emitHpTransitions(all);
  return { changed, all };
}

// Zone-change path companion to emitHpTransitions. Walks current
// players, fires event:respawn for any who were dead in the previous
// zone and are alive now (transitions.js resets HP on entry). Called
// BEFORE buildSnapshot, which clears lastHpByPlayerId — without this
// the rising edge would be lost across zone boundaries and the guest's
// "Waiting for the host…" overlay would never dismiss.
function emitRespawnsForRevivedPlayers(state) {
  const players = playersOf(state).map(serializePlayer).filter(Boolean);
  for (const p of players) {
    const prev = lastHpByPlayerId.get(p.playerId);
    const cur = typeof p.hp === "number" ? p.hp : 100;
    if (prev !== undefined && prev <= 0 && cur > 0) {
      broadcastHostEvent("respawn", { playerId: p.playerId });
    }
  }
}

// Watch each tracked player's hp for a 0-crossing and emit a one-shot
// event so guests can drive UI off it (gameOver overlay on self, toasts
// on peers). Steady-state hp is already in the delta — this is only for
// the rising edge. First sample for a player seeds without emission.
function emitHpTransitions(players) {
  for (const p of players) {
    const prev = lastHpByPlayerId.get(p.playerId);
    const cur = typeof p.hp === "number" ? p.hp : 100;
    if (prev !== undefined) {
      if (prev > 0 && cur <= 0) {
        broadcastHostEvent("death", { playerId: p.playerId });
      } else if (prev <= 0 && cur > 0) {
        broadcastHostEvent("respawn", { playerId: p.playerId });
      }
    }
    lastHpByPlayerId.set(p.playerId, cur);
  }
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

// Dev-only warn ledger so we don't spam the console once per delta
// (20 Hz × ~50 entities = a wall of duplicates). One log per offending
// species/null-bucket. Cleared on every full snapshot via
// `serializeEntityResetWarnings()` so the same offender re-surfaces if
// it shows up in a fresh zone.
const seenMissingIdSigs = new Set();
function warnMissingId(e) {
  if (typeof console === "undefined") return;
  const sig = e ? `species:${e.species_id ?? "?"}` : "null-entity";
  if (seenMissingIdSigs.has(sig)) return;
  seenMissingIdSigs.add(sig);
  console.warn("[broadcaster] dropping entity with missing id", sig, e);
}
function serializeEntityResetWarnings() { seenMissingIdSigs.clear(); }
export const _serializeEntityResetWarningsForTesting = serializeEntityResetWarnings;

function serializeEntity(e) {
  if (!e || e.id == null) { warnMissingId(e); return null; }
  // Host-authoritative visibility. An entity the host hides — a pickup
  // already collected (item_collected.<id>) or a story-flag-gated NPC
  // (display_conditions) — must not reach guests. That hidden state lives
  // in the host's own localStorage and isn't shipped, so the guest can't
  // reproduce it: without this gate the host would broadcast a kunai it
  // picked up in an earlier session (buildZone keeps collected entities in
  // zone.entities, hidden only at render/pickup time), and the guest —
  // lacking the host's item_collected flag — would render it. This is the
  // same gate the renderer/pickup/collision paths use, so the wire set is
  // exactly what the host sees. An entity that flips to hidden mid-session
  // drops out of `seen` in entityDeltas and rides out via removed.entities.
  if (!shouldBeVisible(e)) return null;
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
  // Mobs animate their walk cycle from a `moving` flag the guest can't
  // derive (the host's `_ai.step` never crosses the wire). Ship an
  // explicit boolean for AI entities — always present so a stop clears
  // the previous merged `moving:true` rather than leaving it stale.
  if (e._ai) out.moving = !!e._ai.step;
  return out;
}

// Per-player change signature. Drives whether a player goes into the
// outbound delta. We deliberately omit x/y here even though they're in
// the payload — during a tile step the floats change every tick but
// tileX/tileY/direction/moving stay put, so signing on x/y would emit
// ~5 records per step (one per BROADCAST_INTERVAL_MS at the host's
// 20 Hz). With x/y dropped, the only sig changes during a step are the
// endpoints: moving=true at step start, tileX/tileY change at step
// end. The mirror's lerp between those two payloads still reconstructs
// the float path — receive-time interval ≈ step duration, and lerp
// across (oldTile→newTile) over that interval gives the same visual
// result as today, with ~80 records/sec less traffic in a four-player
// session.
function sigPlayer(p) {
  return [
    p.tileX, p.tileY,
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
    e._ai?.step ? 1 : 0,
  ].join("|");
}

function round3(n) {
  if (typeof n !== "number" || !Number.isFinite(n)) return n;
  return Math.round(n * 1000) / 1000;
}
