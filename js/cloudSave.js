// Cloud-save orchestrator. Pulls on sign-in, debounced-pushes on progress
// change, and resolves conflicts by newest-wins. Strictly offline-tolerant:
// every network step is best-effort and silent on failure, retried on the
// next trigger; nothing here blocks gameplay.
//
// Conflict model (newest-wins) is decided by the pure decideSync() below so
// it's unit-testable without a DOM. The two subtleties it encodes:
//   * a device that has NEVER synced this account adopts the cloud (so a new
//     device pulls the account's progress instead of clobbering it with a
//     fresh start);
//   * once a device has synced, divergence is resolved by comparing the
//     local change time against the cloud's updated_at.
//
// Local sync state lives in `sneakbit.cloudsave.v1`: { rev, updatedAt,
// lastHash, localUpdatedAt }. lastHash is the canonical hash of the blob at
// the last successful sync; localUpdatedAt is bumped only when local content
// genuinely diverges from lastHash (so a boot re-save of identical progress
// doesn't look like a new change).

import { getToken, isSignedIn, onAccountChange } from "./accountSession.js";
import { getCloudSave, putCloudSave } from "./saveApi.js";
import { serializeBlob, applyBlob, hasLocalProgress, hasMeaningfulProgress } from "./saveBlob.js";
import { onStorageChange } from "./storage.js";
import { onBindingsChange } from "./keyBindings.js";
import { onGamepadBindingsChange } from "./gamepadBindings.js";
import { showToast } from "./toast.js";
import { askCloudConflict } from "./cloudConflictPrompt.js";

const META_KEY = "sneakbit.cloudsave.v1";
// Session flag set by the menu's "Clear cache" before it wipes localStorage +
// reloads. It tells the next boot to pull the account's cloud save and apply it
// *before* any state is built, so the player never sees a fresh new game flash
// and then get replaced a beat later when the cloud copy lands. sessionStorage
// (not localStorage) so it survives the reload but never leaks past it.
const BOOT_RESTORE_KEY = "sneakbit.cloudRestorePending";
const DEBOUNCE_MS = 4000;
const BOOT_RESTORE_TIMEOUT_MS = 5000;

let installed = false;
let pushTimer = null;
let prevHash = null;     // last hash we've observed (seeded from lastHash)
let syncing = false;
let suppressPullReload = false; // boot-restore applies inline; the boot rehydrates without a reload

// — Pure conflict decision (unit-tested) ——————————————————————————————————
// Returns one of: "seed" | "push" | "pull" | "conflict" | "insync" | "noop".
export function decideSync({ cloud, local, meta }) {
  if (!cloud) return local.hasProgress ? "seed" : "noop";
  if (cloud.hash === local.hash) return "insync";
  const localChanged = local.hash !== meta.lastHash;
  const cloudAdvanced = cloud.rev !== meta.rev;
  if (!localChanged) return "pull";          // local untouched since last sync
  if (!cloudAdvanced) return "push";         // we're strictly ahead of the cloud
  if (meta.rev == null) {
    // First sign-in on this device: it has never synced this account. If local
    // is just a fresh-boot default, adopt the account (the common new-device
    // case). But if local holds genuine offline progress that differs from the
    // account's save, we can't pick a winner without risking real data loss —
    // surface it as a conflict for the caller to resolve (ask the player).
    return local.meaningful ? "conflict" : "pull";
  }
  return (meta.localUpdatedAt || 0) > cloud.updatedAt ? "push" : "pull"; // newest wins
}

export function installCloudSave() {
  if (installed) return;
  installed = true;
  prevHash = readMeta().lastHash ?? null;
  onStorageChange(markDirty);
  onBindingsChange(markDirty);
  onGamepadBindingsChange(markDirty);
  onAccountChange((user) => { if (user) reconcile().catch(() => {}); else onSignedOut(); });
  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", () => { try { flush(); } catch { /* ignore */ } });
    // Debug / e2e hook (mirrors window.coop / window.save).
    window.cloudSave = {
      markDirty,
      flush: () => pushIfDirty(),
      reconcile: () => reconcile(),
      meta: () => readMeta(),
    };
  }
  // Skip the fire-and-forget boot reconcile when a clear-cache restore is
  // pending: main() drives an awaited bootRestoreFromCloud() instead, and two
  // concurrent reconciles would race the `syncing` lock.
  if (isSignedIn() && !bootRestorePending()) reconcile().catch(() => {});
}

// True when the previous page told us (via the menu's Clear cache) to restore
// from the cloud on this boot. Peeks without consuming — bootRestoreFromCloud
// is what clears it.
function bootRestorePending() {
  try { return sessionStorage.getItem(BOOT_RESTORE_KEY) === "1"; } catch { return false; }
}

