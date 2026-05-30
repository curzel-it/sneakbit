// E2E: a guest's mirrored world must contain exactly the entities the
// HOST can see — never an object the host has already collected or
// otherwise hidden. Regression for the cross-client divergence where
// "collected/hidden" state lives in per-client localStorage
// (item_collected.<id> / display_conditions, applied by shouldBeVisible)
// while the host's snapshot broadcaster shipped the raw zone.entities. A
// host that picked up a kunai in an earlier single-player session then
// started hosting would broadcast that kunai; the guest, lacking the
// host's item_collected flag, rendered it (and could "pick up" a ghost).
//
// Zone 1001 is ideal: near spawn (68,23) it has a kunai bundle
// (id 11169819 @ 69,28) and a plain kunai (id 10754446 @ 73,31). We seed
// the host's storage so it considers the bundle collected, leave the
// kunai untouched as a positive control, and assert the guest mirror has
// the kunai but NOT the bundle.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, evalExpr, waitFor } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";
import { startCoopSession } from "./fixtures/coopSession.mjs";

// Pulled from data/1001.json. Both sit within a tile or two of the
// starting spawn so they're squarely inside the host's broadcast set.
const COLLECTED_BUNDLE_ID = 11169819; // kunai.x10 @ (69,28) — seeded as collected
const CONTROL_KUNAI_ID = 10754446;    // kunai     @ (73,31) — left visible

let servers;
before(async () => {
  if (!findChrome()) return; // tests below self-skip
  servers = await startServers({ staticPort: 8002, relayPort: 8092 });
});
after(() => { if (servers) servers.stop(); });

// Read shouldBeVisible for a bare {id} on the given side. The renderer,
// pickup, and collision paths all gate on this, so it's the single
// source of truth for "does this client see entity N".
function sees(target, id) {
  return evalExpr(target, `
    (async () => {
      const ev = await import('./js/entityVisibility.js?v=20260530c');
      return ev.shouldBeVisible({ id: ${id} });
    })()
  `);
}

// Does the guest's mirrored zone currently hold an entity with this id?
function mirrorHasEntity(guest, id) {
  return evalExpr(guest, `
    (async () => {
      const m = await import('./js/mirrorWorld.js?v=20260530c');
      const z = m.getMirrorZone();
      if (!z || !z.entities) return null;
      return z.entities.some((e) => e.id === ${id});
    })()
  `);
}

test("guest never mirrors an object the host has already collected", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const session = await startCoopSession({
    appUrl: servers.appUrl,
    relayWs: servers.relayWs,
    zone: 1001,
    entry: "deeplink",
    hostSeedKv: { [`item_collected.${COLLECTED_BUNDLE_ID}`]: 1 },
    hostPort: 9229, guestPort: 9230,
    hostDir: "/tmp/sb-e2e-vis-host",
    guestDir: "/tmp/sb-e2e-vis-guest",
  });
  t.after(() => session.stop());

  // Premise: the two clients disagree on visibility because the flag is
  // per-client. The host hides the bundle (we seeded item_collected);
  // the guest, with no such flag, would happily show it if it received
  // it. This is exactly the divergence the broadcaster must absorb.
  assert.equal(await sees(session.host, COLLECTED_BUNDLE_ID), false,
    "host should treat the seeded bundle as collected (hidden)");
  assert.equal(await sees(session.guest, COLLECTED_BUNDLE_ID), true,
    "guest has no collected flag, so its own gate would render the bundle");

  // Wait until the mirror has actually ingested the host's entities,
  // using the un-collected control kunai as the readiness signal. This
  // both proves the mirror is populated (guarding against a false-pass
  // on an empty zone) and that the host does broadcast visible pickups.
  await waitFor(session.guest, `
    (async () => {
      const m = await import('./js/mirrorWorld.js?v=20260530c');
      const z = m.getMirrorZone();
      return (z && z.entities && z.entities.some((e) => e.id === ${CONTROL_KUNAI_ID})) || null;
    })()
  `, { timeoutMs: 15000 });

  assert.equal(await mirrorHasEntity(session.guest, CONTROL_KUNAI_ID), true,
    "control: an un-collected pickup must reach the guest's mirror");
  assert.equal(await mirrorHasEntity(session.guest, COLLECTED_BUNDLE_ID), false,
    "the host-collected bundle must NOT be in the guest's mirror");
});
