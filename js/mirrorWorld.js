// Guest-side mirror of the host's authoritative world. Ingests `snapshot`
// (replace) and `delta` (merge) frames, holds the last two timed samples
// per entity for interpolation, and exposes the result through getters
// shaped like the offline `state` so the existing renderer can draw it
// without modification.
//
// Static zone data (biome / construction tiles) is NOT shipped over the
// wire — the host and guest share the same level files, so the mirror
// loads them locally on the first snapshot or zone change and only
// overwrites `zone.entities` from network frames.

import { SPRITE_SHEET_HEROES } from "./constants.js";
import { loadZone } from "./data.js";
import { buildZone } from "./zone.js";

export const INTERP_DELAY_MS = 100;
const STALE_MS = 300;
const DEAD_MS = 5000;

const HERO_BASE_X = 1;
const HERO_BASE_Y = 1;
const HERO_FRAME_W = 1;
const HERO_FRAME_H = 2;
const HERO_FRAME_COUNT = 4;
const HERO_COLUMN_STRIDE = 4;

let zone = null;
let zonePromise = null;
let pendingZoneId = null;
let players = new Map();   // playerId -> { prev, curr, prevAt, currAt }
let entitySnaps = new Map(); // entityId -> { prev, curr, prevAt, currAt }
let lastFrameAt = 0;
let readyCbs = [];
let isReady = false;
let unsubs = [];

export function installMirrorWorld(net, opts = {}) {
  uninstallMirrorWorld();
  if (!net) return;
  unsubs.push(net.on("snapshot", (m) => handleSnapshot(m, opts)));
  unsubs.push(net.on("delta", handleDelta));
}

export function uninstallMirrorWorld() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  zone = null;
  zonePromise = null;
  pendingZoneId = null;
  players.clear();
  entitySnaps.clear();
  lastFrameAt = 0;
  isReady = false;
  readyCbs = [];
}

export function getMirrorZone() { return zone; }
export function isMirrorReady() { return isReady && !!zone; }
export function getMirrorLastFrameAt() { return lastFrameAt; }

export function isMirrorStale(at = nowMs()) {
  return lastFrameAt > 0 && (at - lastFrameAt) > STALE_MS;
}

export function isMirrorDead(at = nowMs()) {
  return lastFrameAt > 0 && (at - lastFrameAt) > DEAD_MS;
}

export function onMirrorReady(fn) {
  if (isReady) { try { fn(); } catch { /* ignore */ } return () => {}; }
  readyCbs.push(fn);
  return () => { readyCbs = readyCbs.filter((c) => c !== fn); };
}

// Returns mirror players as objects shaped like js/player.js — the
// renderer/entities modules read direction, x/y, frameIndex, etc.
// Positions are time-lerped between the last two received samples.
export function getMirrorPlayers(at = nowMs()) {
  const render = at - INTERP_DELAY_MS;
  const out = [];
  for (const slot of players.values()) {
    out.push(interpolatePlayer(slot, render));
  }
  out.sort((a, b) => (a.slot || 0) - (b.slot || 0));
  return out;
}

export function getMirrorPlayerById(playerId, at = nowMs()) {
  const slot = players.get(playerId);
  if (!slot) return null;
  return interpolatePlayer(slot, at - INTERP_DELAY_MS);
}

// Internal: synchronously apply a snapshot. Loads the zone first if
// needed; reads of getMirrorZone()/isMirrorReady() flip to true once the
// loader resolves and the snapshot is replayed.
export function handleSnapshot(msg, opts = {}) {
  if (!msg || msg.zoneId == null) return;
  if (!zone || zone.id !== msg.zoneId) {
    return loadZoneAndApplySnapshot(msg, opts);
  }
  applySnapshotToCurrentZone(msg);
}

export function handleDelta(msg) {
  if (!msg || !zone || zone.id !== msg.zoneId) return;
  const t = nowMs();
  for (const p of msg.players || []) ingestPlayer(p, t);
  for (const e of msg.entities || []) ingestEntity(e, t);
  if (msg.removed?.entities) {
    for (const id of msg.removed.entities) entitySnaps.delete(id);
  }
  rebuildZoneEntities();
  lastFrameAt = t;
}

