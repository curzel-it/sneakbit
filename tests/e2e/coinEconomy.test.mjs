// End-to-end coin economy through the real module graph + DOM HUD. Boots the
// normal offline game (not ?mode=td) and asserts the wiring the unit tests
// can't see in node: the coin species loaded from data/species.json with the
// real sprite + tuned monster drops, the #coin-hud mounted and reacting to
// wallet changes, and the whole graph importing with zero page exceptions.
//
// Dev serves raw ES modules from /js, so an in-page import() resolves the SAME
// singletons the running game uses — letting us poke wallet.js and read the
// live HUD. Self-skips when Chrome isn't installed.

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

test("coins: species loads, HUD mounts and tracks the wallet, no exceptions", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-coins" });
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

  // — Boot: the coin HUD mounts in the normal game ————————————————————————
  await waitFor(s, "!!document.getElementById('coin-hud')");
  assert.ok(
    await evalExpr(s, "getComputedStyle(document.getElementById('coin-hud')).display !== 'none'"),
    "coin HUD is visible in the normal (non-TD) game",
  );
  assert.equal(
    await evalExpr(s, "document.querySelector('#coin-hud span').textContent"),
    "50",
    "a fresh save starts with the 50-coin starting purse",
  );

  // — Species data: the coin + tuned monster drops loaded from JSON ————————
  const coin = await evalExpr(s, `(async () => {
    const { getSpecies } = await import('./js/species.js');
    const c = getSpecies(2010);
    return { type: c.entity_type, frames: c.frames, ty: c.texture_y, off: c.inventory_texture_offset };
  })()`);
  assert.equal(coin.type, "PickableObject", "coin is a PickableObject");
  assert.equal(coin.frames, 12, "coin uses the 12-frame ground strip");
  assert.equal(coin.ty, 7, "coin ground sprite at animated_objects row 7");
  assert.deepEqual(coin.off, [12, 5], "coin HUD icon at inventory [12,5]");

  const drop = await evalExpr(s, `(async () => {
    const { getSpecies } = await import('./js/species.js');
    const { rollCoinDrop } = await import('./js/coinDrops.js');
    const sp = getSpecies(4006); // strawberry, tuned to 0.8 / 5
    return { hit: rollCoinDrop(sp, () => 0.1), miss: rollCoinDrop(sp, () => 0.9) };
  })()`);
  assert.equal(drop.hit, 5, "strawberry drops 5 coins on a successful roll");
  assert.equal(drop.miss, 0, "strawberry drops nothing on a failed roll");

  // — Wallet → HUD: crediting coins ticks the counter live ————————————————
  // Delta-based so it survives the starting-purse seed: read the balance,
  // credit 5, expect the HUD to show before+5.
  const expected = await evalExpr(s, `(async () => {
    const { addCoins, getCoins } = await import('./js/wallet.js');
    const before = getCoins(0);
    addCoins(5, 0);
    return String(before + 5);
  })()`);
  const label = await waitFor(s, `(() => {
    const t = document.querySelector('#coin-hud span').textContent;
    return t === ${JSON.stringify(expected)} ? t : null;
  })()`);
  assert.equal(label, expected, "HUD reflects the credited balance (+5)");

  // — Full loop: a forced drop, then walking onto the coin credits the wallet —
  // Exercises the real combat→pickup seam (coinDrops.maybeDropCoin spawning an
  // ephemeral coin, then pickups.checkPickup collecting it) against a throwaway
  // zone, independent of the live world. rng=()=>0 forces a 1-coin drop onto the
  // tile below-left of the corpse (0,0), where we place the hero.
  const loop = await evalExpr(s, `(async () => {
    const { maybeDropCoin } = await import('./js/coinDrops.js');
    const { checkPickup } = await import('./js/pickups.js');
    const { getCoins } = await import('./js/wallet.js');
    const zone = {
      cols: 3, rows: 3,
      collision: [[false,false,false],[false,false,false],[false,false,false]],
      entities: [{ id: 999001, species_id: 4003, frame: { x: 1, y: 1, w: 1, h: 1 } }],
    };
    const before = getCoins(0);
    maybeDropCoin(zone, zone.entities[0], () => 0);
    const dropped = zone.entities.filter((e) => e.species_id === 2010).length;
    // Drop the corpse so only the coin remains, then stand the hero on it.
    zone.entities = zone.entities.filter((e) => e.species_id === 2010);
    checkPickup({ zone, player: { tileX: 0, tileY: 0, index: 0, playerId: null } });
    return { dropped, gained: getCoins(0) - before, left: zone.entities.length };
  })()`);
  assert.equal(loop.dropped, 1, "a forced kill scatters one coin");
  assert.equal(loop.gained, 1, "walking onto the coin credits exactly 1");
  assert.equal(loop.left, 0, "the collected coin is removed from the zone");

  assert.deepEqual(errors, [], "no uncaught page exceptions");
});
