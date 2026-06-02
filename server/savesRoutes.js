// Cloud-save endpoints (bearer-authenticated, one row per user). Mirrors
// authRoutes.js: createSavesHandler() wires the db + jwt into one async
// dispatcher that index.js calls for /saves (CORS applied by the caller).
//
//   GET    /saves            -> {blob, rev, updatedAt}  | 204 if none
//   PUT    /saves  {blob, updatedAt, baseRev} -> {rev, updatedAt}
//                            | 409 {blob, rev, updatedAt} if baseRev is stale
//   DELETE /saves            -> {ok:true}
//
// Conflict model is newest-wins, resolved on the CLIENT. The server only
// enforces optimistic concurrency via `rev`: a PUT whose baseRev doesn't
// match the stored rev is rejected with the current cloud copy (409) so the
// client can re-run newest-wins instead of silently clobbering.

import { getSave, putSave, deleteSave } from "./db.js";
import { authenticateUser } from "./bearerAuth.js";
import { readJsonBody } from "./httpBody.js";
import { log } from "./logger.js";

const MAX_BLOB_BYTES = 256 * 1024;
// How far ahead of server time a client-supplied updatedAt may sit before we
// distrust it. Newest-wins is resolved on the client's clock; this stops a
// device with a badly-skewed (or malicious) future clock from stamping a
// timestamp that wins every future conflict and clobbers good progress.
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function createSavesHandler({ db, env = process.env } = {}) {
  async function handle(req, res) {
    if (!env.JWT_SECRET) return json(res, 503, { error: "auth_unavailable" });
    if (pathOf(req.url) !== "/saves") return json(res, 404, { error: "not_found" });
    const user = authenticateUser(req, { db, secret: env.JWT_SECRET });
    if (!user) return json(res, 401, { error: "unauthorized" });
    const userId = user.id;
    try {
      if (req.method === "GET") return getSaveHandler(res, userId);
      if (req.method === "PUT") return await putSaveHandler(req, res, userId);
      if (req.method === "DELETE") return deleteSaveHandler(res, userId);
      return json(res, 405, { error: "method_not_allowed" });
    } catch (err) {
      if (err?.code === "BODY_TOO_LARGE") return json(res, 413, { error: "too_large" });
      if (err?.code === "BAD_JSON") return json(res, 400, { error: "bad_json" });
      log.error("saves.handlerError", { err: err?.message || String(err) });
      return json(res, 500, { error: "server_error" });
    }
  }

  function getSaveHandler(res, userId) {
    const row = getSave(db, userId);
    if (!row) { res.writeHead(204); res.end(); return; }
    return json(res, 200, { blob: JSON.parse(row.blob), rev: row.rev, updatedAt: row.updated_at });
  }

  async function putSaveHandler(req, res, userId) {
    const body = await readJsonBody(req, { maxBytes: MAX_BLOB_BYTES });
    if (!body || typeof body.blob !== "object" || body.blob === null) {
      return json(res, 400, { error: "invalid_blob" });
    }
    const blobStr = JSON.stringify(body.blob);
    if (Buffer.byteLength(blobStr, "utf8") > MAX_BLOB_BYTES) return json(res, 413, { error: "too_large" });
    const now = Date.now();
    // Trust the client's updatedAt (newest-wins is its clock's job) but cap a
    // runaway future value to server-now so it can't win conflicts forever.
    let updatedAt = Number.isFinite(body.updatedAt) ? body.updatedAt : now;
    if (updatedAt > now + MAX_CLOCK_SKEW_MS) updatedAt = now;
    const baseRev = Number.isFinite(body.baseRev) ? body.baseRev : 0;

    const existing = getSave(db, userId);
    if (existing && existing.rev !== baseRev) {
      // Another device advanced the save since the client last synced. Hand
      // back the current cloud copy; the client resolves via newest-wins.
      return json(res, 409, { blob: JSON.parse(existing.blob), rev: existing.rev, updatedAt: existing.updated_at });
    }
    const rev = (existing?.rev ?? 0) + 1;
    putSave(db, { userId, blob: blobStr, rev, updatedAt });
    return json(res, 200, { rev, updatedAt });
  }

  function deleteSaveHandler(res, userId) {
    deleteSave(db, userId);
    return json(res, 200, { ok: true });
  }

  return handle;
}

// — Pure helpers ————————————————————————————————————————————————————————

function json(res, status, obj) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj) + "\n");
}

function pathOf(url) {
  const q = url.indexOf("?");
  return q === -1 ? url : url.slice(0, q);
}
