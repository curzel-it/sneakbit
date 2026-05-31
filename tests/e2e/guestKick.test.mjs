// E2E: host kicks a guest → the guest must drop cleanly back to offline
// and stay PLAYABLE, not freeze. Regression for the freeze where a throw
// in teardownRole("guest") rejected switchRole("offline") before the
// runtime role flipped: the role stayed "guest", the loop kept ticking a
// torn-down mirror world, and the guest could neither move nor recover
// (only a reload got them out). The "removed from session" toast still
// showed because it fires before switchRole — so the toast alone is NOT
// proof the client recovered. This test asserts the client actually came
// back: runtimeRole === "offline" AND the offline avatar can still step.
// Self-skips when Chrome isn't installed.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, evalExpr, waitFor } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession } from "./fixtures/coopSession.mjs";

let servers;
before(async () => {
  if (!findChrome()) return; // tests below self-skip
  servers = await startServers({ staticPort: 8016, relayPort: 8106 });
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("host kicks guest → guest drops to offline and stays playable", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    hostPort: 9281,
    guestPort: 9282,
    hostDir: "/tmp/sb-e2e-kick-host",
    guestDir: "/tmp/sb-e2e-kick-guest",
  });
  t.after(() => session.stop());

  // Surface any uncaught exception on the guest — a teardown throw would
  // land here and is the root cause we're guarding against.
  const guestErrors = [];
  session.guest.on("Runtime.exceptionThrown", (p) =>
    guestErrors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

  // The guest is connected (coopSession waits for mirror + predicted-self).
  // Grab its server-assigned playerId — that's what host.kick matches on.
  const guestPlayerId = await evalExpr(session.guest, `
    (async () => {
      const o = await import('./js/onlineBootstrap.js');
      return o.getSelfPlayerId && o.getSelfPlayerId();
    })()
  `);
  assert.ok(guestPlayerId, "guest should have a server-assigned playerId");

  // Host kicks the guest the same way the party-panel "Kick" button does:
  // host.send({ op: "host.kick", playerId }). The relay replies with close
  // code 4005 to the kicked guest.
  await evalExpr(session.host, `
    (async () => {
      const o = await import('./js/onlineBootstrap.js');
      o.getNet().send({ op: 'host.kick', playerId: ${JSON.stringify(guestPlayerId)} });
      return true;
    })()
  `);

  // Guest must end up back in the offline runtime role. If the teardown
  // throw regressed, the role would stay "guest" forever and this times out.
  await waitFor(session.guest, `
    (async () => {
      const m = await import('./js/onlineMode.js');
      return m.getRuntimeRole() === 'offline' || null;
    })()
  `, { timeoutMs: 15000 });

  // Offline state must be rebuilt — the avatar exists again.
  const before = await evalExpr(session.guest, "window.coop.positions()");
  assert.ok(Array.isArray(before) && before.length >= 1, "offline avatar should exist after kick");

  // The real proof it isn't frozen: the offline tick still processes
  // input. Movement is Gameboy-style tile-stepping, so the first tap in a
  // new direction only TURNS the avatar to face it — that turn is enough
  // to prove the loop is alive and reading input. A frozen guest (stale
  // "guest" role, no offline tick) would never turn. We then tap the same
  // direction again to confirm an actual tile step is possible too.
  const cur = before[0].direction;
  const target = cur === "up" ? "down" : "up";
  await evalExpr(session.guest, `window.coop.tap(1, ${JSON.stringify(target)})`);
  await sleep(250);
  const turned = await evalExpr(session.guest, "window.coop.positions()");
  assert.equal(turned[0].direction, target,
    "kicked guest must still react to input offline (did not turn — frozen)");

  // Now step: a second tap in the faced direction advances one tile
  // (unless a wall is dead ahead — try both axes so the assertion is
  // collision-independent).
  let moved = false;
  for (const dir of [target, target === "up" ? "down" : "up", "left", "right"]) {
    const pre = (await evalExpr(session.guest, "window.coop.positions()"))[0];
    await evalExpr(session.guest, `window.coop.tap(1, ${JSON.stringify(dir)})`);
    await sleep(250);
    await evalExpr(session.guest, `window.coop.tap(1, ${JSON.stringify(dir)})`);
    await sleep(450);
    const post = (await evalExpr(session.guest, "window.coop.positions()"))[0];
    if (post.tileX !== pre.tileX || post.tileY !== pre.tileY) { moved = true; break; }
  }
  assert.ok(moved, "kicked guest must still be able to step offline (not frozen)");

  assert.deepEqual(guestErrors, [], `guest threw uncaught exceptions: ${guestErrors.join("; ")}`);
});
