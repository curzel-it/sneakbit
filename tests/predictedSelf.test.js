// Predicted-self prediction + reconciliation. The renderer side is
// validated by the integration in main.js — here we just check that
// inputs are applied locally and authoritative frames snap the tile.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260528");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260528");
const {
  installPredictedSelf, _uninstallPredictedSelfForTesting,
  tickPredictedSelf, getPredictedSelf, getLastAckedSeq,
} = await import("../js/predictedSelf.js?v=20260528");
const {
  installMirrorWorld, uninstallMirrorWorld, handleSnapshot,
} = await import("../js/mirrorWorld.js?v=20260528");
const inputModule = await import("../js/input.js?v=20260528");
const { loadSpeciesData } = await import("../js/species.js?v=20260528");

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

test("authoritative delta snaps predictedSelf back on disagreement", async () => {
  const net = await setup();
  tickPredictedSelf(0.016);
  inputModule.pushInputPress(1, "down");
  for (let i = 0; i < 20; i++) tickPredictedSelf(0.016);
  assert.ok(getPredictedSelf().tileY > 5);
  // Host says "no, you're still at (5,5)" — wall in front
  net.emit("delta", {
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x: 5, y: 5, tileX: 5, tileY: 5, direction: "down" }],
    entities: [],
    lastSeq: { "p_g1": 1 },
  });
  const p = getPredictedSelf();
  assert.equal(p.tileX, 5);
  assert.equal(p.tileY, 5);
  assert.equal(getLastAckedSeq(), 1);
  teardown();
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
