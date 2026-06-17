// Host-side mirror of a guest's shop purchase: shop.bought from a guest adds
// the granted items to that guest's authoritative pool (player.{slot-1}) and
// echoes an absolute ammoSet back so the buyer's HUD stays in lockstep.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js");
const { loadSpeciesData } = await import("../js/species.js");

loadSpeciesData([
  { id: 1001, entity_type: "Hero", z_index: 15 },
  { id: 7000, entity_type: "Bullet", base_speed: 9, dps: 100,
    sprite_frame: { x: 4, y: 0, w: 1, h: 1 } },
]);

const { installHostShop, _uninstallHostShopForTesting } =
  await import("../js/hostShop.js");
const { createPlayer } = await import("../js/player.js");
const inventory = await import("../js/inventory.js");
const storage = await import("../js/storage.js");

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
    connect: () => {}, close: () => {}, isConnected: () => true,
    getUuid: () => "uuid-host", getUrl: () => "ws://test",
    sent,
  };
}

function setup() {
  storage._resetStorageForTesting();
  inventory.clearInventory();
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "host", uuid: "uuid-host" });
  _uninstallHostShopForTesting();
  const net = makeFakeNet();
  bootstrapOnline({ netFactory: () => net });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_host", name: "Host" });
  const guest2 = createPlayer({ index: 1 }); guest2.playerId = "p_guest2"; guest2.slot = 2;
  const guest3 = createPlayer({ index: 2 }); guest3.playerId = "p_guest3"; guest3.slot = 3;
  const state = {
    player: createPlayer({ index: 0 }),
    player2: guest2,
    players: [{ player: guest3, slot: 3, playerId: "p_guest3" }],
  };
  installHostShop(() => state, { net });
  return { net };
}

function teardown() {
  _uninstallHostShopForTesting();
  _resetOnlineModeForTesting();
  _resetOnlineBootstrapForTesting();
  storage._resetStorageForTesting();
  inventory.clearInventory();
}

function ammoSets(net) {
  return net.sent.filter((m) => m.op === "event" && m.kind === "ammoSet");
}

test("shop.bought credits the buying guest's pool + echoes an absolute ammoSet", () => {
  const { net } = setup();
  net.emit("shop.bought", { op: "shop.bought", from: "p_guest2", items: [{ speciesId: 7000, amount: 10 }] });
  assert.equal(inventory.getAmmo(7000, 1), 10, "guest slot-2 pool (index 1) gets 10 kunai");
  const sets = ammoSets(net);
  assert.equal(sets.length, 1);
  assert.equal(sets[0].playerId, "p_guest2");
  assert.deepEqual(sets[0].items, [{ speciesId: 7000, count: 10 }]);
  teardown();
});

test("a slot-3 guest's purchase lands in its own pool (index 2), not another's", () => {
  const { net } = setup();
  net.emit("shop.bought", { op: "shop.bought", from: "p_guest3", items: [{ speciesId: 7000, amount: 4 }] });
  assert.equal(inventory.getAmmo(7000, 2), 4);
  assert.equal(inventory.getAmmo(7000, 1), 0, "slot-2 guest untouched");
  assert.equal(inventory.getAmmo(7000, 0), 0, "host untouched");
  teardown();
});

test("per-line amount is clamped (anti-abuse)", () => {
  const { net } = setup();
  net.emit("shop.bought", { op: "shop.bought", from: "p_guest2", items: [{ speciesId: 7000, amount: 99999 }] });
  assert.equal(inventory.getAmmo(7000, 1), 200, "clamped to MAX_ITEM_AMOUNT");
  teardown();
});

test("unknown species is ignored", () => {
  const { net } = setup();
  net.emit("shop.bought", { op: "shop.bought", from: "p_guest2", items: [{ speciesId: 424242, amount: 5 }] });
  assert.equal(inventory.getAmmo(424242, 1), 0);
  assert.equal(ammoSets(net).length, 0, "no echo for an empty result");
  teardown();
});

test("a frame from an unknown player is a no-op", () => {
  const { net } = setup();
  net.emit("shop.bought", { op: "shop.bought", from: "p_nobody", items: [{ speciesId: 7000, amount: 5 }] });
  assert.equal(inventory.getAmmo(7000, 0), 0);
  assert.equal(inventory.getAmmo(7000, 1), 0);
  assert.equal(ammoSets(net).length, 0);
  teardown();
});
