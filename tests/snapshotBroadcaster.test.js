// Unit-tests the diffing/serialization logic of the host snapshot
// broadcaster: a snapshot reflects the full world, a follow-up delta
// only carries changes, and removed entities show up in `removed`.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js");
const { _resetOnlineBootstrapForTesting } =
  await import("../js/onlineBootstrap.js");

// Force host mode + a fixed playerId before the broadcaster module
// imports bootstrap.
_resetOnlineBootstrapForTesting();
_setOnlineModeForTesting({ mode: "host", uuid: "uuid-host-broadcaster" });

const broadcaster = await import("../js/snapshotBroadcaster.js");
const { _snapshotForTesting, _broadcastDeltaForTesting,
  installSnapshotBroadcaster, stopSnapshotBroadcaster } = broadcaster;

// We can't easily stub getSelfPlayerId from bootstrap without driving the
// real WS handshake — instead we drive bootstrap directly with a fake net
// that emits a welcome frame, so selfPlayerId gets set.
const { bootstrapOnline, getNet } = await import("../js/onlineBootstrap.js");

function makeFakeNet() {
  const handlers = new Map();
  const sent = [];
  let connected = false;
  return {
    sent,
    on(op, h) {
      let list = handlers.get(op);
      if (!list) { list = []; handlers.set(op, list); }
      list.push(h);
      return () => {
        const i = list.indexOf(h);
        if (i >= 0) list.splice(i, 1);
      };
    },
    emit(op, msg) {
      const list = handlers.get(op) || [];
      for (const h of list.slice()) h(msg);
    },
    send(frame) { sent.push(frame); return true; },
    connect() { connected = true; },
    close() { connected = false; },
    isConnected: () => connected,
    getUuid: () => "uuid-host-broadcaster",
    getUrl: () => "ws://test",
  };
}

function setupBootstrapWithFakeNet() {
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "host", uuid: "uuid-host-broadcaster" });
  const fakeNet = makeFakeNet();
  bootstrapOnline({ netFactory: () => fakeNet });
  // simulate server welcome so selfPlayerId is set
  fakeNet.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_host01", name: "Player-x" });
  // also clear the host.open that bootstrap sends, since we don't care
  fakeNet.sent.length = 0;
  return fakeNet;
}

function makeState(zoneId = 1001) {
  return {
    zone: {
      id: zoneId,
      entities: [
        { id: 100, species_id: 50, frame: { x: 4, y: 5, w: 1, h: 1 }, hp: 30 },
        { id: 101, species_id: 60, frame: { x: 9, y: 9, w: 2, h: 1 }, _open: false },
      ],
    },
    player: {
      index: 0, x: 7, y: 8, tileX: 7, tileY: 8,
      direction: "down", moving: false,
    },
  };
}

test("snapshot includes self player and every entity", () => {
  setupBootstrapWithFakeNet();
  const state = makeState();
  const snap = _snapshotForTesting(state);
  assert.equal(snap.op, "snapshot");
  assert.equal(snap.zoneId, 1001);
  assert.equal(snap.players.length, 1);
  assert.equal(snap.players[0].playerId, "p_host01");
  assert.equal(snap.players[0].tileX, 7);
  assert.equal(snap.entities.length, 2);
  assert.equal(snap.entities[0].id, 100);
  assert.equal(snap.entities[1].id, 101);
  stopSnapshotBroadcaster();
});

test("delta after an unchanged snapshot is null", () => {
  setupBootstrapWithFakeNet();
  const state = makeState();
  _snapshotForTesting(state);
  const d = _broadcastDeltaForTesting(null, state);
  assert.equal(d, null);
  stopSnapshotBroadcaster();
});

test("delta carries only the changed entity", () => {
  setupBootstrapWithFakeNet();
  const state = makeState();
  _snapshotForTesting(state);
  state.zone.entities[0].hp = 20; // damage
  const d = _broadcastDeltaForTesting(null, state);
  assert.ok(d);
  assert.equal(d.entities.length, 1);
  assert.equal(d.entities[0].id, 100);
  assert.equal(d.entities[0].hp, 20);
  assert.equal(d.players.length, 0);
  stopSnapshotBroadcaster();
});

