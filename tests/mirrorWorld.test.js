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
} = await import("../js/mirrorWorld.js?v=20260527");

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
