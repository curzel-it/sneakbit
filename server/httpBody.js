// Buffer a request body, size-cap it, and JSON.parse it. The relay has no
// body parsing today (it's WS + GET endpoints), so the auth POST/PATCH
// handlers need this. Errors are tagged with a `code` so the caller can map
// them to the right HTTP status instead of a blanket 500.

export function readJsonBody(req, { maxBytes = 64 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks = [];
    req.on("data", (chunk) => {
      if (over) return; // already rejected — draining the rest
      size += chunk.length;
      if (size > maxBytes) {
        over = true;
        chunks.length = 0;
        // Drain (don't destroy) the remaining upload so the caller can still
        // write a clean 413 response on the same connection.
        req.resume();
        reject(Object.assign(new Error("request body too large"), { code: "BODY_TOO_LARGE" }));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = chunks.length ? Buffer.concat(chunks).toString("utf8").trim() : "";
      if (!raw) { resolve({}); return; }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error("invalid JSON body"), { code: "BAD_JSON" }));
      }
    });
    req.on("error", (err) => reject(err));
  });
}
