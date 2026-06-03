// Dispatch tests for the guest-side `event` handler. We don't render
// toast HTML in node — instead each test installs a custom kind handler
// via setGuestEventHandler to capture what the dispatcher would have run.

import { test } from "node:test";
import assert from "node:assert/strict";

const {
  installGuestEvents,
  _uninstallGuestEventsForTesting,
  setGuestEventHandler,
  dispatch,
} = await import("../js/guestEvents.js");

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
  };
}

test("toast events surface via the toast kind handler", () => {
  _uninstallGuestEventsForTesting();
  const got = [];
  setGuestEventHandler("toast", (m) => got.push(m));
  dispatch({ kind: "toast", text: "picked up kunai" });
  assert.equal(got.length, 1);
  assert.equal(got[0].text, "picked up kunai");
  _uninstallGuestEventsForTesting();
});

test("unknown kinds are silently dropped", () => {
  _uninstallGuestEventsForTesting();
  // No throw means it's silently ignored — good for forward-compat with
  // newer hosts emitting kinds we don't recognise yet.
  dispatch({ kind: "uninvented" });
  _uninstallGuestEventsForTesting();
});

test("installGuestEvents wires net.on('event') -> dispatch", () => {
  _uninstallGuestEventsForTesting();
  const got = [];
  setGuestEventHandler("toast", (m) => got.push(m));
  const net = makeFakeNet();
  installGuestEvents(net);
  net.emit("event", { op: "event", kind: "toast", text: "hello" });
  assert.equal(got.length, 1);
  assert.equal(got[0].text, "hello");
  _uninstallGuestEventsForTesting();
});

test("zoneChange kind is routable through the override seam", () => {
  _uninstallGuestEventsForTesting();
  let got = null;
  setGuestEventHandler("zoneChange", (m) => { got = m; });
  dispatch({ kind: "zoneChange", zoneId: 1002, fromZoneId: 1001 });
  assert.ok(got);
  assert.equal(got.zoneId, 1002);
  assert.equal(got.fromZoneId, 1001);
  _uninstallGuestEventsForTesting();
});

test("pickup event only updates local inventory when playerId matches self", async () => {
  _uninstallGuestEventsForTesting();
  const { getAmmo, clearInventory } = await import("../js/inventory.js");
  const onlineMode = await import("../js/onlineMode.js");
  const bootstrap = await import("../js/onlineBootstrap.js");
  bootstrap._resetOnlineBootstrapForTesting();
  onlineMode._setOnlineModeForTesting({ mode: "guest", uuid: "uuid-x", joinCode: "ABCDE" });
  const net = makeFakeNet();
  bootstrap.bootstrapOnline({ netFactory: () => ({ ...net, connect: () => {}, send: () => true, close: () => {}, isConnected: () => true, getUuid: () => "u", getUrl: () => "ws://x" }) });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_self", name: "Me" });

  const KUNAI = 7000;
  clearInventory();
  // Pickup tagged for another player → no local change.
  dispatch({ kind: "pickup", playerId: "p_other", items: [{ speciesId: KUNAI, amount: 5 }] });
  assert.equal(getAmmo(KUNAI, 0), 0);

  // Pickup tagged for self → addAmmo.
  dispatch({ kind: "pickup", playerId: "p_self", items: [{ speciesId: KUNAI, amount: 5 }] });
  assert.equal(getAmmo(KUNAI, 0), 5);

  // Legacy payload (no playerId) preserved as "for me" so old fixtures
  // still apply.
  dispatch({ kind: "pickup", items: [{ speciesId: KUNAI, amount: 2 }] });
  assert.equal(getAmmo(KUNAI, 0), 7);

  bootstrap._resetOnlineBootstrapForTesting();
  onlineMode._resetOnlineModeForTesting();
  _uninstallGuestEventsForTesting();
});

