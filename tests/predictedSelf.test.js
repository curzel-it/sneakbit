// Predicted-self: local prediction, committed-step emission, and the exact
// reconciliation contract (docs/multiplayer.md). The renderer
// side is validated by the integration in main.js; here we check that local
// input advances the avatar, that transitions stream as op:"move" commits,
// and that deltas reconcile by comparing the host's tile to the result of
// step #lastSeq (match = lockstep, mismatch = snap).

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

// Walk the predicted self down `tiles` whole tiles (held key, then release
// so it idles cleanly on the final tile).
function walkDown(tiles) {
  inputModule.pushInputPress(1, "down");
  for (let i = 0; i < tiles * 16 + 4; i++) tickPredictedSelf(0.016);
  inputModule.clearInputHeld(1);
  for (let i = 0; i < 20 && getPredictedSelf().step; i++) tickPredictedSelf(0.016);
}

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

// --- step emission ----------------------------------------------------------

test("a committed step is streamed to the host as op:move k:step", async () => {
  const net = await setup();
  tickPredictedSelf(0.016);
  net.sent.length = 0;
  walkDown(1);
  const steps = net.sent.filter((m) => m.op === "move" && m.k === "step");
  assert.ok(steps.length >= 1, "at least one step commit should be emitted");
  const first = steps[0];
  assert.deepEqual({ fx: first.fx, fy: first.fy }, { fx: 5, fy: 5 });
  assert.deepEqual({ tx: first.tx, ty: first.ty }, { tx: 5, ty: 6 });
  assert.equal(first.d, "down");
  // The step-log mirrors what went on the wire.
  assert.equal(getStepLog()[0].seq, first.seq);
  teardown();
});

test("a pure idle rotation streams a face, not a step", async () => {
  const net = await setup();
  tickPredictedSelf(0.016);
  net.sent.length = 0;
  // Tap left for a single tick then release before the commit delay → rotate
  // only, no step.
  inputModule.pushInputPress(1, "left");
  tickPredictedSelf(0.016);
  inputModule.clearInputHeld(1);
  tickPredictedSelf(0.016);
  const faces = net.sent.filter((m) => m.op === "move" && m.k === "face");
  const steps = net.sent.filter((m) => m.op === "move" && m.k === "step");
  assert.ok(faces.length >= 1, "rotation should emit a face");
  assert.equal(steps.length, 0, "no step should be committed for a pure rotation");
  assert.equal(faces[faces.length - 1].d, "left");
  teardown();
});

// --- exact reconciliation ---------------------------------------------------

test("a matching delta keeps predicted ahead (lockstep, no snap)", async () => {
  const net = await setup();
  walkDown(3);
  const p = getPredictedSelf();
  const aheadY = p.tileY;
  const log = getStepLog();
  assert.ok(log.length >= 2);
  // Host acks the first step only; its result tile is the authoritative tile.
  const acked = log[0];
  net.emit("delta", {
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x: acked.tx, y: acked.ty, tileX: acked.tx, tileY: acked.ty, direction: "down" }],
    entities: [],
    lastSeq: { "p_g1": acked.seq },
  });
  // Predicted is unacked-steps ahead of auth — that gap is expected, no snap.
  assert.equal(getPredictedSelf().tileY, aheadY, "predicted must not snap back on a matching ack");
  assert.equal(getLastAckedSeq(), acked.seq);
  teardown();
});

test("no-displacement rejection snaps predicted and stops the phantom walk", async () => {
  const net = await setup();
  walkDown(3);
  const log = getStepLog();
  assert.ok(log.length >= 3);
  // Host accepted up to step[len-2] (auth sits on its result) but REJECTED
  // the latest step (lastSeq advanced to it, tile unchanged). anchor =
  // result of the rejected step ≠ auth tile → snap.
  const accepted = log[log.length - 2];
  const rejected = log[log.length - 1];
  net.emit("delta", {
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x: accepted.tx, y: accepted.ty, tileX: accepted.tx, tileY: accepted.ty, direction: "down" }],
    entities: [],
    lastSeq: { "p_g1": rejected.seq },
  });
  const p = getPredictedSelf();
  assert.deepEqual({ x: p.tileX, y: p.tileY }, { x: accepted.tx, y: accepted.ty },
    "predicted must snap to the authoritative tile, not keep walking the phantom corridor");
  assert.equal(p.step, null);
  assert.deepEqual(getStepLog(), [], "step-log cleared on snap");
  teardown();
});

test("a host displacement (knockback) snaps predicted to the authoritative tile", async () => {
  const net = await setup();
  walkDown(2);
  const log = getStepLog();
  const latest = log[log.length - 1];
  // lastSeq points at the latest step but auth is somewhere unrelated → the
  // host moved us (knockback / warp). Snap exactly.
  net.emit("delta", {
    op: "delta", zoneId: 1001,
    players: [{ playerId: "p_g1", slot: 2, index: 1, x: 12, y: 3, tileX: 12, tileY: 3, direction: "left" }],
    entities: [],
    lastSeq: { "p_g1": latest.seq },
  });
  const p = getPredictedSelf();
  assert.deepEqual({ x: p.tileX, y: p.tileY }, { x: 12, y: 3 });
  teardown();
});

test("a fresh snapshot hard-resets predicted and clears the step-log", async () => {
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
  assert.deepEqual({ x: p.tileX, y: p.tileY }, { x: 1, y: 1 });
  assert.equal(p.direction, "up");
  assert.equal(p.step, null);
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
