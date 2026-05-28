// Predicted-self prediction + reconciliation. The renderer side is
// validated by the integration in main.js — here we just check that
// inputs are applied locally and authoritative frames snap the tile.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260528b");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260528b");
const {
  installPredictedSelf, _uninstallPredictedSelfForTesting,
  tickPredictedSelf, getPredictedSelf, getLastAckedSeq,
  _shouldSnapForTesting,
} = await import("../js/predictedSelf.js?v=20260528b");
const {
  installMirrorWorld, uninstallMirrorWorld, handleSnapshot,
} = await import("../js/mirrorWorld.js?v=20260528b");
const inputModule = await import("../js/input.js?v=20260528b");
const { loadSpeciesData } = await import("../js/species.js?v=20260528b");

function makeFakeZone(id) {
  return {
    id,
    rows: 20,
    cols: 20,
    entities: [],
    // grass = 0 (no obstacle, not slippery)
    biome: Array.from({ length: 20 }, () => Array(20).fill(0)),
    construction: Array.from({ length: 20 }, () => Array(20).fill(0)),
    collision: Array.from({ length: 20 }, () => Array(20).fill(false)),
  };
}

function fakeNet() {
  const handlers = new Map();
  return {
    on(op, h) {
      let list = handlers.get(op);
      if (!list) { list = []; handlers.set(op, list); }
      list.push(h);
      return () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); };
    },
    emit(op, msg) { for (const h of (handlers.get(op) || []).slice()) h(msg); },
    send: () => true,
    connect: () => {},
    close: () => {},
    isConnected: () => true,
  };
}

async function setup() {
  // species data is needed by player.js for slipperiness checks etc.
  loadSpeciesData([{ id: 1001, entity_type: "Hero", z_index: 15 }]);
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "guest", code: "ABCDE", uuid: "uuid-guest" });
  uninstallMirrorWorld();
  _uninstallPredictedSelfForTesting();
  inputModule.clearInputState(1);
  const net = fakeNet();
  bootstrapOnline({ netFactory: () => net });
  // Server says: selfPlayerId = p_g1
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_g1", name: "Player-g" });
  net.emit("guest.joined", {
    op: "guest.joined", sessionId: "s", hostName: "h",
    hostPlayerId: "p_h", selfPlayerId: "p_g1", slot: 2, peers: [],
  });
  installMirrorWorld(net, { zoneLoader: async (id) => makeFakeZone(id) });
  installPredictedSelf(net);
  // Initial snapshot placing us at (5,5)
  await handleSnapshot({
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x: 5, y: 5, tileX: 5, tileY: 5, direction: "down" }],
    entities: [],
    lastSeq: { "p_g1": 0 },
  }, { zoneLoader: async (id) => makeFakeZone(id) });
  return net;
}

function teardown() {
  _uninstallPredictedSelfForTesting();
  uninstallMirrorWorld();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
  inputModule.clearInputState(1);
}

test("predictedSelf is initialised from the mirror on first snapshot", async () => {
  await setup();
  tickPredictedSelf(0); // one tick to materialise predicted
  const p = getPredictedSelf();
  assert.ok(p);
  assert.equal(p.tileX, 5);
  assert.equal(p.tileY, 5);
  assert.equal(p.playerId, "p_g1");
  teardown();
});

test("local input advances predictedSelf within one tick", async () => {
  await setup();
  tickPredictedSelf(0.016);
  // simulate a down keypress hitting input.js state[1]
  inputModule.pushInputPress(1, "down");
  for (let i = 0; i < 20; i++) tickPredictedSelf(0.016);
  const p = getPredictedSelf();
  assert.ok(p.tileY > 5, `expected predicted tileY to advance past 5, got ${p.tileY}`);
  teardown();
});

test("authoritative delta snaps predictedSelf on orthogonal disagreement (host knockback)", async () => {
  const net = await setup();
  tickPredictedSelf(0.016);
  inputModule.pushInputPress(1, "down");
  for (let i = 0; i < 20; i++) tickPredictedSelf(0.016);
  assert.ok(getPredictedSelf().tileY > 5);
  // Orthogonal disagreement: predicted moved down, auth says we're
  // off to the side (e.g. host-side knockback the guest didn't predict).
  // The latency-tolerance heuristic must NOT swallow this — it's a
  // real divergence, not RTT lag along the move axis.
  net.emit("delta", {
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x: 7, y: 5, tileX: 7, tileY: 5, direction: "right" }],
    entities: [],
    lastSeq: { "p_g1": 1 },
  });
  const p = getPredictedSelf();
  assert.equal(p.tileX, 7);
  assert.equal(p.tileY, 5);
  assert.equal(getLastAckedSeq(), 1);
  teardown();
});

test("shouldSnap: matching tiles never snap", () => {
  const predicted = { tileX: 5, tileY: 5, direction: "right", step: null };
  const auth = { tileX: 5, tileY: 5 };
  assert.equal(_shouldSnapForTesting(predicted, auth, 0), false);
});

test("shouldSnap: auth 1 tile behind us in our move direction is tolerated (RTT lag)", () => {
  // Predicted moving right at tileX=7; auth still at tileX=6. Common
  // continuous-motion case — host is one boundary behind us.
  const predicted = { tileX: 7, tileY: 5, direction: "right", step: { progress: 0.3 } };
  const auth = { tileX: 6, tileY: 5 };
  assert.equal(_shouldSnapForTesting(predicted, auth, 0), false);
});

test("shouldSnap: auth more than MAX_BEHIND tiles behind triggers a snap", () => {
  const predicted = { tileX: 10, tileY: 5, direction: "right", step: { progress: 0.1 } };
  const auth = { tileX: 5, tileY: 5 };
  assert.equal(_shouldSnapForTesting(predicted, auth, 0), true);
});

test("shouldSnap: auth ahead of predicted snaps (we missed inputs)", () => {
  const predicted = { tileX: 5, tileY: 5, direction: "right", step: { progress: 0.4 } };
  const auth = { tileX: 6, tileY: 5 };
  assert.equal(_shouldSnapForTesting(predicted, auth, 0), true);
});

test("shouldSnap: orthogonal disagreement snaps even mid-step", () => {
  // Predicted moving right, auth says we shifted up — not lag, a divergence.
  const predicted = { tileX: 7, tileY: 5, direction: "right", step: { progress: 0.5 } };
  const auth = { tileX: 6, tileY: 4 };
  assert.equal(_shouldSnapForTesting(predicted, auth, 0), true);
});

test("shouldSnap: idle and long-stopped → snap on any disagreement", () => {
  // No step, no recent movement (now far past the grace window) — the
  // host has had ample time to catch up; a remaining mismatch is real.
  const predicted = { tileX: 7, tileY: 5, direction: "right", step: null };
  const auth = { tileX: 6, tileY: 5 };
  assert.equal(_shouldSnapForTesting(predicted, auth, 10_000), true);
});

test("matching authoritative delta does not jostle the predicted position", async () => {
  const net = await setup();
  inputModule.pushInputPress(1, "down");
  for (let i = 0; i < 20; i++) tickPredictedSelf(0.016);
  const beforeY = getPredictedSelf().tileY;
  net.emit("delta", {
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x: 5, y: beforeY, tileX: 5, tileY: beforeY, direction: "down" }],
    entities: [],
    lastSeq: { "p_g1": 1 },
  });
  const p = getPredictedSelf();
  assert.equal(p.tileX, 5);
  assert.equal(p.tileY, beforeY);
  teardown();
});
