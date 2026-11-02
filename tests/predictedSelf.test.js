// Predicted-self: local prediction, position streaming, and the
// reconciliation contract (docs/multiplayer.md). Local input advances the
// avatar, its position streams as op:"move" k:"pos" updates, and deltas
// reconcile by comparing the host's position to update #lastSeq
// (match = lockstep, mismatch = snap).

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js");
const {
  installPredictedSelf, _uninstallPredictedSelfForTesting,
  tickPredictedSelf, getPredictedSelf, getLastAckedSeq,
  _predictionZoneForTesting,
} = await import("../js/predictedSelf.js");
const {
  installGuestInputForwarder, _resetForwarderForTesting, getStepLog,
} = await import("../js/guestInputForwarder.js");
const {
  installMirrorWorld, uninstallMirrorWorld, handleSnapshot,
} = await import("../js/mirrorWorld.js");
const inputModule = await import("../js/input.js");
const { loadSpeciesData } = await import("../js/species.js");

function makeFakeZone(id) {
  return {
    id,
    rows: 20,
    cols: 20,
    entities: [],
    biome: Array.from({ length: 20 }, () => Array(20).fill(0)),
    construction: Array.from({ length: 20 }, () => Array(20).fill(0)),
    collision: Array.from({ length: 20 }, () => Array(20).fill(false)),
  };
}

function fakeNet() {
  const handlers = new Map();
  const sent = [];
  return {
    sent,
    on(op, h) {
      let list = handlers.get(op);
      if (!list) { list = []; handlers.set(op, list); }
      list.push(h);
      return () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); };
    },
    emit(op, msg) { for (const h of (handlers.get(op) || []).slice()) h(msg); },
    send(frame) { sent.push(frame); return true; },
    connect: () => {},
    close: () => {},
    isConnected: () => true,
  };
}

async function setup() {
  loadSpeciesData([{ id: 1001, entity_type: "Hero", z_index: 15 }]);
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "guest", code: "ABCDE", uuid: "uuid-guest" });
  uninstallMirrorWorld();
  _uninstallPredictedSelfForTesting();
  _resetForwarderForTesting();
  inputModule.clearInputState(1);
  const net = fakeNet();
  bootstrapOnline({ netFactory: () => net });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_g1", name: "Player-g" });
  net.emit("guest.joined", {
    op: "guest.joined", sessionId: "s", hostName: "h",
    hostPlayerId: "p_h", selfPlayerId: "p_g1", slot: 2, peers: [],
  });
  installMirrorWorld(net, { zoneLoader: async (id) => makeFakeZone(id) });
  installPredictedSelf(net);
  installGuestInputForwarder(net); // so predicted's emitted steps fill the step-log
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
  _resetForwarderForTesting();
  uninstallMirrorWorld();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
  inputModule.clearInputState(1);
}

// Walk the predicted self down for about `tiles` tiles, then release.
function walkDown(tiles) {
  inputModule.pushInputPress(1, "down");
  for (let i = 0; i < tiles * 14; i++) tickPredictedSelf(0.016);
  inputModule.clearInputHeld(1);
  tickPredictedSelf(0.016);
}

const moves = (net) => net.sent.filter((m) => m.op === "move");

test("predictedSelf is initialised from the mirror on first tick", async () => {
  await setup();
  tickPredictedSelf(0);
  const p = getPredictedSelf();
  assert.ok(p);
  assert.deepEqual({ x: p.tileX, y: p.tileY }, { x: 5, y: 5 });
  assert.equal(p.playerId, "p_g1");
  teardown();
});

test("local input advances predictedSelf within a few ticks", async () => {
  await setup();
  tickPredictedSelf(0.016);
  inputModule.pushInputPress(1, "down");
  for (let i = 0; i < 20; i++) tickPredictedSelf(0.016);
  assert.ok(getPredictedSelf().tileY > 5);
  teardown();
});

// --- position streaming ----------------------------------------------------

test("walking streams op:move k:pos updates, throttled, ending with a stop", async () => {
  const net = await setup();
  tickPredictedSelf(0.016);
  net.sent.length = 0;
  walkDown(1);
  const sent = moves(net);
  assert.ok(sent.length >= 3, `several updates while walking, got ${sent.length}`);
  assert.ok(sent.length <= 10, `throttled below the frame rate, got ${sent.length}`);
  for (const m of sent) assert.equal(m.k, "pos");
  assert.equal(sent[0].d, "down");
  assert.equal(sent[0].m, 1);
  const last = sent[sent.length - 1];
  assert.equal(last.m, 0, "the stop is sent at once");
  const p = getPredictedSelf();
  assert.equal(last.y, Math.round(p.y * 1000) / 1000, "the final update is where the avatar stands");
  assert.equal(getStepLog()[getStepLog().length - 1].seq, last.seq);
  teardown();
});

test("a pure turn streams a position update with the new facing", async () => {
  const net = await setup();
  tickPredictedSelf(0.016);
  net.sent.length = 0;
  inputModule.pushInputPress(1, "left");
  inputModule.clearInputHeld(1);
  tickPredictedSelf(0.016);
  const sent = moves(net);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].d, "left");
  assert.deepEqual({ x: sent[0].x, y: sent[0].y }, { x: 5, y: 5 });
  teardown();
});

