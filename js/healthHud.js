// HP bars pinned to the top of the viewport. Lives in the DOM, not the
// canvas, per the project's UI rule.
//
// In single-player a single bar sits top-left. In local co-op (2-4
// players) one bar per player stacks below it. A bar hides when its
// player is dead, or when the local player count doesn't cover it.

import { getPlayerHp, getPlayerMaxHp, onPlayerHealthChange, isPlayerDead } from "./playerHealth.js";
import { localPlayerCount } from "./coopMode.js";
import { sliceCount, getSlices } from "./splitScreen.js";
import { el } from "./dom.js";

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
  // Build all four bars up front; redraw shows only the active ones. Local
  // co-op count is hot-toggled (always 1 at boot), so we can't size the
  // bar set at install time.
  for (let i = 0; i < MAX_PLAYERS; i++) bars.push(makeBar(i));
  root = el("div", { id: "health-hud" }, bars.map((b) => b.root));
  document.body.appendChild(root);

  onPlayerHealthChange(redraw);
  // Re-anchor each bar to its slice when the window resizes (the slice
  // geometry changes). zoom.js recomputes the slices first (its listener is
  // installed earlier), so getSlices() is fresh by the time we read it.
  if (typeof window !== "undefined") window.addEventListener("resize", redraw);
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
  const label = el("div", { style: { marginBottom: "4px" } });
  const fill = el("div", {
    style: {
      width: "100%",
      height: "100%",
      background: PLAYER_COLORS[index] ?? PLAYER_COLORS[0],
      transition: "width 120ms linear",
    },
  });
  const bar = el("div", {
    style: {
      width: "100%",
      height: "8px",
      background: "#222",
      border: "1px solid #444",
      borderRadius: "3px",
      overflow: "hidden",
    },
  }, fill);
  const card = el("div", { class: "hp-card" }, [label, bar]);
  return { root: card, label, fill, index };
}

function redraw() {
  const count = localPlayerCount();
  // In split-screen, anchor each player's bar to the top-left of THEIR slice
  // instead of stacking all bars in the shared top-left container.
  const slices = sliceCount() > 1 ? getSlices() : null;
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
    anchorBar(b, slices);
    const pct = Math.max(0, Math.min(100, (hp / max) * 100));
    const tag = count > 1 ? `P${b.index + 1} ` : "";
    b.label.textContent = `${tag}HP ${Math.ceil(hp)} / ${max}`;
    b.fill.style.width = `${pct}%`;
  }
}

// Position one bar: fixed to its slice corner in split-screen, or reset to the
// stacked flex flow (single-slice). Falls back to stacked if slice geometry
// isn't available yet (e.g. cssRect computed in a non-DOM context).
function anchorBar(b, slices) {
  const css = slices?.[b.index]?.cssRect;
  if (css) {
    Object.assign(b.root.style, {
      position: "fixed",
      left: `${Math.round(css.left + 12)}px`,
      top: `${Math.round(css.top + 12)}px`,
    });
  } else {
    Object.assign(b.root.style, { position: "", left: "", top: "" });
  }
}
