// Host-side loadout broadcaster: seeds self entry from local equipment,
// fans event:loadout on local equipment changes, replays all entries on
// peer.joined for late joiners, and writes incoming guest.loadout into
// the session map (also re-broadcasting it for other peers).

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260531c");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260531c");
const equipment = await import("../js/equipment.js?v=20260531c");
const storage = await import("../js/storage.js?v=20260531c");
const {
  installHostLoadoutSync,
  _uninstallHostLoadoutSyncForTesting,
} = await import("../js/hostLoadoutSync.js?v=20260531c");
const {
  getSessionLoadout,
  _resetSessionLoadoutsForTesting,
} = await import("../js/sessionLoadouts.js?v=20260531c");

function makeFakeNet() {
  const handlers = new Map();
  const sent = [];
  return {
    on(op, h) {
      let list = handlers.get(op);
      if (!list) { list = []; handlers.set(op, list); }
      list.push(h);
      return () => { const i = list.indexOf(h); if (i >= 0) list.splice(i, 1); };
    },
    emit(op, msg) { for (const h of (handlers.get(op) || []).slice()) h(msg); },
    send: (m) => { sent.push(m); return true; },
    connect: () => {},
    close: () => {},
    isConnected: () => true,
    getUuid: () => "uuid-host",
    getUrl: () => "ws://test",
    sent,
  };
}

function setupHost({ initialMelee = null, initialRanged = null } = {}) {
  storage._resetStorageForTesting();
  _resetSessionLoadoutsForTesting();
  _uninstallHostLoadoutSyncForTesting();
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "host", uuid: "uuid-host" });
  if (initialMelee != null) equipment.setEquipped(equipment.SLOT_MELEE, initialMelee, 0);
  if (initialRanged != null) equipment.setEquipped(equipment.SLOT_RANGED, initialRanged, 0);
  const net = makeFakeNet();
  bootstrapOnline({ netFactory: () => net });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_host", name: "Host" });
  installHostLoadoutSync({ net });
  return { net };
}

function teardown() {
  _uninstallHostLoadoutSyncForTesting();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
  _resetSessionLoadoutsForTesting();
  storage._resetStorageForTesting();
}

function loadoutFrames(net) {
  return net.sent.filter((f) => f.op === "event" && f.kind === "loadout");
}

test("install seeds the session map with the host's current local equipment", () => {
  const { net } = setupHost({ initialMelee: 1159 });
  const entry = getSessionLoadout("p_host");
  assert.ok(entry, "self entry must exist after install");
  assert.equal(entry.melee, 1159);
  // Drained the session map; no broadcast yet because we didn't fire onEquipmentChange.
  assert.equal(loadoutFrames(net).length, 0);
  teardown();
});

test("local equipment change broadcasts event:loadout with the new ids", () => {
  const { net } = setupHost();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159, 0);
  const frames = loadoutFrames(net);
  assert.equal(frames.length, 1, "exactly one loadout broadcast for the change");
  assert.equal(frames[0].playerId, "p_host");
  assert.equal(frames[0].melee, 1159);
  teardown();
});

test("non-zero-index equipment writes are ignored (those routes go through pickups + sessionLoadouts directly)", () => {
  const { net } = setupHost();
  equipment.setEquipped(equipment.SLOT_MELEE, 1159, 1);
  // The map for slot 0 didn't get a guest entry, and no broadcast went out.
  assert.equal(loadoutFrames(net).length, 0);
  teardown();
});

test("guest.loadout writes the guest into the session map and re-broadcasts to all peers", () => {
  const { net } = setupHost();
  net.emit("guest.loadout", { op: "guest.loadout", from: "p_guest", melee: 1159, ranged: 1160 });
  const entry = getSessionLoadout("p_guest");
  assert.ok(entry);
  assert.equal(entry.melee, 1159);
  assert.equal(entry.ranged, 1160);
  const frames = loadoutFrames(net);
  assert.equal(frames.length, 1);
  assert.equal(frames[0].playerId, "p_guest");
  assert.equal(frames[0].melee, 1159);
  teardown();
});

test("peer.joined re-broadcasts every known loadout so the new joiner catches up", () => {
  const { net } = setupHost({ initialMelee: 1159 });
  // Seed a second entry via guest.loadout, then count how many loadout
  // frames a peer.joined produces — should be one per known entry.
  net.emit("guest.loadout", { op: "guest.loadout", from: "p_guest1", melee: 1170, ranged: null });
  const beforeJoin = loadoutFrames(net).length;
  net.emit("peer.joined", { op: "peer.joined", playerId: "p_guest2", slot: 3 });
  const after = loadoutFrames(net);
  assert.equal(after.length, beforeJoin + 2, "rebroadcast = one frame per known loadout");
  const ids = new Set(after.slice(beforeJoin).map((f) => f.playerId));
  assert.ok(ids.has("p_host"), "rebroadcast includes self");
  assert.ok(ids.has("p_guest1"), "rebroadcast includes the previously announced guest");
  teardown();
});

test("peer.left drops the departed guest's entry from the session map", () => {
  const { net } = setupHost();
  net.emit("guest.loadout", { op: "guest.loadout", from: "p_guest", melee: 1159, ranged: null });
  assert.ok(getSessionLoadout("p_guest"));
  net.emit("peer.left", { op: "peer.left", playerId: "p_guest" });
  assert.equal(getSessionLoadout("p_guest"), null);
  teardown();
});
