// HP bars pinned to the top of the viewport. Lives in the DOM, not the
// canvas, per the project's UI rule.
//
// In single-player a single bar sits top-left. In local co-op (2-4
// players) one bar per player stacks below it. A bar hides when its
// player is dead, or when the local player count doesn't cover it.

import { getPlayerHp, getPlayerMaxHp, onPlayerHealthChange, isPlayerDead } from "./playerHealth.js";
import { localPlayerCount } from "./coopMode.js";
import { sliceCount, getSlices } from "./splitScreen.js";
import { topHudRow } from "./topHudRow.js";
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
  topHudRow().appendChild(root);

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
      position: relative;
      display: flex; flex-direction: column; gap: 6px;
      /* Elastic item of the top row: grow to 180px, shrink to 84px so the
         coin + ammo chips always fit beside it on narrow screens. */
      flex: 0 1 180px;
      min-width: 84px;
      pointer-events: none;
      user-select: none; -webkit-user-select: none;
    }
    .hp-card {
      width: 100%;
      box-sizing: border-box;
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
  // `last` caches the values most recently written to the DOM so redraw can
  // skip the write (and the string allocation) when nothing changed. redraw
  // runs every frame while a player takes continuous damage or regenerates
  // (playerHealth.notify fires per tick), so the unconditional version churned
  // template strings and thrashed style/layout 60×/s during combat.
  return { root: card, label, fill, index, last: { display: null, text: null, width: null, left: null, top: null } };
}

function redraw() {
  const count = localPlayerCount();
  // In split-screen, anchor each player's bar to the top-left of THEIR slice
  // instead of stacking all bars in the shared top-left container.
  const slices = sliceCount() > 1 ? getSlices() : null;
  for (const b of bars) {
    // Hide bars beyond the active local player count.
    if (b.index >= count) { setDisplay(b, "none"); continue; }
    const dead = isPlayerDead(b.index);
    // Co-op teammates hide while dead (matches Rust: dead co-op player
    // drops out until the zone reloads). P1 stays visible even at 0 — the
    // game-over modal takes over.
    if (b.index > 0 && dead) { setDisplay(b, "none"); continue; }
    setDisplay(b, "");
    anchorBar(b, slices);
    const hp = getPlayerHp(b.index);
    const max = getPlayerMaxHp(b.index);
    // Round before formatting so a fractional damage/regen tick only writes
    // the DOM when the displayed value actually moves: the label tracks whole
    // HP and the fill tracks whole-percent width (the 120ms CSS transition
    // smooths the steps). hp is part of the cache key via `text`/`width`.
    const pct = Math.max(0, Math.min(100, Math.round((hp / max) * 100)));
    const tag = count > 1 ? `P${b.index + 1} ` : "";
    const text = `${tag}HP ${Math.ceil(hp)} / ${max}`;
    if (text !== b.last.text) { b.label.textContent = text; b.last.text = text; }
    const width = `${pct}%`;
    if (width !== b.last.width) { b.fill.style.width = width; b.last.width = width; }
  }
}

function setDisplay(b, value) {
  if (b.last.display === value) return;
  b.root.style.display = value;
  b.last.display = value;
}

// Position one bar: fixed to its slice corner in split-screen, or reset to the
// stacked flex flow (single-slice). Falls back to stacked if slice geometry
// isn't available yet (e.g. cssRect computed in a non-DOM context). Cached
// per bar so a steady camera doesn't rewrite the same left/top every frame.
function anchorBar(b, slices) {
  const css = slices?.[b.index]?.cssRect;
  // The canvas is centred and sized a hair larger than the viewport (zoom.js),
  // so a top-row / left-column slice's cssRect can start a few px off-screen.
  // Clamp to a 12px viewport margin so the card never clips above/left of the
  // visible area (the symptom: P1/P2's panel top sliced off).
  const left = css ? `${Math.max(12, Math.round(css.left + 12))}px` : "";
  const top = css ? `${Math.max(12, Math.round(css.top + 12))}px` : "";
  const position = css ? "fixed" : "";
  if (left === b.last.left && top === b.last.top) return;
  b.root.style.position = position;
  b.root.style.left = left;
  b.root.style.top = top;
  b.last.left = left;
  b.last.top = top;
}
