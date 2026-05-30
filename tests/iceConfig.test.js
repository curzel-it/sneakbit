// iceConfig: pulls TURN credentials from the relay's /turn-credentials
// endpoint at boot, falls back to STUN-only when the endpoint is absent.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getIceServers,
  primeIceServers,
  _resetIceConfigForTesting,
  _getCachedExpiresAtForTesting,
} from "../js/iceConfig.js?v=20260530a";
import { DEFAULT_STUN_SERVERS } from "../js/webrtcChannel.js?v=20260530a";

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

test("primeIceServers translates ws:// → http://", async () => {
  _resetIceConfigForTesting();
  let calledWith = null;
  await primeIceServers("ws://localhost:8090/ws", async (url) => {
    calledWith = url;
    return { ok: false, async json() { return {}; } };
  });
  assert.equal(calledWith, "http://localhost:8090/turn-credentials");
});
