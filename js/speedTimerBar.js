// Speed-buff timer bar — a DOM HUD chip showing how much of the Silver Potion
// speed boost is left. Same shape and lifecycle as giantTimerBar.js (its own
// feature/file, DOM not canvas), stacked just below the giant bar in the top-
// right so both can show at once when a player is giant AND sped up.
//
// Scoped to the local self (index 0): a single bar. The buff itself is local-
// only (speedMode.js), so there's no per-peer readout to worry about.

import { SPEED_DURATION_MS, getSpeedRemainingMs, onSpeedChange } from "./speedMode.js";
import { el } from "./dom.js";

const SELF_INDEX = 0;
const URGENT_MS = 4000;

let root = null;
let fill = null;
let raf = null;

export function installSpeedTimerBar() {
  if (root) return root;
  if (typeof document === "undefined") return null;
  injectStyles();
  fill = el("div", { class: "speed-hud-fill" });
  const track = el("div", { class: "speed-hud-track" }, fill);
  const label = el("div", { class: "speed-hud-label" }, "SPEED");
  root = el("div", { id: "speed-hud" }, [label, track]);
  document.body.appendChild(root);
  onSpeedChange(sync);
  sync();
  return root;
}

function sync() {
  if (!root) return;
  if (getSpeedRemainingMs(SELF_INDEX) > 0) start();
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
  const remaining = getSpeedRemainingMs(SELF_INDEX);
  if (remaining <= 0) { raf = null; finish(); return; }
  const pct = Math.max(0, Math.min(1, remaining / SPEED_DURATION_MS));
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
  if (document.getElementById("speed-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "speed-hud-styles";
  style.textContent = `
    #speed-hud {
      position: fixed;
      top: 60px;
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
    #speed-hud.show {
      opacity: 1;
      visibility: visible;
      transform: scale(1);
      transition: opacity 200ms ease, transform 200ms ease, visibility 0s;
      animation: speed-hud-pop 280ms cubic-bezier(0.34, 1.56, 0.64, 1) both;
    }
    #speed-hud .speed-hud-label {
      margin-bottom: 4px;
      letter-spacing: 1px;
      font-weight: bold;
    }
    #speed-hud .speed-hud-track {
      width: 100%;
      height: 8px;
      background: #222;
      border: 1px solid #444;
      border-radius: 3px;
      overflow: hidden;
    }
    #speed-hud .speed-hud-fill {
      width: 100%;
      height: 100%;
      background: linear-gradient(90deg, #8a9ba8 0%, #e8eef2 100%);
      transition: background 200ms ease;
    }
    #speed-hud.urgent .speed-hud-fill {
      background: linear-gradient(90deg, #b13 0%, #e54 100%);
    }
    #speed-hud.urgent {
      animation: speed-hud-pulse 700ms ease-in-out infinite;
    }
    @keyframes speed-hud-pop {
      0%   { transform: scale(0.6); opacity: 0; }
      100% { transform: scale(1);   opacity: 1; }
    }
    @keyframes speed-hud-pulse {
      0%, 100% { box-shadow: 0 0 0 0 rgba(229, 68, 51, 0); }
      50%      { box-shadow: 0 0 10px 2px rgba(229, 68, 51, 0.65); }
    }

    /* Phone portrait: below the giant bar, left-aligned. */
    @media (max-width: 600px) and (orientation: portrait) {
      #speed-hud {
        top: 104px;
        left: 8px;
        right: auto;
      }
    }

    @media (prefers-reduced-motion: reduce) {
      #speed-hud, #speed-hud.show, #speed-hud.urgent { animation: none; }
    }
  `;
  document.head.appendChild(style);
}
