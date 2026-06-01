import { test } from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { readJsonBody } from "../server/httpBody.js";

// A minimal request stand-in: a Readable carrying the body bytes. readJsonBody
// only uses .on('data'|'end'|'error') and .destroy(), all of which Readable
// provides.
function fakeReq(str) {
  return Readable.from([Buffer.from(str)]);
}

test("parses a JSON body", async () => {
  const body = await readJsonBody(fakeReq(JSON.stringify({ a: 1, b: "x" })));
  assert.deepEqual(body, { a: 1, b: "x" });
});

test("an empty body resolves to {}", async () => {
  assert.deepEqual(await readJsonBody(fakeReq("")), {});
});

test("malformed JSON rejects with code BAD_JSON", async () => {
  await assert.rejects(
    () => readJsonBody(fakeReq("{not valid")),
    (err) => err.code === "BAD_JSON",
  );
});

test("an over-cap body rejects with code BODY_TOO_LARGE", async () => {
  const big = JSON.stringify({ pad: "x".repeat(2000) });
  await assert.rejects(
    () => readJsonBody(fakeReq(big), { maxBytes: 100 }),
    (err) => err.code === "BODY_TOO_LARGE",
  );
});
