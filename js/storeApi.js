// Thin fetch wrappers over the /store endpoints. Same normalized result shape
// as accountApi.js — NEVER throws, so callers don't try/catch the network:
//
//   { ok, status, data, error, offline }
//
// The browser never loads Stripe.js: createCheckout returns a hosted-Checkout
// URL the caller redirects to. Prices/identity are the server's job; this layer
// only carries the sku + chosen currency.

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

export const fetchCatalog = () => request("/store/catalog");
export const createCheckout = (token, { sku, currency }) =>
  request("/store/checkout", { method: "POST", body: { sku, currency }, token });
export const fetchEntitlements = (token) => request("/store/entitlements", { token });
