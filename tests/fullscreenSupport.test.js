// Whether the menu offers a Fullscreen button at all. The rule is that a
// browser which can't actually give us the screen gets NO button, rather than
// one that does nothing every time it's pressed (menu.js hides the row on a
// false from here).
//
// The interesting case is the third one: a page in an iframe without
// allow="fullscreen" has requestFullscreen and is refused on every call, so
// the method alone was never enough to decide on.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isFullscreenSupported } from "../js/fullscreen.js";

// The module reads the bare `document` global at call time, so a stub on
// globalThis is what a browser looks like from here. Returns a restore fn.
function withDocument(doc) {
  globalThis.document = doc;
  return () => { delete globalThis.document; };
}

const desktop = () => ({
  documentElement: { requestFullscreen() {} },
  exitFullscreen() {},
  fullscreenEnabled: true,
});

test("a browser with the whole API has a screen to offer", () => {
  const restore = withDocument(desktop());
  assert.equal(isFullscreenSupported(), true);
  restore();
});

test("no document at all — Node, where every unit test runs — offers nothing", () => {
  assert.equal(isFullscreenSupported(), false);
});

test("iOS Safari, which only fullscreens <video>, offers nothing", () => {
  const restore = withDocument({ documentElement: {}, exitFullscreen() {} });
  assert.equal(isFullscreenSupported(), false);
  restore();
});

test("a screen we could take and never give back is not offered", () => {
  const doc = desktop();
  delete doc.exitFullscreen;
  const restore = withDocument(doc);
  assert.equal(isFullscreenSupported(), false, "an exit path is half the feature");
  restore();
});

test("an embedded page that will be refused every time is not offered either", () => {
  const doc = desktop();
  doc.fullscreenEnabled = false; // iframe without allow="fullscreen"
  const restore = withDocument(doc);
  assert.equal(isFullscreenSupported(), false,
    "the method is there and every call is refused — that's a dead button");
  restore();
});

test("the WebKit-prefixed pair counts, and its absent `enabled` flag means allowed", () => {
  const restore = withDocument({
    documentElement: { webkitRequestFullscreen() {} },
    webkitExitFullscreen() {},
  });
  assert.equal(isFullscreenSupported(), true);
  restore();
});

test("a prefixed engine that says no is still a no", () => {
  const restore = withDocument({
    documentElement: { webkitRequestFullscreen() {} },
    webkitExitFullscreen() {},
    webkitFullscreenEnabled: false,
  });
  assert.equal(isFullscreenSupported(), false);
  restore();
});
