// Protocol relay. Pure routing: connections in, frames out.
// Host frames (snapshot/delta/event) fan out to the session's guests; guest
// frames (input) fan in to the session's host. Lifecycle frames
// (peer.joined/left/ghosted, session.closed, host.ghosted/resumed) are
// emitted by the relay itself. See docs/online-coop.md.

import {
  SessionStore,
  DEFAULT_GRACE_MS,
  MAX_GUESTS,
  makePlayerId,
  makeName,
} from "./sessions.js";
import { log as defaultLog } from "./logger.js";
import { createMetrics } from "./metrics.js";

export const PROTOCOL = 1;
export const MIN_PROTOCOL = 1;

// UUIDv4 by RFC 4122: 8-4-4-4-12 lowercase hex with version nibble 4
// and variant high bits 10 (yielding [89abAB] in the variant nibble).
// crypto.randomUUID() — the browser path in js/onlineMode.js — always
// produces a string matching this regex; legacy short labels from old
// tests no longer pass and are now expected to be rejected with 4001.
const UUIDV4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function isValidUuidV4(s) {
  return typeof s === "string" && UUIDV4_RE.test(s);
}

// Per-spec close codes. 4002 = idle (no pings for the timeout window);
// 4004 = severe rate violation — the client gets banned for a minute;
// 4005 = kicked by host (host.kick op) — no auto-reconnect on the client;
// 4006 = server at capacity (MAX_CONNECTIONS / MAX_SESSIONS reached).
export const CLOSE_IDLE = 4002;
export const CLOSE_RATE = 4004;
export const CLOSE_KICKED = 4005;
export const CLOSE_CAPACITY = 4006;

// Defense-in-depth caps. Numbers are generous for a single-VPS hobby
// relay but bound the worst case: a persistent attacker (or a popular
// launch) cannot exhaust RAM by opening unbounded sockets or sessions.
// Both can be tuned via env without code changes.
export const DEFAULT_MAX_CONNECTIONS = 500;
export const DEFAULT_MAX_SESSIONS = 100;

// Per-spec rate limits (docs/online-coop.md §Rate limits).
// Burst-friendly: input + snapshot/delta can hit 30/s, everything else
// caps at 10/s. Severe abuse (~1000 msgs in a sliding window) trips a
// 4004 close. Numbers chosen to match the spec; not tunable per
// connection.
const LIMIT_INPUT_PER_S = 30;
const LIMIT_BROADCAST_PER_S = 30;
const LIMIT_OTHER_PER_S = 10;
const SEVERE_WINDOW_MS = 10_000;
const SEVERE_LIMIT = 1000;

// Idle close: ping cadence is 20s on the client; spec allows 30s; this
// gives ~3 missed pings before we drop the connection.
const IDLE_TIMEOUT_MS = 60_000;
const IDLE_CHECK_MS = 5_000;

const BROADCAST_OPS = new Set(["snapshot", "delta", "event"]);

