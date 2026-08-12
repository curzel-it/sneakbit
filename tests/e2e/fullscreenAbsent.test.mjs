// E2E: a browser that will refuse the screen gets NO Fullscreen button.
//
// The companion to i18nFullscreen, which pins the button being *there* on a
// browser that can give us one. The case here is the embedded page — an iframe
// without allow="fullscreen" has requestFullscreen and is refused on every
// single call — which used to reach the menu as a button that quietly did
// nothing, because the check was for the method alone.
//
// document.fullscreenEnabled is stubbed rather than staged in a real iframe:
// it is exactly how the browser reports that condition, and the alternative is
// a second page in the repo whose only job is to hold an iframe.

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

// What an embedded page looks like from the inside. Installed for every
// document in the tab so it is in place before the menu is built.
const REFUSE_FULLSCREEN = `
  Object.defineProperty(document, 'fullscreenEnabled', { value: false, configurable: true });
`;

test("a page the browser will refuse is offered no fullscreen button", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const { chrome, session: s } = await launchPage("/tmp/sb-e2e-fullscreen-absent");
  t.after(() => chrome.kill());
  t.after(() => s.close());
  await s.send("Page.addScriptToEvaluateOnNewDocument", { source: REFUSE_FULLSCREEN });

  await navigate(s, `${servers.appUrl}/`);
  await waitFor(s, "!!window.__menuNav");
  assert.equal(await evalExpr(s, "document.fullscreenEnabled"), false, "premise: the browser says no");

  await evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape', bubbles: true })) || true`);
  await sleep(50);

  // The element stays in the markup — menu.js owns one static page and hides
  // what doesn't apply — so "no button" is a button nobody can see or reach.
  const shown = await evalExpr(s, `
    (() => {
      const btn = document.getElementById('menu-fullscreen');
      if (!btn) return null;
      return getComputedStyle(btn).display !== 'none';
    })()
  `);
  assert.equal(shown, false, "a refused browser gets no button rather than a dead one");

  // And the rest of the menu is still there — this hides one row, not the page.
  assert.equal(await evalExpr(s, `!!document.getElementById('menu-open-settings')`), true);
});
