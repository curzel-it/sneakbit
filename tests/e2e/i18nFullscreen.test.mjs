// E2E: the localization wiring (English by default, Italian when selected)
// and the fullscreen menu button. Drives the live page in headless Chrome.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers({ staticPort: 8007, relayPort: 8097 });
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

test("localization loads English by default and Italian when selected; fullscreen button present", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9282, dataDir: "/tmp/sb-e2e-i18n" });
  t.after(() => chrome.kill());
  const page = (await getTargets(9282)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  // Default load: tr() resolves a known key to its English value.
  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!window.__menuNav");
  const enWeapons = await evalExpr(s, `import('./js/strings.js?v=20260531c').then(m => m.tr('weapons_selection.title'))`);
  assert.equal(enWeapons, "Weapons", "English string table is active by default");

  // The fullscreen toggle is wired into the pause menu.
  await evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true }))`);
  await sleep(50);
  const fsLabel = await evalExpr(s, `document.getElementById('menu-fullscreen')?.textContent ?? null`);
  assert.ok(fsLabel === "Fullscreen" || fsLabel === "Exit fullscreen", `fullscreen button present (got ${fsLabel})`);

  // Persist the Italian preference the way the settings panel does, reload,
  // and confirm the same key now resolves to its Italian value.
  await evalExpr(s, `(() => {
    const raw = localStorage.getItem('sneakbit.settings.v1');
    const cur = raw ? JSON.parse(raw) : {};
    cur.language = 'it';
    localStorage.setItem('sneakbit.settings.v1', JSON.stringify(cur));
  })()`);
  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!window.__menuNav");
  const itWeapons = await evalExpr(s, `import('./js/strings.js?v=20260531c').then(m => m.tr('weapons_selection.title'))`);
  assert.equal(itWeapons, "Armi", "Italian string table is active after selecting 'it'");

  // A key only present in English still falls back rather than showing raw.
  const fallback = await evalExpr(s, `import('./js/strings.js?v=20260531c').then(m => m.tr('ok'))`);
  assert.equal(fallback, "Ok", "shared key resolves under Italian too");
});
