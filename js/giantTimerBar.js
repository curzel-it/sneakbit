// Giant-mode timer bar — a DOM HUD chip showing how much of the Giant Pill
// transformation is left. Lives in the DOM, not the canvas, per the project's
// UI rule, and is its own feature/file like the other HUD chips.
//
// It's the only HUD piece that wants the top-RIGHT corner on desktop (the HP /
// coin / ammo strip owns the top-left, see topHudRow.js), so it's a standalone
// position:fixed element on <body> rather than a child of the top row. On
// phone-portrait it drops to just below the HP bar, left-aligned.
//
// The bar is scoped to the local self (index 0): a single bar, matching the
// request. Giant state still syncs/renders for every avatar — only this timer
// readout is self-only.

import { GIANT_DURATION_MS, getGiantRemainingMs, onGiantChange } from "./giantMode.js";
import { el } from "./dom.js";

const SELF_INDEX = 0;
// Final stretch where the bar turns red and pulses to signal "time's almost up".
const URGENT_MS = 5000;

let root = null;
let fill = null;
let raf = null;

export function installGiantTimerBar() {
  if (root) return root;
  if (typeof document === "undefined") return null;
  injectStyles();
  fill = el("div", { class: "giant-hud-fill" });
  const track = el("div", { class: "giant-hud-track" }, fill);
  const label = el("div", { class: "giant-hud-label" }, "GIANT");
  root = el("div", { id: "giant-hud" }, [label, track]);
  document.body.appendChild(root);
  // Reactive wake-up: a pill consumed locally or arriving over the wire fires
  // onGiantChange, which starts the countdown loop. Session teardown also fires
  // it (with 0 remaining) so the loop notices and fades the bar out.
  onGiantChange(sync);
  sync();
  return root;
}

function sync() {
  if (!root) return;
  if (getGiantRemainingMs(SELF_INDEX) > 0) start();
}

// Begin (or restart) the countdown. The rAF loop runs ONLY while giant and
// self-stops at expiry, so there's zero per-frame cost the rest of the time.
function start() {
  if (raf != null) return; // already counting down
  // Replay the pop-in keyframe even on a back-to-back re-arm.
  root.classList.remove("show");
  void root.offsetWidth; // force reflow so re-adding the class restarts the animation
  root.classList.add("show");
  tick();
}

function tick() {
  const remaining = getGiantRemainingMs(SELF_INDEX);
  if (remaining <= 0) { raf = null; finish(); return; }
  // rAF-driven width → buttery-smooth drain without a CSS width transition.
  const pct = Math.max(0, Math.min(1, remaining / GIANT_DURATION_MS));
  fill.style.width = `${pct * 100}%`;
  root.classList.toggle("urgent", remaining <= URGENT_MS);
  raf = requestAnimationFrame(tick);
}

function finish() {
  fill.style.width = "0%";
  root.classList.remove("urgent");
  // Drops .show → the card fades out via the opacity/visibility transition.
  root.classList.remove("show");
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("giant-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "giant-hud-styles";
  style.textContent = `
    #giant-hud {
      position: fixed;
      top: 12px;
      right: 12px;
      z-index: 11;
      box-sizing: border-box;
      width: 160px;
      padding: 6px 10px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
      color: var(--sb-text);
      font-family: var(--sb-font);
      font-size: 12px;
      pointer-events: none;
      user-select: none; -webkit-user-select: none;
      opacity: 0;
      visibility: hidden;
      transform: scale(0.96);
      /* Hidden by default; visibility flips immediately on show, and after the
         fade on hide, so the card never lingers as an invisible click-shield. */
      transition: opacity 200ms ease, transform 200ms ease, visibility 0s linear 200ms;
    }
    #giant-hud.show {
      opacity: 1;
      visibility: visible;
      transform: scale(1);
      transition: opacity 200ms ease, transform 200ms ease, visibility 0s;
      animation: giant-hud-pop 280ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    #giant-hud .giant-hud-label {
      margin-bottom: 4px;
      letter-spacing: 1px;
      font-weight: bold;
    }
    #giant-hud .giant-hud-track {
      width: 100%;
      height: 8px;
      background: #222;
      border: 1px solid #444;
      border-radius: 3px;
      overflow: hidden;
    }
    #giant-hud .giant-hud-fill {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #7b2ff7 0%, #d24bff 100%);
      /* No width transition — the rAF loop sets width every frame. Only the
         color shift to the urgent palette animates. */
      transition: background 200ms ease;
    }
    /* Final seconds: red fill + pulsing glow on the whole card. */
    #giant-hud.urgent .giant-hud-fill {
      background: linear-gradient(90deg, #b13 0%, #e54 100%);
    }
    #giant-hud.urgent {
      animation: giant-hud-pulse 700ms ease-in-out infinite;
    }
    @keyframes giant-hud-pop {
      0%   { transform: scale(0.6); opacity: 0; }
      100% { transform: scale(1);   opacity: 1; }
    }
    @keyframes giant-hud-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(229, 68, 51, 0); }
      50%      { box-shadow: 0 0 10px 2px rgba(229, 68, 51, 0.65); }
    }

    /* Phone portrait: drop below the top-left HP strip, left-aligned. The fixed
       offset clears the HUD row (matches how the rest of the HUD uses fixed
       positions). */
    @media (max-width: 600px) and (orientation: portrait) {
      #giant-hud {
        top: 56px;
        left: 8px;
        right: auto;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #giant-hud, #giant-hud.show, #giant-hud.urgent { animation: none; }
    }
  `;
  document.head.appendChild(style);
}
