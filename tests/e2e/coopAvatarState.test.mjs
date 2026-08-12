// E2E: what a guest sees of the *host's* avatar.
//
// The guest's local sim never runs anyone else's actions, so anything the
// host's body does has to arrive over the wire and be replayed on the
// mirror. Two things went missing on that trip:
//
//   * a swing — the host ships `sw`/`swd` in every snapshot/delta, but the
//     mirror dropped them on the floor, so the host's sword never left its
//     idle row on the guest's screen and an attack looked like nothing;
//   * a death — hp reached the guest fine, but the guest rendered every
//     mirrored player regardless, so a downed host stood around as a
//     live-looking body for the rest of the zone.
//
// Both are asserted through the live modules on the guest, at the seam the
// renderer reads (melee's per-player swing progress, isMirrorPlayerDead).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, evalExpr, waitFor } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession } from "./fixtures/coopSession.mjs";

const SWORD_SPECIES_ID = 1159;   // objects.name.sword.weapon
const HOST_PLAYER_INDEX = 0;     // slot 1 → index 0, on both clients

let servers;
before(async () => {
  if (!findChrome()) return; // tests below self-skip
  servers = await startServers();
});
after(() => { if (servers) servers.stop(); });

test("the host's sword swing and death both reach the guest", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    entry: "deeplink",
    hostDir: "/tmp/sb-e2e-avatar-host",
    guestDir: "/tmp/sb-e2e-avatar-guest",
  });
  t.after(() => session.stop());

  // Premise: nothing is swinging on the guest yet.
  const swingOnGuest = `
    (async () => {
      const m = await import('./js/melee.js');
      return m.getMeleeSwingProgress(${HOST_PLAYER_INDEX});
    })()
  `;
  assert.equal(await evalExpr(session.guest, swingOnGuest), null);

  // The host swings on a loop: one swing is 0.35 s and the guest polls, so
  // a single attack could slip between samples. The loop just keeps the
  // animation alive long enough to observe.
  await evalExpr(session.host, `
    (async () => {
      const eq = await import('./js/equipment.js');
      const m = await import('./js/melee.js');
      eq.setEquipped(eq.SLOT_MELEE, ${SWORD_SPECIES_ID}, ${HOST_PLAYER_INDEX});
      window.__swingLoop = setInterval(() => { try { m.tryMelee(); } catch {} }, 120);
      return true;
    })()
  `);

  const seen = await waitFor(session.guest, swingOnGuest, { timeoutMs: 15000 });
  assert.ok(seen > 0 && seen <= 1, `guest should see the host mid-swing, got ${seen}`);

  await evalExpr(session.host, `clearInterval(window.__swingLoop) || true`);
  // …and it has to END on the guest too (the host stops shipping sw/swd, the
  // guest's own tickMelee drains the rest). A swing frozen at frame 1 forever
  // would be its own bug.
  await waitFor(session.guest, `
    (async () => {
      const m = await import('./js/melee.js');
      return m.getMeleeSwingProgress(${HOST_PLAYER_INDEX}) === null ? true : null;
    })()
  `, { timeoutMs: 15000 });

  // Now kill the host and watch the guest's view of that avatar.
  const hostDeadOnGuest = `
    (async () => {
      const m = await import('./js/mirrorWorld.js');
      const o = await import('./js/onlineBootstrap.js');
      return m.isMirrorPlayerDead(o.getHostPlayerId());
    })()
  `;
  assert.equal(await evalExpr(session.guest, hostDeadOnGuest), false);

  await evalExpr(session.host, `
    (async () => {
      const h = await import('./js/playerHealth.js');
      h.setPlayerHp(0, ${HOST_PLAYER_INDEX});
      return h.isPlayerDead(${HOST_PLAYER_INDEX});
    })()
  `);

  await waitFor(session.guest, `${hostDeadOnGuest}.then(v => v || null)`, { timeoutMs: 15000 });
  assert.equal(await evalExpr(session.guest, hostDeadOnGuest), true,
    "the guest must know the host is down, so it stops drawing the body");
});
