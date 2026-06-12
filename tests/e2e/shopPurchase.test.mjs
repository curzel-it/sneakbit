// End-to-end shop purchase through the real module graph + DOM. Boots the
// normal offline game, opens the buy screen from the SHIPPED clerk stock
// (data/12900001.json — the zone-1001 shop interior), then buys a kunai
// bundle by driving the actual DOM (click the row, click Buy) and asserts
// the wallet was debited and the kunai landed in the inventory.
//
// Dev serves raw ES modules from /js, so an in-page import() resolves the
// SAME singletons the running game uses — we read wallet.js / inventory.js
// straight after the click. Self-skips when Chrome isn't installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skipIfNoChrome, launchChrome, getTargets,
  connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8016;
const RELAY_PORT = 8106;
const CHROME_PORT = 9276;

// The zone-1001 shop interior, its clerk entity, and the kunai-bundle good.
const SHOP_ZONE = 12900001;
const CLERK_ID = 12900010;
const KUNAI_BUNDLE = 7001; // expands to 10× kunai (7000)
const KUNAI = 7000;
const BUNDLE_PRICE = 10;

test("shop: opens the shipped clerk stock and a kunai purchase moves coins → inventory", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-shop" });
  t.after(() => chrome.kill());
  const targets = await getTargets(CHROME_PORT);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });

  await navigate(s, `${servers.appUrl}/play/`);
  // Coin HUD mounting is our "game booted, data loaded" signal.
  await waitFor(s, "!!document.getElementById('coin-hud')");

  // — Open the shop from the SHIPPED clerk stock ——————————————————————————
  // Pull the stock off the real interior zone so the test breaks if the data
  // (or its parsing) ever stops carrying shop_stock, then open the overlay.
  const stock = await evalExpr(s, `(async () => {
    const { loadZone } = await import('./js/data.js');
    const zone = await loadZone(${SHOP_ZONE});
    const clerk = zone.entities.find((e) => e.id === ${CLERK_ID});
    const { openShop } = await import('./js/shop.js');
    openShop(clerk.shop_stock, 0);
    return clerk.shop_stock;
  })()`);
  assert.ok(Array.isArray(stock) && stock.length > 0, "the clerk carries shipped shop_stock");
  const kunaiIdx = stock.findIndex((e) => e.item === KUNAI_BUNDLE);
  assert.ok(kunaiIdx >= 0, "the kunai bundle is on sale");
  assert.equal(stock[kunaiIdx].price, BUNDLE_PRICE, "kunai bundle priced at 10");

  await waitFor(s, `(() => getComputedStyle(document.getElementById('shop')).display !== 'none')()`);

  // — Snapshot the wallet + kunai count before buying ——————————————————————
  const before = await evalExpr(s, `(async () => {
    const { getCoins } = await import('./js/wallet.js');
    const { getAmmo } = await import('./js/inventory.js');
    return { coins: getCoins(0), kunai: getAmmo(${KUNAI}, 0) };
  })()`);

  // — Drive the real DOM: open the kunai row, then click Buy ————————————————
  await evalExpr(s, `document.querySelector('#shop .shop-row[data-i="${kunaiIdx}"]').click()`);
  await waitFor(s, `(() => !!document.querySelector('#shop .shop-buy'))()`);
  // Default quantity for a 10-coin bundle on the starting purse is 1 → +10 kunai.
  const qty = await evalExpr(s, "Number(document.querySelector('#shop .shop-qty-val').textContent)");
  assert.equal(qty, 1, "quantity defaults to 1");
  await evalExpr(s, `document.querySelector('#shop .shop-buy').click()`);

  // confirmBuy() returns to the storefront once the purchase lands.
  await waitFor(s, `(() => document.querySelector('#shop .shop-screen[data-screen="detail"]').style.display === 'none')()`);

  // — Assert the purchase moved coins into kunai ——————————————————————————
  const after = await evalExpr(s, `(async () => {
    const { getCoins } = await import('./js/wallet.js');
    const { getAmmo } = await import('./js/inventory.js');
    return { coins: getCoins(0), kunai: getAmmo(${KUNAI}, 0) };
  })()`);

  assert.equal(after.kunai - before.kunai, 10, "buying one bundle grants 10 kunai");
  assert.equal(before.coins - after.coins, BUNDLE_PRICE, "the wallet is debited the bundle price");

  // The HUD reflects the debited balance.
  assert.equal(
    await evalExpr(s, "document.querySelector('#coin-hud span').textContent"),
    String(after.coins),
    "coin HUD shows the post-purchase balance",
  );

  assert.deepEqual(errors, [], "no uncaught page exceptions");
});
