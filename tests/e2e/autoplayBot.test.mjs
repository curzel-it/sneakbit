// The autoplay bot, end-to-end in a real browser. Boots the normal offline
// game with ?autoplay=1, lets the in-page bot drive the REAL engine through
// its input seams, and asserts it actually plays: the ticker comes alive,
// the hero leaves spawn, loot is collected, a dialogue is exhausted, and a
// zone transition commits — the whole M1 pipeline (nav → pickups → talks →
// travel) proven against the live module graph. Self-skips without Chrome.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  skipIfNoChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate,
} from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

const STATIC_PORT = 8018;
const RELAY_PORT = 8118;
const CHROME_PORT = 9278;

test("autoplay: the bot navigates, collects, talks, and travels", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const servers = await startServers({ staticPort: STATIC_PORT, relayPort: RELAY_PORT });
  t.after(() => servers.stop());
  const chrome = await launchChrome({ port: CHROME_PORT, dataDir: "/tmp/sb-e2e-autoplay" });
  t.after(() => chrome.kill());
  const page = (await getTargets(CHROME_PORT)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => {
    errors.push(p?.exceptionDetails?.exception?.description || p?.exceptionDetails?.text || "unknown");
  });

  await navigate(s, `${servers.appUrl}/play/?autoplay=1&zone=1001`);
  await waitFor(s, "!!document.getElementById('coin-hud')", { timeoutMs: 20000 });

  // The bot installs window.autoplay and flips `ready` once the world graph
  // is prefetched + built.
  await waitFor(s, "!!(window.autoplay && window.autoplay.ready)", { timeoutMs: 30000 });

  const spawn = await evalExpr(s, `(() => {
    const p = window.autoplay.ctx.getState().player;
    return { x: p.tileX, y: p.tileY };
  })()`);

  // Poll until every M1 proof-of-life holds (or time out): the hero moved,
  // a pickup landed, a dialogue was exhausted, and a second zone was entered.
  const metricsExpr = `(() => {
    const p = window.autoplay.ctx.getState().player;
    let collected = 0, dialogues = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.includes('item_collected.')) collected++;
      if (k.includes('dialogue.answer.')) dialogues++;
    }
    return JSON.stringify({
      moved: p.tileX !== ${spawn.x} || p.tileY !== ${spawn.y},
      collected, dialogues,
      visited: window.autoplay.visited.size,
    });
  })()`;

  // Generous budget: the starting zone is monster-dense and the bot may die
  // and respawn a few times before it threads out to a second zone (combat is
  // survival-by-avoidance — these monsters are unkillable bullet-sponges).
  await waitFor(
    s,
    `(() => { const m = JSON.parse(${metricsExpr}); return m.moved && m.collected >= 1 && m.dialogues >= 1 && m.visited >= 2; })()`,
    { timeoutMs: 150000, pollMs: 1000 },
  );

  const m = JSON.parse(await evalExpr(s, metricsExpr));
  assert.ok(m.moved, "hero left the spawn tile");
  assert.ok(m.collected >= 1, `collected ${m.collected} pickups`);
  assert.ok(m.dialogues >= 1, `exhausted ${m.dialogues} dialogues`);
  assert.ok(m.visited >= 2, `visited ${m.visited} zones (travel committed)`);
  assert.deepEqual(errors, [], `no uncaught page errors:\n${errors.join("\n")}`);
});
