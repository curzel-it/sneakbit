// Client mirror of server entitlements. The server is authoritative; this
// reconciles the signed-in user's active entitlements into local skin
// ownership so a purchase shows as Owned and survives New Game / Clear Cache
// (the account survives, so boot-time reconcile re-applies the grants).
//
// Mirrors cloudSave.js's reconcile shape. A local "entitled-set" cache records
// which skins we own *via entitlement* (as opposed to coins), so a later refund
// removes only those — coin-bought skins are never in the set and stay put.
//
// The cache is a small JSON array of refIds in its own localStorage key (NOT
// the int-only storage.js KV, which can't hold a list, and NOT cloud-synced —
// entitlements are re-fetched from the server on every boot).

import { fetchEntitlements } from "./storeApi.js";
import { markOwned, markUnowned } from "./skins.js";

const CACHE_KEY = "sneakbit.store.entitled.v1";

// Pure diff (unit-testable, no DOM): given the active skin refIds from the
// server and the refIds previously in our entitled-set, return what to grant
// and what to revoke. toGrant is the full active set (markOwned is idempotent);
// toRevoke is anything we had entitled that's no longer active (a refund).
export function diffEntitlements(activeRefIds, cachedRefIds) {
  const active = new Set(activeRefIds);
  const cached = new Set(cachedRefIds);
  const toGrant = [...active];
  const toRevoke = [...cached].filter((r) => !active.has(r));
  return { toGrant, toRevoke };
}

function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch { return []; }
}

function writeCache(refIds) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify([...new Set(refIds)])); }
  catch { /* no/blocked localStorage */ }
}

// Fetch the user's active entitlements and apply the diff to local skin
// ownership. Returns { ok, granted, revoked } — never throws. Offline / 5xx
// leaves local ownership untouched (we don't strip skins on a transient error).
export async function reconcile(token) {
  if (!token) return { ok: false, granted: [], revoked: [] };
  const r = await fetchEntitlements(token);
  if (!r.ok || !Array.isArray(r.data?.entitlements)) {
    return { ok: false, granted: [], revoked: [] };
  }
  const activeRefIds = r.data.entitlements
    .filter((e) => e && e.kind === "skin" && typeof e.refId === "string")
    .map((e) => e.refId);

  const { toGrant, toRevoke } = diffEntitlements(activeRefIds, readCache());
  for (const refId of toGrant) markOwned(refId);
  for (const refId of toRevoke) markUnowned(refId);
  writeCache(activeRefIds);
  return { ok: true, granted: toGrant, revoked: toRevoke };
}

// Test seam — clear the local entitled-set cache.
export function _clearEntitledCacheForTesting() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* ignore */ }
}
