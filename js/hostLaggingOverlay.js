// Guest-only HUD overlay shown while the host's stream is interrupted.
// Two distinct reasons fold into one element so we don't stack toasts:
//   * the host has explicitly paused (event:hostPause) → "Host paused
//     the game" — a calm message, the world will resume when they do
//   * the mirror world has gone stale (>STALE_MS without a delta and
//     no pause signal) → "Host lagging…" — the network/peer is the
//     suspect
// Pause is checked first so a paused host doesn't transiently flash
// "Host lagging…" once the broadcaster's delta stream falls quiet.
// Sits above the canvas in the top-centre.

import { isMirrorStale } from "./mirrorWorld.js?v=20260530g";
import { getRuntimeRole, onRoleChange } from "./onlineMode.js?v=20260530g";
import { isHostPausedRemote } from "./guestHostPause.js?v=20260530g";

const PAUSED_TEXT = "Host paused the game";
const LAGGING_TEXT = "Host lagging…";

let overlay = null;
let installed = false;

export function installHostLaggingOverlay() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  injectStyles();
  overlay = document.createElement("div");
  overlay.id = "host-lagging-overlay";
  overlay.style.display = "none";
  overlay.textContent = LAGGING_TEXT;
  document.body.appendChild(overlay);
  // Force-hide on any guest → offline / host transition. tickGuestFrame
  // is the only caller of updateHostLaggingOverlay(), so without this
  // a switchRole away from guest while the overlay was showing would
  // leave it stuck on screen until the role flipped back.
  onRoleChange((role) => {
    if (role !== "guest" && overlay) {
      overlay.style.display = "none";
      lastShown = false;
      lastText = "";
    }
  });
}

// Called every guest tick from main.js. Avoids a per-frame DOM read by
// caching the last applied display state and text; the tick is at
// requestAnimationFrame cadence so a write per state transition is the
// upper bound.
let lastShown = false;
let lastText = "";
export function updateHostLaggingOverlay() {
  if (!overlay) return;
  const isGuest = getRuntimeRole() === "guest";
  const isPaused = isGuest && isHostPausedRemote();
  // While paused we don't gate on staleness — the paused signal is
  // explicit and we want the overlay up immediately, not after the
  // 300 ms staleness threshold.
  const shouldShow = isGuest && (isPaused || isMirrorStale());
  const text = isPaused ? PAUSED_TEXT : LAGGING_TEXT;
  if (shouldShow === lastShown && text === lastText) return;
  lastShown = shouldShow;
  if (text !== lastText) {
    overlay.textContent = text;
    lastText = text;
  }
  overlay.style.display = shouldShow ? "block" : "none";
}

export function _resetHostLaggingOverlayForTesting() {
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  overlay = null;
  installed = false;
  lastShown = false;
  lastText = "";
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("host-lagging-styles")) return;
  const style = document.createElement("style");
  style.id = "host-lagging-styles";
  style.textContent = `
    #host-lagging-overlay {
      position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
      padding: 6px 14px;
      background: rgba(60, 30, 30, 0.85);
      border: 1px solid #a44; border-radius: 6px;
      color: #fed; font-family: monospace; font-size: 13px;
      letter-spacing: 1px;
      z-index: 22; pointer-events: none; user-select: none;
      animation: host-lagging-pulse 1.4s ease-in-out infinite;
    }
    @keyframes host-lagging-pulse {
      0%, 100% { opacity: 0.85; }
      50%      { opacity: 0.45; }
    }
  `;
  document.head.appendChild(style);
}
