// Protocol relay. Pure routing: connections in, frames out.
// Host frames (snapshot/delta/event) fan out to the session's guests; guest
// frames (input) fan in to the session's host. Lifecycle frames
// (peer.joined/left/ghosted, session.closed, host.ghosted/resumed) are
// emitted by the relay itself. See host-authoritative-server.md.

import {
  SessionStore,
  DEFAULT_GRACE_MS,
  MAX_GUESTS,
  makePlayerId,
  makeName,
} from "./sessions.js";

export const PROTOCOL = 1;
export const MIN_PROTOCOL = 1;

// Per-spec close codes. 4002 = idle (no pings for the timeout window);
// 4004 = severe rate violation — the client gets banned for a minute.
export const CLOSE_IDLE = 4002;
export const CLOSE_RATE = 4004;

// Per-spec rate limits (host-authoritative-server.md §Rate limits).
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
} = {}) {
  const conns = new Set();

  function attach(ws) {
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
    ws.on("message", (text) => handleMessage(ctx, text));
    ws.on("close", () => {
      conns.delete(ctx);
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
      case "guest.join": return onGuestJoin(ctx, msg);
      case "guest.leave": return onGuestLeave(ctx);
      case "input": return onInput(ctx, msg);
      case "snapshot":
      case "delta":
      case "event":
        return onHostBroadcast(ctx, msg);
      default: return;
    }
  }

  function onHello(ctx, msg) {
    if (typeof msg.uuid !== "string" || msg.uuid.length < 4) {
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
    if (existing && existing.hostUuid === ctx.uuid) {
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
    const session = store.createSession(ctx.uuid, ctx.ws);
    ctx.role = "host";
    ctx.sessionId = session.id;
    ctx.ws.sendJSON({
      op: "host.opened",
      sessionId: session.id,
      code: session.code,
      maxGuests: MAX_GUESTS,
    });
  }

  function onHostClose(ctx) {
    if (ctx.role !== "host") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    closeSession(session, "host_quit");
  }

  function closeSession(session, reason) {
    for (const g of session.guests.values()) {
      if (g.conn) {
        g.conn.sendJSON({ op: "session.closed", reason });
        g.conn.close(1000, "session closed");
      }
    }
    store.destroySession(session);
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
    ctx.role = null;
    ctx.sessionId = null;
  }

  function onInput(ctx, msg) {
    if (ctx.role !== "guest") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session || !session.hostConn) return;
    session.hostConn.sendJSON({ ...msg, from: ctx.playerId });
  }

  function onHostBroadcast(ctx, msg) {
    if (ctx.role !== "host") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    for (const g of session.guests.values()) {
      if (g.conn) g.conn.sendJSON(msg);
    }
  }

  function onDisconnect(ctx) {
    if (!ctx.sessionId) return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    if (ctx.role === "host") {
      if (session.hostConn !== ctx.ws) return;
      store.ghostHost(session);
      for (const g of session.guests.values()) {
        if (g.conn) g.conn.sendJSON({ op: "host.ghosted" });
      }
      setTimeout(() => {
        const s = store.sessionsById.get(ctx.sessionId);
        if (!s || s.hostConn) return;
        closeSession(s, "host_timeout");
      }, graceMs);
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
      setTimeout(() => {
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
      }, graceMs);
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
    if (op === "input") {
      limit = LIMIT_INPUT_PER_S;
      if (++rl.countInput > limit) return false;
    } else if (BROADCAST_OPS.has(op)) {
      limit = LIMIT_BROADCAST_PER_S;
      if (++rl.countBroadcast > limit) return false;
    } else {
      limit = LIMIT_OTHER_PER_S;
      if (++rl.countOther > limit) return false;
    }
    // Severe-abuse 10s window. Trim and append; once over the threshold
    // we close with 4004 — the client is expected to back off for ~60s.
    rl.recent.push(now);
    while (rl.recent.length && now - rl.recent[0] > SEVERE_WINDOW_MS) {
      rl.recent.shift();
    }
    if (rl.recent.length > SEVERE_LIMIT) {
      try { ctx.ws.close(CLOSE_RATE, "rate"); } catch { /* ignore */ }
      return false;
    }
    return true;
  }

  function shutdown() {
    clearInterval(idleTimer);
  }

  return { attach, store, shutdown };
}

function nowMs() {
  return typeof performance !== "undefined" && performance?.now
    ? performance.now()
    : Date.now();
}