async function loadZoneAndApplySnapshot(msg, opts) {
  const zoneId = msg.zoneId;
  if (pendingZoneId === zoneId && zonePromise) {
    await zonePromise;
    if (zone?.id === zoneId) applySnapshotToCurrentZone(msg);
    return;
  }
  pendingZoneId = zoneId;
  const loader = opts.zoneLoader || ((id) => loadZone(id).then(buildZone));
  zonePromise = loader(zoneId);
  try {
    const z = await zonePromise;
    if (pendingZoneId !== zoneId) return; // superseded
    zone = z;
    pendingZoneId = null;
    zonePromise = null;
    applySnapshotToCurrentZone(msg);
  } catch (e) {
    console.error("mirror: zone load failed", zoneId, e);
    pendingZoneId = null;
    zonePromise = null;
  }
}

function applySnapshotToCurrentZone(msg) {
  const t = nowMs();
  // A snapshot is authoritative: drop any state we'd been holding.
  players.clear();
  entitySnaps.clear();
  for (const p of msg.players || []) ingestPlayer(p, t);
  for (const e of msg.entities || []) ingestEntity(e, t);
  rebuildZoneEntities();
  lastFrameAt = t;
  if (!isReady) {
    isReady = true;
    for (const cb of readyCbs.splice(0)) { try { cb(); } catch { /* ignore */ } }
  }
}

function ingestPlayer(p, t) {
  if (!p || !p.playerId) return;
  const prev = players.get(p.playerId);
  if (prev) {
    players.set(p.playerId, {
      prev: prev.curr,
      curr: { ...prev.curr, ...p },
      prevAt: prev.currAt,
      currAt: t,
    });
  } else {
    players.set(p.playerId, { prev: p, curr: p, prevAt: t, currAt: t });
  }
}

function ingestEntity(e, t) {
  if (!e || e.id == null) return;
  const prev = entitySnaps.get(e.id);
  const merged = mergeEntity(prev?.curr, e);
  entitySnaps.set(e.id, {
    prev: prev ? prev.curr : merged,
    curr: merged,
    prevAt: prev ? prev.currAt : t,
    currAt: t,
  });
}

function mergeEntity(prev, incoming) {
  if (!prev) return cloneEntity(incoming);
  const out = { ...prev, ...incoming };
  if (incoming.frame || prev.frame) {
    out.frame = { ...(prev.frame || {}), ...(incoming.frame || {}) };
  }
  return out;
}

function cloneEntity(e) {
  const out = { ...e };
  if (e.frame) out.frame = { ...e.frame };
  return out;
}

function rebuildZoneEntities() {
  if (!zone) return;
  const list = [];
  for (const snap of entitySnaps.values()) {
    if (snap.curr) list.push(snap.curr);
  }
  zone.entities = list;
}

function interpolatePlayer({ prev, curr, prevAt, currAt }, renderTime) {
  const baseFrame = heroFrameForIndex(curr.index | 0);
  const animFrame = pickAnimFrame(currAt);
  const span = currAt - prevAt;
  let t = span > 0 ? (renderTime - prevAt) / span : 1;
  if (t < 0) t = 0; if (t > 1) t = 1;
  const sx = (prev?.x ?? curr.x);
  const sy = (prev?.y ?? curr.y);
  return {
    index: curr.index | 0,
    playerId: curr.playerId,
    slot: curr.slot,
    x: sx + ((curr.x ?? sx) - sx) * t,
    y: sy + ((curr.y ?? sy) - sy) * t,
    tileX: curr.tileX,
    tileY: curr.tileY,
    direction: curr.direction || "down",
    moving: !!curr.moving,
    sheetId: SPRITE_SHEET_HEROES,
    baseFrame,
    frameCount: HERO_FRAME_COUNT,
    frameIndex: animFrame,
    frameTimer: 0,
    step: curr.moving ? { progress: t } : null,
  };
}

function heroFrameForIndex(index) {
  return {
    x: HERO_BASE_X + (index | 0) * HERO_COLUMN_STRIDE,
    y: HERO_BASE_Y,
    w: HERO_FRAME_W,
    h: HERO_FRAME_H,
  };
}

// Cycle the walk-strip locally — same FPS the host runs at — so animation
// stays smooth even when snapshots only carry positional changes.
function pickAnimFrame(_currAt) {
  const t = nowMs();
  return Math.floor((t / 120) % HERO_FRAME_COUNT);
}

function nowMs() {
  return typeof performance !== "undefined" && performance?.now
    ? performance.now()
    : Date.now();
}
