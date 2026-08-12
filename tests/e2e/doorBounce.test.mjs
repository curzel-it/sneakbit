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

  // Hold "up" and keep holding it — no release. The press is repeated only
  // until the hero actually turns: on a loaded machine the first one can be
  // drained during the boot frame, and a press that never registered would
  // look like the fix working. Once it has taken, the key just stays down,
  // which is the state the bug needs.
  const holdUp = `(async () => { (await import('/js/input.js')).pushInputPress(1, 'up'); return true; })()`;
  await evalExpr(s, holdUp);
  await waitFor(s, `(() => {
    const p = window.coop.positions()[0];
    return p && (p.direction === 'up' || p.tileY < ${DOOR.y + 1});
  })()`, { timeoutMs: 5000 }).catch(async () => { await evalExpr(s, holdUp); });
  await waitFor(s, `(() => {
    const m = /Zone (\\d+)/.exec(document.getElementById('hud')?.textContent || '');
    return m && Number(m[1]) !== ${ZONE};
  })()`);
  const inside = await currentZone();
  assert.equal(inside, DEST, "the held key carried the player through the door");

  // Still holding. Without the gate the return door under the player's feet
  // fires again within a frame or two and we'd be back where we started —
  // then in again, then out, for as long as the key is down. Sampled across
  // the window rather than checked at the end: the bounce oscillates, so a
  // single late look can catch it on either side.
  const samples = [];
  for (let i = 0; i < 15; i++) {
    samples.push(await currentZone());
    await sleep(100);
  }
  assert.deepEqual(
    [...new Set(samples)], [DEST],
    `held input must not walk back out (saw ${[...new Set(samples)].join(", ")})`,
  );

  // A deliberate press still goes back through — the gate stops the bounce,
  // it doesn't shut the door. Re-pressed while waiting because a press that
  // lands during the fade has nothing to act on yet.
  const pressUp = `(async () => {
    const input = await import('/js/input.js');
    input.releaseInputHeld(1, 'up');
    input.pushInputPress(1, 'up');
    return true;
  })()`;
  for (let i = 0; i < 10 && (await currentZone()) !== ZONE; i++) {
    await evalExpr(s, pressUp);
    await sleep(400);
  }
  assert.equal(await currentZone(), ZONE, "a deliberate press goes back through");
});
