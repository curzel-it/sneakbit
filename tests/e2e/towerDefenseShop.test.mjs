// End-to-end Tower Defense shop + finite-ammo flow through the real module
// graph + DOM, driven via ?mode=td. Asserts: the squad boots with finite ammo
// shown in the ammo HUD, the dock's Shop button opens the regular shop UI
// stocked with the TD catalog, and a purchase debits the shared squad purse —
// all with zero uncaught page exceptions. Self-skips when Chrome isn't present.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skipIfNoChrome, launchChrome, getTargets,
  connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8014;
const RELAY_PORT = 8104;
const CHROME_PORT = 9274;

test("tower defense: finite ammo HUD + shop button opens shop and a buy debits coins", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-td-shop" });
  t.after(() => chrome.kill());
  const targets = await getTargets(CHROME_PORT);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });

  await navigate(s, `${servers.appUrl}/play/?mode=td`);

  await waitFor(s, "!!window.td");
  await waitFor(s, "window.td.state().phase === 'build'");

  // — Finite ammo: the starting Ninja has rounds, shown in the ammo HUD ————————
  assert.ok(
    await evalExpr(s, "!!document.getElementById('ammo-hud') && getComputedStyle(document.getElementById('ammo-hud')).display !== 'none'"),
    "ammo HUD is visible in TD (ammo is finite now)",
  );
  assert.ok(
    await evalExpr(s, "/x\\d+/.test(document.getElementById('ammo-hud').textContent)"),
    "ammo HUD shows a round count for the active hero",
  );

  // — The Shop button is in the dock and opens the shop overlay ————————————————
  await evalExpr(s, "window.td.coins(5000)"); // afford anything
  assert.ok(
    await evalExpr(s, "!!document.querySelector('#td-dock .td-shop') && getComputedStyle(document.querySelector('#td-dock .td-shop')).display !== 'none'"),
    "the Shop button is visible next to Switch hero",
  );
  await evalExpr(s, "document.querySelector('#td-dock .td-shop').click()");
  await waitFor(s, "!!document.getElementById('shop') && getComputedStyle(document.getElementById('shop')).display === 'flex'");
  assert.ok(
    await evalExpr(s, "document.querySelectorAll('#shop .shop-row').length > 3"),
    "the shop is stocked with the TD catalog",
  );

  // — A purchase debits the shared coin purse ——————————————————————————————————
  const coinsBefore = await evalExpr(s, "window.td.state().coins");
  // Open the first buyable row, then confirm the buy.
  await evalExpr(s, "document.querySelector('#shop .shop-row:not(.is-owned)').click()");
  await waitFor(s, "!!document.querySelector('#shop .shop-buy:not([disabled])')");
  await evalExpr(s, "document.querySelector('#shop .shop-buy').click()");
  await waitFor(s, `window.td.state().coins < ${coinsBefore}`, { timeoutMs: 4000 });
  const coinsAfter = await evalExpr(s, "window.td.state().coins");
  assert.ok(coinsAfter < coinsBefore, "buying debited the shared squad purse");

  assert.deepEqual(errors, [], "no uncaught page exceptions during the shop flow");
});
