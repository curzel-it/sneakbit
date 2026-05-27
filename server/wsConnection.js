// Thin wrapper around a net.Socket post-handshake. Re-assembles fragmented
// messages, handles control frames, exposes text JSON send + ping/pong.

import { EventEmitter } from "node:events";
import { encodeFrame, encodeCloseFrame, parseFrames, OP } from "./wsFrames.js";

export class WsConnection extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.closed = false;
    this.fragments = [];
    this.fragmentOpcode = null;

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
    } else if (frame.opcode === OP.CONT) {
      this.fragments.push(frame.payload);
    } else {
      return;
    }
    if (frame.fin) {
      const full = Buffer.concat(this.fragments);
      const op = this.fragmentOpcode;
      this.fragments = [];
      this.fragmentOpcode = null;
      if (op === OP.TEXT) this.emit("message", full.toString("utf8"));
      else if (op === OP.BINARY) this.emit("binary", full);
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
    this._sendRaw(encodeFrame(OP.TEXT, s));
  }

  sendJSON(obj) { this.sendText(JSON.stringify(obj)); }

  sendPing(payload = Buffer.alloc(0)) {
    if (this.closed) return;
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
