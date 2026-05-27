// Minimal WebSocket client for tests. Speaks just enough of RFC 6455 to
// drive the relay: HTTP upgrade, masked text frames, recv parsing, close.

import { connect } from "node:net";
import { createHash, randomBytes } from "node:crypto";
import { encodeFrame, parseFrames, OP } from "../../server/wsFrames.js";

const MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export function openWsClient(host, port, path = "/ws") {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port }, () => {
      const key = randomBytes(16).toString("base64");
      const expected = createHash("sha1").update(key + MAGIC).digest("base64");
      const req =
        `GET ${path} HTTP/1.1\r\n` +
        `Host: ${host}:${port}\r\n` +
        `Upgrade: websocket\r\n` +
        `Connection: Upgrade\r\n` +
        `Sec-WebSocket-Key: ${key}\r\n` +
        `Sec-WebSocket-Version: 13\r\n\r\n`;
      socket.write(req);

      let buf = Buffer.alloc(0);
      let handshakeDone = false;
      const queue = [];
      const waiters = [];
      let closed = false;
      let closeCode = null;
      const closeWaiters = [];

      function deliver(msg) {
        const w = waiters.shift();
        if (w) w.resolve(msg);
        else queue.push(msg);
      }

      function finishClose(code) {
        if (closed) return;
        closed = true;
        closeCode = code;
        for (const w of waiters.splice(0)) w.reject(new Error("closed " + code));
        for (const w of closeWaiters.splice(0)) w.resolve(code);
        try { socket.destroy(); } catch { /* ignore */ }
      }

      socket.on("data", (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        if (!handshakeDone) {
          const idx = buf.indexOf("\r\n\r\n");
          if (idx < 0) return;
          const head = buf.slice(0, idx).toString("utf8");
          if (!head.startsWith("HTTP/1.1 101")) {
            reject(new Error("handshake failed: " + head));
            socket.destroy();
            return;
          }
          if (!head.includes(expected)) {
            reject(new Error("handshake bad accept"));
            socket.destroy();
            return;
          }
          buf = buf.slice(idx + 4);
          handshakeDone = true;
          resolve(client);
        }
        let parsed;
        try { parsed = parseFrames(buf); }
        catch { finishClose(1009); return; }
        buf = parsed.rest;
        for (const f of parsed.frames) {
          if (f.opcode === OP.TEXT) {
            try { deliver(JSON.parse(f.payload.toString("utf8"))); }
            catch { /* malformed JSON, drop */ }
          } else if (f.opcode === OP.CLOSE) {
            const code = f.payload.length >= 2 ? f.payload.readUInt16BE(0) : 1005;
            finishClose(code);
          }
        }
      });

      socket.on("close", () => finishClose(closeCode ?? 1006));
      socket.on("error", () => finishClose(closeCode ?? 1006));

      const client = {
        send(obj) {
          if (closed) throw new Error("closed");
          const frame = encodeFrame(OP.TEXT, JSON.stringify(obj), { mask: true });
          socket.write(frame);
        },
        recv(timeout = 1500) {
          if (queue.length) return Promise.resolve(queue.shift());
          if (closed) return Promise.reject(new Error("closed " + closeCode));
          return new Promise((res, rej) => {
            const t = setTimeout(() => {
              const i = waiters.indexOf(entry);
              if (i >= 0) waiters.splice(i, 1);
              rej(new Error("recv timeout"));
            }, timeout);
            const entry = {
              resolve: (v) => { clearTimeout(t); res(v); },
              reject: (e) => { clearTimeout(t); rej(e); },
            };
            waiters.push(entry);
          });
        },
        waitClose(timeout = 2000) {
          if (closed) return Promise.resolve(closeCode);
          return new Promise((res, rej) => {
            const t = setTimeout(() => rej(new Error("waitClose timeout")), timeout);
            closeWaiters.push({
              resolve: (code) => { clearTimeout(t); res(code); },
            });
          });
        },
        close() { try { socket.end(); } catch { /* ignore */ } finishClose(1000); },
        get isClosed() { return closed; },
        get closeCode() { return closeCode; },
      };
    });
    socket.once("error", reject);
  });
}
