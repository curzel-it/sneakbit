// HP bars pinned to the top of the viewport. Lives in the DOM, not the
// canvas, per the project's UI rule.
//
// In single-player a single bar sits top-left. In local co-op (2-4
// players) one bar per player stacks below it. A bar hides when its
// player is dead, or when the local player count doesn't cover it.

import { getPlayerHp, getPlayerMaxHp, onPlayerHealthChange, isPlayerDead } from "./playerHealth.js?v=20260530c";
import { localPlayerCount } from "./coopMode.js?v=20260530c";

const MAX_PLAYERS = 4;
const PLAYER_COLORS = [
  "linear-gradient(90deg, #b13 0%, #e54 100%)", // P1 red/orange
  "linear-gradient(90deg, #168 0%, #4ad 100%)", // P2 blue/cyan
  "linear-gradient(90deg, #2a2 0%, #6d6 100%)", // P3 green
  "linear-gradient(90deg, #b82 0%, #ed4 100%)", // P4 amber
];

let root = null;
const bars = []; // [{ label, fill, index }]

export function installHealthHud() {
  if (root) return root;
  injectStyles();
  root = document.createElement("div");
  root.id = "health-hud";

  // Build all four bars up front; redraw shows only the active ones. Local
  // co-op count is hot-toggled (always 1 at boot), so we can't size the
  // bar set at install time.
  for (let i = 0; i < MAX_PLAYERS; i++) bars.push(makeBar(i));
  for (const b of bars) root.appendChild(b.root);
  document.body.appendChild(root);

  onPlayerHealthChange(redraw);
  redraw();
  return root;
}

// Called after the local player count changes (main.setLocalPlayers) so
// added/removed players' bars appear/disappear without waiting for a
// health-change event.
export function refreshHealthHud() { if (root) redraw(); }

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
  const count = localPlayerCount();
  for (const b of bars) {
    // Hide bars beyond the active local player count.
    if (b.index >= count) { b.root.style.display = "none"; continue; }
    const hp = getPlayerHp(b.index);
    const max = getPlayerMaxHp();
    const dead = isPlayerDead(b.index);
    // Co-op teammates hide while dead (matches Rust: dead co-op player
    // drops out until the zone reloads). P1 stays visible even at 0 — the
    // game-over modal takes over.
    if (b.index > 0 && dead) {
      b.root.style.display = "none";
      continue;
    }
    b.root.style.display = "";
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    const tag = count > 1 ? `P${b.index + 1} ` : "";
    b.label.textContent = `${tag}HP ${Math.ceil(hp)} / ${max}`;
    b.fill.style.width = `${pct}%`;
  }
}
