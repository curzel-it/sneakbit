// HP bars pinned to the top of the viewport. Lives in the DOM, not the
// canvas, per the project's UI rule.
//
// In single-player a single bar sits top-left. In co-op an extra bar sits
// below it — the second player's HP. A bar hides when its player is dead.

import { getPlayerHp, getPlayerMaxHp, onPlayerHealthChange, isPlayerDead } from "./playerHealth.js";
import { isCoopMode } from "./coopMode.js";

const PLAYER_COLORS = [
  "linear-gradient(90deg, #b13 0%, #e54 100%)",
  "linear-gradient(90deg, #168 0%, #4ad 100%)",
];

let root = null;
const bars = []; // [{ label, fill, index }]

export function installHealthHud() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "health-hud";
  Object.assign(root.style, {
    position: "fixed",
    top: "12px",
    left: "12px",
    display: "flex",
    flexDirection: "column",
    gap: "6px",
    zIndex: "11",
    pointerEvents: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  });

  const count = isCoopMode() ? 2 : 1;
  for (let i = 0; i < count; i++) bars.push(makeBar(i));
  for (const b of bars) root.appendChild(b.root);
  document.body.appendChild(root);

  onPlayerHealthChange(redraw);
  redraw();
  return root;
}

function makeBar(index) {
  const card = document.createElement("div");
  Object.assign(card.style, {
    width: "180px",
    padding: "6px 10px",
    background: "rgba(10, 10, 10, 0.7)",
    border: "1px solid #333",
    borderRadius: "6px",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "12px",
  });

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
