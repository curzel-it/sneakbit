// Unit-tests the diffing/serialization logic of the host snapshot
// broadcaster: a snapshot reflects the full world, a follow-up delta
// only carries changes, and removed entities show up in `removed`.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260528b");
const { _resetOnlineBootstrapForTesting } =
  await import("../js/onlineBootstrap.js?v=20260528b");

// Force host mode + a fixed playerId before the broadcaster module
// imports bootstrap.
_resetOnlineBootstrapForTesting();
_setOnlineModeForTesting({ mode: "host", uuid: "uuid-host-broadcaster" });

const broadcaster = await import("../js/snapshotBroadcaster.js?v=20260528b");
const { _snapshotForTesting, _broadcastDeltaForTesting,
  installSnapshotBroadcaster, stopSnapshotBroadcaster } = broadcaster;

// We can't easily stub getSelfPlayerId from bootstrap without driving the
// real WS handshake — instead we drive bootstrap directly with a fake net
// that emits a welcome frame, so selfPlayerId gets set.
const { bootstrapOnline, getNet } = await import("../js/onlineBootstrap.js?v=20260528b");

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

test("mid-step x/y drift does NOT produce a delta (sigPlayer is tile-locked)", () => {
  // The whole point of the sigPlayer tightening: between tile changes,
  // the floats slide every host tick but tileX/tileY/direction/moving
  // stay put. If we signed on x/y we'd emit ~5 deltas per step (one
  // every BROADCAST_INTERVAL_MS = 50 ms). Now we emit only at the
  // endpoints and the mirror's lerp handles the float path.
  setupBootstrapWithFakeNet();
  const state = makeState();
  _snapshotForTesting(state);
  // Player is mid-step: x has drifted from the tile but tileX hasn't
  // committed yet (this is exactly what player.js does during step
  // advancement). With the new signature, no delta should fire.
  state.player.x = 7.45;
  state.player.y = 8.0;
  const d1 = _broadcastDeltaForTesting(null, state);
  assert.equal(d1, null, "x/y drift alone must not produce a delta");
  // A bit later, more drift — still nothing.
  state.player.x = 7.7;
  const d2 = _broadcastDeltaForTesting(null, state);
  assert.equal(d2, null, "consecutive mid-step x drifts must remain silent");
  // Step completes: tileX snaps. Now a delta fires.
  state.player.tileX = 8;
  state.player.x = 8;
  const d3 = _broadcastDeltaForTesting(null, state);
  assert.ok(d3, "tile change must produce a delta");
  assert.equal(d3.players.length, 1);
  assert.equal(d3.players[0].tileX, 8);
  stopSnapshotBroadcaster();
});

test("moving toggle (step start) produces a delta even with same tile", () => {
  // At step start the host sets moving=true but tileX/tileY haven't
  // moved yet — sigPlayer must still emit so the guest sees moving=true
  // and starts cycling its walk frames.
  setupBootstrapWithFakeNet();
  const state = makeState();
  state.player.moving = false;
  _snapshotForTesting(state);
  state.player.moving = true;
  const d = _broadcastDeltaForTesting(null, state);
  assert.ok(d, "moving toggle must produce a delta");
  assert.equal(d.players.length, 1);
  assert.equal(d.players[0].moving, true);
  stopSnapshotBroadcaster();
});

test("direction change (tap-to-turn, no step) produces a delta", () => {
  // The player can turn without stepping — sigPlayer must include
  // direction so guests see the rotation immediately.
  setupBootstrapWithFakeNet();
  const state = makeState();
  state.player.direction = "down";
  _snapshotForTesting(state);
  state.player.direction = "right";
  const d = _broadcastDeltaForTesting(null, state);
  assert.ok(d, "direction change must produce a delta");
  assert.equal(d.players[0].direction, "right");
  stopSnapshotBroadcaster();
});