// Boot-time restore for the Clear-cache path. When the previous page set the
// pending flag and we're signed in, fetch the account's cloud save and apply it
// inline (NO reload) so the very first state main() builds is the restored one.
// Best-effort and bounded: offline, signed-out, no cloud save, or a slow
// network all just resolve false and the normal fresh start proceeds. The flag
// is consumed unconditionally so a stuck flag can't wedge every future boot.
export async function bootRestoreFromCloud() {
  const pending = bootRestorePending();
  try { sessionStorage.removeItem(BOOT_RESTORE_KEY); } catch { /* ignore */ }
  if (!pending || !isSignedIn() || syncing) return false;
  const token = getToken();
  if (!token) return false;
  syncing = true;
  try {
    const r = await withTimeout(getCloudSave(token), BOOT_RESTORE_TIMEOUT_MS);
    if (!r || r.offline || r.status === 401) return false;
    if (r.status === 204 || !r.data) return false; // no cloud save → fresh start
    const cloud = { rev: r.data.rev, updatedAt: r.data.updatedAt, hash: hashBlob(r.data.blob), blob: r.data.blob };
    // localStorage was just wiped, so cloud is unambiguously authoritative.
    suppressPullReload = true;
    try { pull(cloud); } finally { suppressPullReload = false; }
    return hasLocalProgress();
  } catch { return false; }
  finally { syncing = false; }
}

// Resolve to the promise's value, or null if it doesn't settle within `ms`, so a
// hung network call can never block boot indefinitely. A late resolution is
// harmless: the boot has already moved on and the result is ignored.
function withTimeout(promise, ms) {
  return new Promise((resolve) => {
    let done = false;
    const settle = (v) => { if (!done) { done = true; clearTimeout(t); resolve(v); } };
    const t = setTimeout(() => settle(null), ms);
    promise.then(settle, () => settle(null));
  });
}

// Called on any local progress change (kv writes, rebinds, language).
export function markDirty() {
  noteLocalChange();
  if (!isSignedIn()) return;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => { pushTimer = null; pushIfDirty().catch(() => {}); }, DEBOUNCE_MS);
}

// — Sync steps ——————————————————————————————————————————————————————————

async function reconcile() {
  if (syncing) return;
  const token = getToken();
  if (!token) return;
  // Hold the lock across the whole GET → decide → act so a debounced push
  // can't interleave with the pull/seed decision and race the meta writes.
  syncing = true;
  try {
    const r = await getCloudSave(token);
    if (r.offline || r.status === 401) return;
    const blob = safeSerialize();
    if (!blob) return;
    const local = { hash: hashBlob(blob), hasProgress: hasLocalProgress(), meaningful: hasMeaningfulProgress() };
    const meta = readMeta();
    const cloud = (r.status === 204 || !r.data) ? null
      : { rev: r.data.rev, updatedAt: r.data.updatedAt, hash: hashBlob(r.data.blob), blob: r.data.blob };

    switch (decideSync({ cloud, local, meta })) {
      case "seed":
      case "push":
        await doPush();
        break;
      case "pull":
        pull(cloud);
        break;
      case "conflict":
        await resolveFirstSignInConflict(cloud);
        break;
      case "insync":
        adoptCloudMeta(cloud, local.hash);
        break;
      default: /* noop */ break;
    }
  } finally {
    syncing = false;
  }
}

async function pushIfDirty(opts = {}) {
  if (syncing) return;
  syncing = true;
  try { await doPush(opts); }
  finally { syncing = false; }
}

// The actual push, assuming the caller holds the `syncing` lock. Both the
// debounced pushIfDirty and reconcile call this so the lock is never taken
// twice (which would self-deadlock the guard).
async function doPush(opts = {}) {
  const token = getToken();
  if (!token) return;
  const blob = safeSerialize();
  if (!blob) return;
  const localHash = hashBlob(blob);
  const meta = readMeta();
  if (localHash === meta.lastHash) return; // nothing to push
  const updatedAt = meta.localUpdatedAt || Date.now();
  const r = await putCloudSave(token, { blob, updatedAt, baseRev: meta.rev ?? 0 }, opts);
  if (r.offline || r.status === 401) return;
  if (r.status === 409 && r.data) { await resolveConflict(r.data, blob, localHash, opts); return; }
  if (r.ok && r.data) {
    writeMeta({ rev: r.data.rev, updatedAt: r.data.updatedAt, lastHash: localHash, localUpdatedAt: r.data.updatedAt });
    prevHash = localHash;
  }
}

