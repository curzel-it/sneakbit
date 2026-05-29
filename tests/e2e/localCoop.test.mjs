// E2E: local co-op with 2, 3 and 4 players on one machine. For each N we
// set the local player count, assert N avatars spawn with N HP bars, then
// drive each input slot in turn and assert ONLY that slot's avatar moves —
// proving each local player is independently controlled at every count.
//
// Input is exercised through the real pipeline via window.coop (a debug
// hook in main.js): tap() injects a press into a slot exactly as the
// keyboard/gamepad path would. We assert on FACING rather than position —
// pressing a direction the avatar isn't already facing rotates it in
// place (player.js), which is terrain-independent, so the test doesn't
// depend on which tiles happen to be walkable around each spawn.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers({ staticPort: 8004, relayPort: 8094 });
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function positions(s) {
  return evalExpr(s, "window.coop.positions()");
}
function posOf(list, index) {
  return list.find((p) => p.index === index);
}

test("local co-op spawns and independently drives 2, 3, and 4 players", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9261, dataDir: "/tmp/sb-e2e-localcoop" });
  t.after(() => chrome.kill());
  const targets = await getTargets(9261);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!(window.coop && window.coop.positions().length >= 1)");

  for (const N of [2, 3, 4]) {
    // Fresh layout each round: drop to single-player then back up to N so
    // P2-P4 respawn on walkable tiles next to P1, instead of inheriting
    // drift from the previous round's taps.
    await evalExpr(s, "window.coop.setLocalPlayers(1)");
    await evalExpr(s, `window.coop.setLocalPlayers(${N})`);

    const count = await evalExpr(s, "window.coop.count()");
    assert.equal(count, N, `localPlayerCount should be ${N}`);

    const players = await positions(s);
    assert.equal(players.length, N, `expected ${N} avatars, got ${players.length}`);

    const bars = await evalExpr(s, `[...document.querySelectorAll('#health-hud .hp-card')].filter(c => c.style.display !== 'none').length`);
    assert.equal(bars, N, `expected ${N} visible HP bars, got ${bars}`);

    // Drive each slot 1..N and assert only that avatar reacts (turns to
    // face the tapped direction) while the others are untouched.
    for (let slot = 1; slot <= N; slot++) {
      const index = slot - 1;
      const before = await positions(s);
      const cur = posOf(before, index).direction;
      const target = cur === "up" ? "down" : "up"; // a direction it isn't facing

      await evalExpr(s, `window.coop.tap(${slot}, ${JSON.stringify(target)})`);
      await sleep(250);

      const after = await positions(s);
      assert.equal(
        posOf(after, index).direction, target,
        `N=${N}: slot ${slot} (P${slot}) did not turn to face ${target}`,
      );
      // No other avatar should have changed facing.
      for (const other of after) {
        if (other.index === index) continue;
        assert.equal(
          other.direction, posOf(before, other.index).direction,
          `N=${N}: tapping slot ${slot} also turned P${other.index + 1}`,
        );
      }
    }
  }

  assert.deepEqual(errors, [], "page threw no exceptions");
});
