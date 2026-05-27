// In-memory counters for the relay. Cheap monotonic integers; the
// /metrics HTTP endpoint serializes them on demand. No Prometheus
// formatting — JSON is enough for now, and the spec keeps the relay
// dep-free.
//
// All counters are best-effort. We deliberately don't lock around
// increments — a Node event loop is single-threaded for our purposes,
// and the cost of a missed tick under future worker-threads would be
// dwarfed by the cost of a real lock.

export function createMetrics({ now = () => Date.now() } = {}) {
  const startedAt = now();
  const state = {
    connections: { current: 0, total: 0 },
    sessions: {
      current: 0,
      totalOpened: 0,
      closed: { host_quit: 0, host_timeout: 0, server_restart: 0 },
    },
    peers: {
      joined: 0,
      left: { leave: 0, disconnect: 0, timeout: 0, kicked: 0 },
    },
    frames: { input: 0, snapshot: 0, delta: 0, event: 0, webrtcSignal: 0 },
    bytesRelayed: 0,
    drops: { perOp: 0, severeClose: 0, idleClose: 0 },
  };

  function connOpened() { state.connections.current++; state.connections.total++; }
  function connClosed() {
    if (state.connections.current > 0) state.connections.current--;
  }
  function sessionOpened() { state.sessions.current++; state.sessions.totalOpened++; }
  function sessionClosed(reason) {
    if (state.sessions.current > 0) state.sessions.current--;
    if (reason && Object.prototype.hasOwnProperty.call(state.sessions.closed, reason)) {
      state.sessions.closed[reason]++;
    }
  }
  function peerJoined() { state.peers.joined++; }
  function peerLeft(reason) {
    if (reason && Object.prototype.hasOwnProperty.call(state.peers.left, reason)) {
      state.peers.left[reason]++;
    }
  }
  // op is the wire `op` value; size is JSON byte length the relay
  // forwarded. Unknown ops are ignored to keep the shape stable.
  function frameRelayed(op, size) {
    const k = op === "webrtc.signal" ? "webrtcSignal" : op;
    if (Object.prototype.hasOwnProperty.call(state.frames, k)) state.frames[k]++;
    if (typeof size === "number" && size > 0) state.bytesRelayed += size;
  }
  function dropPerOp() { state.drops.perOp++; }
  function dropSevere() { state.drops.severeClose++; }
  function dropIdle() { state.drops.idleClose++; }

  function snapshot() {
    return {
      startedAt: new Date(startedAt).toISOString(),
      uptimeSeconds: Math.round((now() - startedAt) / 1000),
      ...state,
    };
  }

  return {
    connOpened, connClosed,
    sessionOpened, sessionClosed,
    peerJoined, peerLeft,
    frameRelayed,
    dropPerOp, dropSevere, dropIdle,
    snapshot,
  };
}
