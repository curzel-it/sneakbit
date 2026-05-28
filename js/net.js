// Thin WebSocket client. Speaks the relay's JSON-over-WS protocol described
// in docs/server.md: hello on every open, app-level ping
// every 20 s, automatic reconnect with backoff on unexpected close (codes
// 4001 obsolete and 4003 uuid-conflict bail out). One instance per tab —
// host and guest share the same module.

import { getOnlineUuid } from "./onlineMode.js?v=20260528i";

export const PROTOCOL = 1;
const DEFAULT_DEV_WS = "ws://localhost:8090/ws";
const DEFAULT_PROD_WS = "wss://sneakbit.curzel.it/ws";
const BACKOFF_STEPS_MS = [1000, 2000, 4000, 8000, 16000, 30000];
const PING_INTERVAL_MS = 20000;
const CLIENT_TAG = "sneakbit-html";

export function pickServerUrl(loc = typeof location !== "undefined" ? location : null) {
  // ?server=… is a dev-only escape hatch — it lets you point the page
  // at a local relay without editing source. In production it would be
  // a phishing primitive: a malicious link like
  //   https://curzel.it/sneakbit-html?server=wss://attacker.example/ws
  // would silently re-route the player's session (and their session
  // code, which is enough to impersonate them) to a server the
  // attacker controls. We only honour the override when the page
  // itself is loaded from a local host.
  const host = loc?.hostname || "";
  const isLocal = host === "localhost" || host === "127.0.0.1" || host === "";
  if (loc?.search) {
    try {
      const override = new URLSearchParams(loc.search).get("server");
      if (override) {
        if (isLocal) return override;
        // Surface the ignored override so a developer who set it
        // intentionally on a deployed build can see why they ended up
        // on the prod relay instead.
        if (typeof console !== "undefined") {
          console.warn(
            `[net] ?server= override ignored on non-local host "${host}" (anti-phishing). Falling back to default relay.`
          );
        }
      }
    } catch { /* ignore */ }
  }
  if (isLocal) return DEFAULT_DEV_WS;
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
  // Optional send-side hook: returning true short-circuits the WS send.
  // Used by webrtcTransport to lift game traffic onto a DataChannel once
  // one is open. Receive-side, the transport calls `emitOp` directly.
  let sendInterceptor = null;
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
    if (sendInterceptor) {
      try {
        if (sendInterceptor(frame) === true) return true;
      } catch (e) { console.error("net send interceptor", e); }
    }
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(frame)); return true; }
    catch (e) { console.error("net send error", e); return false; }
  }

  function setSendInterceptor(fn) { sendInterceptor = fn || null; }
  function emitOp(op, msg) { emit(op, msg); }

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
      send({ op: "hello", protocol: PROTOCOL, uuid: resolvedUuid, client: CLIENT_TAG });
      startPing();
      emit("_open", { url: resolvedUrl });
    };
    sock.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); }
      catch { return; }
      if (!msg || typeof msg.op !== "string") return;
      // Reset backoff only after a successful handshake round-trip.
      // Resetting in onopen lets a TLS-handshake-OK-but-server-closes
      // failure (bad protocol, immediate reject) fast-loop at the
      // 1 s floor — by the time we see `welcome` we know the relay
      // accepted us, so escalating backoff is safe to wipe.
      if (msg.op === "welcome") {
        attempts = 0;
        idleRetryUsed = false;
      }
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
      if (code === 4005) return; // kicked by host — coming back uninvited is hostile
      if (code === 4006) return; // server at capacity — don't pile on; user can manually retry
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
    setSendInterceptor,
    emitOp,
    getUuid: () => resolvedUuid,
    getUrl: () => resolvedUrl,
    isConnected: () => !!ws && ws.readyState === 1,
  };
}
