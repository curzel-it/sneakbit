import { test } from "node:test";
import assert from "node:assert/strict";

const { createLogger } = await import("../server/logger.js");

function makeCapture() {
  const out = [];
  const err = [];
  return {
    stream: (line, isErr) => (isErr ? err : out).push(line),
    out,
    err,
  };
}

test("default level is info: debug is dropped, info+ flow", () => {
  const cap = makeCapture();
  const log = createLogger({ stream: cap.stream });
  log.debug("x");
  log.info("y");
  assert.equal(cap.out.length, 1);
  assert.match(cap.out[0], / INFO y$/);
});

test("LOG_LEVEL=debug enables debug records", () => {
  const cap = makeCapture();
  const log = createLogger({ level: "debug", stream: cap.stream });
  log.debug("seen");
  assert.equal(cap.out.length, 1);
  assert.match(cap.out[0], / DEBUG seen$/);
});

test("LOG_LEVEL=error drops info/warn", () => {
  const cap = makeCapture();
  const log = createLogger({ level: "error", stream: cap.stream });
  log.info("nope");
  log.warn("nope");
  log.error("boom");
  assert.equal(cap.out.length, 0);
  assert.equal(cap.err.length, 1);
  assert.match(cap.err[0], / ERROR boom$/);
});

test("warn/error route to stderr; info/debug route to stdout", () => {
  const cap = makeCapture();
  const log = createLogger({ level: "debug", stream: cap.stream });
  log.debug("a");
  log.info("b");
  log.warn("c");
  log.error("d");
  assert.equal(cap.out.length, 2);
  assert.equal(cap.err.length, 2);
});

test("fields render as key=value, with quoting for whitespace/equals/quotes", () => {
  const cap = makeCapture();
  const log = createLogger({ stream: cap.stream });
  log.info("session.open", { id: "sess_1", code: "K7MJ2", hostUuid: "111-222", peers: 0 });
  assert.match(cap.out[0], /session\.open id=sess_1 code=K7MJ2 hostUuid=111-222 peers=0$/);
  log.info("oddities", { weird: "a b c", eq: "x=y", quote: 'has "q"' });
  // Whitespace + `=` + quote characters all get JSON-quoted.
  assert.ok(cap.out[1].endsWith(' weird="a b c" eq="x=y" quote="has \\"q\\""'));
});

test("null fields print as `null`; undefined fields are omitted", () => {
  const cap = makeCapture();
  const log = createLogger({ stream: cap.stream });
  log.info("e", { a: null, b: undefined, c: 1 });
  assert.match(cap.out[0], / e a=null c=1$/);
});

test("invalid LOG_LEVEL falls back to info", () => {
  const cap = makeCapture();
  const log = createLogger({ level: "bogus", stream: cap.stream });
  log.debug("hidden");
  log.info("visible");
  assert.equal(cap.out.length, 1);
});

test("records carry an ISO timestamp prefix", () => {
  const cap = makeCapture();
  const log = createLogger({ stream: cap.stream });
  log.info("e");
  assert.match(cap.out[0], /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z INFO e$/);
});