test("a duplicate pickup (same eid) is applied once; a new eid applies again", async () => {
  _uninstallGuestEventsForTesting();
  const { getAmmo, clearInventory } = await import("../js/inventory.js");
  const onlineMode = await import("../js/onlineMode.js");
  const bootstrap = await import("../js/onlineBootstrap.js");
  bootstrap._resetOnlineBootstrapForTesting();
  onlineMode._setOnlineModeForTesting({ mode: "guest", uuid: "uuid-x", joinCode: "ABCDE" });
  const net = makeFakeNet();
  bootstrap.bootstrapOnline({ netFactory: () => ({ ...net, connect: () => {}, send: () => true, close: () => {}, isConnected: () => true, getUuid: () => "u", getUrl: () => "ws://x" }) });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_self", name: "Me" });

  const KUNAI = 7000;
  clearInventory();
  dispatch({ kind: "pickup", playerId: "p_self", eid: 1, items: [{ speciesId: KUNAI, amount: 5 }] });
  assert.equal(getAmmo(KUNAI, 0), 5);
  // Same eid redelivered (path switch / replay) — must NOT stack.
  dispatch({ kind: "pickup", playerId: "p_self", eid: 1, items: [{ speciesId: KUNAI, amount: 5 }] });
  assert.equal(getAmmo(KUNAI, 0), 5);
  // A genuinely new pickup (new eid) applies.
  dispatch({ kind: "pickup", playerId: "p_self", eid: 2, items: [{ speciesId: KUNAI, amount: 3 }] });
  assert.equal(getAmmo(KUNAI, 0), 8);

  bootstrap._resetOnlineBootstrapForTesting();
  onlineMode._resetOnlineModeForTesting();
  _uninstallGuestEventsForTesting();
});

test("ammoSet event overwrites local counts to the absolute value for self", async () => {
  _uninstallGuestEventsForTesting();
  const { getAmmo, addAmmo, clearInventory } = await import("../js/inventory.js");
  const onlineMode = await import("../js/onlineMode.js");
  const bootstrap = await import("../js/onlineBootstrap.js");
  bootstrap._resetOnlineBootstrapForTesting();
  onlineMode._setOnlineModeForTesting({ mode: "guest", uuid: "uuid-x", joinCode: "ABCDE" });
  const net = makeFakeNet();
  bootstrap.bootstrapOnline({ netFactory: () => ({ ...net, connect: () => {}, send: () => true, close: () => {}, isConnected: () => true, getUuid: () => "u", getUrl: () => "ws://x" }) });
  net.emit("welcome", { op: "welcome", protocol: 1, playerId: "p_self", name: "Me" });

  const KUNAI = 7000;
  clearInventory();
  addAmmo(KUNAI, 4, 0);
  // For another player → ignored.
  dispatch({ kind: "ammoSet", playerId: "p_other", items: [{ speciesId: KUNAI, count: 99 }] });
  assert.equal(getAmmo(KUNAI, 0), 4);
  // For self, lower → removeAmmo down to target.
  dispatch({ kind: "ammoSet", playerId: "p_self", items: [{ speciesId: KUNAI, count: 2 }] });
  assert.equal(getAmmo(KUNAI, 0), 2);
  // For self, higher → addAmmo up to target.
  dispatch({ kind: "ammoSet", playerId: "p_self", items: [{ speciesId: KUNAI, count: 10 }] });
  assert.equal(getAmmo(KUNAI, 0), 10);

  bootstrap._resetOnlineBootstrapForTesting();
  onlineMode._resetOnlineModeForTesting();
  _uninstallGuestEventsForTesting();
});

test("hostPause events drive the guest-side isHostPausedRemote flag", async () => {
  _uninstallGuestEventsForTesting();
  const { isHostPausedRemote, _resetGuestHostPauseForTesting } =
    await import("../js/guestHostPause.js");
  _resetGuestHostPauseForTesting();
  assert.equal(isHostPausedRemote(), false);
  dispatch({ kind: "hostPause", paused: true });
  assert.equal(isHostPausedRemote(), true);
  dispatch({ kind: "hostPause", paused: false });
  assert.equal(isHostPausedRemote(), false);
  // uninstallGuestEvents resets the cached flag so a re-join doesn't
  // inherit a stale "paused" state from a previous session.
  dispatch({ kind: "hostPause", paused: true });
  assert.equal(isHostPausedRemote(), true);
  _uninstallGuestEventsForTesting();
  assert.equal(isHostPausedRemote(), false);
});

