// Transport between the game and the native shells it ships inside — Steam
// (Electron), iOS and Android. Carries two things: the save this build wrote
// to a real file last session, and the save the *pre-rewrite Rust build* left
// behind on the same device.
//
// Read channel — uniform. All three shells already intercept requests for
// their own origin to serve the bundled site (electron/appProtocol.js,
// ios/SneakBit/BundleSchemeHandler.swift, android/…/MainActivity.kt), so the
// boot asks them for one reserved URL and gets everything in a single fetch:
//
//   GET /__native/state.json -> 200 { platform, mirror, legacy }
//
// A 200 *is* the "am I in a native shell?" signal — the shells answer with
// null members rather than 404 when they have nothing. On the plain web
// nothing serves that path, isNativeShell() stays false and every caller
// no-ops. No preload script, no contextBridge, no injected globals.
//
// Write channel — necessarily per-shell. WKWebView drops the request body from
// WKURLSchemeHandler tasks, and Android's WebResourceRequest carries no body at
// all, so only Electron can answer a POST. Each shell uses what it has and
// writeMirror() hides the difference.
//
// Quit channel — Electron only:
//
//   POST /__native/quit -> 204, then the app goes down
//
// It's the one shell command the game sends, and it exists because the desktop
// build is the only one where "leave the game" is the player's job: a browser
// tab can't close itself and both mobile OSes treat a self-terminating app as
// a crash. See js/exitGame.js.

const STATE_URL = "/__native/state.json";
const MIRROR_URL = "/__native/mirror";
const QUIT_URL = "/__native/quit";

const PLATFORMS = new Set(["ios", "android", "electron"]);

// The shells answer off local disk, so this only ever bounds the web's doomed
// request — it must never sit in front of the loading screen on a bad network.
const BOOT_FETCH_TIMEOUT_MS = 2000;

// Bounds the one mirror write anybody waits on (clearMirror, before New game
// navigates away). The others are fire-and-forget and never reach it.
const MIRROR_WRITE_TIMEOUT_MS = 3000;

// The quit request answers off a local protocol handler and the app follows it
// down, so this only ever fires when the shell is wedged — at which point the
// menu has to come back to life rather than hang on "Exit game".
const QUIT_REQUEST_TIMEOUT_MS = 3000;

// Remembers a *definitive* "no shell here" so the web pays for the discovery
// once per browser rather than once per page load. Safe to cache forever: an
// origin doesn't grow a shell later.
//
// The value is the origin that answered, not a bare flag. saveBackup.js copies
// every `sneakbit.*` key, so a backup exported on the web and restored inside a
// shell would otherwise carry a "not native" verdict across and silently retire
// that install's save mirror — the scheme differs (app:// and the Android asset
// host vs https://sneakbit.curzel.it) even where the host doesn't, so the stale
// memo simply doesn't apply.
const NOT_NATIVE_KEY = "sneakbit.nativeShell.v1";

let state = null;
let initialized = false;

function originTag() {
  if (typeof location === "undefined") return "";
  return `${location.protocol}//${location.host}`;
}

function knownNotNative() {
  try { return localStorage.getItem(NOT_NATIVE_KEY) === originTag(); } catch { return false; }
}

