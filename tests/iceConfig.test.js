// iceConfig: pulls TURN credentials from the relay's /turn-credentials
// endpoint at boot, falls back to STUN-only when the endpoint is absent.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getIceServers,
  primeIceServers,
  refreshIceServers,
  areIceServersExpired,
  _resetIceConfigForTesting,
  _getCachedExpiresAtForTesting,
} from "../js/iceConfig.js";
import { DEFAULT_STUN_SERVERS } from "../js/webrtcChannel.js";

function fakeFetch(response) {
  return async () => response;
}

test("default iceServers is the STUN-only list", () => {
  _resetIceConfigForTesting();
  assert.deepEqual(getIceServers(), DEFAULT_STUN_SERVERS);
});

test("primeIceServers merges TURN entries on top of STUN", async () => {
  _resetIceConfigForTesting();
  const body = {
    iceServers: [{ urls: "turn:turn.example.com:3478", username: "u", credential: "c" }],
    expiresAt: 9_999_999_999,
  };
  await primeIceServers("ws://localhost:8090/ws", fakeFetch({
    ok: true,
    async json() { return body; },
  }));
  const servers = getIceServers();
  assert.equal(servers.length, DEFAULT_STUN_SERVERS.length + 1);
  assert.equal(servers[servers.length - 1].urls, "turn:turn.example.com:3478");
  assert.equal(_getCachedExpiresAtForTesting(), 9_999_999_999);
});

test("primeIceServers leaves STUN intact on 503", async () => {
  _resetIceConfigForTesting();
  await primeIceServers("ws://localhost:8090/ws", fakeFetch({
    ok: false,
    async json() { return {}; },
  }));
  assert.deepEqual(getIceServers(), DEFAULT_STUN_SERVERS);
});

test("primeIceServers tolerates a thrown fetch", async () => {
  _resetIceConfigForTesting();
  await primeIceServers("ws://localhost:8090/ws", async () => { throw new Error("boom"); });
  assert.deepEqual(getIceServers(), DEFAULT_STUN_SERVERS);
});

test("primeIceServers translates wss:// → https:// for the endpoint URL", async () => {
  _resetIceConfigForTesting();
  let calledWith = null;
  await primeIceServers("wss://sneakbit.curzel.it/ws", async (url) => {
    calledWith = url;
    return { ok: false, async json() { return {}; } };
  });
  assert.equal(calledWith, "https://sneakbit.curzel.it/turn-credentials");
});

test("areIceServersExpired: false with no TURN creds, true past TTL", async () => {
  _resetIceConfigForTesting();
  // STUN-only (expiresAt 0) → never "expired", nothing to refresh.
  assert.equal(areIceServersExpired(Date.now()), false);
  await primeIceServers("ws://localhost:8090/ws", fakeFetch({
    ok: true,
    async json() { return { iceServers: [{ urls: "turn:t" }], expiresAt: 1_000_000 }; },
  }));
  assert.equal(areIceServersExpired(0), false, "well before expiry");
  assert.equal(areIceServersExpired(1_000_000), true, "at expiry");
});

test("refreshIceServers re-fetches only when past TTL (within skew)", async () => {
  _resetIceConfigForTesting();
  await primeIceServers("ws://localhost:8090/ws", fakeFetch({
    ok: true,
    async json() { return { iceServers: [{ urls: "turn:old" }], expiresAt: 100_000 }; },
  }));
  let fetches = 0;
  const newBody = fakeFetch({
    ok: true,
    async json() { fetches++; return { iceServers: [{ urls: "turn:new" }], expiresAt: 999_999 }; },
  });

  // Well before expiry → no fetch, cache unchanged.
  let servers = await refreshIceServers("ws://localhost:8090/ws", newBody, 0);
  assert.equal(fetches, 0);
  assert.equal(servers[servers.length - 1].urls, "turn:old");

  // Past expiry → re-fetch, cache replaced.
  servers = await refreshIceServers("ws://localhost:8090/ws", newBody, 100_000);
  assert.equal(fetches, 1);
  assert.equal(servers[servers.length - 1].urls, "turn:new");
});

test("primeIceServers translates ws:// → http://", async () => {
  _resetIceConfigForTesting();
  let calledWith = null;
  await primeIceServers("ws://localhost:8090/ws", async (url) => {
    calledWith = url;
    return { ok: false, async json() { return {}; } };
  });
  assert.equal(calledWith, "http://localhost:8090/turn-credentials");
});
