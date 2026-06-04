// Controller connect/disconnect UX. Wires the Gamepad API connection
// events to: (a) make a freshly-plugged pad the active device (so glyphs
// switch with no settings step — the Steam Deck "no setup" rule), (b)
// toast which player a pad became, and (c) pause the game with a reconnect
// overlay when the active pad drops mid-play (a console/Steam-cert
// expectation). Switching keyboard↔pad never pauses — only losing the pad
// you're using does.

import { markInputDevice, getActiveInputDevice } from "./activeInputDevice.js";
import { slotForPadIndex } from "./gamepad.js";
import { showToast } from "./toast.js";
import { getNetRole } from "./onlineBootstrap.js";
import { el } from "./dom.js";

let overlay = null;
let paused = false;
let installed = false;

// True while the disconnect overlay is up. main.js folds this into its
// `paused` derivation so the sim freezes (and setHostPaused tells guests).
export function isControllerPaused() { return paused; }

export function installControllerPresence() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("gamepadconnected", onConnect);
  window.addEventListener("gamepaddisconnected", onDisconnect);
  // Any keyboard input resumes from a controller-disconnect pause —
  // keyboard is always a valid input device (Valve's simultaneous-input
  // rule), so the player isn't stranded if their pad is dead.
  window.addEventListener("keydown", () => { if (paused) resume(); }, true);
}

function onConnect(e) {
  markInputDevice("gamepad");
  // A reconnect (any pad) clears a disconnect pause.
  if (paused) { resume(); }
  const slot = slotForPadIndex(e?.gamepad?.index);
  showToast(slot > 0 ? `Controller connected — Player ${slot}` : "Controller connected", "hint");
}

function onDisconnect() {
  // Guests don't own the sim — can't pause the authoritative game; just
  // surface it. (Their predicted self simply stops getting input.)
  if (getNetRole() === "guest") {
    showToast("Controller disconnected", "hint");
    return;
  }
  // Pause only if a pad was actually the active device — i.e. someone was
  // playing with the controller that just dropped. A keyboard player with
  // an idle pad that unplugs sees only a toast.
  if (getActiveInputDevice() === "gamepad") {
    openOverlay();
  } else {
    showToast("Controller disconnected", "hint");
  }
}

function openOverlay() {
  paused = true;
  if (!overlay) overlay = buildOverlay();
  overlay.style.display = "flex";
}

function resume() {
  paused = false;
  if (overlay) overlay.style.display = "none";
}

function buildOverlay() {
  const node = el("div", {
    id: "controller-disconnect",
    style: {
      position: "fixed", inset: "0", display: "none",
      alignItems: "center", justifyContent: "center",
      background: "rgba(0,0,0,0.72)", backdropFilter: "blur(2px)",
      zIndex: "30", color: "#eee", fontFamily: "monospace", textAlign: "center",
    },
    html: `
    <div style="background:#181818;border:1px solid #333;border-radius:var(--sb-card-radius);padding:28px 32px;max-width:320px;">
      <h1 style="margin:0 0 12px;font-size:16px;letter-spacing:1px;">Controller disconnected</h1>
      <p style="margin:0;color:#aaa;font-size:12px;line-height:1.6;">
        Reconnect your controller to continue,<br>or press any key to play on the keyboard.
      </p>
    </div>`,
  });
  document.body.appendChild(node);
  return node;
}

// Test seam.
export function _resetControllerPresenceForTesting() {
  if (overlay) { overlay.remove(); overlay = null; }
  paused = false;
  installed = false;
}
