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

import { SPRITE_SHEET_HEROES, ANIMATIONS_FPS } from "./constants.js?v=20260528f";
import { loadZone } from "./data.js?v=20260528f";
import { buildZone } from "./zone.js?v=20260528f";
import { setupCutscenes } from "./cutscenes.js?v=20260528f";
import { evictZoneCache } from "./zoneCache.js?v=20260528f";

export const INTERP_DELAY_MS = 100;
const STALE_MS = 300;
const DEAD_MS = 5000;
// Auto-resync: after the mirror has been stale for this long, ask the
// host for a fresh full snapshot. STALE_MS already gates the toast UI;
// the resync is a separate threshold, deliberately higher so a typical
// network hiccup (which the next 50 ms broadcaster tick recovers from)
// doesn't pile resync requests on top of the recovery deltas.
const RESYNC_AFTER_STALE_MS = 1000;
const RESYNC_MIN_INTERVAL_MS = 2000;

const HERO_BASE_X = 1;
const HERO_BASE_Y = 1;
const HERO_FRAME_W = 1;
const HERO_FRAME_H = 2;
const HERO_FRAME_COUNT = 4;
const HERO_COLUMN_STRIDE = 4;

// Forward extrapolation during continuous motion. The broadcaster's
// sigPlayer omits x/y to save bandwidth, so a moving avatar only emits
// ~2 deltas per 220 ms tile-step (start + end). Without extrapolation
// the renderer (back-dated by INTERP_DELAY_MS) sat at curr for ~100 ms
// between every step → the "buttery 50% + frozen 50%" choppiness.
// When curr.moving=true and renderTime exceeds currAt, we project
// forward at the host's step speed in curr.direction, capped at the
// next-tile boundary so we never predict past one chained step.
// A fresh delta arrives within ~200 ms in normal motion and the lerp
// resumes from the extrapolated point (prev becomes the old curr, so
// the handoff is continuous). The cap means a stop-after-running can
// snap back at most one tile — in practice much less, because the
// inter-delta gap is ~50 ms when sig flips.
const STEP_DURATION_MS = 220;
const STEP_TILES_PER_MS = 1 / STEP_DURATION_MS;
const DIR_DELTA = {
  up:    { x:  0, y: -1 },
  down:  { x:  0, y:  1 },
  left:  { x: -1, y:  0 },
  right: { x:  1, y:  0 },
};

let zone = null;
let zonePromise = null;
let pendingZoneId = null;
let players = new Map();   // playerId -> { prev, curr, prevAt, currAt }
let entitySnaps = new Map(); // entityId -> { prev, curr, prevAt, currAt }
let lastFrameAt = 0;
let readyCbs = [];
let isReady = false;
let unsubs = [];
let netRef = null;
// -Infinity so the first requestResync() after install isn't accidentally
// throttled against the t=0 sentinel.
let lastResyncRequestAt = -Infinity;
let resyncTimer = null;

export function installMirrorWorld(net, opts = {}) {
  uninstallMirrorWorld();
  if (!net) return;
  netRef = net;
  unsubs.push(net.on("snapshot", (m) => handleSnapshot(m, opts)));
  unsubs.push(net.on("delta", handleDelta));
  // Without these the departed peer's last-known interpolated frame
  // keeps rendering forever (the host stops shipping the player in its
  // delta but mirror's `players` map keeps the stale entry).
  unsubs.push(net.on("peer.left", (m) => handlePeerLeft(m)));
  // Auto-resync watchdog: if no delta has landed for RESYNC_AFTER_STALE_MS
  // ask the host for a fresh full snapshot. Idempotent — the host's
  // broadcaster reuses sendFullSnapshot which other ghosted mirrors in
  // the same session also benefit from.
  const checkMs = opts.resyncCheckMs ?? 500;
  resyncTimer = setInterval(maybeRequestResync, checkMs);
  if (resyncTimer.unref) resyncTimer.unref();
}

export function uninstallMirrorWorld() {
  for (const u of unsubs) { try { u(); } catch { /* ignore */ } }
  unsubs = [];
  if (resyncTimer) { clearInterval(resyncTimer); resyncTimer = null; }
  netRef = null;
  lastResyncRequestAt = -Infinity;
  if (zone) evictZoneCache(zone);
  zone = null;
  zonePromise = null;
  pendingZoneId = null;
  players.clear();
  entitySnaps.clear();
  lastFrameAt = 0;
  isReady = false;
  readyCbs = [];
}

// Public seam for tests + a manual "refetch" button if we ever need it.
// Returns true if the request actually went out, false if it was
// throttled or the net isn't connected.
export function requestResync(now = nowMs()) {
  if (!netRef?.isConnected?.()) return false;
  if (now - lastResyncRequestAt < RESYNC_MIN_INTERVAL_MS) return false;
  lastResyncRequestAt = now;
  netRef.send({ op: "guest.resync" });
  return true;
}

function maybeRequestResync() {
  if (!isReady || lastFrameAt === 0) return;
  const now = nowMs();
  if (now - lastFrameAt > RESYNC_AFTER_STALE_MS) {
    requestResync(now);
  }
}

export function _getLastResyncAtForTesting() { return lastResyncRequestAt; }

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