test("pickup events feed addAmmo so the guest's HUD updates", async () => {
  _uninstallGuestEventsForTesting();
  const { getAmmo } = await import("../js/inventory.js");
  // Snapshot starting counts because other tests in the suite may have
  // hydrated inventory with non-zero values for the same species ids.
  const KUNAI = 7000;
  const SWORD = 1170;
  const before = { kunai: getAmmo(KUNAI, 0), sword: getAmmo(SWORD, 0) };
  dispatch({ kind: "pickup", items: [{ speciesId: KUNAI, amount: 3 }, { speciesId: SWORD, amount: 1 }] });
  assert.equal(getAmmo(KUNAI, 0), before.kunai + 3);
  assert.equal(getAmmo(SWORD, 0), before.sword + 1);
  // Defensive: malformed item entries don't throw and don't add.
  dispatch({ kind: "pickup", items: [null, { speciesId: 0, amount: 5 }, { speciesId: KUNAI, amount: -2 }] });
  assert.equal(getAmmo(KUNAI, 0), before.kunai + 3);
  _uninstallGuestEventsForTesting();
});

test("cutscene events are routable through the override seam", () => {
  _uninstallGuestEventsForTesting();
  const seen = [];
  setGuestEventHandler("cutsceneStart", (m) => seen.push(["start", m.key]));
  setGuestEventHandler("cutsceneEnd", (m) => seen.push(["end", m.key]));
  dispatch({ kind: "cutsceneStart", key: "demon.defeated" });
  dispatch({ kind: "cutsceneEnd", key: "demon.defeated" });
  assert.deepEqual(seen, [["start", "demon.defeated"], ["end", "demon.defeated"]]);
  _uninstallGuestEventsForTesting();
});

test("dialogue events are routable through the override seam", () => {
  _uninstallGuestEventsForTesting();
  const seen = [];
  setGuestEventHandler("dialogueOpen", (m) => seen.push(["open", m.lines]));
  setGuestEventHandler("dialogueAdvance", (m) => seen.push(["advance", m.idx]));
  setGuestEventHandler("dialogueClose", () => seen.push(["close"]));
  dispatch({ kind: "dialogueOpen", lines: ["hello", "world"], idx: 0 });
  dispatch({ kind: "dialogueAdvance", idx: 1 });
  dispatch({ kind: "dialogueClose" });
  assert.deepEqual(seen, [
    ["open", ["hello", "world"]],
    ["advance", 1],
    ["close"],
  ]);
  _uninstallGuestEventsForTesting();
});

test("death/respawn events are routable through the override seam", () => {
  _uninstallGuestEventsForTesting();
  const seen = [];
  setGuestEventHandler("death", (m) => seen.push(["death", m.playerId]));
  setGuestEventHandler("respawn", (m) => seen.push(["respawn", m.playerId]));
  dispatch({ kind: "death", playerId: "p_self" });
  dispatch({ kind: "respawn", playerId: "p_self" });
  dispatch({ kind: "death", playerId: "p_peer" });
  assert.deepEqual(seen, [
    ["death", "p_self"],
    ["respawn", "p_self"],
    ["death", "p_peer"],
  ]);
  _uninstallGuestEventsForTesting();
});

test("malformed events are ignored", () => {
  _uninstallGuestEventsForTesting();
  let count = 0;
  setGuestEventHandler("toast", () => { count++; });
  dispatch(null);
  dispatch({});
  dispatch({ kind: 42 });
  assert.equal(count, 0);
  _uninstallGuestEventsForTesting();
});
