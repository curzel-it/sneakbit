// Thin wrapper around a net.Socket post-handshake. Re-assembles fragmented
// messages, handles control frames, exposes text JSON send + ping/pong.
//
// When permessage-deflate is negotiated (RFC 7692, both sides
// no_context_takeover) the wrapper deflates outgoing text frames and
// inflates incoming RSV1-flagged frames. Per-message sync compression —
// no streaming state to manage.

import { EventEmitter } from "node:events";
import { deflateRawSync, inflateRawSync, constants as zlibConstants } from "node:zlib";
import { encodeFrame, encodeCloseFrame, parseFrames, OP } from "./wsFrames.js";
import { stripTrailer, appendTrailer } from "./wsExtensions.js";

// 1 MB cap for the compressed-payload buffer. Same order of magnitude as
// the spec's "ws frame size cap ~1 MB" todo. Inflated output is bounded by
// zlib itself.
const MAX_INFLATE_INPUT = 1 << 20;

export class WsConnection extends EventEmitter {
  constructor(socket, { deflate = false } = {}) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.fragments = [];
    this.fragmentOpcode = null;
    this.fragmentCompressed = false;
    this.deflate = !!deflate;

    socket.on("data", (chunk) => this._onData(chunk));
    socket.on("end", () => this._onSocketClose());
    socket.on("close", () => this._onSocketClose());
    socket.on("error", (err) => this.emit("socketError", err));
  }

  _onData(chunk) {
    this.buf = Buffer.concat([this.buf, chunk]);
    let parsed;
    try { parsed = parseFrames(this.buf); }
    catch { this.close(1009, "frame too big"); return; }
    this.buf = parsed.rest;
    for (const frame of parsed.frames) this._handleFrame(frame);
  }

  _handleFrame(frame) {
    if (frame.opcode === OP.CLOSE) {
      const code = frame.payload.length >= 2
        ? frame.payload.readUInt16BE(0)
        : 1005;
      this._finalizeClose(code);
      return;
    }
    if (frame.opcode === OP.PING) {
      this._sendRaw(encodeFrame(OP.PONG, frame.payload));
      return;
    }
    if (frame.opcode === OP.PONG) {
      this.emit("pong");
      return;
    }
    if (frame.opcode === OP.TEXT || frame.opcode === OP.BINARY) {
      this.fragments = [frame.payload];
      this.fragmentOpcode = frame.opcode;
      this.fragmentCompressed = !!frame.rsv1;
    } else if (frame.opcode === OP.CONT) {
      this.fragments.push(frame.payload);
    } else {
      return;
    }
    if (frame.fin) {
      const full = Buffer.concat(this.fragments);
      const op = this.fragmentOpcode;
      const compressed = this.fragmentCompressed;
      this.fragments = [];
      this.fragmentOpcode = null;
      this.fragmentCompressed = false;
      let decoded = full;
      if (compressed) {
        if (full.length > MAX_INFLATE_INPUT) {
          this.close(1009, "inflate input too big");
          return;
        }
        // `finishFlush: Z_SYNC_FLUSH` lets the one-shot inflater accept a
        // stream that ends with the SYNC_FLUSH marker (RFC 7692) instead
        // of demanding a BFINAL block. Real browsers send SYNC_FLUSH —
        // without this, inflateRawSync throws "unexpected end of file".
        try { decoded = inflateRawSync(appendTrailer(full), { finishFlush: zlibConstants.Z_SYNC_FLUSH }); }
        catch (e) { this.close(1007, "inflate failed"); return; }
      }
      if (op === OP.TEXT) this.emit("message", decoded.toString("utf8"));
      else if (op === OP.BINARY) this.emit("binary", decoded);
    }
  }

  _onSocketClose() { this._finalizeClose(1006); }

  _finalizeClose(code) {
    if (this.closed) return;
    this.closed = true;
    try { this.socket.end(); } catch { /* ignore */ }
    this.emit("close", code);
  }

  sendText(s) {
    if (this.closed) return;
    if (!this.deflate) {
      this._sendRaw(encodeFrame(OP.TEXT, s));
      return;
    }
    const raw = Buffer.from(s, "utf8");
    // `finishFlush: Z_SYNC_FLUSH` (NOT `flush:` — that option is ignored
    // by deflateRawSync) makes the one-shot deflater end the stream with
    // the `00 00 ff ff` marker that RFC 7692 mandates we then strip.
    // With the wrong option, output ends with a BFINAL block instead,
    // stripTrailer is a no-op, and peers can't inflate.
    const compressed = stripTrailer(
      deflateRawSync(raw, { finishFlush: zlibConstants.Z_SYNC_FLUSH })
    );
    this._sendRaw(encodeFrame(OP.TEXT, compressed, { rsv1: true }));
  }

  sendJSON(obj) { this.sendText(JSON.stringify(obj)); }

  sendPing(payload = Buffer.alloc(0)) {
    if (this.closed) return;
    // Control frames are never compressed (RFC 7692 §6.1).
    this._sendRaw(encodeFrame(OP.PING, payload));
  }

  close(code = 1000, reason = "") {
    if (this.closed) return;
    this.closed = true;
    try {
      this.socket.write(encodeCloseFrame(code, reason));
      this.socket.end();
    } catch {
      try { this.socket.destroy(); } catch { /* ignore */ }
    }
  }

  _sendRaw(buf) {
    try { this.socket.write(buf); }
    catch (e) { this.emit("socketError", e); }
  }
}