export function createRelay({
  store = new SessionStore(),
  graceMs = DEFAULT_GRACE_MS,
  idleTimeoutMs = IDLE_TIMEOUT_MS,
  idleCheckMs = IDLE_CHECK_MS,
  maxConnections = DEFAULT_MAX_CONNECTIONS,
  maxSessions = DEFAULT_MAX_SESSIONS,
  log = defaultLog,
  metrics = createMetrics(),
} = {}) {
  const conns = new Set();
  // Track ghost-grace timers so drain()/shutdown() can clear them; an
  // un-cleared timer keeps the event loop alive past SIGTERM and can
  // fire against torn-down metrics. Cleared on session destroy, too.
  const graceTimers = new Set();
  // Set by drain(): once true, onDisconnect skips arming fresh grace
  // timers. Without this, the upgradedSockets.destroy() call that
  // follows drain() triggers onDisconnect → setTimeout(graceMs),
  // which keeps the event loop alive past SIGTERM.
  let draining = false;

  function attach(ws) {
    if (conns.size >= maxConnections) {
      metrics.dropCapacity?.();
      log.warn("conn.capacity", { open: conns.size, cap: maxConnections });
      try { ws.close(CLOSE_CAPACITY, "capacity"); } catch { /* ignore */ }
      return null;
    }
    const ctx = {
      ws,
      uuid: null,
      playerId: null,
      name: null,
      role: null,
      sessionId: null,
      authed: false,
      // Per-connection rate-limit bookkeeping. Two counters: a 1s
      // sliding bucket (for the per-op caps) and a 10s window (for
      // the severe-abuse 4004 close).
      rl: {
        secStart: 0,
        countInput: 0,
        countBroadcast: 0,
        countOther: 0,
        recent: [],
      },
      // Heartbeat: last message timestamp; the idle sweep tears down
      // connections that haven't said anything in IDLE_TIMEOUT_MS.
      lastSeenMs: nowMs(),
    };
    conns.add(ctx);
    metrics.connOpened();
    ws.on("message", (text) => handleMessage(ctx, text));
    ws.on("close", () => {
      conns.delete(ctx);
      metrics.connClosed();
      onDisconnect(ctx);
    });
    return ctx;
  }

  // Sweep idle connections every idleCheckMs. Cheap — `conns` is a
  // small Set in practice (single-digit hosts, ≤3 guests each).
  const idleTimer = setInterval(() => {
    const now = nowMs();
    for (const ctx of conns) {
      if (now - ctx.lastSeenMs > idleTimeoutMs) {
        metrics.dropIdle();
        log.warn("conn.idle", { uuid: ctx.uuid, role: ctx.role, sessionId: ctx.sessionId });
        try { ctx.ws.close(CLOSE_IDLE, "idle"); } catch { /* ignore */ }
      }
    }
  }, idleCheckMs);
  if (idleTimer.unref) idleTimer.unref();

  function handleMessage(ctx, text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg.op !== "string") return;
    ctx.lastSeenMs = nowMs();
    if (!checkRate(ctx, msg.op)) return;
    switch (msg.op) {
      case "hello": return onHello(ctx, msg);
      case "ping": return ctx.ws.sendJSON({ op: "pong" });
      case "pong": return;
      case "host.open": return onHostOpen(ctx);
      case "host.close": return onHostClose(ctx);
      case "host.kick": return onHostKick(ctx, msg);
      case "guest.join": return onGuestJoin(ctx, msg);
      case "guest.leave": return onGuestLeave(ctx);
      case "input": return onInput(ctx, msg);
      case "move": return onMove(ctx, msg);
      case "guest.resync": return onGuestResync(ctx);
      case "guest.loadout": return onGuestLoadout(ctx, msg);
      case "snapshot":
      case "delta":
      case "event":
        return onHostBroadcast(ctx, msg);
      case "webrtc.signal":
        return onWebrtcSignal(ctx, msg);
      default: return;
    }
  }

  function onHello(ctx, msg) {
    if (!isValidUuidV4(msg.uuid)) {
      ctx.ws.close(4001, "bad uuid"); return;
    }
    if (typeof msg.protocol !== "number" || msg.protocol < MIN_PROTOCOL) {
      ctx.ws.sendJSON({ op: "obsolete", minProtocol: MIN_PROTOCOL, message: "please reload" });
      ctx.ws.close(4001, "obsolete"); return;
    }
    for (const other of conns) {
      if (other !== ctx && other.uuid === msg.uuid) {
        other.ws.close(4003, "uuid conflict");
      }
    }
    ctx.uuid = msg.uuid;
    ctx.playerId = makePlayerId(msg.uuid);
    ctx.name = makeName(msg.uuid);
    // Validate the optional client tag (e.g. "sneakbit"). Capped at
    // 32 chars so a verbose client string can't bloat every log line, and
    // stashed on the ctx so session.open / peer.join can include it —
    // useful for "stuck client" triage without forcing the client to
    // re-identify on every frame.
    if (typeof msg.client === "string" && msg.client.length <= 32) {
      ctx.client = msg.client;
    }
    ctx.authed = true;
    ctx.ws.sendJSON({
      op: "welcome",
      protocol: PROTOCOL,
      playerId: ctx.playerId,
      name: ctx.name,
    });
  }

  function onHostOpen(ctx) {
    if (!ctx.authed) return;
    const existing = store.findByUuid(ctx.uuid);
    const prevRole = store.roleOf(ctx.uuid);
    // Only resume into the host's own session. Without the role gate, a
    // stale guest entry whose uuidIndex still points at the previous
    // session would fall through to createSession, which then overwrites
    // uuidIndex; later the ghost-grace timer would call removeGuest →
    // uuidIndex.delete and trample the new host's lookup.
    if (existing && prevRole === "host" && existing.hostUuid === ctx.uuid) {
      store.resumeHost(existing, ctx.ws);
      ctx.role = "host";
      ctx.sessionId = existing.id;
      ctx.ws.sendJSON({
        op: "host.opened",
        sessionId: existing.id,
        code: existing.code,
        maxGuests: MAX_GUESTS,
        resumed: true,
      });
      for (const g of existing.guests.values()) {
        if (g.conn) g.conn.sendJSON({ op: "host.resumed" });
      }
      return;
    }
    if (existing && prevRole === "guest") {
      ejectStaleGuest(existing, ctx);
    }
    if (store.sessionsById.size >= maxSessions) {
      metrics.dropCapacity?.();
      log.warn("session.capacity", { open: store.sessionsById.size, cap: maxSessions });
      ctx.ws.close(CLOSE_CAPACITY, "capacity");
      return;
    }
    const session = store.createSession(ctx.uuid, ctx.ws);
    ctx.role = "host";
    ctx.sessionId = session.id;
    metrics.sessionOpened();
    log.info("session.open", { sessionId: session.id, code: session.code, hostUuid: ctx.uuid, client: ctx.client });
    ctx.ws.sendJSON({
      op: "host.opened",
      sessionId: session.id,
      code: session.code,
      maxGuests: MAX_GUESTS,
    });
  }

  function ejectStaleGuest(session, ctx) {
    const guest = session.guests.get(ctx.uuid);
    if (!guest) return;
    store.removeGuest(session, ctx.uuid);
    const leftFrame = {
      op: "peer.left",
      playerId: guest.playerId,
      reason: "leave",
    };
    if (session.hostConn) session.hostConn.sendJSON(leftFrame);
    for (const other of session.guests.values()) {
      if (other.conn) other.conn.sendJSON(leftFrame);
    }
  }

  function onHostClose(ctx) {
    if (ctx.role !== "host") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    closeSession(session, "host_quit");
  }

  // Host requests that a specific guest be ejected. Auth-gated to the
  // host of the session. We remove the guest *before* closing the WS so
  // onDisconnect's `session.guests.get(ctx.uuid)` early-returns and we
  // don't double-emit a peer.ghosted / delayed peer.left for the same
  // playerId. Close code 4005 tells the kicked guest's net.js not to
  // auto-reconnect (docs/online-coop.md §Close codes).
  function onHostKick(ctx, msg) {
    if (ctx.role !== "host") return;
    if (typeof msg.playerId !== "string") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    let kickedUuid = null;
    let kickedConn = null;
    for (const g of session.guests.values()) {
      if (g.playerId === msg.playerId) {
        kickedUuid = g.uuid;
        kickedConn = g.conn;
        break;
      }
    }
    if (!kickedUuid) return;
    store.removeGuest(session, kickedUuid);
    const leftFrame = {
      op: "peer.left",
      playerId: msg.playerId,
      reason: "kicked",
    };
    if (session.hostConn) session.hostConn.sendJSON(leftFrame);
    for (const g of session.guests.values()) {
      if (g.conn) g.conn.sendJSON(leftFrame);
    }
    if (kickedConn) {
      try { kickedConn.close(CLOSE_KICKED, "kicked"); } catch { /* ignore */ }
    }
    metrics.peerLeft("kicked");
    log.info("peer.left", { sessionId: session.id, playerId: msg.playerId, reason: "kicked" });
  }

  function closeSession(session, reason) {
    for (const g of session.guests.values()) {
      if (g.conn) {
        g.conn.sendJSON({ op: "session.closed", reason });
        g.conn.close(1000, "session closed");
      }
    }
    store.destroySession(session);
    metrics.sessionClosed(reason);
    log.info("session.close", { sessionId: session.id, code: session.code, reason });
  }

  function onGuestJoin(ctx, msg) {
    if (!ctx.authed) return;
    if (typeof msg.code !== "string") {
      ctx.ws.sendJSON({ op: "guest.joinFailed", reason: "not_found" }); return;
    }
    const session = store.findSessionByCode(msg.code);
    if (!session) {
      ctx.ws.sendJSON({ op: "guest.joinFailed", reason: "not_found" }); return;
    }
    if (!session.hostConn) {
      ctx.ws.sendJSON({ op: "guest.joinFailed", reason: "host_offline" }); return;
    }
    const result = store.addOrResumeGuest(session, ctx.uuid, ctx.ws);
    if (!result) {
      ctx.ws.sendJSON({ op: "guest.joinFailed", reason: "full" }); return;
    }
    const { guest, isReconnect } = result;
    ctx.role = "guest";
    ctx.sessionId = session.id;

    const peers = [];
    for (const g of session.guests.values()) {
      if (g.uuid !== ctx.uuid) peers.push({ playerId: g.playerId, name: g.name, slot: g.slot });
    }
    ctx.ws.sendJSON({
      op: "guest.joined",
      sessionId: session.id,
      hostName: makeName(session.hostUuid),
      hostPlayerId: makePlayerId(session.hostUuid),
      selfPlayerId: ctx.playerId,
      slot: guest.slot,
      peers,
    });
    if (!isReconnect) {
      metrics.peerJoined();
      log.info("peer.join", { sessionId: session.id, playerId: ctx.playerId, slot: guest.slot, client: ctx.client });
    } else {
      log.info("peer.rejoin", { sessionId: session.id, playerId: ctx.playerId, slot: guest.slot, client: ctx.client });
    }
    const peerFrame = {
      op: isReconnect ? "peer.rejoined" : "peer.joined",
      playerId: ctx.playerId,
      name: ctx.name,
      slot: guest.slot,
    };
    session.hostConn.sendJSON(peerFrame);
    // Fan the join to every OTHER guest so their mirror world can
    // render the newcomer's name and their predicted-self lookup picks
    // up the new slot. Without this fan-out a third party watching the
    // session only ever learns about peers via the initial `peers` list
    // on their own join.
    for (const g of session.guests.values()) {
      if (g.uuid !== ctx.uuid && g.conn) g.conn.sendJSON(peerFrame);
    }
  }

  function onGuestLeave(ctx) {
    if (ctx.role !== "guest") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    store.removeGuest(session, ctx.uuid);
    const leftFrame = {
      op: "peer.left",
      playerId: ctx.playerId,
      reason: "leave",
    };
    if (session.hostConn) session.hostConn.sendJSON(leftFrame);
    for (const g of session.guests.values()) {
      if (g.conn) g.conn.sendJSON(leftFrame);
    }
    metrics.peerLeft("leave");
    log.info("peer.left", { sessionId: ctx.sessionId, playerId: ctx.playerId, reason: "leave" });
    ctx.role = null;
    ctx.sessionId = null;
  }

  function onInput(ctx, msg) {
    if (ctx.role !== "guest") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session || !session.hostConn) return;
    // Whitelist what we relay. A guest that appends a giant `payload` to
    // an `input` frame would otherwise have the server fan their bytes
    // out at the host's bandwidth cost.
    const out = {
      op: "input",
      from: ctx.playerId,
      seq: typeof msg.seq === "number" ? msg.seq : 0,
      intent: typeof msg.intent === "string" ? msg.intent : "",
    };
    if (typeof msg.dir === "string") out.dir = msg.dir;
    // Facing the action fires in — the host sets the avatar's direction
    // before dispatching so a shoot/melee/interact can't be re-timed
    // against a separate face update (guest-authoritative-movement.md).
    if (typeof msg.d === "string") out.d = msg.d;
    if (typeof msg.t === "number") out.t = msg.t;
    session.hostConn.sendJSON(out);
    metrics.frameRelayed("input", jsonByteLength(out));
  }

  // Guest → host committed tile-step / face update (guest-authoritative-
  // movement.md). Same fan-in shape as input: guest-only, forwarded to the
  // session host with a strict field whitelist so a tampered client can't
  // ride extra bytes out at the host's cost. `k` selects the variant:
  //   step → fx,fy (source tile), tx,ty (target tile), d (direction)
  //   face → x,y (idle tile), d (direction)
  function onMove(ctx, msg) {
    if (ctx.role !== "guest") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session || !session.hostConn) return;
    const out = {
      op: "move",
      from: ctx.playerId,
      seq: typeof msg.seq === "number" ? msg.seq : 0,
      k: typeof msg.k === "string" ? msg.k : "",
    };
    if (typeof msg.d === "string") out.d = msg.d;
    for (const f of ["fx", "fy", "tx", "ty", "x", "y"]) {
      if (typeof msg[f] === "number") out[f] = msg[f];
    }
    session.hostConn.sendJSON(out);
    metrics.frameRelayed("input", jsonByteLength(out));
  }

  // Guest asks the host for a fresh full snapshot. Forwarded host-bound
  // (same shape as input). The host's snapshotBroadcaster listens and
  // emits a snapshot frame addressed to all guests — the requesting
  // guest's mirror will adopt it on arrival. We deliberately don't
  // address the snapshot back to just the requester: the spec says the
  // snapshot is the authoritative baseline, so re-broadcasting it
  // refreshes every other ghosted-and-recovering mirror in the session
  // at no extra cost.
  function onGuestResync(ctx) {
    if (ctx.role !== "guest") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session || !session.hostConn) return;
    session.hostConn.sendJSON({ op: "guest.resync", from: ctx.playerId });
  }

  // Guest tells the host what they have equipped (melee + ranged species
  // ids, null when unequipped). Forwarded host-bound and whitelisted to
  // just the fields we expect, mirroring the input/guest.resync pattern.
  // The host updates its sessionLoadouts entry for this guest and fans
  // event:loadout to the other guests so every client renders the right
  // gear on every avatar.
  function onGuestLoadout(ctx, msg) {
    if (ctx.role !== "guest") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session || !session.hostConn) return;
    const out = {
      op: "guest.loadout",
      from: ctx.playerId,
      melee: typeof msg.melee === "number" ? msg.melee : null,
      ranged: typeof msg.ranged === "number" ? msg.ranged : null,
    };
    session.hostConn.sendJSON(out);
    metrics.frameRelayed("guest.loadout", jsonByteLength(out));
  }

  function onHostBroadcast(ctx, msg) {
    if (ctx.role !== "host") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    const size = jsonByteLength(msg);
    let fanout = 0;
    for (const g of session.guests.values()) {
      if (g.conn) { g.conn.sendJSON(msg); fanout++; }
    }
    // Charge bytes for every fan-out copy — that's what actually went
    // over the wire. Frame count is one per host send, not per fan-out
    // recipient.
    metrics.frameRelayed(msg.op, size * fanout);
  }

  // Opaque pass-through for WebRTC offer/answer/ICE candidates. The relay
  // never inspects the payload — it just routes host ↔ named-guest. Once
  // the data channel is open, the game traffic moves off the WS and the
  // relay stops seeing snapshots/inputs for that pair. See
  // docs/online-coop.md §"WebRTC upgrade path".
  function onWebrtcSignal(ctx, msg) {
    if (!ctx.role) return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    const out = { op: "webrtc.signal", from: ctx.playerId, payload: msg.payload };
    if (ctx.role === "host") {
      if (typeof msg.to !== "string") return;
      // Host addresses a specific guest by playerId. Defensive: scan rather
      // than build a side index — guests is a tiny Map.
      for (const g of session.guests.values()) {
        if (g.playerId === msg.to && g.conn) {
          out.to = msg.to;
          g.conn.sendJSON(out);
          metrics.frameRelayed("webrtc.signal", jsonByteLength(out));
          return;
        }
      }
      return;
    }
    // Guest → host. Destination is always the host; we still echo `to` so
    // the host can dispatch by guest playerId via from.
    if (!session.hostConn) return;
    out.to = makePlayerId(session.hostUuid);
    session.hostConn.sendJSON(out);
    metrics.frameRelayed("webrtc.signal", jsonByteLength(out));
  }

  function onDisconnect(ctx) {
    if (draining) return;
    if (!ctx.sessionId) return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    if (ctx.role === "host") {
      if (session.hostConn !== ctx.ws) return;
      store.ghostHost(session);
      for (const g of session.guests.values()) {
        if (g.conn) g.conn.sendJSON({ op: "host.ghosted" });
      }
      const t = setTimeout(() => {
        graceTimers.delete(t);
        const s = store.sessionsById.get(ctx.sessionId);
        if (!s || s.hostConn) return;
        closeSession(s, "host_timeout");
      }, graceMs);
      graceTimers.add(t);
      return;
    }
    if (ctx.role === "guest") {
      const guest = session.guests.get(ctx.uuid);
      if (!guest || guest.conn !== ctx.ws) return;
      store.ghostGuest(session, ctx.uuid);
      const ghostFrame = { op: "peer.ghosted", playerId: ctx.playerId };
      if (session.hostConn) session.hostConn.sendJSON(ghostFrame);
      for (const g of session.guests.values()) {
        if (g.uuid !== ctx.uuid && g.conn) g.conn.sendJSON(ghostFrame);
      }
      const t = setTimeout(() => {
        graceTimers.delete(t);
        const s = store.sessionsById.get(ctx.sessionId);
        if (!s) return;
        const g = s.guests.get(ctx.uuid);
        if (!g || g.conn) return;
        store.removeGuest(s, ctx.uuid);
        const leftFrame = {
          op: "peer.left",
          playerId: ctx.playerId,
          reason: "timeout",
        };
        if (s.hostConn) s.hostConn.sendJSON(leftFrame);
        for (const other of s.guests.values()) {
          if (other.conn) other.conn.sendJSON(leftFrame);
        }
        metrics.peerLeft("timeout");
        log.info("peer.left", { sessionId: ctx.sessionId, playerId: ctx.playerId, reason: "timeout" });
      }, graceMs);
      graceTimers.add(t);
    }
  }

  // Returns true if the frame should be processed. Otherwise the frame
  // is dropped (per-op cap) or the connection is closed (severe abuse).
  function checkRate(ctx, op) {
    const now = nowMs();
    const rl = ctx.rl;
    // Per-second bucket.
    if (now - rl.secStart >= 1000) {
      rl.secStart = now;
      rl.countInput = 0;
      rl.countBroadcast = 0;
      rl.countOther = 0;
    }
    let limit;
    if (op === "input" || op === "move") {
      limit = LIMIT_INPUT_PER_S;
      if (++rl.countInput > limit) { metrics.dropPerOp(); return false; }
    } else if (BROADCAST_OPS.has(op)) {
      limit = LIMIT_BROADCAST_PER_S;
      if (++rl.countBroadcast > limit) { metrics.dropPerOp(); return false; }
    } else {
      limit = LIMIT_OTHER_PER_S;
      if (++rl.countOther > limit) { metrics.dropPerOp(); return false; }
    }
    // Severe-abuse 10s window. Trim and append; once over the threshold
    // we close with 4004 — the client is expected to back off for ~60s.
    rl.recent.push(now);
    while (rl.recent.length && now - rl.recent[0] > SEVERE_WINDOW_MS) {
      rl.recent.shift();
    }
    if (rl.recent.length > SEVERE_LIMIT) {
      metrics.dropSevere();
      log.warn("conn.rateBan", { uuid: ctx.uuid, role: ctx.role, sessionId: ctx.sessionId });
      try { ctx.ws.close(CLOSE_RATE, "rate"); } catch { /* ignore */ }
      return false;
    }
    return true;
  }

  // Graceful drain. On SIGTERM the bootstrap calls this before letting
  // the process exit so guests see a clean "server restart" close
  // frame instead of a TCP reset → "connection reset by peer" toast.
  // Returns a promise that resolves once every connection has been
  // signaled and given a short flush window. We don't actively close
  // the underlying sockets here — the caller closes the HTTP server
  // and lets its own teardown drop the upgraded TCP sockets so the
  // OS doesn't half-close in the middle of a flushing frame.
  function drain({ flushMs = 100 } = {}) {
    draining = true;
    clearInterval(idleTimer);
    for (const t of graceTimers) clearTimeout(t);
    graceTimers.clear();
    const frame = { op: "session.closed", reason: "server_restart" };
    for (const session of store.sessionsById.values()) {
      if (session.hostConn) {
        try { session.hostConn.sendJSON(frame); } catch { /* ignore */ }
      }
      for (const g of session.guests.values()) {
        if (g.conn) {
          try { g.conn.sendJSON(frame); } catch { /* ignore */ }
        }
      }
      metrics.sessionClosed("server_restart");
      log.info("session.close", { sessionId: session.id, code: session.code, reason: "server_restart" });
    }
    return new Promise((res) => setTimeout(res, flushMs));
  }

  function shutdown() {
    clearInterval(idleTimer);
    for (const t of graceTimers) clearTimeout(t);
    graceTimers.clear();
  }

  return { attach, store, shutdown, drain, metrics };
}

function jsonByteLength(obj) {
  try { return Buffer.byteLength(JSON.stringify(obj), "utf8"); }
  catch { return 0; }
}

function nowMs() {
  return typeof performance !== "undefined" && performance?.now
    ? performance.now()
    : Date.now();
}
