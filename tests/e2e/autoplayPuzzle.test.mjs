// The autoplay bot solving a Sokoban key puzzle end-to-end, in a real
// browser. Boots straight into a key dungeon (1007) and asserts the bot
// collects the key: it finds the key isn't walk-reachable, runs an
// off-thread worker solve, pushes the box with botPush, walks clear across
// the zone via the engine-true pathfinder, and steps onto the key.
//
// Monster damage is neutralised for the run (a hard-immunity tick) so the
// test exercises the PUZZLE machinery deterministically — survival in the
// monster-dense dungeon is botCombat's concern, covered elsewhere. Keys live
// in the inventory (every key zone is ephemeral_state, so no collected flag),
// so that's what we assert. Self-skips without Chrome.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skipIfNoChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8019;
const RELAY_PORT = 8119;
const CHROME_PORT = 9279;
const KEY_ZONE = 1007;

test("autoplay: the bot solves a Sokoban puzzle and collects a dungeon key", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-puzzle" });
  t.after(() => chrome.kill());
  const page = (await getTargets(CHROME_PORT)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });

  await navigate(s, `${servers.appUrl}/play/?autoplay=1&zone=${KEY_ZONE}`);
  await waitFor(s, "!!document.getElementById('coin-hud')", { timeoutMs: 20000 });
  await waitFor(s, "!!(window.autoplay && window.autoplay.ready)", { timeoutMs: 30000 });

  // Neutralise monster damage so the long cross-zone solve isn't cut short by
  // a death (survival is tested separately). A repeating hard-immunity tick.
  await evalExpr(s, `(async () => {
    const { setPlayerHardImmunity } = await import('./js/playerHealth.js');
    window.__imm = setInterval(() => setPlayerHardImmunity(2, 0), 200);
  })()`);

  // Keys are inventory items (ephemeral zones never write a collected flag).
  const keysExpr = `(async () => {
    const { getAmmo } = await import('./js/inventory.js');
    let k = 0;
    for (const sp of [2000, 2001, 2002, 2003, 2004, 2005]) if (getAmmo(sp, 0) > 0) k++;
    return k;
  })()`;

  await waitFor(s, `(async () => (await (${keysExpr})) >= 1)()`, { timeoutMs: 200000, pollMs: 2000 });

  const keys = await evalExpr(s, keysExpr);
  assert.ok(keys >= 1, `collected ${keys} dungeon keys`);
  assert.deepEqual(errors, [], `no uncaught page errors:\n${errors.join("\n")}`);
});
