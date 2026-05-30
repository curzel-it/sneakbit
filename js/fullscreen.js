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
