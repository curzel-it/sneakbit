// Small HP bar pinned to the top-left of the viewport. Lives in the DOM,
// not the canvas, per the project's UI rule.

import { getPlayerHp, getPlayerMaxHp, onPlayerHealthChange } from "./playerHealth.js";

let root = null;
let fill = null;
let label = null;

export function installHealthHud() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "health-hud";
  Object.assign(root.style, {
    position: "fixed",
    top: "12px",
    left: "12px",
    width: "180px",
    padding: "6px 10px",
    background: "rgba(10, 10, 10, 0.7)",
    border: "1px solid #333",
    borderRadius: "6px",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "12px",
    zIndex: "11",
    pointerEvents: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
  });

  label = document.createElement("div");
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

  fill = document.createElement("div");
  Object.assign(fill.style, {
    width: "100%",
    height: "100%",
    background: "linear-gradient(90deg, #b13 0%, #e54 100%)",
    transition: "width 120ms linear",
  });
  bar.appendChild(fill);
  root.appendChild(label);
  root.appendChild(bar);
  document.body.appendChild(root);

  onPlayerHealthChange(redraw);
  redraw();
  return root;
}

function redraw() {
  if (!root) return;
  const hp = getPlayerHp();
  const max = getPlayerMaxHp();
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  label.textContent = `HP ${Math.ceil(hp)} / ${max}`;
  fill.style.width = `${pct}%`;
}
