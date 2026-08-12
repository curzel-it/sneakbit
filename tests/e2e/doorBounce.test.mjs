// E2E: walking through a door/staircase with the key still held must not
// bounce you straight back.
//
// The reported bug: stand below a staircase, hold "up". You walk in, arrive
// on the next floor standing in front of the staircase back down — and the
// still-held key immediately walks you into it, forever, until you let go.
// Zone entry now arms a hold gate (transitions.movePlayerTo → player.js),
// so the held key stops at the arrival tile and a deliberate return trip
// costs one fresh press.
//
// Driven through the real input pipeline: pushInputPress leaves the
// direction HELD (unlike window.coop.tap, which releases it), which is
// exactly the state the bug needs.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, launchPage, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers();
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A mutually-bouncing door pair: 1004's door at (59, 18) leads to 1005,
// whose return door at (27, 30) drops the player on the tile *below* it —
// so walking in northbound and holding the key is exactly the reported
// staircase loop. (48 door pairs in the shipped data have this geometry.)
const ZONE = 1004;
const DOOR = { x: 59, y: 18 };
const DEST = 1005;

test("a door entered on a held key doesn't bounce the player back out", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const { chrome, session: s } = await launchPage("/tmp/sb-e2e-doorbounce");
  t.after(() => chrome.kill());
  t.after(() => s.close());

  // Spawn one tile below the door, so a single held "up" walks into it.
  await navigate(s, `${servers.appUrl}/?zone=${ZONE}&x=${DOOR.x}&y=${DOOR.y + 1}`);
  await waitFor(s, "!!(window.coop && window.coop.positions().length >= 1)");

  // The HUD is the zone read-out the game already renders.
  const currentZone = () => evalExpr(s, `(() => {
    const m = /Zone (\\d+)/.exec(document.getElementById('hud')?.textContent || '');
    return m ? Number(m[1]) : null;
  })()`);
  assert.equal(await currentZone(), ZONE, "spawned below the door");

  // Hold "up" and keep holding it — no release, no second press.
  await evalExpr(s, `(async () => { (await import('/js/input.js')).pushInputPress(1, 'up'); return true; })()`);
  await waitFor(s, `(() => {
    const m = /Zone (\\d+)/.exec(document.getElementById('hud')?.textContent || '');
    return m && Number(m[1]) !== ${ZONE};
  })()`);
  const inside = await currentZone();
  assert.equal(inside, DEST, "the held key carried the player through the door");

  // Still holding. Without the gate the return door under the player's feet
  // fires again within a frame or two and we'd be back where we started —
  // then in again, then out, for as long as the key is down.
  await sleep(1500);
  assert.equal(await currentZone(), DEST, "held input must not walk back out");

  // A fresh press is all it takes to go back — the door still works.
  await evalExpr(s, `(async () => {
    const input = await import('/js/input.js');
    input.releaseInputHeld(1, 'up');
    input.pushInputPress(1, 'up');
    return true;
  })()`);
  await waitFor(s, `(() => {
    const m = /Zone (\\d+)/.exec(document.getElementById('hud')?.textContent || '');
    return m && Number(m[1]) === ${ZONE};
  })()`);
  assert.equal(await currentZone(), ZONE, "one deliberate press goes back through");
});
