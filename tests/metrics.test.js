import { test } from "node:test";
import assert from "node:assert/strict";

const { createMetrics } = await import("../server/metrics.js");

test("snapshot starts at zeroes", () => {
  const m = createMetrics({ now: () => 0 });
  const s = m.snapshot();
  assert.equal(s.connections.current, 0);
  assert.equal(s.sessions.totalOpened, 0);
  assert.equal(s.bytesRelayed, 0);
  assert.match(s.startedAt, /^1970-/);
});

test("connection counters bump and decay", () => {
  const m = createMetrics();
  m.connOpened();
  m.connOpened();
  m.connClosed();
  const s = m.snapshot();
  assert.equal(s.connections.current, 1);
  assert.equal(s.connections.total, 2);
});

test("connClosed never goes negative", () => {
  const m = createMetrics();
  m.connClosed();
  m.connClosed();
  assert.equal(m.snapshot().connections.current, 0);
});

test("sessionClosed records reason and decrements current", () => {
  const m = createMetrics();
  m.sessionOpened();
  m.sessionOpened();
  m.sessionClosed("host_quit");
  m.sessionClosed("host_timeout");
  m.sessionClosed("not_a_real_reason"); // ignored
  const s = m.snapshot();
  assert.equal(s.sessions.current, 0);
  assert.equal(s.sessions.totalOpened, 2);
  assert.equal(s.sessions.closed.host_quit, 1);
  assert.equal(s.sessions.closed.host_timeout, 1);
});

test("peerLeft groups by reason", () => {
  const m = createMetrics();
  m.peerJoined();
  m.peerJoined();
  m.peerLeft("leave");
  m.peerLeft("kicked");
  m.peerLeft("bogus");
  const s = m.snapshot();
  assert.equal(s.peers.joined, 2);
  assert.equal(s.peers.left.leave, 1);
  assert.equal(s.peers.left.kicked, 1);
});

test("frameRelayed counts ops and accumulates bytes; webrtc.signal -> webrtcSignal", () => {
  const m = createMetrics();
  m.frameRelayed("input", 30);
  m.frameRelayed("snapshot", 1200);
  m.frameRelayed("webrtc.signal", 200);
  m.frameRelayed("unknown.op", 9999); // ignored count, bytes still tracked
  const s = m.snapshot();
  assert.equal(s.frames.input, 1);
  assert.equal(s.frames.snapshot, 1);
  assert.equal(s.frames.webrtcSignal, 1);
  assert.equal(s.bytesRelayed, 30 + 1200 + 200 + 9999);
});

test("drop counters", () => {
  const m = createMetrics();
  m.dropPerOp(); m.dropPerOp();
  m.dropSevere();
  m.dropIdle();
  const s = m.snapshot();
  assert.equal(s.drops.perOp, 2);
  assert.equal(s.drops.severeClose, 1);
  assert.equal(s.drops.idleClose, 1);
});

test("uptimeSeconds advances with the clock", () => {
  let t = 1_000_000;
  const m = createMetrics({ now: () => t });
  t += 5500;
  assert.equal(m.snapshot().uptimeSeconds, 6); // Math.round(5.5) = 6
});