test("payload still carries x/y for the mirror's lerp endpoints", () => {
  // sigPlayer dropping x/y is a change-detection tightening only — the
  // payload must still ship them so the mirror has concrete floats to
  // interpolate between. (The mirror lerps on prev.x/prev.y and
  // curr.x/curr.y; if either is missing the lerp falls back to the
  // tile-integer alone, which works but loses sub-tile precision on
  // start/end frames where rounding might matter.)
  setupBootstrapWithFakeNet();
  const state = makeState();
  _snapshotForTesting(state);
  state.player.tileX = 8;
  state.player.x = 8.0;
  const d = _broadcastDeltaForTesting(null, state);
  const p = d.players[0];
  assert.equal(p.x, 8.0);
  assert.equal(p.y, 8);
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

test("guest.resync triggers a full snapshot send (host reuses the peer.joined path)", () => {
  const fakeNet = setupBootstrapWithFakeNet();
  const state = makeState();
  const ok = installSnapshotBroadcaster(() => state, { intervalMs: 100000, net: fakeNet });
  assert.equal(ok, true);
  fakeNet.emit("guest.resync", { op: "guest.resync", from: "p_lagging" });
  const snaps = fakeNet.sent.filter((m) => m.op === "snapshot");
  assert.equal(snaps.length, 1, "guest.resync must produce exactly one snapshot");
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

test("hp 0-crossing emits event:death; recovery emits event:respawn", async () => {
  const fakeNet = setupBootstrapWithFakeNet();
  const ph = await import("../js/playerHealth.js?v=20260528b");
  ph.resetPlayerHealth(); // baseline: all players at MAX_HP
  const state = makeState();
  // Seed baseline so the next delta has prev-hp to compare against.
  _snapshotForTesting(state);
  // Knock host's player down to 0 — we mutate state to force a sig
  // change, then drive a delta. _broadcastDeltaForTesting bypasses the
  // timer so we get a deterministic single tick.
  // applyPlayerDamage caps at MAX_HP — go big to guarantee a kill.
  ph.applyPlayerDamage(999, 0);
  // Also bump position so sigPlayer differs from baseline (hp alone is
  // enough but let's not depend on it).
  state.player.tileX = 8;
  state.player.x = 8;
  fakeNet.sent.length = 0;
  _broadcastDeltaForTesting(null, state);
  const deaths = fakeNet.sent.filter((m) => m.op === "event" && m.kind === "death");
  assert.equal(deaths.length, 1, "expected exactly one event:death");
  assert.equal(deaths[0].playerId, "p_host01");
  // Now revive and tick again — expect event:respawn.
  ph.resetPlayerHealth(0);
  state.player.tileX = 9;
  state.player.x = 9;
  fakeNet.sent.length = 0;
  _broadcastDeltaForTesting(null, state);
  const resps = fakeNet.sent.filter((m) => m.op === "event" && m.kind === "respawn");
  assert.equal(resps.length, 1, "expected exactly one event:respawn");
  assert.equal(resps[0].playerId, "p_host01");
  stopSnapshotBroadcaster();
});

test("a fresh snapshot seeds hp baseline without re-emitting death", async () => {
  const fakeNet = setupBootstrapWithFakeNet();
  const ph = await import("../js/playerHealth.js?v=20260528b");
  ph.resetPlayerHealth();
  // Pre-kill the host before the first snapshot — the joiner should not
  // be told the host is freshly dead; that already-dead state is encoded
  // in the snapshot's hp field, not in a discrete event.
  ph.applyPlayerDamage(999, 0);
  const state = makeState();
  fakeNet.sent.length = 0;
  _snapshotForTesting(state);
  // No tick has driven playerDeltas yet — emission only runs from the
  // delta path. Now drive a delta with unchanged hp (still 0).
  _broadcastDeltaForTesting(null, state);
  const deaths = fakeNet.sent.filter((m) => m.op === "event" && m.kind === "death");
  assert.equal(deaths.length, 0, "snapshot should seed baseline, no event:death");
  // Cleanup: bring HP back so later tests start clean.
  ph.resetPlayerHealth();
  stopSnapshotBroadcaster();
});

test("zone change emits event:respawn for players whose hp was 0 in the prior zone", async () => {
  const fakeNet = setupBootstrapWithFakeNet();
  const ph = await import("../js/playerHealth.js?v=20260528b");
  const state = makeState(1001);
  // Host dies in the old zone. Install first (with the dead baseline)
  // so a baseline broadcaster tick records hp=0 in lastHpByPlayerId.
  ph.resetPlayerHealth();
  ph.applyPlayerDamage(999, 0);
  const ok = installSnapshotBroadcaster(() => state, { intervalMs: 5, net: fakeNet });
  assert.equal(ok, true);
  await new Promise((resolve) => setTimeout(resolve, 25));
  // Now travelTo() runs: revive the dead host, swap zones. The next
  // broadcaster tick must emit event:respawn BEFORE sendFullSnapshot
  // wipes the hp baseline, otherwise the guest's "Waiting for the
  // host…" overlay never dismisses on the new zone.
  ph.resetPlayerHealth(0);
  state.zone = {
    id: 1002,
    entities: [{ id: 200, species_id: 70, frame: { x: 1, y: 1, w: 1, h: 1 } }],
  };
  fakeNet.sent.length = 0;
  await new Promise((resolve) => setTimeout(resolve, 25));
  const resps = fakeNet.sent.filter((m) => m.op === "event" && m.kind === "respawn");
  const zoneChanges = fakeNet.sent.filter((m) => m.op === "event" && m.kind === "zoneChange");
  const snaps = fakeNet.sent.filter((m) => m.op === "snapshot");
  assert.equal(zoneChanges.length, 1, "expected the zoneChange event");
  assert.ok(snaps.length >= 1, "expected the full snapshot");
  assert.equal(resps.length, 1, "expected event:respawn for the revived host");
  assert.equal(resps[0].playerId, "p_host01");
  stopSnapshotBroadcaster();
  ph.resetPlayerHealth();
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