test("an idle avatar sends nothing", async () => {
  const net = await setup();
  tickPredictedSelf(0.016);
  net.sent.length = 0;
  for (let i = 0; i < 30; i++) tickPredictedSelf(0.016);
  assert.equal(moves(net).length, 0);
  teardown();
});

// --- reconciliation ---------------------------------------------------------

function delta(net, x, y, lastSeq, direction = "down") {
  net.emit("delta", {
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x, y, tileX: Math.round(x), tileY: Math.round(y), direction }],
    entities: [],
    lastSeq: { "p_g1": lastSeq },
  });
}

test("a matching delta keeps predicted ahead (lockstep, no snap)", async () => {
  const net = await setup();
  walkDown(3);
  const p = getPredictedSelf();
  const aheadY = p.y;
  const log = getStepLog();
  assert.ok(log.length >= 2);
  const acked = log[0];
  delta(net, acked.x, acked.y, acked.seq);
  assert.equal(getPredictedSelf().y, aheadY, "predicted must not snap back on a matching ack");
  assert.equal(getLastAckedSeq(), acked.seq);
  teardown();
});

test("a rejected update snaps predicted back to the authoritative position", async () => {
  const net = await setup();
  walkDown(3);
  const log = getStepLog();
  assert.ok(log.length >= 3);
  const accepted = log[log.length - 2];
  const rejected = log[log.length - 1];
  delta(net, accepted.x, accepted.y, rejected.seq);
  const p = getPredictedSelf();
  assert.deepEqual({ x: p.x, y: p.y }, { x: accepted.x, y: accepted.y });
  assert.deepEqual(getStepLog(), [], "log cleared on snap");
  teardown();
});

test("updates sent before a snap are not compared again", async () => {
  const net = await setup();
  walkDown(3);
  const log = getStepLog();
  const first = log[0];
  const latest = log[log.length - 1];
  delta(net, 12, 3, first.seq);
  assert.deepEqual({ x: getPredictedSelf().x, y: getPredictedSelf().y }, { x: 12, y: 3 }, "snapped");
  // The host still applies updates that were in flight before the snap;
  // their echoes must not snap the guest a second time.
  delta(net, latest.x, latest.y, latest.seq - 1);
  assert.deepEqual({ x: getPredictedSelf().x, y: getPredictedSelf().y }, { x: 12, y: 3 });
  teardown();
});

test("a host displacement while idle snaps predicted to the authoritative position", async () => {
  const net = await setup();
  walkDown(2);
  const log = getStepLog();
  const latest = log[log.length - 1];
  delta(net, latest.x, latest.y, latest.seq);
  delta(net, 12, 3, latest.seq, "left");
  const p = getPredictedSelf();
  assert.deepEqual({ x: p.tileX, y: p.tileY }, { x: 12, y: 3 });
  teardown();
});

test("a fresh snapshot hard-resets predicted and clears the log", async () => {
  const net = await setup();
  walkDown(3);
  assert.ok(getStepLog().length >= 1);
  net.emit("snapshot", {
    op: "snapshot", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x: 1, y: 1, tileX: 1, tileY: 1, direction: "up" }],
    entities: [],
    lastSeq: { "p_g1": 0 },
  });
  const p = getPredictedSelf();
  assert.deepEqual({ x: p.x, y: p.y }, { x: 1, y: 1 });
  assert.equal(p.direction, "up");
  assert.equal(p._holdGate, true);
  assert.deepEqual(getStepLog(), []);
  teardown();
});

// --- prediction zone (mob-free collision view) ------------------------------

test("predictionZone strips self-driven mobs but keeps static rigids", () => {
  loadSpeciesData([
    { id: 1001, entity_type: "Hero", z_index: 15 },
    { id: 2001, entity_type: "CloseCombatMonster", movement_directions: "FindHero", is_rigid: true },
    { id: 2002, entity_type: "Free wanderer", movement_directions: "Free", is_rigid: true },
    { id: 2003, entity_type: "StaticObject", is_rigid: true },
  ]);
  const zone = {
    id: 1, rows: 10, cols: 10,
    entities: [
      { id: 10, species_id: 2001, frame: { x: 1, y: 1, w: 1, h: 1 } },
      { id: 11, species_id: 2002, frame: { x: 2, y: 2, w: 1, h: 1 } },
      { id: 12, species_id: 2003, frame: { x: 3, y: 3, w: 1, h: 1 } },
    ],
  };
  const pz = _predictionZoneForTesting(zone);
  assert.deepEqual(pz.entities.map((e) => e.id).sort(), [12]);
  assert.equal(zone.entities.length, 3, "original zone not mutated");
});

test("predictionZone returns the same object when there are no mobs (no alloc)", () => {
  loadSpeciesData([
    { id: 1001, entity_type: "Hero", z_index: 15 },
    { id: 2003, entity_type: "StaticObject", is_rigid: true },
  ]);
  const zone = { id: 1, rows: 10, cols: 10, entities: [{ id: 12, species_id: 2003, frame: { x: 3, y: 3, w: 1, h: 1 } }] };
  assert.equal(_predictionZoneForTesting(zone), zone);
  const empty = { id: 1, rows: 10, cols: 10, entities: [] };
  assert.equal(_predictionZoneForTesting(empty), empty);
});
