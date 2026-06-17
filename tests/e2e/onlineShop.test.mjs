// E2E: online co-op shop access for a guest. The clerk's buy screen is a
// host-owned DOM modal, so a guest can't use the host's — instead the host
// sends the stock to the guest (event:shopOpen), the guest runs the buy on its
// own client, and reports each grant back (shop.bought) so the host mirrors the
// ammo into its authoritative per-guest pool (the one shooting.js spends and
// ammoSet rebroadcasts). This exercises both new wire directions over the real
// transport + relay, end to end.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, evalExpr, waitFor } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession } from "./fixtures/coopSession.mjs";

// Kunai bullet — a stackable shop good present in the shipped species data.
const KUNAI = 7000;

let servers;
before(async () => {
  if (!findChrome()) return; // test self-skips
  servers = await startServers({ staticPort: 8003, relayPort: 8093 });
});
after(() => { if (servers) servers.stop(); });

test("guest opens the clerk shop on its own client and a purchase credits the host's pool", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    hostPort: 9233, guestPort: 9234,
    hostDir: "/tmp/sb-e2e-shop-host",
    guestDir: "/tmp/sb-e2e-shop-guest",
  });
  t.after(() => session.stop());

  const guestId = await evalExpr(session.guest, `
    (async () => (await import('./js/onlineBootstrap.js')).getSelfPlayerId())()
  `);
  assert.ok(guestId, "guest learned its playerId");

  // Host decides this guest is standing at a clerk — the path performInteract
  // takes for a guest facing shop_stock. Send a one-item stock to the guest.
  await evalExpr(session.host, `
    (async () => {
      const { broadcastHostEvent } = await import('./js/hostEvents.js');
      broadcastHostEvent('shopOpen', { playerId: ${JSON.stringify(guestId)}, stock: [{ item: ${KUNAI}, price: 1 }] });
      return true;
    })()
  `);

  // The buy screen opens on the GUEST's own client.
  await waitFor(session.guest, `
    (async () => (await import('./js/shop.js')).isShopOpen() || null)()
  `, { timeoutMs: 10000 });

  // While the buy screen is open the guest's predicted self is frozen, so its
  // avatar can't wander on the host while shopping.
  const frozen = await evalExpr(session.guest, `
    (async () => {
      const shop = await import('./js/shop.js');
      return shop.isShopOpen();
    })()
  `);
  assert.equal(frozen, true);

  // Guest completes a purchase — this is the exact frame the buy screen's
  // onPurchase hook emits after granting the goods locally.
  await evalExpr(session.guest, `
    (async () => {
      const { getNet } = await import('./js/onlineBootstrap.js');
      getNet().send({ op: 'shop.bought', items: [{ speciesId: ${KUNAI}, amount: 7 }] });
      return true;
    })()
  `);

  // The host mirrors the grant into the guest's authoritative pool. The lone
  // guest is slot 2 → player index 1.
  await waitFor(session.host, `
    (async () => {
      const inv = await import('./js/inventory.js');
      return inv.getAmmo(${KUNAI}, 1) === 7 || null;
    })()
  `, { timeoutMs: 10000 });

  // …and echoes an absolute ammoSet, so the guest's own HUD count matches.
  await waitFor(session.guest, `
    (async () => {
      const inv = await import('./js/inventory.js');
      return inv.getAmmo(${KUNAI}, 0) === 7 || null;
    })()
  `, { timeoutMs: 10000 });

  // The host's own pool (index 0) is untouched — per-player inventory.
  assert.equal(await evalExpr(session.host, `
    (async () => (await import('./js/inventory.js')).getAmmo(${KUNAI}, 0))()
  `), 0, "host's own kunai pool is not credited by the guest's purchase");
});
