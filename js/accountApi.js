// Thin fetch wrappers over the 6 auth endpoints. Every call resolves to a
// normalized result object — it NEVER throws, so callers don't have to
// try/catch the network. Offline / network errors come back as
// { ok:false, offline:true }; HTTP errors carry { ok:false, status, error }.
//
//   { ok, status, data, error, offline }

import { pickApiBase } from "./apiBase.js";

async function request(path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers["authorization"] = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${pickApiBase()}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    return { ok: false, offline: true, error: "offline", data: {} };
  }
  let data = {};
  try { data = (await res.json()) || {}; } catch { /* non-JSON / empty */ }
  return {
    ok: res.ok,
    status: res.status,
    data,
    error: res.ok ? null : (data.error || `http_${res.status}`),
  };
}

export const registerAccount = (body) => request("/auth/register", { method: "POST", body });
export const loginAccount = (body) => request("/auth/login", { method: "POST", body });
export const fetchMe = (token) => request("/auth/me", { token });
export const updateMe = (token, body) => request("/auth/me", { method: "PATCH", body, token });
export const forgotPassword = (body) => request("/auth/forgot-password", { method: "POST", body });
export const resetPassword = (body) => request("/auth/reset-password", { method: "POST", body });
