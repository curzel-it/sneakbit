// Ice-buff timer bar — a DOM HUD chip showing how much of the Ice Potion buff
// is left. Same shape and lifecycle as speedTimerBar.js / giantTimerBar.js (its
// own feature/file, DOM not canvas), stacked just below the speed bar in the
// top-right so all three can show at once.
//
// Scoped to the local self (index 0): a single bar. getIceRemainingMs keys the
// self on its playerId online, so this reads the local player's own buff even
// when peers are buffed too.

import { ICE_DURATION_MS, getIceRemainingMs, onIceChange } from "./iceMode.js";
import { el } from "./dom.js";

const SELF_INDEX = 0;
const URGENT_MS = 3000;

let root = null;
let fill = null;
let raf = null;

export function installIceTimerBar() {
  if (root) return root;
  if (typeof document === "undefined") return null;
  injectStyles();
  fill = el("div", { class: "ice-hud-fill" });
  const track = el("div", { class: "ice-hud-track" }, fill);
  const label = el("div", { class: "ice-hud-label" }, "ICE");
  root = el("div", { id: "ice-hud" }, [label, track]);
  document.body.appendChild(root);
  onIceChange(sync);
  sync();
  return root;
}

function sync() {
  if (!root) return;
  if (getIceRemainingMs(SELF_INDEX) > 0) start();
}

// The rAF loop runs ONLY while buffed and self-stops at expiry, so there's
// zero per-frame cost the rest of the time.
function start() {
  if (raf != null) return;
  root.classList.remove("show");
  void root.offsetWidth; // force reflow so re-adding the class restarts the animation
  root.classList.add("show");
  tick();
}

function tick() {
  const remaining = getIceRemainingMs(SELF_INDEX);
  if (remaining <= 0) { raf = null; finish(); return; }
  const pct = Math.max(0, Math.min(1, remaining / ICE_DURATION_MS));
  fill.style.width = `${pct * 100}%`;
  root.classList.toggle("urgent", remaining <= URGENT_MS);
  raf = requestAnimationFrame(tick);
}

function finish() {
  fill.style.width = "0%";
  root.classList.remove("urgent");
  root.classList.remove("show");
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("ice-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "ice-hud-styles";
  style.textContent = `
    #ice-hud {
      position: fixed;
      top: 108px;
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
      transition: opacity 200ms ease, transform 200ms ease, visibility 0s linear 200ms;
    }
    #ice-hud.show {
      opacity: 1;
      visibility: visible;
      transform: scale(1);
      transition: opacity 200ms ease, transform 200ms ease, visibility 0s;
      animation: ice-hud-pop 280ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    #ice-hud .ice-hud-label {
      margin-bottom: 4px;
      letter-spacing: 1px;
      font-weight: bold;
    }
    #ice-hud .ice-hud-track {
      width: 100%;
      height: 8px;
      background: #222;
      border: 1px solid #444;
      border-radius: 3px;
      overflow: hidden;
    }
    #ice-hud .ice-hud-fill {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #4aa3d6 0%, #cdeefb 100%);
      transition: background 200ms ease;
    }
    #ice-hud.urgent .ice-hud-fill {
      background: linear-gradient(90deg, #b13 0%, #e54 100%);
    }
    #ice-hud.urgent {
      animation: ice-hud-pulse 700ms ease-in-out infinite;
    }
    @keyframes ice-hud-pop {
      0%   { transform: scale(0.6); opacity: 0; }
      100% { transform: scale(1);   opacity: 1; }
    }
    @keyframes ice-hud-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(229, 68, 51, 0); }
      50%      { box-shadow: 0 0 10px 2px rgba(229, 68, 51, 0.65); }
    }

    /* Phone portrait: below the speed bar, left-aligned. */
    @media (max-width: 600px) and (orientation: portrait) {
      #ice-hud {
        top: 152px;
        left: 8px;
        right: auto;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #ice-hud, #ice-hud.show, #ice-hud.urgent { animation: none; }
    }
  `;
  document.head.appendChild(style);
}
