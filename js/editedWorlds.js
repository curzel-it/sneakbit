// Client side of server-backed creative-mode worlds. Replaces the old
// IndexedDB override buffer (zoneBuffer.js): edited worlds now live on the
// server as one JSON file per zone, fetched fresh each session and held only in
// data.js's in-memory cache. The matching server endpoints are in
// server/editingRoutes.js (bearer-authenticated, editor-only).
//
// Every call is token-aware and never throws: when the user isn't signed in (or
// isn't an editor, or is offline) loads resolve to null and saves are no-ops, so
// non-editors fall through to the shipped ./data/<id>.json exactly as before.

import { pickApiBase } from "./apiBase.js";
import { getToken } from "./accountSession.js";

async function request(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  try {
    return await fetch(`${pickApiBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return null; // offline — caller treats as "no override"
  }
}

// Raw zone JSON for `id` from the server, or null when nothing is stored (204),
// the user can't edit, or we're offline. data.js falls back to shipped data on
// null.
export async function loadEditedWorld(id) {
  const token = getToken();
  if (!token) return null;
  const res = await request(`/editing/${id}`, { token });
  if (!res || res.status === 204 || !res.ok) return null;
  try {
    const data = await res.json();
    return data?.blob ?? null;
  } catch {
    return null;
  }
}

// Fire-and-forget overwrite of the world for `id`. No-op when signed out — the
// server would 401/403 anyway. Returns true on a confirmed 200, else false.
export async function saveEditedWorld(id, raw) {
  const token = getToken();
  if (!token) return false;
  const res = await request(`/editing/${id}`, { method: "PUT", body: { blob: raw }, token });
  return !!res && res.ok;
}

// Revert the world for `id` to shipped (deletes the server file).
export async function revertEditedWorld(id) {
  const token = getToken();
  if (!token) return false;
  const res = await request(`/editing/${id}`, { method: "DELETE", token });
  return !!res && res.ok;
}

// Ids of all stored worlds, or [] when unavailable.
export async function listEditedWorlds() {
  const token = getToken();
  if (!token) return [];
  const res = await request(`/editing`, { token });
  if (!res || !res.ok) return [];
  try {
    const data = await res.json();
    return Array.isArray(data?.ids) ? data.ids : [];
  } catch {
    return [];
  }
}
