// End-to-end skins flow through the real module graph + DOM. Boots the
// offline game, buys a cosmetic skin from the SHIPPED clerk stock by driving
// the shop DOM, then equips it from the wardrobe screen in the pause menu —
// asserting the buy debits coins without auto-equipping, and the wardrobe
// equip flips the selected skin (and thus the rendered hero column).
//
// Dev serves raw ES modules from /js, so an in-page import() resolves the SAME
// singletons the running game uses. Self-skips when Chrome isn't installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skipIfNoChrome, launchChrome, getTargets,
  connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8019;
const RELAY_PORT = 8109;
const CHROME_PORT = 9279;

const SHOP_ZONE = 12900001;
const CLERK_ID = 12900010;
const SKIN_ID = "ninja_black";
const SKIN_PRICE = 400;
const SKIN_COLUMN = 21; // ninja_black's heroes-sheet column (skins.js)

const key = (s, code) =>
  evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, bubbles: true }))`);

test("skins: buy a skin in the shop, then equip it from the wardrobe", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-skins" });
  t.after(() => chrome.kill());
  const targets = await getTargets(CHROME_PORT);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!document.getElementById('coin-hud')");

  // Give the hero enough coins to afford a premium skin.
  await evalExpr(s, `(async () => {
    const { addCoins } = await import('./js/wallet.js');
    addCoins(${SKIN_PRICE}, 0);
  })()`);

  // — Open the shop from the SHIPPED clerk stock and locate the skin row ——————
  const stock = await evalExpr(s, `(async () => {
    const { loadZone } = await import('./js/data.js');
    const zone = await loadZone(${SHOP_ZONE});
    const clerk = zone.entities.find((e) => e.id === ${CLERK_ID});
    const { openShop } = await import('./js/shop.js');
    openShop(clerk.shop_stock, 0);
    return clerk.shop_stock;
  })()`);
  const skinIdx = stock.findIndex((e) => e.skin === SKIN_ID);
  assert.ok(skinIdx >= 0, "the clerk sells the skin");
  assert.equal(stock[skinIdx].price, SKIN_PRICE, "skin priced as expected");

  await waitFor(s, `(() => getComputedStyle(document.getElementById('shop')).display !== 'none')()`);

  const before = await evalExpr(s, `(async () => {
    const { getCoins } = await import('./js/wallet.js');
    const { isOwned, getSelected } = await import('./js/skins.js');
    return { coins: getCoins(0), owned: isOwned('${SKIN_ID}', 0), selected: getSelected(0) };
  })()`);
  assert.equal(before.owned, false, "skin starts unowned");

  // — Drive the shop DOM: open the skin row, then click Buy ——————————————————
  await evalExpr(s, `document.querySelector('#shop .shop-row[data-i="${skinIdx}"]').click()`);
  await waitFor(s, `(() => !!document.querySelector('#shop .shop-buy'))()`);
  // Skins are one-of-a-kind: the detail screen shows no quantity stepper.
  assert.equal(
    await evalExpr(s, "!!document.querySelector('#shop .shop-qty')"),
    false,
    "a skin has no quantity stepper",
  );
  await evalExpr(s, `document.querySelector('#shop .shop-buy').click()`);
  await waitFor(s, `(() => document.querySelector('#shop .shop-screen[data-screen="detail"]').style.display === 'none')()`);

  const afterBuy = await evalExpr(s, `(async () => {
    const { getCoins } = await import('./js/wallet.js');
    const { isOwned, getSelected } = await import('./js/skins.js');
    return { coins: getCoins(0), owned: isOwned('${SKIN_ID}', 0), selected: getSelected(0) };
  })()`);
  assert.equal(afterBuy.owned, true, "skin is owned after purchase");
  assert.equal(before.coins - afterBuy.coins, SKIN_PRICE, "wallet debited the skin price");
  assert.equal(afterBuy.selected, "default", "buying does NOT auto-equip the skin");

  // — Close the shop, open the pause menu, go to the Wardrobe ————————————————
  await evalExpr(s, `document.querySelector('#shop .shop-close').click()`);
  await waitFor(s, `(() => getComputedStyle(document.getElementById('shop')).display === 'none')()`);
  await key(s, "Escape"); // open the pause menu
  await waitFor(s, `(() => getComputedStyle(document.getElementById('menu')).display !== 'none')()`);
  await evalExpr(s, `document.getElementById('menu-open-wardrobe').click()`);
  await waitFor(s, `(() => !!document.querySelector('#menu-wardrobe-body .wardrobe-card[data-skin="${SKIN_ID}"]'))()`);

  // — Equip the owned skin from the wardrobe ————————————————————————————————
  await evalExpr(s, `document.querySelector('#menu-wardrobe-body .wardrobe-card[data-skin="${SKIN_ID}"]').click()`);
  await waitFor(s, `(async () => {
    const { getSelected } = await import('./js/skins.js');
    return getSelected(0) === '${SKIN_ID}';
  })()`);

  // The render seam now resolves the skin's column for the local hero.
  const column = await evalExpr(s, `(async () => {
    const { resolveSkinColumn } = await import('./js/skins.js');
    return resolveSkinColumn({ index: 0 });
  })()`);
  assert.equal(column, SKIN_COLUMN, "equipped skin drives the hero's sprite column");

  assert.deepEqual(errors, [], "no uncaught page exceptions");
});
