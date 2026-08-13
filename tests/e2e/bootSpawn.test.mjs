// E2E: booting into a zone must never leave the player standing on a door.
//
// Two ways in, both reported from real play in 1002 (whose first teleporter is
// the road back to 1001, at 82,45):
//
//   1. A save that names a zone but no tile — every save migrated from the
//      Rust builds, which only ever stored `latest_world`.
//   2. A death in a zone that was loaded at boot. zone.spawnPoint is seeded
//      from the same entry-tile rule, so Continue used to drop the player onto
//      the door — and that respawn tile is then persisted, so every later boot
//      started there too. That's what made it stick on saves that never saw a
//      migration.
//
// Standing on the exit isn't fatal by itself (a transition needs a step *onto*
// the tile), but it means the first step in the wrong direction warps the
// player out of the zone they just loaded into.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findChrome, skipIfNoChrome, launchPage, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers();
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ZONE = 1002;
// The zone's first teleporter — the one the entry-tile rule keys off.
const DOOR = (() => {
  const raw = JSON.parse(readFileSync(new URL(`../../data/${ZONE}.json`, import.meta.url), "utf8"));
  const t = raw.entities.find((e) => e.species_id === 1019 && e.frame);
  return { x: t.frame.x, y: t.frame.y, dest: t.destination.world ?? t.destination.zone };
})();

const position = (s) => evalExpr(s, `(() => {
  const p = window.coop.positions()[0];
  return JSON.stringify({ x: p.tileX, y: p.tileY });
})()`).then(JSON.parse);

async function boot(s, url) {
  await navigate(s, url);
  await waitFor(s, "!!(window.coop && window.coop.positions().length >= 1)");
  await sleep(400);
}

test("a boot into a zone stands the player beside the door, not on it", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const { chrome, session: s } = await launchPage("/tmp/sb-e2e-bootspawn");
  t.after(() => chrome.kill());
  t.after(() => s.close());

  // ?zone= takes the same path a save with no spawn tile does.
  await boot(s, `${servers.appUrl}/?zone=${ZONE}`);
  const spawn = await position(s);
  assert.notDeepEqual(spawn, { x: DOOR.x, y: DOOR.y },
    `booted standing on the door back to ${DOOR.dest}`);
  assert.ok(Math.abs(spawn.x - DOOR.x) + Math.abs(spawn.y - DOOR.y) === 1,
    `expected a tile adjacent to the door, got ${JSON.stringify(spawn)}`);

  // Dying re-enters through zone.spawnPoint, seeded by the same rule.
  await evalExpr(s, `(async () => {
    (await import('/js/playerHealth.js')).applyPlayerDamage(9999, 0);
    return true;
  })()`);
  // The overlay disables Continue for 350ms so a stale in-game Enter can't
  // skip it — clicking before that does nothing at all.
  await waitFor(s, `(() => {
    const b = document.querySelector('#go-continue');
    return !!b && b.offsetParent !== null && !b.disabled;
  })()`, { timeoutMs: 8000 });
  await evalExpr(s, `document.querySelector('#go-continue').click()`);
  // Continue runs a full travelTo (fade out, zone reload, fade in), so wait
  // for the overlay to go away rather than for a single frame.
  await waitFor(s, `!document.querySelector('#go-continue')?.offsetParent`);
  await sleep(1000);

  const revived = await position(s);
  assert.notDeepEqual(revived, { x: DOOR.x, y: DOOR.y },
    "revived standing on the door — and that tile gets persisted");

  // The persisted tile is what the next boot restores, so it must be off the
  // door too: this is the step that made the bug survive restarts.
  const saved = await evalExpr(s, `JSON.stringify({
    x: Number(localStorage.getItem("sneakbit.kv.v1.player.0.spawn.tileX")),
    y: Number(localStorage.getItem("sneakbit.kv.v1.player.0.spawn.tileY")),
  })`).then(JSON.parse);
  assert.notDeepEqual(saved, { x: DOOR.x, y: DOOR.y }, "the door tile was persisted as the spawn");
});
