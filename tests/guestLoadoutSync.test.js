// Guest-side loadout sync: sends guest.loadout on install + on local
// equipment changes, and applies inbound event:loadout into the session
// map. For loadouts addressed to selfPlayerId, writes through to local
// equipment storage so an auto-equipped pickup persists past the session.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260530a");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260530a");
const equipment = await import("../js/equipment.js?v=20260530a");
const storage = await import("../js/storage.js?v=20260530a");
const {
  installGuestLoadoutSync,
  _uninstallGuestLoadoutSyncForTesting,
} = await import("../js/guestLoadoutSync.js?v=20260530a");
const {
  getSessionLoadout,
  _resetSessionLoadoutsForTesting,
} = await import("../js/sessionLoadouts.js?v=20260530a");

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
    getUuid: () => "uuid-guest",
    getUrl: () => "ws://test",
    sent,
  };
}

function setupGuest({ initialMelee = null, initialRanged = null } = {}) {
  storage._resetStorageForTesting();
  _resetSessionLoadoutsForTesting();
  _uninstallGuestLoadoutSyncForTesting();
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "guest", uuid: "uuid-guest", joinCode: "ABCDE" });
  if (initialMelee != null) equipment.setEquipped(equipment.SLOT_MELEE, initialMelee, 0);
  if (initialRanged != null) equipment.setEquipped(equipment.SLOT_RANGED, initialRanged, 0);
  const net = makeFakeNet();
  bootstrapOnline({ netFactory: () => net });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_self", name: "Guest" });
  installGuestLoadoutSync({ net });
  return { net };
}

function teardown() {
  _uninstallGuestLoadoutSyncForTesting();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
  _resetSessionLoadoutsForTesting();
  storage._resetStorageForTesting();
}

function loadoutSends(net) {
  return net.sent.filter((m) => m.op === "guest.loadout");
}

test("install immediately sends a guest.loadout with the local equipment ids", () => {
  const { net } = setupGuest({ initialMelee: 1159 });
  const sends = loadoutSends(net);
  assert.equal(sends.length, 1);
  assert.equal(sends[0].melee, 1159);
  teardown();
});

test("a local equipment change re-sends guest.loadout with the new ids", () => {
  const { net } = setupGuest();
  loadoutSends(net).length;
  equipment.setEquipped(equipment.SLOT_RANGED, 1170, 0);
  const sends = loadoutSends(net);
  assert.equal(sends.length, 2, "install send + change send");
  assert.equal(sends[1].ranged, 1170);
  teardown();
});

test("event:loadout from host writes the matching entry into the session map", () => {
  const { net } = setupGuest();
  net.emit("event", { op: "event", kind: "loadout", playerId: "p_peer", melee: 1159, ranged: null });
  const entry = getSessionLoadout("p_peer");
  assert.ok(entry);
  assert.equal(entry.melee, 1159);
  assert.equal(entry.ranged, null);
  teardown();
});

test("event:loadout for self writes through to local equipment (persists past the session)", () => {
  const { net } = setupGuest();
  net.emit("event", { op: "event", kind: "loadout", playerId: "p_self", melee: 1159, ranged: 1170 });
  assert.equal(equipment.getEquipped(equipment.SLOT_MELEE, 0), 1159);
  assert.equal(equipment.getEquipped(equipment.SLOT_RANGED, 0), 1170);
  teardown();
});
