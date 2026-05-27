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

export function createRelay({
  store = new SessionStore(),
  graceMs = DEFAULT_GRACE_MS,
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
    };
    conns.add(ctx);
    ws.on("message", (text) => handleMessage(ctx, text));
    ws.on("close", () => {
      conns.delete(ctx);
      onDisconnect(ctx);
    });
    return ctx;
  }

  function handleMessage(ctx, text) {
    let msg;
    try { msg = JSON.parse(text); } catch { return; }
    if (!msg || typeof msg.op !== "string") return;
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
    session.hostConn.sendJSON({
      op: isReconnect ? "peer.rejoined" : "peer.joined",
      playerId: ctx.playerId,
      name: ctx.name,
      slot: guest.slot,
    });
  }

  function onGuestLeave(ctx) {
    if (ctx.role !== "guest") return;
    const session = store.sessionsById.get(ctx.sessionId);
    if (!session) return;
    store.removeGuest(session, ctx.uuid);
    if (session.hostConn) {
      session.hostConn.sendJSON({
        op: "peer.left",
        playerId: ctx.playerId,
        reason: "leave",
      });
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
      if (session.hostConn) {
        session.hostConn.sendJSON({ op: "peer.ghosted", playerId: ctx.playerId });
      }
      setTimeout(() => {
        const s = store.sessionsById.get(ctx.sessionId);
        if (!s) return;
        const g = s.guests.get(ctx.uuid);
        if (!g || g.conn) return;
        store.removeGuest(s, ctx.uuid);
        if (s.hostConn) {
          s.hostConn.sendJSON({
            op: "peer.left",
            playerId: ctx.playerId,
            reason: "timeout",
          });
        }
      }, graceMs);
    }
  }

  return { attach, store };
}
