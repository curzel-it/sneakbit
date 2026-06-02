// Pure-node coverage for the framework-free clipboard helpers. The DOM
// path (promptCopy) is exercised by the e2e suite; here we pin the two
// pure predicates by stubbing navigator / location.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

const { canNativeShare, buildShareUrl } = await import("../js/clipboard.js");

const origNavigator = globalThis.navigator;
const origLocation = globalThis.location;

afterEach(() => {
  // node exposes a read-only `navigator`; restore via defineProperty so we
  // don't leak a stub into other suites.
  Object.defineProperty(globalThis, "navigator", { value: origNavigator, configurable: true, writable: true });
  Object.defineProperty(globalThis, "location", { value: origLocation, configurable: true, writable: true });
});

function stubNavigator(nav) {
  Object.defineProperty(globalThis, "navigator", { value: nav, configurable: true, writable: true });
}
function stubLocation(href) {
  Object.defineProperty(globalThis, "location", { value: { href }, configurable: true, writable: true });
}

test("canNativeShare: false when navigator.share is absent", () => {
  stubNavigator({});
  assert.equal(canNativeShare(), false);
});

test("canNativeShare: honors userAgentData.mobile when present", () => {
  stubNavigator({ share: () => {}, userAgentData: { mobile: true } });
  assert.equal(canNativeShare(), true);
  stubNavigator({ share: () => {}, userAgentData: { mobile: false } });
  assert.equal(canNativeShare(), false);
});

test("canNativeShare: falls back to UA sniff for mobile vs desktop", () => {
  stubNavigator({ share: () => {}, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)" });
  assert.equal(canNativeShare(), true);
  stubNavigator({ share: () => {}, userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X)" });
  assert.equal(canNativeShare(), false);
});

test("buildShareUrl: strips ?host and sets ?join=<code>", () => {
  stubLocation("https://sneakbit.curzel.it/?host=1");
  const url = new URL(buildShareUrl("ABC12"));
  assert.equal(url.searchParams.get("host"), null);
  assert.equal(url.searchParams.get("join"), "ABC12");
});

test("buildShareUrl: returns the bare code with no location", () => {
  Object.defineProperty(globalThis, "location", { value: undefined, configurable: true, writable: true });
  assert.equal(buildShareUrl("XYZ99"), "XYZ99");
});
