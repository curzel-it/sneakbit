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
} = await import("../js/guestEvents.js?v=20260527b");

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

test("pickup events feed addAmmo so the guest's HUD updates", async () => {
  _uninstallGuestEventsForTesting();
  const { getAmmo } = await import("../js/inventory.js?v=20260527b");
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
