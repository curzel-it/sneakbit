import { test } from "node:test";
import assert from "node:assert/strict";

const { parseAllowedHosts, isOriginAllowed } =
  await import("../server/originAllowlist.js");

test("default allowlist covers prod and local dev hosts", () => {
  const hosts = parseAllowedHosts(undefined);
  assert.ok(hosts.includes("curzel.it"));
  assert.ok(hosts.includes("sneakbit.curzel.it"));
  assert.ok(hosts.includes("localhost"));
  assert.ok(hosts.includes("127.0.0.1"));
});

test("ALLOWED_ORIGINS env value overrides defaults", () => {
  const hosts = parseAllowedHosts(" example.com , staging.example.com ");
  assert.deepEqual(hosts, ["example.com", "staging.example.com"]);
});

test("empty env value falls back to defaults", () => {
  // We want the default rather than an empty allowlist — a misconfigured
  // env var should not silently lock everyone out in prod.
  const hosts = parseAllowedHosts("");
  assert.ok(hosts.length > 0);
});

test("absent Origin header is allowed (non-browser tooling)", () => {
  const hosts = parseAllowedHosts(undefined);
  assert.equal(isOriginAllowed(undefined, hosts), true);
  assert.equal(isOriginAllowed("", hosts), true);
});

test("a known origin is allowed regardless of scheme or port", () => {
  const hosts = parseAllowedHosts(undefined);
  assert.equal(isOriginAllowed("https://curzel.it", hosts), true);
  assert.equal(isOriginAllowed("http://localhost:5500", hosts), true);
  assert.equal(isOriginAllowed("https://sneakbit.curzel.it/", hosts), true);
});

test("an unknown origin is rejected", () => {
  const hosts = parseAllowedHosts(undefined);
  assert.equal(isOriginAllowed("https://evil.example.com", hosts), false);
  // Subdomain mismatch — exact-host match only, no wildcards.
  assert.equal(isOriginAllowed("https://api.curzel.it", hosts), false);
});

test("malformed Origin headers are rejected, not allowed", () => {
  const hosts = parseAllowedHosts(undefined);
  assert.equal(isOriginAllowed("not a url", hosts), false);
  assert.equal(isOriginAllowed("javascript:alert(1)", hosts), false);
});
