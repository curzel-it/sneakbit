// Creative-mode edited-world endpoints (bearer-authenticated, editor-only).
// Mirrors savesRoutes.js: createEditingHandler() wires the db + editor allowlist
// + filesystem store into one async dispatcher that index.js calls for
// /editing (CORS applied by the caller).
//
//   GET    /editing            -> {ids:[...]}            (list stored worlds)
//   GET    /editing/<id>       -> {blob}                 | 204 if none
//   PUT    /editing/<id>  {blob} -> {ok:true}            (overwrite; last-write-wins)
//   DELETE /editing/<id>       -> {ok:true}              (revert to shipped)
//
// Unlike saves there's no `rev` handshake — editing is a single-author workflow,
// so PUT simply overwrites. Auth is two-step: a valid bearer token AND an email
// on the editor allowlist; a signed-in non-editor gets 403.

import { authenticateUser } from "./bearerAuth.js";
import { isEditor } from "./editors.js";
import { getEdited, putEdited, deleteEdited, listEdited } from "./editingStore.js";
import { readJsonBody } from "./httpBody.js";
import { log } from "./logger.js";

const MAX_BLOB_BYTES = 2 * 1024 * 1024;

export function createEditingHandler({ db, env = process.env } = {}) {
  async function handle(req, res) {
    if (!env.JWT_SECRET) return json(res, 503, { error: "auth_unavailable" });
    const path = pathOf(req.url);
    if (path !== "/editing" && !path.startsWith("/editing/")) {
      return json(res, 404, { error: "not_found" });
    }
    const user = authenticateUser(req, { db, secret: env.JWT_SECRET });
    if (!user) return json(res, 401, { error: "unauthorized" });
    if (!isEditor(user.email, env)) return json(res, 403, { error: "not_editor" });

    const id = path === "/editing" ? null : decodeURIComponent(path.slice("/editing/".length));
    try {
      if (id === null) {
        if (req.method === "GET") return json(res, 200, { ids: listEdited(env) });
        return json(res, 405, { error: "method_not_allowed" });
      }
      if (req.method === "GET") return getOne(res, id, env);
      if (req.method === "PUT") return await putOne(req, res, id, env);
      if (req.method === "DELETE") return deleteOne(res, id, env);
      return json(res, 405, { error: "method_not_allowed" });
    } catch (err) {
      if (err?.code === "BAD_ID") return json(res, 400, { error: "invalid_id" });
      if (err?.code === "BODY_TOO_LARGE") return json(res, 413, { error: "too_large" });
      if (err?.code === "BAD_JSON") return json(res, 400, { error: "bad_json" });
      log.error("editing.handlerError", { err: err?.message || String(err) });
      return json(res, 500, { error: "server_error" });
    }
  }

  function getOne(res, id, env) {
    const blob = getEdited(id, env);
    if (blob == null) { res.writeHead(204); res.end(); return; }
    return json(res, 200, { blob });
  }

  async function putOne(req, res, id, env) {
    const body = await readJsonBody(req, { maxBytes: MAX_BLOB_BYTES });
    if (!body || typeof body.blob !== "object" || body.blob === null) {
      return json(res, 400, { error: "invalid_blob" });
    }
    if (Buffer.byteLength(JSON.stringify(body.blob), "utf8") > MAX_BLOB_BYTES) {
      return json(res, 413, { error: "too_large" });
    }
    putEdited(id, body.blob, env);
    return json(res, 200, { ok: true });
  }

  function deleteOne(res, id, env) {
    deleteEdited(id, env);
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
