// End-to-end online co-op Tower Defense: a host runs the authoritative TD sim
// while a connected guest renders the mirror and drives its own hero. Boots a
// normal co-op session, has the host start a TD run mid-session, then asserts
// the guest adopts TD (mode + read-only HUD), sees the synced horde, and that a
// guest's movement is executed host-authoritatively on the guest's hero.
// Self-skips when Chrome isn't installed.

import { test } from "node:test";
import assert from "node:assert/strict";
import { skipIfNoChrome, evalExpr, waitFor } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession, dispatchKey, KEYS } from "./fixtures/coopSession.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const tdHudVisible = `(() => { const e = document.getElementById('td-hud');
  return !!e && getComputedStyle(e).display !== 'none'; })()`;

// The host's sand path (DESERT biome = 1) reaches the guest via tdMap, painted
// onto the mirror zone — proof the board, not just the entities, syncs.
const mirrorHasSandPath = `(async () => {
  const m = await import('./js/mirrorWorld.js');
  const z = m.getMirrorZone();
  if (!z || !z.biome) return null;
  let n = 0; for (const row of z.biome) for (const b of row) if (b === 1) n++;
  return n > 0 || null;
})()`;

// A TD enemy is a zone entity with a fusion-chain species id (4003..4007).
const mirrorHasEnemy = `(async () => {
  const m = await import('./js/mirrorWorld.js');
  const z = m.getMirrorZone();
  if (!z || !z.entities) return null;
  return z.entities.some((e) => e.species_id >= 4003 && e.species_id <= 4007) || null;
})()`;

// Guest's own predicted-self tile.
const guestSelfTile = `(async () => {
  const p = await import('./js/predictedSelf.js');
  const s = p.getPredictedSelf();
  return s ? { x: s.tileX, y: s.tileY } : null;
})()`;

test("online co-op TD: guest mirrors the run and the host drives its hero", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: 8014, relayPort: 8104 });
  t.after(() => servers.stop());
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    hostPort: 9281, guestPort: 9282,
    hostDir: "/tmp/sb-e2e-td-host", guestDir: "/tmp/sb-e2e-td-guest",
  });
  t.after(() => session.stop());
  const { host, guest } = session;

  const errors = [];
  for (const [who, s] of [["host", host], ["guest", guest]]) {
    s.on("Runtime.exceptionThrown", (p) => {
      errors.push(`${who}: ${p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown"}`);
    });
  }

  // — Host starts a TD run without tearing down the session ————————————————
  await evalExpr(host, "window.td.start()");
  await waitFor(host, "window.td.state().phase === 'build'");
  // Host kept the guest: slot 2 owns hero 1 (set by reconcileGuestHeroes on the
  // first tick, so wait for ownership rather than racing it).
  await waitFor(host, "window.td.squad() >= 2", { timeoutMs: 8000 });
  await waitFor(host, "window.td.ownerSlot(1) === 2", { timeoutMs: 8000 });

  // — Guest adopts TD: mode syncs + read-only HUD shows ————————————————————
  await waitFor(guest, "(async () => (await import('./js/gameMode.js')).isTowerDefenseMode() || null)()", { timeoutMs: 15000 });
  await waitFor(guest, tdHudVisible, { timeoutMs: 15000 });
  // Read-only: the economy dock buttons are hidden for the guest.
  assert.equal(
    await evalExpr(guest, "(() => { const b = document.querySelector('#td-dock .td-start'); return !b || getComputedStyle(b).display === 'none'; })()"),
    true, "guest TD dock is read-only (no Start button)",
  );

  // — The sand path reaches the guest's mirror board ———————————————————————
  await waitFor(guest, mirrorHasSandPath, { timeoutMs: 15000 });

  // — A wave's horde reaches the guest's mirror as synced entities ——————————
  await evalExpr(host, "window.td.startWave()");
  await waitFor(host, "window.td.enemies() > 0", { timeoutMs: 10000 });
  await waitFor(guest, mirrorHasEnemy, { timeoutMs: 15000 });

  // — Guest movement is executed host-authoritatively on its hero ——————————
  const before = await evalExpr(host, "window.td.heroTiles().find(h => h.i === 1)");
  assert.ok(before, "the guest's hero (index 1) exists on the host");
  let moved = false;
  for (const dir of [KEYS.ArrowLeft, KEYS.ArrowRight, KEYS.ArrowUp, KEYS.ArrowDown]) {
    await evalExpr(guest, dispatchKey("keydown", dir.key, dir.code, dir.vk));
    for (let i = 0; i < 12 && !moved; i++) {
      await sleep(120);
      const now = await evalExpr(host, "window.td.heroTiles().find(h => h.i === 1)");
      if (now && (now.x !== before.x || now.y !== before.y)) moved = true;
    }
    await evalExpr(guest, dispatchKey("keyup", dir.key, dir.code, dir.vk));
    if (moved) break;
  }
  assert.ok(moved, "the guest's input moved its hero on the host (host-authoritative)");

  assert.deepEqual(errors, [], `no uncaught page exceptions: ${errors.join("; ")}`);
});
