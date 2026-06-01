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
import { serializeBlob, applyBlob, hasLocalProgress } from "./saveBlob.js";
import { onStorageChange } from "./storage.js";
import { onBindingsChange } from "./keyBindings.js";
import { onGamepadBindingsChange } from "./gamepadBindings.js";

const META_KEY = "sneakbit.cloudsave.v1";
const DEBOUNCE_MS = 4000;

let installed = false;
let pushTimer = null;
let prevHash = null;     // last hash we've observed (seeded from lastHash)
let syncing = false;

// — Pure conflict decision (unit-tested) ——————————————————————————————————
// Returns one of: "seed" | "push" | "pull" | "insync" | "noop".
export function decideSync({ cloud, local, meta }) {
  if (!cloud) return local.hasProgress ? "seed" : "noop";
  if (cloud.hash === local.hash) return "insync";
  const localChanged = local.hash !== meta.lastHash;
  const cloudAdvanced = cloud.rev !== meta.rev;
  if (!localChanged) return "pull";          // local untouched since last sync
  if (!cloudAdvanced) return "push";         // we're strictly ahead of the cloud
  if (meta.rev == null) return "pull";       // never synced here → adopt the account
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
  if (isSignedIn()) reconcile().catch(() => {});
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
  const r = await getCloudSave(token);
  if (r.offline || r.status === 401) return;
  const blob = safeSerialize();
  if (!blob) return;
  const local = { hash: hashBlob(blob), hasProgress: hasLocalProgress() };
  const meta = readMeta();
  const cloud = (r.status === 204 || !r.data) ? null
    : { rev: r.data.rev, updatedAt: r.data.updatedAt, hash: hashBlob(r.data.blob), blob: r.data.blob };

  switch (decideSync({ cloud, local, meta })) {
    case "seed":
    case "push":
      await pushIfDirty();
      break;
    case "pull":
      pull(cloud);
      break;
    case "insync":
      adoptCloudMeta(cloud, local.hash);
      break;
    default: /* noop */ break;
  }
}

async function pushIfDirty() {
  if (syncing) return;
  const token = getToken();
  if (!token) return;
  const blob = safeSerialize();
  if (!blob) return;
  const localHash = hashBlob(blob);
  const meta = readMeta();
  if (localHash === meta.lastHash) return; // nothing to push
  syncing = true;
  try {
    const updatedAt = meta.localUpdatedAt || Date.now();
    const r = await putCloudSave(token, { blob, updatedAt, baseRev: meta.rev ?? 0 });
    if (r.offline || r.status === 401) return;
    if (r.status === 409 && r.data) { await resolveConflict(r.data, blob, localHash); return; }
    if (r.ok && r.data) {
      writeMeta({ rev: r.data.rev, updatedAt: r.data.updatedAt, lastHash: localHash, localUpdatedAt: r.data.updatedAt });
      prevHash = localHash;
    }
  } finally {
    syncing = false;
  }
}

// 409: the cloud advanced under us. Newest-wins against the returned copy.
async function resolveConflict(cloud, localBlob, localHash) {
  const cloudHash = hashBlob(cloud.blob);
  if (cloudHash === localHash) { adoptCloudMeta(cloud, localHash); return; }
  const meta = readMeta();
  if ((meta.localUpdatedAt || 0) > cloud.updatedAt) {
    // Local is newer — re-push on top of the cloud's current rev.
    const r = await putCloudSave(getToken(), { blob: localBlob, updatedAt: meta.localUpdatedAt, baseRev: cloud.rev });
    if (r.ok && r.data) {
      writeMeta({ rev: r.data.rev, updatedAt: r.data.updatedAt, lastHash: localHash, localUpdatedAt: r.data.updatedAt });
      prevHash = localHash;
    }
  } else {
    pull(cloud);
  }
}

function pull(cloud) {
  if (!cloud) return;
  applyBlob(cloud.blob);
  writeMeta({ rev: cloud.rev, updatedAt: cloud.updatedAt, lastHash: hashBlob(cloud.blob), localUpdatedAt: cloud.updatedAt });
  prevHash = null;
  if (typeof location !== "undefined") location.reload();
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
  // beforeunload: fire-and-forget; pushIfDirty uses keepalive via saveApi if
  // we ever pass it, but a normal fetch with the page closing is best-effort.
  if (isSignedIn()) pushIfDirty().catch(() => {});
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
