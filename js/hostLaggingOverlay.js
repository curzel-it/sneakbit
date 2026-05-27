// Guest-only HUD overlay shown while the mirror world has gone stale
// (>STALE_MS without a delta from the host). Sits above the canvas in
// the top-centre. Decoupled from the discrete `host.ghosted` frame:
// the overlay reads `isMirrorStale()` every frame, so it lights up on
// any delta drought — including the common "delta-flow paused but no
// disconnect yet" case where the relay hasn't fanned a ghost frame —
// and clears the instant fresh state lands.

import { isMirrorStale } from "./mirrorWorld.js?v=20260527b";
import { getRuntimeRole, onRoleChange } from "./onlineMode.js?v=20260527b";

let overlay = null;
let installed = false;

export function installHostLaggingOverlay() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  injectStyles();
  overlay = document.createElement("div");
  overlay.id = "host-lagging-overlay";
  overlay.style.display = "none";
  overlay.textContent = "Host lagging…";
  document.body.appendChild(overlay);
  // Force-hide on any guest → offline / host transition. tickGuestFrame
  // is the only caller of updateHostLaggingOverlay(), so without this
  // a switchRole away from guest while the overlay was showing would
  // leave it stuck on screen until the role flipped back.
  onRoleChange((role) => {
    if (role !== "guest" && overlay) {
      overlay.style.display = "none";
      lastShown = false;
    }
  });
}

// Called every guest tick from main.js. Avoids a per-frame DOM read by
// caching the last applied display state; the tick is at requestAnimationFrame
// cadence so a write per stale-transition is the upper bound.
let lastShown = false;
export function updateHostLaggingOverlay() {
  if (!overlay) return;
  const shouldShow = getRuntimeRole() === "guest" && isMirrorStale();
  if (shouldShow === lastShown) return;
  lastShown = shouldShow;
  overlay.style.display = shouldShow ? "block" : "none";
}

export function _resetHostLaggingOverlayForTesting() {
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  overlay = null;
  installed = false;
  lastShown = false;
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
