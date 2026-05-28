// Guest-side mirroring of the host's authoritative HP into the local
// playerHealth record so getPlayerHp(0) — what the healthHud reads —
// reflects what the host thinks the guest's HP is, instead of the
// guest's stale local default (100).

import { test } from "node:test";
import assert from "node:assert/strict";

const { _setOnlineModeForTesting, _resetOnlineModeForTesting } =
  await import("../js/onlineMode.js?v=20260528b");
const { _resetOnlineBootstrapForTesting, bootstrapOnline } =
  await import("../js/onlineBootstrap.js?v=20260528b");
const { getPlayerHp, resetPlayerHealth } =
  await import("../js/playerHealth.js?v=20260528b");
const {
  installGuestSelfHpSync,
  _uninstallGuestSelfHpSyncForTesting,
} = await import("../js/guestSelfHpSync.js?v=20260528b");

function makeFakeNet() {
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
    getUuid: () => "uuid-guest",
    getUrl: () => "ws://test",
  };
}

function setupGuest() {
  _uninstallGuestSelfHpSyncForTesting();
  _resetOnlineBootstrapForTesting();
  _setOnlineModeForTesting({ mode: "guest", uuid: "uuid-guest", joinCode: "ABCDE" });
  resetPlayerHealth();
  const net = makeFakeNet();
  bootstrapOnline({ netFactory: () => net });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_self", name: "Guest" });
  installGuestSelfHpSync({ net });
  return { net };
}

function teardown() {
  _uninstallGuestSelfHpSyncForTesting();
  _resetOnlineBootstrapForTesting();
  _resetOnlineModeForTesting();
  resetPlayerHealth();
}

test("snapshot with the self player writes hp into playerHealth.records[0]", () => {
  const { net } = setupGuest();
  net.emit("snapshot", {
    op: "snapshot", players: [
      { playerId: "p_self", hp: 42 },
      { playerId: "p_host", hp: 90 },
    ],
  });
  assert.equal(getPlayerHp(0), 42);
  teardown();
});

test("delta updates the local hp too — every frame is a chance to resync", () => {
  const { net } = setupGuest();
  net.emit("snapshot", { op: "snapshot", players: [{ playerId: "p_self", hp: 90 }] });
  net.emit("delta", { op: "delta", players: [{ playerId: "p_self", hp: 30 }] });
  assert.equal(getPlayerHp(0), 30);
  teardown();
});

test("a frame without the self player leaves the local hp untouched", () => {
  const { net } = setupGuest();
  net.emit("snapshot", { op: "snapshot", players: [{ playerId: "p_self", hp: 55 }] });
  assert.equal(getPlayerHp(0), 55);
  net.emit("delta", { op: "delta", players: [{ playerId: "p_host", hp: 22 }] });
  // Host hp is not the guest's hp — leave alone.
  assert.equal(getPlayerHp(0), 55);
  teardown();
});
