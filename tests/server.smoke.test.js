// Production smoke test. SKIPPED when SMOKE_URL is unset so a normal
// `node --test tests/` sweep doesn't reach out to the network; the
// deploy script sets SMOKE_URL=wss://sneakbit.curzel.it/ws as its
// final post-health-check step.
//
// These are deliberately the lightest checks that exercise the real
// nginx → relay → response round-trip:
//   - hello/welcome (TLS upgrade through nginx, protocol intact)
//   - host.open returns a 5-char code (host flow + lobby store)
//   - guest.join with a bogus code → guest.joinFailed
//     (a real session would litter prod with empty rooms; failing
//     fast on a known-bogus code proves routing without side
//     effects)
//   - host close after the smoke — leaves prod clean.
//
// Don't add tests here that produce sessions you can't tear down.

import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { openWsClient } from "./helpers/wsTestClient.js";

const SMOKE_URL = process.env.SMOKE_URL;
const SHOULD_RUN = !!SMOKE_URL;

function parseSmokeUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== "wss:" && u.protocol !== "ws:") {
    throw new Error(`SMOKE_URL must be wss:// or ws://, got ${u.protocol}`);
  }
  return {
    tls: u.protocol === "wss:",
    host: u.hostname,
    port: u.port ? Number(u.port) : (u.protocol === "wss:" ? 443 : 80),
    path: u.pathname || "/ws",
  };
}

async function openSmoke() {
  const { tls, host, port, path } = parseSmokeUrl(SMOKE_URL);
  return openWsClient(host, port, path, { tls, origin: "https://curzel.it" });
}

async function hello(c, uuid) {
  c.send({ op: "hello", protocol: 1, uuid, client: "smoke" });
  const w = await c.recv();
  assert.equal(w.op, "welcome");
  return w;
}

// Stable, non-conflicting UUIDv4 per smoke run. The relay strict-validates
// UUIDv4 shape now, so we can't smuggle a "smoke" prefix into the first
// group — encode the tag into the timestamp segment instead so a
// misbehaving relay log still makes it easy to see "this came from a
// smoke test".
function smokeUuid(tag) {
  const r = (n) => Math.floor(Math.random() * 16).toString(16).padStart(n, "0");
  const tagHex = Buffer.from(String(tag)).toString("hex").padEnd(8, "0").slice(0, 8);
  return `${tagHex}-${r(4)}-4${r(3)}-8${r(3)}-${r(12)}`;
}

test("[smoke] hello -> welcome over TLS", { skip: !SHOULD_RUN }, async () => {
  const c = await openSmoke();
  try {
    const w = await hello(c, smokeUuid("hi"));
    assert.equal(w.protocol, 1);
    assert.match(w.playerId, /^p_/);
  } finally { c.close(); }
});

test("[smoke] host.open returns a 5-char invite code, then host.close tears down", { skip: !SHOULD_RUN }, async () => {
  const c = await openSmoke();
  try {
    await hello(c, smokeUuid("ho"));
    c.send({ op: "host.open" });
    const opened = await c.recv();
    assert.equal(opened.op, "host.opened");
    assert.match(opened.code, /^[A-Z0-9]{5}$/);
    assert.equal(opened.maxGuests, 3);
    c.send({ op: "host.close" });
  } finally { c.close(); }
});

test("[smoke] guest.join with a bogus code -> guest.joinFailed not_found", { skip: !SHOULD_RUN }, async () => {
  const c = await openSmoke();
  try {
    await hello(c, smokeUuid("gj"));
    c.send({ op: "guest.join", code: "ZZZZZ" });
    const m = await c.recv();
    assert.equal(m.op, "guest.joinFailed");
    assert.equal(m.reason, "not_found");
  } finally { c.close(); }
});

test("[smoke] ping -> pong", { skip: !SHOULD_RUN }, async () => {
  const c = await openSmoke();
  try {
    await hello(c, smokeUuid("pg"));
    c.send({ op: "ping" });
    const m = await c.recv();
    assert.equal(m.op, "pong");
  } finally { c.close(); }
});
