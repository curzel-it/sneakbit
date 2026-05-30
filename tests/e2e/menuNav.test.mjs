// E2E: keyboard + controller menu navigation. Arrow keys (real synthetic
// keydowns — menuNav's listener handles them) move a single .nav-focused
// highlight; the gamepad code path is exercised via window.__menuNav
// (move/confirm/back) since headless Chrome has no virtual pad. Both paths
// share the same nav core.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers({ staticPort: 8006, relayPort: 8096 });
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const key = (s, code) => evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown', { code: ${JSON.stringify(code)}, bubbles: true }))`);
const focusedId = (s) => evalExpr(s, `document.querySelector('.nav-focused')?.id || null`);
const focusedCount = (s) => evalExpr(s, `document.querySelectorAll('.nav-focused').length`);
const screenVisible = (s, screen) => evalExpr(s, `(() => { const c = document.querySelector('.menu-card[data-screen="${screen}"]'); return !!c && c.style.display !== 'none'; })()`);
const menuOpen = (s) => evalExpr(s, `(() => { const m = document.getElementById('menu'); return !!m && m.style.display !== 'none'; })()`);

test("keyboard + controller navigate the pause menu", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9281, dataDir: "/tmp/sb-e2e-menunav" });
  t.after(() => chrome.kill());
  const page = (await getTargets(9281)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!window.__menuNav");

  // Open the pause menu; the first item should be highlighted.
  await key(s, "Escape");
  await sleep(50);
  assert.equal(await menuOpen(s), true, "menu should open");
  assert.equal(await focusedCount(s), 1, "exactly one item highlighted");
  const first = await focusedId(s);

  // ArrowDown moves the highlight; ArrowUp returns it.
  await key(s, "ArrowDown");
  const second = await focusedId(s);
  assert.notEqual(second, first, "ArrowDown moves the highlight");
  await key(s, "ArrowUp");
  assert.equal(await focusedId(s), first, "ArrowUp returns the highlight");

  // Navigate to Settings and activate it via the controller path (confirm).
  let guard = 0;
  while ((await focusedId(s)) !== "menu-open-settings" && guard++ < 15) await key(s, "ArrowDown");
  assert.equal(await focusedId(s), "menu-open-settings", "reached Settings");
  await evalExpr(s, "window.__menuNav.confirm()");
  await sleep(50);
  assert.equal(await screenVisible(s, "settings"), true, "confirm opened Settings");
  assert.equal(await focusedCount(s), 1, "settings screen has a highlight");

  // Back (controller B) returns to the pause screen; again closes the menu.
  await evalExpr(s, "window.__menuNav.back()");
  await sleep(50);
  assert.equal(await screenVisible(s, "pause"), true, "back returned to pause");
  await evalExpr(s, "window.__menuNav.back()");
  await sleep(50);
  assert.equal(await menuOpen(s), false, "back again closed the menu");
});

test("navigation carries into a second surface (party panel)", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9282, dataDir: "/tmp/sb-e2e-menunav2" });
  t.after(() => chrome.kill());
  const page = (await getTargets(9282)).find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!window.__menuNav");

  // Open the pause menu, navigate to "Multiplayer", activate it.
  await key(s, "Escape");
  await sleep(50);
  let guard = 0;
  while ((await focusedId(s)) !== "menu-open-multiplayer" && guard++ < 15) await key(s, "ArrowDown");
  assert.equal(await focusedId(s), "menu-open-multiplayer", "reached Multiplayer");
  await evalExpr(s, "window.__menuNav.confirm()");
  await sleep(50);

  // The party panel is now the active surface with its own highlight, and
  // arrows move within it.
  const partyOpen = await evalExpr(s, `(() => { const v = document.querySelector('.party-view'); return !!v && v.offsetParent !== null; })()`);
  assert.equal(partyOpen, true, "party panel opened");
  assert.equal(await focusedCount(s), 1, "party panel has a single highlight");
  const before = await focusedId(s);
  await key(s, "ArrowDown");
  // Focus stays within the party panel (highlight is on a party element).
  const within = await evalExpr(s, `!!document.querySelector('.party-view .nav-focused')`);
  assert.equal(within, true, "ArrowDown keeps focus inside the party panel");
});
