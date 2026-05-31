// js/net.js drives a WebSocket-shaped object. The browser's WebSocket
// isn't available in node:test, so we inject a fake socket factory and
// drive its lifecycle by hand.

import { test } from "node:test";
import assert from "node:assert/strict";

const { createNet, PROTOCOL, pickServerUrl } = await import("../js/net.js");

function makeFakeSocket() {
  const sock = {
    readyState: 0,
    sent: [],
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    send(data) { sock.sent.push(JSON.parse(data)); },
    close(code = 1000, reason = "") {
      sock.readyState = 3;
      if (sock.onclose) sock.onclose({ code, reason });
    },
    _open() {
      sock.readyState = 1;
      if (sock.onopen) sock.onopen({});
    },
    _serverMsg(msg) {
      if (sock.onmessage) sock.onmessage({ data: JSON.stringify(msg) });
    },
    _serverClose(code, reason = "") {
      sock.readyState = 3;
      if (sock.onclose) sock.onclose({ code, reason });
    },
  };
  return sock;
}

function makeFactory() {
  const sockets = [];
  function factory() {
    const s = makeFakeSocket();
    sockets.push(s);
    return s;
  }
  factory.sockets = sockets;
  factory.last = () => sockets[sockets.length - 1];
  return factory;
}

test("connect() sends hello after open", () => {
  const factory = makeFactory();
  const net = createNet({
    url: "ws://test/ws",
    uuid: "11111111-2222-3333-4444-555555555555",
    wsFactory: factory,
  });
  net.connect();
  const sock = factory.last();
  sock._open();
  assert.equal(sock.sent.length, 1);
  assert.deepEqual(sock.sent[0], {
    op: "hello",
    protocol: PROTOCOL,
    uuid: "11111111-2222-3333-4444-555555555555",
    client: "sneakbit-html",
  });
  net.close();
});

test("incoming messages dispatch to registered handlers by op", () => {
  const factory = makeFactory();
  const net = createNet({
    url: "ws://test/ws",
    uuid: "u",
    wsFactory: factory,
  });
  const got = [];
  net.on("welcome", (m) => got.push(["welcome", m]));
  net.on("host.opened", (m) => got.push(["host.opened", m]));
  net.connect();
  const sock = factory.last();
  sock._open();
  sock._serverMsg({ op: "welcome", protocol: 1, playerId: "p_x", name: "Player-x" });
  sock._serverMsg({ op: "host.opened", code: "ABCDE", sessionId: "sess_1" });
  sock._serverMsg({ op: "something.unknown", foo: 1 }); // ignored — no handler

  assert.equal(got.length, 2);
  assert.equal(got[0][0], "welcome");
  assert.equal(got[0][1].playerId, "p_x");
  assert.equal(got[1][0], "host.opened");
  assert.equal(got[1][1].code, "ABCDE");
  net.close();
});

test("send() returns false when not connected", () => {
  const factory = makeFactory();
  const net = createNet({ url: "ws://test/ws", uuid: "u", wsFactory: factory });
  // not yet connected
  assert.equal(net.send({ op: "input", seq: 1 }), false);
  net.connect();
  // socket created but not yet open
  assert.equal(net.send({ op: "input", seq: 1 }), false);
  factory.last()._open();
  assert.equal(net.send({ op: "input", seq: 1 }), true);
  net.close();
});

test("close code 4003 (uuid conflict) does NOT schedule reconnect", async () => {
  const factory = makeFactory();
  const net = createNet({
    url: "ws://test/ws",
    uuid: "u",
    wsFactory: factory,
    backoffSteps: [10],
  });
  net.connect();
  factory.last()._open();
  factory.last()._serverClose(4003, "uuid conflict");
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(factory.sockets.length, 1); // no second connection attempt
  net.close();
});

test("unexpected close (1006) triggers a reconnect", async () => {
  const factory = makeFactory();
  const net = createNet({
    url: "ws://test/ws",
    uuid: "u",
    wsFactory: factory,
    backoffSteps: [5],
  });
  net.connect();
  factory.last()._open();
  factory.last()._serverClose(1006);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(factory.sockets.length, 2);
  net.close();
});

