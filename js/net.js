// Thin WebSocket client. Speaks the relay's JSON-over-WS protocol described
// in host-authoritative-server.md: hello on every open, app-level ping
// every 20 s, automatic reconnect with backoff on unexpected close (codes
// 4001 obsolete and 4003 uuid-conflict bail out). One instance per tab —
// host and guest share the same module.

import { getOnlineUuid } from "./onlineMode.js";

export const PROTOCOL = 1;
const DEFAULT_DEV_WS = "ws://localhost:8090/ws";
const DEFAULT_PROD_WS = "wss://sneakbit.curzel.it/ws";
const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const PING_INTERVAL_MS = 20000;
const CLIENT_TAG = "sneakbit-html";

export function pickServerUrl() {
  if (typeof location !== "undefined" && location?.search) {
    try {
      const override = new URLSearchParams(location.search).get("server");
      if (override) return override;
    } catch { /* ignore */ }
  }
  if (typeof location !== "undefined") {
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") return DEFAULT_DEV_WS;
  }
  return DEFAULT_PROD_WS;
}

export function createNet({
  url,
  uuid,
  wsFactory,
  pingIntervalMs = PING_INTERVAL_MS,
  backoffSteps = BACKOFF_STEPS_MS,
} = {}) {
  const resolvedUrl = url || pickServerUrl();
  const resolvedUuid = uuid || getOnlineUuid();
  const handlers = new Map();

  let ws = null;
  let attempts = 0;
  let intentionallyClosed = false;
  let pingTimer = null;
  let reconnectTimer = null;
  // After a 4002 (idle close) we get exactly one auto-retry — typical
  // cause is a transient network blip. If that retry also closes 4002,
  // there's something wrong with the path and we stop fighting; the
  // user can refresh / re-open the session manually.
  let idleRetryUsed = false;

  function on(op, handler) {
    let list = handlers.get(op);
    if (!list) { list = []; handlers.set(op, list); }
    list.push(handler);
    return () => {
      const idx = list.indexOf(handler);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  function emit(op, msg) {
    const list = handlers.get(op);
    if (!list) return;
    for (const h of list.slice()) {
      try { h(msg); }
      catch (e) {
        // Surface handler errors but don't tear down the socket — one bad
        // handler shouldn't kill all the others.
        console.error("net handler error", op, e);
      }
    }
  }

  function send(frame) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(frame)); return true; }
    catch (e) { console.error("net send error", e); return false; }
  }

  function startPing() {
    stopPing();
    pingTimer = setInterval(() => send({ op: "ping" }), pingIntervalMs);
  }
  function stopPing() {
    if (pingTimer) { clearInterval(pingTimer); pingTimer = null; }
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    const delay = backoffSteps[Math.min(attempts, backoffSteps.length - 1)];
    attempts++;
    reconnectTimer = setTimeout(() => { reconnectTimer = null; connect(); }, delay);
  }

  function connect() {
    if (ws) return;
    intentionallyClosed = false;
    const factory = wsFactory || ((u) => new WebSocket(u));
    let sock;
    try { sock = factory(resolvedUrl); }
    catch (e) {
      console.error("net: ws factory failed", e);
      scheduleReconnect();
      return;
    }
    ws = sock;
    sock.onopen = () => {
      attempts = 0;
      idleRetryUsed = false;
      send({ op: "hello", protocol: PROTOCOL, uuid: resolvedUuid, client: CLIENT_TAG });
      startPing();
      emit("_open", { url: resolvedUrl });
    };
    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); }
      catch { return; }
      if (!msg || typeof msg.op !== "string") return;
      emit(msg.op, msg);
    };
    sock.onclose = (ev) => {
      stopPing();
      ws = null;
      const code = ev?.code ?? 1006;
      emit("_close", { code, reason: ev?.reason });
      if (intentionallyClosed) return;
      if (code === 4001) {
        // Protocol obsolete — reload to pick up the new client.
        if (typeof location !== "undefined" && typeof location.reload === "function") {
          location.reload();
        }
        return;
      }
      if (code === 4003) return; // uuid conflict — don't fight the other tab
      if (code === 4004) return; // rate-limit ban — see spec, 60s lockout
      if (code === 4002) {
        // Idle / ping-timeout. Give the link one chance to recover,
        // then give up. Blindly reconnecting forever turns a wedged
        // connection (e.g. captive portal) into a thundering retry.
        if (idleRetryUsed) return;
        idleRetryUsed = true;
        scheduleReconnect();
        return;
      }
      scheduleReconnect();
    };
    sock.onerror = () => { /* onclose follows; nothing to do here */ };
  }

  function close() {
    intentionallyClosed = true;
    stopPing();
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (ws) {
      try { ws.close(1000, "client closing"); } catch { /* ignore */ }
      ws = null;
    }
  }

  return {
    connect,
    close,
    send,
    on,
    getUuid: () => resolvedUuid,
    getUrl: () => resolvedUrl,
    isConnected: () => !!ws && ws.readyState === 1,
  };
}
