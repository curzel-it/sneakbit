// In-memory session map. The relay is the only writer.
//
// A session = one host + 0..3 guests, identified externally by a 5-char
// invite code and internally by a session id. Guests get a slot number
// (2, 3, 4) so the host can route their inputs to the right local-coop
// player slot. The store knows nothing about WebSocket frames — it just
// holds bookkeeping and identifies returning UUIDs.

import { randomBytes } from "node:crypto";

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CODE_LEN = 5;
// Spec allows up to 3 guests (4-player co-op), but hostGuests.js only
// spawns a slot-2 avatar today — anyone past slot 2 gets a peer.joined
// frame and then is silently ignored. Cap at 1 here so the server's
// advertised maxGuests matches what the host can actually render.
// Lift this back to 3 once main.js gains state.players[] and
// hostGuests.js handles slots 3/4.
export const MAX_GUESTS = 1;
export const DEFAULT_GRACE_MS = 30000;

export function generateCode() {
  const bytes = randomBytes(CODE_LEN);
  let s = "";
  for (let i = 0; i < CODE_LEN; i++) {
    s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return s;
}

export function makePlayerId(uuid) {
  return "p_" + uuid.replace(/-/g, "").slice(0, 6);
}

export function makeName(uuid) {
  return "Player-" + uuid.replace(/-/g, "").slice(0, 4);
}

export class SessionStore {
  constructor() {
    this.sessionsById = new Map();
    this.sessionsByCode = new Map();
    this.uuidIndex = new Map();
  }

  createSession(hostUuid, hostConn) {
    const sessionId = "sess_" + randomBytes(3).toString("hex");
    let code;
    do { code = generateCode(); } while (this.sessionsByCode.has(code));
    const session = {
      id: sessionId,
      code,
      hostUuid,
      hostConn,
      guests: new Map(),
    };
    this.sessionsById.set(sessionId, session);
    this.sessionsByCode.set(code, session);
    this.uuidIndex.set(hostUuid, { sessionId, role: "host" });
    return session;
  }

  findSessionByCode(code) {
    if (typeof code !== "string") return null;
    return this.sessionsByCode.get(code.toUpperCase()) || null;
  }

  findByUuid(uuid) {
    const idx = this.uuidIndex.get(uuid);
    if (!idx) return null;
    return this.sessionsById.get(idx.sessionId) || null;
  }

  roleOf(uuid) {
    const idx = this.uuidIndex.get(uuid);
    return idx ? idx.role : null;
  }

  _nextSlot(session) {
    const used = new Set();
    for (const g of session.guests.values()) used.add(g.slot);
    for (let i = 2; i <= MAX_GUESTS + 1; i++) {
      if (!used.has(i)) return i;
    }
    return null;
  }

  addOrResumeGuest(session, uuid, conn) {
    const existing = session.guests.get(uuid);
    if (existing) {
      existing.conn = conn;
      return { guest: existing, isReconnect: true };
    }
    if (session.guests.size >= MAX_GUESTS) return null;
    const slot = this._nextSlot(session);
    if (slot == null) return null;
    const guest = {
      uuid,
      conn,
      slot,
      name: makeName(uuid),
      playerId: makePlayerId(uuid),
    };
    session.guests.set(uuid, guest);
    this.uuidIndex.set(uuid, { sessionId: session.id, role: "guest" });
    return { guest, isReconnect: false };
  }

  removeGuest(session, uuid) {
    session.guests.delete(uuid);
    this.uuidIndex.delete(uuid);
  }

  ghostGuest(session, uuid) {
    const g = session.guests.get(uuid);
    if (g) g.conn = null;
  }

  ghostHost(session) { session.hostConn = null; }

  resumeHost(session, conn) { session.hostConn = conn; }

  destroySession(session) {
    this.sessionsById.delete(session.id);
    this.sessionsByCode.delete(session.code);
    this.uuidIndex.delete(session.hostUuid);
    for (const uuid of session.guests.keys()) this.uuidIndex.delete(uuid);
    session.guests.clear();
  }
}