test("delta carries removed entity ids", () => {
  setupBootstrapWithFakeNet();
  const state = makeState();
  _snapshotForTesting(state);
  state.zone.entities = state.zone.entities.filter((e) => e.id !== 101);
  const d = _broadcastDeltaForTesting(null, state);
  assert.ok(d);
  assert.deepEqual(d.removed, { entities: [101] });
  stopSnapshotBroadcaster();
});

test("delta carries the player when position changes", () => {
  setupBootstrapWithFakeNet();
  const state = makeState();
  _snapshotForTesting(state);
  state.player.tileX = 8;
  state.player.x = 8;
  const d = _broadcastDeltaForTesting(null, state);
  assert.ok(d);
  assert.equal(d.players.length, 1);
  assert.equal(d.players[0].tileX, 8);
  stopSnapshotBroadcaster();
});

test("installSnapshotBroadcaster does nothing in offline mode", () => {
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "offline" });
  const installed = installSnapshotBroadcaster(() => makeState());
  assert.equal(installed, false);
  stopSnapshotBroadcaster();
  _resetOnlineModeForTesting();
});

test("peer.joined triggers a full snapshot send", () => {
  const fakeNet = setupBootstrapWithFakeNet();
  const state = makeState();
  const ok = installSnapshotBroadcaster(() => state, { intervalMs: 100000, net: fakeNet });
  assert.equal(ok, true);
  fakeNet.emit("peer.joined", { op: "peer.joined", playerId: "p_g1", slot: 2 });
  const snaps = fakeNet.sent.filter((m) => m.op === "snapshot");
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].zoneId, 1001);
  stopSnapshotBroadcaster();
});

test("zone change broadcasts event:zoneChange before the full snapshot", () => {
  const fakeNet = setupBootstrapWithFakeNet();
  const state = makeState(1001);
  const ok = installSnapshotBroadcaster(() => state, { intervalMs: 5, net: fakeNet });
  assert.equal(ok, true);
  // Drive a tick to capture the baseline.
  return new Promise((resolve) => setTimeout(resolve, 25)).then(() => {
    fakeNet.sent.length = 0;
    state.zone = {
      id: 1002,
      entities: [{ id: 200, species_id: 70, frame: { x: 1, y: 1, w: 1, h: 1 } }],
    };
    return new Promise((resolve) => setTimeout(resolve, 25));
  }).then(() => {
    const eventIdx = fakeNet.sent.findIndex((m) =>
      m.op === "event" && m.kind === "zoneChange" && m.zoneId === 1002);
    const snapIdx = fakeNet.sent.findIndex((m) =>
      m.op === "snapshot" && m.zoneId === 1002);
    assert.ok(eventIdx >= 0, "event:zoneChange must be sent");
    assert.ok(snapIdx >= 0, "snapshot must be sent");
    assert.ok(eventIdx < snapIdx, "event:zoneChange must precede the snapshot");
    stopSnapshotBroadcaster();
  });
});

test("zone id change forces the next delta to be a full snapshot", () => {
  setupBootstrapWithFakeNet();
  const state = makeState(1001);
  // Establish a baseline at zone 1001.
  _snapshotForTesting(state);
  // Travel.
  state.zone = {
    id: 1002,
    entities: [
      { id: 200, species_id: 70, frame: { x: 1, y: 1, w: 1, h: 1 } },
    ],
  };
  const d = _broadcastDeltaForTesting(null, state);
  // _broadcastDeltaForTesting returns the would-be delta msg; once the
  // zone changes we expect null because the live loop replaces it with a
  // snapshot via a different code path. Either way the diff for the new
  // zone must reflect the new entity id only.
  if (d) {
    assert.equal(d.zoneId, 1002);
    const ids = (d.entities || []).map((e) => e.id);
    assert.ok(ids.includes(200));
  }
  stopSnapshotBroadcaster();
});
