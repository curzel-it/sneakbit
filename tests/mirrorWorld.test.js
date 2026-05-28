// Mirror world unit tests: snapshot replace, delta merge, removal,
// interpolation between two timed samples. The zone loader is stubbed so
// tests don't touch the network or the disk.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  installMirrorWorld,
  uninstallMirrorWorld,
  handleSnapshot,
  handleDelta,
  getMirrorZone,
  getMirrorPlayers,
  getMirrorPlayerById,
  isMirrorReady,
  INTERP_DELAY_MS,
} = await import("../js/mirrorWorld.js?v=20260528f");

function makeFakeZone(id) {
  return { id, rows: 10, cols: 10, entities: [] };
}

async function applySnapshot(msg) {
  await handleSnapshot(msg, {
    zoneLoader: async (id) => makeFakeZone(id),
  });
}

function reset() { uninstallMirrorWorld(); }

test("snapshot loads the zone, populates players + entities, marks ready", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", t: 0, zoneId: 1001,
    players: [{ playerId: "p_host", slot: 1, index: 0, x: 5, y: 5, tileX: 5, tileY: 5, direction: "down" }],
    entities: [{ id: 7, species_id: 50, frame: { x: 1, y: 1, w: 1, h: 1 }, hp: 30 }],
  });
  assert.equal(isMirrorReady(), true);
  const z = getMirrorZone();
  assert.equal(z.id, 1001);
  assert.equal(z.entities.length, 1);
  assert.equal(z.entities[0].id, 7);
  const players = getMirrorPlayers();
  assert.equal(players.length, 1);
  assert.equal(players[0].playerId, "p_host");
  assert.equal(players[0].direction, "down");
  reset();
});

test("delta merges a partial entity update without wiping other fields", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [],
    entities: [{ id: 7, species_id: 50, frame: { x: 1, y: 1, w: 1, h: 1 }, hp: 30 }],
  });
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [],
    entities: [{ id: 7, hp: 12 }],
  });
  const z = getMirrorZone();
  assert.equal(z.entities[0].id, 7);
  assert.equal(z.entities[0].hp, 12);
  assert.equal(z.entities[0].frame.x, 1);
  assert.equal(z.entities[0].species_id, 50);
  reset();
});

test("delta with `removed` drops the entity", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [],
    entities: [
      { id: 7, species_id: 50, frame: { x: 1, y: 1, w: 1, h: 1 } },
      { id: 8, species_id: 51, frame: { x: 2, y: 2, w: 1, h: 1 } },
    ],
  });
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [],
    entities: [],
    removed: { entities: [7] },
  });
  const z = getMirrorZone();
  assert.equal(z.entities.length, 1);
  assert.equal(z.entities[0].id, 8);
  reset();
});

test("delta for a different zone is ignored", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [],
    entities: [{ id: 7, frame: { x: 0, y: 0, w: 1, h: 1 } }],
  });
  handleDelta({
    op: "delta", zoneId: 9999,
    entities: [{ id: 7, hp: 0, _dead: true }],
  });
  const z = getMirrorZone();
  assert.equal(z.entities[0]._dead, undefined);
  reset();
});

test("getMirrorPlayerById returns null for unknown id", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_a", slot: 1, index: 0, x: 1, y: 1, tileX: 1, tileY: 1, direction: "down" }],
    entities: [],
  });
  assert.equal(getMirrorPlayerById("p_missing"), null);
  assert.ok(getMirrorPlayerById("p_a"));
  reset();
});

test("two deltas for the same player produce an interpolated position", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_h", slot: 1, index: 0, x: 0, y: 0, tileX: 0, tileY: 0, direction: "right" }],
    entities: [],
  });
  // Snapshot and delta need a measurable gap for the lerp denominator
  // to be nonzero. 30 ms is plenty given the 100 ms interp delay.
  await new Promise((r) => setTimeout(r, 30));
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_h", slot: 1, index: 0, x: 10, y: 0, tileX: 10, tileY: 0, direction: "right", moving: true }],
    entities: [],
  });
  // Aim renderTime ~halfway between prev and curr.
  // currAt ≈ now; prevAt ≈ now - 30. We want renderTime ≈ prevAt + 15
  // → at ≈ prevAt + 15 + 100 = now - 30 + 15 + 100 = now + 85.
  const at = performance.now() + 85;
  const p = getMirrorPlayerById("p_h", at);
  assert.ok(p);
  assert.ok(p.x > 0 && p.x < 10, `expected interpolated x in (0,10), got ${p.x}`);
  reset();
});