test("handshake-fail reconnects escalate backoff (no fast-loop before welcome)", async () => {
  // Each socket opens fine, then the server closes 1006 before sending
  // welcome — same shape as a bad-hello / protocol-mismatch rejection.
  // The first close should schedule at step[0], the second at step[1],
  // proving attempts isn't reset by onopen.
  const factory = makeFactory();
  const net = createNet({
    url: "ws://test/ws",
    uuid: "u",
    wsFactory: factory,
    backoffSteps: [5, 200],
  });
  net.connect();
  factory.last()._open();
  factory.last()._serverClose(1006);
  // First retry uses step[0] = 5 ms; show up within ~30 ms.
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(factory.sockets.length, 2, "first retry should have happened");
  factory.last()._open();
  factory.last()._serverClose(1006);
  // Second retry uses step[1] = 200 ms; must NOT have happened at 30 ms.
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(factory.sockets.length, 2, "second retry must wait for backoff step[1], not fast-loop at step[0]");
  await new Promise((r) => setTimeout(r, 220));
  assert.equal(factory.sockets.length, 3);
  net.close();
});

test("welcome resets backoff: a close after welcome retries at step[0] again", async () => {
  const factory = makeFactory();
  const net = createNet({
    url: "ws://test/ws",
    uuid: "u",
    wsFactory: factory,
    backoffSteps: [5, 200],
  });
  net.connect();
  // First connection: open but no welcome, server drops → attempts=1.
  factory.last()._open();
  factory.last()._serverClose(1006);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(factory.sockets.length, 2);
  // Second connection: open + welcome → attempts must reset.
  factory.last()._open();
  factory.last()._serverMsg({ op: "welcome", protocol: 1, playerId: "p", name: "P" });
  factory.last()._serverClose(1006);
  // Next retry should fire fast (step[0] = 5 ms), not slow.
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(factory.sockets.length, 3, "post-welcome close should retry at step[0]");
  net.close();
});

test("explicit close() prevents reconnect", async () => {
  const factory = makeFactory();
  const net = createNet({
    url: "ws://test/ws",
    uuid: "u",
    wsFactory: factory,
    backoffSteps: [5],
  });
  net.connect();
  factory.last()._open();
  net.close();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(factory.sockets.length, 1);
});

test("ping is sent on the configured interval", async () => {
  const factory = makeFactory();
  const net = createNet({
    url: "ws://test/ws",
    uuid: "u",
    wsFactory: factory,
    pingIntervalMs: 20,
  });
  net.connect();
  const sock = factory.last();
  sock._open();
  await new Promise((r) => setTimeout(r, 70));
  const pings = sock.sent.filter((m) => m.op === "ping").length;
  assert.ok(pings >= 2, `expected >=2 pings, got ${pings}`);
  net.close();
});

test("pickServerUrl: ?server= override honored only on localhost / 127.0.0.1", () => {
  // Local — override is honoured.
  assert.equal(
    pickServerUrl({ hostname: "localhost", search: "?server=ws://example.com/ws" }),
    "ws://example.com/ws",
  );
  assert.equal(
    pickServerUrl({ hostname: "127.0.0.1", search: "?server=wss://example.com/ws" }),
    "wss://example.com/ws",
  );
  // file:// pages (hostname is "") count as local for dev convenience.
  assert.equal(
    pickServerUrl({ hostname: "", search: "?server=ws://example.com/ws" }),
    "ws://example.com/ws",
  );
});

test("pickServerUrl: ?server= override is ignored on a deployed origin (anti-phishing)", () => {
  // Suppress the console.warn the override path emits — we only want
  // to assert the URL choice here, not pin the log line itself.
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    assert.equal(
      pickServerUrl({ hostname: "curzel.it", search: "?server=wss://attacker.example/ws" }),
      "wss://sneakbit.curzel.it/ws",
    );
    assert.equal(
      pickServerUrl({ hostname: "evil.example.com", search: "?server=wss://attacker.example/ws" }),
      "wss://sneakbit.curzel.it/ws",
    );
  } finally {
    console.warn = origWarn;
  }
});

test("pickServerUrl: default dev URL when local with no override", () => {
  assert.equal(pickServerUrl({ hostname: "localhost", search: "" }), "ws://localhost:8090/ws");
});

test("pickServerUrl: default prod URL when remote with no override", () => {
  assert.equal(pickServerUrl({ hostname: "curzel.it", search: "" }), "wss://sneakbit.curzel.it/ws");
});

test("bad JSON over the wire is silently dropped", () => {
  const factory = makeFactory();
  const net = createNet({ url: "ws://test/ws", uuid: "u", wsFactory: factory });
  let calls = 0;
  net.on("welcome", () => { calls++; });
  net.connect();
  const sock = factory.last();
  sock._open();
  // simulate raw garbage
  sock.onmessage({ data: "not json" });
  sock.onmessage({ data: '{"no_op_field":true}' });
  sock._serverMsg({ op: "welcome" });
  assert.equal(calls, 1);
  net.close();
});
