// E2E: the SECOND physical controller in local co-op.
//
// Two bugs from a real couch session, both invisible to the existing local
// co-op test (which drives slots through the keyboard/injection seam):
//
//   * P2's shoot / melee buttons did nothing. The slot→hero lookup used by
//     the per-slot action seams refused slot 2 unless the avatar carried a
//     network playerId, which a local P2 never has — so the sword P2 is
//     gifted on spawn could never be swung and no kunai ever left their hand.
//   * Once ANY overlay was up (a dialogue P2 started, the multiplayer panel)
//     the loop stopped polling slots 2-4 entirely, so the pad that opened it
//     couldn't dismiss it. Only P1 could.
//
// Headless Chrome exposes no Gamepad API, so the test installs a fake
// navigator.getGamepads — everything downstream (gamepad.js edge detection,
// input.js folding, the per-slot callbacks) is the real code path.

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

// Two connected standard-mapping pads, mutable so the test can hold and
// release buttons between frames.
const INSTALL_PADS = `(() => {
  const makePad = (index) => ({
    index, id: "fake pad", connected: true, mapping: "standard",
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
  });
  window.__pads = [makePad(0), makePad(1)];
  navigator.getGamepads = () => window.__pads;
  return true;
})()`;

// Hold a button on pad 2 for long enough that the loop sees the rising edge,
// then release it (and let the release be seen too).
const tapPad2 = async (s, button) => {
  await evalExpr(s, `(() => { window.__pads[1].buttons[${button}].pressed = true; return true; })()`);
  await sleep(150);
  await evalExpr(s, `(() => { window.__pads[1].buttons[${button}].pressed = false; return true; })()`);
  await sleep(100);
};

test("a second controller fights, and can dismiss what it opened", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const { chrome, session: s } = await launchPage("/tmp/sb-e2e-coop-pad2");
  t.after(() => chrome.kill());
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

  await navigate(s, `${servers.appUrl}/`);
  await waitFor(s, "!!(window.coop && window.coop.positions().length >= 1)");

  await evalExpr(s, INSTALL_PADS);
  await evalExpr(s, "window.coop.setLocalPlayers(2)");
  assert.equal(await evalExpr(s, "window.coop.count()"), 2, "local co-op is on");

  // P2 spawns with the starter sword equipped and needs ammo to throw.
  const equipped = await evalExpr(s, `(async () => (await import('/js/equipment.js')).getEquipped('melee', 1))()`);
  assert.ok(equipped, "P2 was gifted a melee weapon on spawn");
  await evalExpr(s, `(async () => { (await import('/js/inventory.js')).addAmmo(7000, 5, 1); return true; })()`);

  // P2's own gamepad bindings decide which buttons these are.
  const buttons = await evalExpr(s, `(async () => {
    const gb = await import('/js/gamepadBindings.js');
    return { melee: gb.buttonFor('melee', 1), shoot: gb.buttonFor('shoot', 1) };
  })()`);

  // --- Melee on pad 2 -----------------------------------------------------
  await tapPad2(s, buttons.melee);
  const swings = await evalExpr(s, `(async () => {
    const m = await import('/js/melee.js');
    return { p2: m.getMeleeSwingProgress(1), p1: m.getMeleeSwingProgress(0) };
  })()`);
  assert.notEqual(swings.p2, null, "pad 2's melee button swung P2's sword");
  assert.equal(swings.p1, null, "…and left P1 alone");

  // --- Kunai on pad 2 -----------------------------------------------------
  const ammoBefore = await evalExpr(s, `(async () => (await import('/js/inventory.js')).getAmmo(7000, 1))()`);
  await tapPad2(s, buttons.shoot);
  const ammoAfter = await evalExpr(s, `(async () => (await import('/js/inventory.js')).getAmmo(7000, 1))()`);
  assert.equal(ammoAfter, ammoBefore - 1, "pad 2's shoot button threw one of P2's kunai");

  // --- Dismissing an overlay from pad 2 -----------------------------------
  // Open the pause menu (the multiplayer panel is one of its rows, and both
  // freeze the loop the same way), then press B on the SECOND pad.
  await evalExpr(s, `window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Escape' }))`);
  await sleep(100);
  const menuOpen = (expr = "") => evalExpr(s, `(() => { const m = document.getElementById('menu'); return !!m && m.style.display !== 'none'; })()${expr}`);
  assert.equal(await menuOpen(), true, "menu opened");

  await tapPad2(s, "1"); // B — the fixed "back" convention in menu mode
  assert.equal(await menuOpen(), false, "pad 2 dismissed the overlay");

  assert.deepEqual(errors, [], "page threw no exceptions");
});