function rememberNotNative() {
  try { localStorage.setItem(NOT_NATIVE_KEY, originTag()); } catch { /* ignore */ }
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

// Normalize a shell's envelope, or return null if it isn't one. Strict on
// shape: a malformed answer means "treat this as the plain web" rather than
// letting a half-understood payload reach the import path, where a wrong
// `legacy.save` would replace a real save.
export function parseNativeState(raw) {
  if (!isPlainObject(raw)) return null;
  if (!PLATFORMS.has(raw.platform)) return null;

  const mirror = isPlainObject(raw.mirror) ? raw.mirror : null;

  let legacy = null;
  if (isPlainObject(raw.legacy)) {
    const save = isPlainObject(raw.legacy.save) ? raw.legacy.save : null;
    let audio = null;
    if (isPlainObject(raw.legacy.audio)) {
      const { sfx, music } = raw.legacy.audio;
      // Both flags or neither — a half-populated audio block would silently
      // default the missing half to "enabled" and unmute a player who wasn't.
      if (typeof sfx === "boolean" && typeof music === "boolean") audio = { sfx, music };
    }
    if (save || audio) legacy = { save, audio };
  }

  return { platform: raw.platform, mirror, legacy };
}

// One fetch, at most once per browser. Never throws and never blocks boot for
// long: any failure (404 on the web, non-JSON, unexpected shape) lands on the
// same "not native" outcome.
//
// Only an *answered* request caches that outcome. A timeout or network error is
// inconclusive, and caching it inside a real shell would silently retire the
// save mirror for good — so those retry on the next boot instead.
export async function initNativeBridge() {
  if (initialized) return state;
  initialized = true;
  if (knownNotNative()) return null;
  try {
    const res = await fetch(STATE_URL, {
      cache: "no-store",
      signal: AbortSignal.timeout(BOOT_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) { rememberNotNative(); return state; }
    state = parseNativeState(await res.json());
    if (!state) rememberNotNative();
  } catch {
    // Inconclusive — leave the door open for the next boot.
  }
  return state;
}

export function isNativeShell() {
  return state !== null;
}

export function getNativeState() {
  return state;
}

// Hand the shell a serialized save to mirror to a real file. Resolves true once
// the shell has the bytes: immediately on iOS and Android, where the call is a
// synchronous hop into native code, and when the POST completes on Electron.
//
// Almost every caller ignores the result — the mirror is a safety net, so a
// failed write must never surface to the player or interrupt play. Awaiting
// matters in one place: clearMirror() runs immediately before a navigation, and
// that write is the one whose loss would hand a deleted save back. See the note
// there.
//
// The request is dispatched synchronously (before the first await), so the
// unload path still gets its shot even though nothing awaits it; `keepalive`
// is what carries it past the navigation.
export async function writeMirror(text, { keepalive = false } = {}) {
  if (!state || typeof text !== "string") return false;
  try {
    if (state.platform === "ios") {
      const handler = globalThis.webkit?.messageHandlers?.saveMirror;
      if (!handler) return false;
      handler.postMessage(text);
      return true;
    }
    if (state.platform === "android") {
      const bridge = globalThis.SneakBitNative;
      if (typeof bridge?.writeMirror !== "function") return false;
      bridge.writeMirror(text);
      return true;
    }
    // Electron: protocol.handle() receives the body, so the write rides the
    // same origin as the read and needs no IPC bridge. The renderer stays
    // sandboxed with no preload.
    const res = await fetch(MIRROR_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: text,
      keepalive,
      // A local file write behind a protocol handler; a bound this generous
      // only ever catches a wedged shell, and it keeps New game — which waits
      // on this — from hanging on the menu.
      signal: AbortSignal.timeout(MIRROR_WRITE_TIMEOUT_MS),
    });
    return res.ok;
  } catch (e) {
    console.error("[nativeBridge] mirror write failed", e);
    return false;
  }
}

// Ask the shell to close the app. Electron only — the mobile shells have no
// business quitting themselves, and on the web there's nothing to ask.
// Resolves true once the shell has accepted; the window usually disappears a
// beat later, so callers should treat this as the last thing they do.
export async function requestShellQuit() {
  if (state?.platform !== "electron") return false;
  try {
    const res = await fetch(QUIT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(QUIT_REQUEST_TIMEOUT_MS),
    });
    return res.ok;
  } catch (e) {
    console.error("[nativeBridge] quit request failed", e);
    return false;
  }
}

// Test-only: drop the cached envelope so a suite can re-init against a
// different fake shell. Leaves the NOT_NATIVE_KEY memo alone — that lives in
// localStorage, which is what a test simulating a second page load wants to
// keep across the reset.
export function _resetNativeBridgeForTesting(next = null) {
  state = next;
  initialized = next !== null;
}
