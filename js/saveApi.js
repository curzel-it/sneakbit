// Thin fetch wrappers for the cloud-save endpoints. Like accountApi, these
// never throw — offline/network errors come back as { ok:false, offline:true }.
// `keepalive` is used by the beforeunload flush so a final push survives the
// page teardown.

import { pickApiBase } from "./apiBase.js";

async function request(path, { method = "GET", body, token, keepalive = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${pickApiBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      keepalive,
    });
  } catch {
    return { ok: false, offline: true, error: "offline", data: null };
  }
  if (res.status === 204) return { ok: true, status: 204, data: null };
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON / empty */ }
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : (data?.error || `http_${res.status}`),
  };
}

export const getCloudSave = (token) => request("/saves", { token });
export const putCloudSave = (token, body, opts = {}) =>
  request("/saves", { method: "PUT", body, token, keepalive: opts.keepalive });
export const deleteCloudSave = (token, opts = {}) =>
  request("/saves", { method: "DELETE", token, keepalive: opts.keepalive });
