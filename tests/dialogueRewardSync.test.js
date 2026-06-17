// Online co-op: an NPC reward earned by a guest is granted into that guest's
// authoritative pool on the host, then synced to the guest's own client (an
// absolute ammoSet for its HUD + a "received" toast addressed to it). Local
// rewards (no playerId) don't hit the wire — covered by dialogue.test.js.

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js");
const { loadSpeciesData } = await import("../js/species.js");

loadSpeciesData([
  { id: 7000, entity_type: "Bullet", base_speed: 9, dps: 100,
    sprite_frame: { x: 4, y: 0, w: 1, h: 1 } },
  { id: 7001, entity_type: "Bundle", bundle_contents: Array(10).fill(7000) },
]);

const { handleReward } = await import("../js/dialogue.js");
const inventory = await import("../js/inventory.js");
const storage = await import("../js/storage.js");

function makeFakeNet() {
  const sent = [];
  return {
    on() { return () => {}; },
    emit() {},
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
  const net = makeFakeNet();
  bootstrapOnline({ netFactory: () => net });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_host", name: "Host" });
  return { net };
}

function teardown() {
  _resetOnlineModeForTesting();
  _resetOnlineBootstrapForTesting();
  storage._resetStorageForTesting();
  inventory.clearInventory();
}

test("a guest's bundle reward credits its pool + syncs an ammoSet and toast to it", () => {
  const { net } = setup();
  handleReward({ text: "lore.npc.gift", reward: 7001 }, 1, "p_guest");
  // Granted into the guest's authoritative pool (slot 2 → index 1).
  assert.equal(inventory.getAmmo(7000, 1), 10);
  assert.equal(inventory.getAmmo(7000, 0), 0, "host's own pool untouched");

  const ammoSet = net.sent.find((m) => m.op === "event" && m.kind === "ammoSet");
  assert.ok(ammoSet, "an ammoSet was sent");
  assert.equal(ammoSet.playerId, "p_guest");
  assert.deepEqual(ammoSet.items, [{ speciesId: 7000, count: 10 }]);

  const toast = net.sent.find((m) => m.op === "event" && m.kind === "toast");
  assert.ok(toast, "a reward toast was sent");
  assert.equal(toast.playerId, "p_guest", "toast addressed to the earning guest");
  teardown();
});

test("the reward is still one-time per dialogue text (guest path)", () => {
  const { net } = setup();
  handleReward({ text: "lore.npc.once", reward: 7001 }, 1, "p_guest");
  handleReward({ text: "lore.npc.once", reward: 7001 }, 1, "p_guest");
  assert.equal(inventory.getAmmo(7000, 1), 10, "second grant is suppressed");
  assert.equal(net.sent.filter((m) => m.kind === "ammoSet").length, 1, "only one sync");
  teardown();
});