test("endpoint-only step lerp: tile A → tile B over the receive interval reconstructs the float path", async () => {
  // Companion to the snapshot-broadcaster sigPlayer tightening. The
  // host now ships only two samples per step: the step-start delta
  // (moving=true, oldTile floats) and the step-end delta (newTile
  // floats). The mirror's lerp between them must cover the full
  // tile-to-tile transition smoothly — no freeze, no jump. If this
  // test ever fails after the sig change, the float reconstruction
  // is broken and the guest will see avatars teleporting.
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_w", slot: 1, index: 0, x: 5, y: 3, tileX: 5, tileY: 3, direction: "right", moving: false }],
    entities: [],
  });
  // Step START delta — same tile, moving flips true. This is the
  // "old endpoint" — the host still has x=5,y=3 because the step has
  // only just begun.
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_w", x: 5, y: 3, tileX: 5, tileY: 3, direction: "right", moving: true }],
  });
  const stepStart = performance.now();
  // ~220 ms later the step completes and the host emits the end
  // delta with the new tile floats.
  await new Promise((r) => setTimeout(r, 220));
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_w", x: 6, y: 3, tileX: 6, tileY: 3, direction: "right", moving: true }],
  });
  // The lerp uses receive-time intervals; renderTime is back-dated
  // by INTERP_DELAY_MS. Sample three points across the step and
  // confirm x advances strictly between the two endpoints.
  // stepStart was the END delta's receive moment relative to the
  // start delta's; rendering at start+50ms (with the 100ms back-date,
  // so renderTime≈stepStart-50ms = halfway through the lerp window)
  // should land x roughly between 5 and 6.
  const baseAt = performance.now();
  // We want renderTime = stepStart + ~110ms (halfway through 220ms
  // step). renderTime = at - 100, so at = stepStart + 210.
  const mid = getMirrorPlayerById("p_w", stepStart + 210);
  assert.ok(mid.x > 5 && mid.x < 6,
    `mid-step x should lerp between 5 and 6, got ${mid.x}`);
  // Late in the step: x should be closer to 6.
  const late = getMirrorPlayerById("p_w", stepStart + 290);
  assert.ok(late.x > mid.x,
    `x should advance monotonically: ${mid.x} -> ${late.x}`);
  // After currAt elapses while moving=true, the mirror extrapolates
  // forward in curr.direction at the host's step speed. The cap kicks
  // in at the next-tile boundary (7), so a long sample lands at the
  // boundary, not past it.
  const after = getMirrorPlayerById("p_w", baseAt + 500);
  assert.ok(after.x > 6 && after.x <= 7,
    `moving=true after currAt should extrapolate toward next tile, got ${after.x}`);
  reset();
});

test("extrapolation: moving=true past currAt advances at step speed up to one tile", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_e", slot: 1, index: 0, x: 5, y: 3, tileX: 5, tileY: 3, direction: "right", moving: false }],
    entities: [],
  });
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_e", x: 5, y: 3, tileX: 5, tileY: 3, direction: "right", moving: true }],
  });
  const t0 = performance.now();
  // Render 100 ms past currAt (renderTime = currAt + 100, so at = currAt + 200).
  // At STEP_DURATION 220 ms/tile that's ~0.45 tiles forward.
  const e = getMirrorPlayerById("p_e", t0 + 200);
  assert.ok(e.x > 5.3 && e.x < 5.6,
    `expected ~0.45 tiles of forward extrapolation, got ${e.x}`);
  // Render way past currAt (1 s out) — extrapolation caps at the next
  // tile (6), it doesn't run away.
  const capped = getMirrorPlayerById("p_e", t0 + 1100);
  assert.equal(capped.x, 6, `extrapolation must cap at next tile, got ${capped.x}`);
  reset();
});

test("extrapolation: moving=false does NOT extrapolate (rests at curr)", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_s", slot: 1, index: 0, x: 4, y: 2, tileX: 4, tileY: 2, direction: "down", moving: false }],
    entities: [],
  });
  const t0 = performance.now();
  // Idle player, far past currAt — must remain on its tile.
  const p = getMirrorPlayerById("p_s", t0 + 500);
  assert.equal(p.x, 4);
  assert.equal(p.y, 2);
  reset();
});

test("animation phase: idle player renders frame 0", async () => {
  reset();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_idle", slot: 1, index: 0, x: 3, y: 3, tileX: 3, tileY: 3, direction: "down", moving: false }],
    entities: [],
  });
  const p = getMirrorPlayerById("p_idle");
  assert.equal(p.frameIndex, 0);
  reset();
});

test("animation phase: a fresh step starts at frame 0 (no moonwalk)", async () => {
  reset();
  // Snapshot the player as moving. stepStartedAt is stamped to ≈ now.
  const t0 = performance.now();
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_m", slot: 1, index: 0, x: 0, y: 0, tileX: 0, tileY: 0, direction: "right", moving: true }],
    entities: [],
  });
  // Rendering ~at-step-start must yield frame 0, regardless of where
  // a global clock happens to be. This is the bug the fix targets:
  // before, frameIndex came from `floor(now/120) % 4`, so a step
  // beginning at e.g. t=370 ms would render frame 3 → moonwalk.
  const p = getMirrorPlayerById("p_m", t0 + 5);
  assert.equal(p.frameIndex, 0, "step start should render frame 0");
  reset();
});