// 409: the cloud advanced under us. Newest-wins against the returned copy.
async function resolveConflict(cloud, localBlob, localHash, opts = {}) {
  const cloudHash = hashBlob(cloud.blob);
  if (cloudHash === localHash) { adoptCloudMeta(cloud, localHash); return; }
  const meta = readMeta();
  if ((meta.localUpdatedAt || 0) > cloud.updatedAt) {
    // Local is newer — re-push on top of the cloud's current rev.
    const r = await putCloudSave(getToken(), { blob: localBlob, updatedAt: meta.localUpdatedAt, baseRev: cloud.rev }, opts);
    if (r.ok && r.data) {
      writeMeta({ rev: r.data.rev, updatedAt: r.data.updatedAt, lastHash: localHash, localUpdatedAt: r.data.updatedAt });
      prevHash = localHash;
    }
  } else {
    pull(cloud);
  }
}

// First sign-in where this device already has genuine offline progress that
// differs from the account's save. Neither side is safe to discard silently,
// so ask the player. "local" keeps this device (push it up onto the account);
// "cloud" / no UI adopts the account (the historical safe default — pull).
async function resolveFirstSignInConflict(cloud) {
  if (!cloud) return;
  let choice = null;
  try { choice = await askCloudConflict(); } catch { choice = null; }
  if (choice === "local") {
    // Keep this device. Stamp the cloud's rev as our base so the push lands as
    // an update rather than tripping a 409 against the existing account save.
    const blob = safeSerialize();
    if (blob) writeMeta({ rev: cloud.rev, updatedAt: cloud.updatedAt, lastHash: null, localUpdatedAt: Date.now() });
    await doPush();
    return;
  }
  // "cloud" or no UI available → adopt the account.
  pull(cloud);
}

function pull(cloud) {
  if (!cloud) return;
  // Storage becomes cloud-authoritative immediately; the reload lets every
  // module rehydrate from it. Applying-then-reloading is kept atomic-ish on
  // purpose — if we let the running session keep going on stale in-memory
  // state it could write it back over what we just pulled.
  applyBlob(cloud.blob);
  writeMeta({ rev: cloud.rev, updatedAt: cloud.updatedAt, lastHash: hashBlob(cloud.blob), localUpdatedAt: cloud.updatedAt });
  prevHash = null;
  // Boot-restore applies inline and lets main() build state straight off the
  // freshly-written storage — no reload needed (and a reload mid-boot would be
  // jarring rather than the "synced from another device" mid-play case below).
  if (suppressPullReload) return;
  reloadForPull();
}

// A pull replaces local progress with a newer copy from another device, which
// means a page reload. Rather than a silent yank mid-play, explain it with a
// toast and reload on the next safe moment: instantly if the tab is hidden
// (the player is away — ideal), otherwise after a short beat so the message
// paints. The window before reload is tiny, so the running session has no real
// chance to write stale state back over the pulled save.
function reloadForPull() {
  if (typeof location === "undefined") return; // tests / non-browser
  const doReload = () => { try { location.reload(); } catch { /* ignore */ } };
  const hidden = typeof document !== "undefined" && document.visibilityState === "hidden";
  try { showToast("Synced newer progress from another device.", "longHint"); } catch { /* ignore */ }
  if (hidden) { doReload(); return; }
  setTimeout(doReload, 1200);
}

function onSignedOut() {
  // Drop the sync lineage so a different account signing in next is treated
  // as a fresh adoption. Local progress itself is left untouched.
  writeMeta({});
  prevHash = null;
}

// — Helpers ————————————————————————————————————————————————————————————

// Stamp localUpdatedAt only when content genuinely diverges from the synced
// baseline, so a boot re-save of identical progress doesn't look new.
function noteLocalChange() {
  const blob = safeSerialize();
  if (!blob) return;
  const h = hashBlob(blob);
  if (h === prevHash) return;
  prevHash = h;
  const meta = readMeta();
  if (h !== meta.lastHash) { meta.localUpdatedAt = Date.now(); writeMeta(meta); }
}

function flush() {
  // beforeunload: fire-and-forget. keepalive:true keeps the final PUT alive
  // through page teardown (a normal fetch is killed when the tab closes), so
  // the last bit of progress lands instead of waiting for the next load.
  if (isSignedIn()) pushIfDirty({ keepalive: true }).catch(() => {});
}

function adoptCloudMeta(cloud, localHash) {
  writeMeta({ rev: cloud.rev, updatedAt: cloud.updatedAt, lastHash: localHash, localUpdatedAt: cloud.updatedAt });
  prevHash = localHash;
}

function safeSerialize() {
  try { return serializeBlob(); } catch { return null; }
}

function readMeta() {
  try { return JSON.parse(localStorage.getItem(META_KEY)) || {}; } catch { return {}; }
}

function writeMeta(m) {
  try { localStorage.setItem(META_KEY, JSON.stringify(m)); } catch { /* ignore */ }
}

// Order-independent hash so a blob round-tripped through the server (which
// may reorder object keys) compares equal to the local one.
function canonical(v) {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  const keys = Object.keys(v).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",") + "}";
}

function hashBlob(blob) {
  const s = canonical(blob);
  let h = 0x811c9dc5 >>> 0; // FNV-1a 32-bit
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16);
}
