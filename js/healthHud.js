// HP bars pinned to the top of the viewport. Lives in the DOM, not the
// canvas, per the project's UI rule.
//
// In single-player a single bar sits top-left. In co-op an extra bar sits
// below it — the second player's HP. A bar hides when its player is dead.

import { getPlayerHp, getPlayerMaxHp, onPlayerHealthChange, isPlayerDead } from "./playerHealth.js?v=20260528c";
import { isCoopMode } from "./coopMode.js?v=20260528c";

const PLAYER_COLORS = [
  "linear-gradient(90deg, #b13 0%, #e54 100%)",
  "linear-gradient(90deg, #168 0%, #4ad 100%)",
];

let root = null;
const bars = []; // [{ label, fill, index }]

export function installHealthHud() {
  if (root) return root;
  injectStyles();
  root = document.createElement("div");
  root.id = "health-hud";

  const count = isCoopMode() ? 2 : 1;
  for (let i = 0; i < count; i++) bars.push(makeBar(i));
  for (const b of bars) root.appendChild(b.root);
  document.body.appendChild(root);

  onPlayerHealthChange(redraw);
  redraw();
  return root;
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("health-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "health-hud-styles";
  style.textContent = `
    #health-hud {
      position: fixed; top: 12px; left: 12px;
      display: flex; flex-direction: column; gap: 6px;
      z-index: 11; pointer-events: none;
      user-select: none; -webkit-user-select: none;
    }
    .hp-card {
      width: 180px;
      padding: 6px 10px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
      color: var(--sb-text);
      font-family: var(--sb-font);
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}

function makeBar(index) {
  const card = document.createElement("div");
  card.className = "hp-card";

  const label = document.createElement("div");
  label.style.marginBottom = "4px";

  const bar = document.createElement("div");
  Object.assign(bar.style, {
    width: "100%",
    height: "8px",
    background: "#222",
    border: "1px solid #444",
    borderRadius: "3px",
    overflow: "hidden",
  });

  const fill = document.createElement("div");
  Object.assign(fill.style, {
    width: "100%",
    height: "100%",
    background: PLAYER_COLORS[index] ?? PLAYER_COLORS[0],
    transition: "width 120ms linear",
  });
  bar.appendChild(fill);
  card.appendChild(label);
  card.appendChild(bar);
  return { root: card, label, fill, index };
}

function redraw() {
  for (const b of bars) {
    const hp = getPlayerHp(b.index);
    const max = getPlayerMaxHp();
    const dead = isPlayerDead(b.index);
    // P2 hides while dead (matches Rust: dead co-op player drops out of
    // play until the zone reloads). P1 stays visible even at 0 — the
    // game-over modal takes over.
    if (b.index > 0 && dead) {
      b.root.style.display = "none";
      continue;
    }
    b.root.style.display = "";
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    const tag = bars.length > 1 ? `P${b.index + 1} ` : "";
    b.label.textContent = `${tag}HP ${Math.ceil(hp)} / ${max}`;
    b.fill.style.width = `${pct}%`;
  }
}
