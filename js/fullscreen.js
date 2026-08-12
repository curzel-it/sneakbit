// Fullscreen toggle. Thin wrapper over the Fullscreen API with the WebKit
// prefix fallback older Safari still needs. The actual canvas re-sizing is
// js/zoom.js's job — it already listens for `resize`, which the browser
// fires on fullscreen enter/exit, so there's nothing to do here but flip
// the state.
//
// Not every browser exposes element fullscreen (notably iOS Safari, which
// only fullscreens <video>). isFullscreenSupported() lets the menu hide the
// button rather than show one that does nothing.

const docEl = () => document.documentElement;

export function isFullscreenSupported() {
  if (typeof document === "undefined") return false;
  const el = docEl();
  return !!(el.requestFullscreen || el.webkitRequestFullscreen);
}

export function isFullscreen() {
  if (typeof document === "undefined") return false;
  return !!(document.fullscreenElement || document.webkitFullscreenElement);
}

function request() {
  const el = docEl();
  if (el.requestFullscreen) return el.requestFullscreen();
  if (el.webkitRequestFullscreen) return el.webkitRequestFullscreen();
}

function exit() {
  if (document.exitFullscreen) return document.exitFullscreen();
  if (document.webkitExitFullscreen) return document.webkitExitFullscreen();
}

// Returns a promise so callers can react to a rejected request (some
// browsers reject when not driven by a user gesture). Swallows the
// rejection — a failed fullscreen toggle should never break the menu.
export function toggleFullscreen() {
  try {
    return Promise.resolve(isFullscreen() ? exit() : request()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

// Fullscreen never survives a navigation: the browser drops it on unload,
// and several flows deliberately reload the page (New game and Clear cache
// both wipe localStorage then re-enter via location.replace; a language
// change reloads). The player who started a new game from a fullscreen
// session used to land back in a window.
//
// So: remember that we were fullscreen on the way out, and re-enter on the
// way back in. The flag lives in sessionStorage, scoped to this tab and
// gone when it closes, so a fresh tab never fullscreens itself unasked.
const RESTORE_KEY = "sneakbit.fullscreen.restore";

// Set while a restore is owed but hasn't landed yet. Boot can chain several
// reloads (cloud restore, native save mirror, legacy import) before the game
// even starts, and each one is another unload — so the flag has to survive
// them instead of being consumed by the first boot that reads it.
let restorePending = false;

export function installFullscreenRestore() {
  if (typeof window === "undefined") return;
  installEscapeCapture();
  try { restorePending = sessionStorage.getItem(RESTORE_KEY) === "1"; } catch { /* ignore */ }
  window.addEventListener("pagehide", () => {
    try {
      if (isFullscreen() || restorePending) sessionStorage.setItem(RESTORE_KEY, "1");
      else sessionStorage.removeItem(RESTORE_KEY);
    } catch { /* private mode — restoring fullscreen is best-effort */ }
  });
  if (!restorePending) return;
  // A page load carries no user activation, so browsers reject the request
  // outright. Ask anyway (shells that allow it re-enter with no visible
  // gap), then fall back to the first real gesture — which, mid-game, is
  // the player's very next keypress or tap.
  attemptRestore().then((ok) => { if (!ok) armGestureRetry(); });
}

function attemptRestore() {
  return Promise.resolve()
    .then(request)
    .catch(() => {})
    .then(() => {
      const ok = isFullscreen();
      if (ok) settleRestore();
      return ok;
    });
}

function settleRestore() {
  restorePending = false;
  try { sessionStorage.removeItem(RESTORE_KEY); } catch { /* ignore */ }
}

function armGestureRetry() {
  const onGesture = () => {
    window.removeEventListener("keydown", onGesture, true);
    window.removeEventListener("pointerdown", onGesture, true);
    // One shot: if the player's own gesture can't get us back to fullscreen,
    // stop owing it rather than retrying forever on every input.
    attemptRestore().then(settleRestore);
  };
  window.addEventListener("keydown", onGesture, true);
  window.addEventListener("pointerdown", onGesture, true);
}

// Escape is the pause-menu key (menu.js), but in fullscreen the browser
// claims it for itself: the player pressing Esc to open the menu dropped
// out of fullscreen instead, and the menu never showed. The Keyboard Lock
// API routes Esc to the page while we're fullscreen; the browser keeps
// press-and-hold Esc as the escape hatch, so there's no way to trap
// someone. Chromium-only — where navigator.keyboard is missing (Safari,
// Firefox) nothing changes and Esc keeps exiting fullscreen.
//
// The lock only applies while the document is fullscreen, so it's taken
// and released off fullscreenchange rather than held for the session.
function installEscapeCapture() {
  if (!navigator?.keyboard?.lock) return;
  onFullscreenChange(syncEscapeLock);
  syncEscapeLock();
}

function syncEscapeLock() {
  const kb = navigator?.keyboard;
  if (!kb?.lock) return;
  try {
    // lock() rejects when the request can't be honoured (no user
    // activation, not a top-level context) — that just leaves Esc on its
    // default behaviour, which is what we had before.
    if (isFullscreen()) Promise.resolve(kb.lock(["Escape"])).catch(() => {});
    else kb.unlock();
  } catch { /* ignore — best-effort */ }
}

// Subscribe to enter/exit so the menu label can stay in sync. Returns an
// unsubscribe function. Covers both the standard and WebKit event names.
export function onFullscreenChange(fn) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("fullscreenchange", fn);
  document.addEventListener("webkitfullscreenchange", fn);
  return () => {
    document.removeEventListener("fullscreenchange", fn);
    document.removeEventListener("webkitfullscreenchange", fn);
  };
}
