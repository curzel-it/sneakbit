// The desktop shutdown behind the pause menu's "Exit game". The one thing that
// has to hold: the quit happens on a later turn of the loop, not inline —
// app.quit() destroys the window, and the 204 the renderer is awaiting is
// dropped with it.

import { test } from "node:test";
import assert from "node:assert/strict";

import { scheduleQuit, QUIT_DELAY_MS } from "../electron/quitApp.js";

test("the quit is deferred, never inline", () => {
  let quits = 0;
  let scheduled = null;
  scheduleQuit({ quit: () => { quits++; } }, (fn, ms) => { scheduled = { fn, ms }; });

  assert.equal(quits, 0, "the response has to go out first");
  assert.equal(scheduled.ms, QUIT_DELAY_MS);
  scheduled.fn();
  assert.equal(quits, 1);
});

test("a quit that throws doesn't escape into the protocol handler", () => {
  const run = (fn) => fn();
  assert.doesNotThrow(() => scheduleQuit({ quit: () => { throw new Error("nope"); } }, run));
});