export function handlePeerLeft(msg) {
  if (!msg || !msg.playerId) return;
  players.delete(msg.playerId);
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
    // Drop the outgoing zone's bake before we overwrite the only
    // strong reference to its zone object. WeakMap would free it
    // eventually; this just makes the canvases collectable in the
    // same task as the zone swap rather than next-GC-pass.
    if (zone && zone !== z) evictZoneCache(zone);
    zone = z;
    // The host's snapshot ships dynamic state only — cutscene
    // definitions come from the level JSON. Initialize them on the
    // mirror so event:cutsceneStart can flip _isPlaying on the right
    // entry and drawCutscenes has something to paint.
    setupCutscenes(zone);
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
    const merged = { ...prev.curr, ...p };
    const wasMoving = !!prev.curr?.moving;
    const isMoving = !!merged.moving;
    // Stamp the moment a step starts so animation phase is anchored to
    // the step instead of a free-running clock. Once moving, the timer
    // keeps running across consecutive tile-steps — only an
    // idle→moving transition rewinds the phase to frame 0.
    const stepStartedAt = isMoving && !wasMoving ? t : (prev.stepStartedAt || 0);
    players.set(p.playerId, {
      prev: prev.curr,
      curr: merged,
      prevAt: prev.currAt,
      currAt: t,
      stepStartedAt,
    });
  } else {
    players.set(p.playerId, {
      prev: p,
      curr: p,
      prevAt: t,
      currAt: t,
      stepStartedAt: p.moving ? t : 0,
    });
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

// Interpolate every mirrored entity's frame.x / frame.y between its
// last two snapshots and write the result to zone.entities. Called once
// per render frame from tickGuestFrame so animated entities (mobs,
// pushables, projectiles) slide smoothly instead of teleporting at the
// broadcaster's 20 Hz tick rate. Static entities lerp from prev=curr
// → no visible change, no cost beyond the per-frame alloc.
//
// renderTime is back-dated by INTERP_DELAY_MS so we're interpolating
// inside the already-arrived sample window, never extrapolating beyond
// the latest curr. (Forward extrapolation for "still moving past
// currAt" needs a `moving` flag in serializeEntity — Proposal #6 — and
// is parked for a follow-up.)
export function refreshMirrorEntities(at = nowMs()) {
  if (!zone) return;
  const renderTime = at - INTERP_DELAY_MS;
  const list = [];
  for (const snap of entitySnaps.values()) {
    if (!snap.curr) continue;
    list.push(interpolateEntity(snap, renderTime));
  }
  zone.entities = list;
}

function interpolateEntity({ prev, curr, prevAt, currAt }, renderTime) {
  const out = { ...curr };
  if (curr.frame) out.frame = { ...curr.frame };
  if (!prev || !prev.frame || !curr.frame) return out;
  const span = currAt - prevAt;
  if (span <= 0) return out;
  let t = (renderTime - prevAt) / span;
  if (t < 0) t = 0;
  if (t > 1) t = 1;
  const px = prev.frame.x ?? curr.frame.x;
  const py = prev.frame.y ?? curr.frame.y;
  const cx = curr.frame.x ?? px;
  const cy = curr.frame.y ?? py;
  out.frame.x = px + (cx - px) * t;
  out.frame.y = py + (cy - py) * t;
  return out;
}

function interpolatePlayer({ prev, curr, prevAt, currAt, stepStartedAt }, renderTime) {
  const baseFrame = heroFrameForIndex(curr.index | 0);
  const span = currAt - prevAt;
  let t = span > 0 ? (renderTime - prevAt) / span : 1;
  if (t < 0) t = 0; if (t > 1) t = 1;
  const sx = (prev?.x ?? curr.x);
  const sy = (prev?.y ?? curr.y);
  const cx = (curr.x ?? sx);
  const cy = (curr.y ?? sy);
  let x = sx + (cx - sx) * t;
  let y = sy + (cy - sy) * t;
  if (curr.moving && renderTime > currAt) {
    const dir = DIR_DELTA[(curr.direction || "").toLowerCase()];
    if (dir && (dir.x !== 0 || dir.y !== 0)) {
      const ahead = (renderTime - currAt) * STEP_TILES_PER_MS;
      const targetX = curr.tileX + dir.x;
      const targetY = curr.tileY + dir.y;
      x = cx + dir.x * ahead;
      y = cy + dir.y * ahead;
      if (dir.x > 0 && x > targetX) x = targetX;
      else if (dir.x < 0 && x < targetX) x = targetX;
      if (dir.y > 0 && y > targetY) y = targetY;
      else if (dir.y < 0 && y < targetY) y = targetY;
    }
  }
  const animFrame = curr.moving
    ? Math.floor((renderTime - (stepStartedAt || 0)) * ANIMATIONS_FPS / 1000) % HERO_FRAME_COUNT
    : 0;
  return {
    index: curr.index | 0,
    playerId: curr.playerId,
    slot: curr.slot,
    x,
    y,
    tileX: curr.tileX,
    tileY: curr.tileY,
    direction: curr.direction || "down",
    moving: !!curr.moving,
    sheetId: SPRITE_SHEET_HEROES,
    baseFrame,
    frameCount: HERO_FRAME_COUNT,
    frameIndex: animFrame < 0 ? 0 : animFrame,
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

function nowMs() {
  return typeof performance !== "undefined" && performance?.now
    ? performance.now()
    : Date.now();
}