test("animation phase: a moving sprite advances frames at ANIMATIONS_FPS (10)", async () => {
  reset();
  // Start idle so stepStartedAt is 0; the delta below flips to moving
  // and stamps stepStartedAt synchronously — we can pin it to the
  // wall-clock immediately after the delta call without racing the
  // zone loader.
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_m", slot: 1, index: 0, x: 0, y: 0, tileX: 0, tileY: 0, direction: "right", moving: false }],
    entities: [],
  });
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_m", x: 1, y: 0, tileX: 1, tileY: 0, direction: "right", moving: true }],
  });
  const stepStartedAt = performance.now(); // ≈ the t stamped by handleDelta
  // The mirror back-dates render by INTERP_DELAY_MS to give the
  // hold-and-interpolate buffer something to sample. Animation phase
  // uses the same back-dated clock so position and frame stay in
  // lockstep, so the test must compensate.
  // 10 FPS → 100 ms per frame. Sample after the step started.
  const samples = [5, 105, 205, 305, 405].map((dt) => {
    const p = getMirrorPlayerById("p_m", stepStartedAt + INTERP_DELAY_MS + dt);
    return p.frameIndex;
  });
  assert.equal(samples[0], 0);
  assert.equal(samples[1], 1);
  assert.equal(samples[2], 2);
  assert.equal(samples[3], 3);
  assert.equal(samples[4], 0, "wraps modulo frameCount");
  reset();
});

test("animation phase: idle→moving transition rewinds phase; moving→moving keeps cycling", async () => {
  reset();
  // Snapshot as idle.
  await applySnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_x", slot: 1, index: 0, x: 0, y: 0, tileX: 0, tileY: 0, direction: "right", moving: false }],
    entities: [],
  });
  // Wait a touch so a free-running clock would have advanced.
  await new Promise((r) => setTimeout(r, 50));
  // First delta flips to moving — stepStartedAt resets to "now".
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_x", x: 1, y: 0, tileX: 1, tileY: 0, direction: "right", moving: true }],
  });
  const tMoveStart = performance.now();
  const startFrame = getMirrorPlayerById("p_x", tMoveStart + INTERP_DELAY_MS + 5);
  assert.equal(startFrame.frameIndex, 0, "idle→moving must reset to frame 0");

  // Second delta keeps moving — stepStartedAt must NOT reset. Render
  // 110 ms past the first step's start should now sit in frame 1.
  handleDelta({
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_x", x: 2, y: 0, tileX: 2, tileY: 0, direction: "right", moving: true }],
  });
  const laterFrame = getMirrorPlayerById("p_x", tMoveStart + INTERP_DELAY_MS + 110);
  assert.equal(laterFrame.frameIndex, 1, "moving→moving must keep the phase running");
  reset();
});

test("requestResync sends {op:guest.resync} and throttles within MIN_INTERVAL", async () => {
  reset();
  const sent = [];
  const fakeNet = {
    on() { return () => {}; },
    isConnected: () => true,
    send(frame) { sent.push(frame); },
  };
  const { installMirrorWorld, requestResync, uninstallMirrorWorld } =
    await import("../js/mirrorWorld.js?v=20260528f");
  installMirrorWorld(fakeNet);
  assert.equal(requestResync(0), true);
  assert.deepEqual(sent[sent.length - 1], { op: "guest.resync" });
  // Same wall-clock-ish second → throttled.
  assert.equal(requestResync(100), false);
  assert.equal(requestResync(500), false);
  // After RESYNC_MIN_INTERVAL_MS (2000), allowed again.
  assert.equal(requestResync(2100), true);
  assert.equal(sent.length, 2);
  uninstallMirrorWorld();
});

test("requestResync no-ops when the net is disconnected", async () => {
  reset();
  const sent = [];
  const fakeNet = {
    on() { return () => {}; },
    isConnected: () => false,
    send(frame) { sent.push(frame); },
  };
  const { installMirrorWorld, requestResync, uninstallMirrorWorld } =
    await import("../js/mirrorWorld.js?v=20260528f");
  installMirrorWorld(fakeNet);
  assert.equal(requestResync(), false);
  assert.equal(sent.length, 0);
  uninstallMirrorWorld();
});

test("installMirrorWorld wires snapshot + delta handlers off a net", async () => {
  reset();
  let snapHandler = null;
  let deltaHandler = null;
  const fakeNet = {
    on(op, fn) {
      if (op === "snapshot") snapHandler = fn;
      else if (op === "delta") deltaHandler = fn;
      return () => {};
    },
  };
  installMirrorWorld(fakeNet, {
    // funnel handleSnapshot's zoneLoader through the same fake
    zoneLoader: async (id) => makeFakeZone(id),
  });
  assert.ok(snapHandler);
  assert.ok(deltaHandler);
  // simulate server snapshot via the wired handler
  await snapHandler({
    op: "snapshot", zoneId: 2222,
    players: [{ playerId: "p_1", slot: 1, index: 0, x: 0, y: 0, tileX: 0, tileY: 0, direction: "down" }],
    entities: [],
  });
  assert.equal(getMirrorZone().id, 2222);
  reset();
});
