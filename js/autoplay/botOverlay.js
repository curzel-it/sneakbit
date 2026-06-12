// On-screen overlay for the stream. Pure DOM, pure display — it reads a
// plain snapshot the orchestrator hands it and never touches game state
// itself (UI lives in the DOM, never the canvas, per the house rules).

import { el } from "../dom.js";

let root = null;
let els = null;

export function installOverlay() {
  if (root || typeof document === "undefined") return root;
  root = el("div", {
    id: "autoplay-overlay",
    html: `
      <div id="ap-title">AUTOPLAY</div>
      <div id="ap-objective">Booting…</div>
      <div id="ap-stats"></div>
      <div id="ap-ticker"></div>
    `,
    style: {
      position: "fixed",
      left: "12px",
      bottom: "12px",
      zIndex: "30",
      maxWidth: "min(360px, 40vw)",
      padding: "10px 12px",
      background: "rgba(8, 10, 16, 0.82)",
      border: "1px solid #3a4150",
      borderRadius: "8px",
      color: "#e6ecff",
      fontFamily: "monospace",
      fontSize: "12px",
      lineHeight: "1.5",
      pointerEvents: "none",
      boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
    },
  });
  document.body.appendChild(root);
  const style = document.createElement("style");
  style.textContent = `
    #autoplay-overlay #ap-title { font-weight: 700; letter-spacing: 2px; color: #8fb0ff; font-size: 11px; }
    #autoplay-overlay #ap-objective { margin-top: 4px; color: #ffe9a8; }
    #autoplay-overlay #ap-stats { margin-top: 4px; color: #9fb0c8; }
    #autoplay-overlay #ap-ticker { margin-top: 6px; color: #7f8aa0; font-size: 11px; white-space: pre-line; }
  `;
  document.head.appendChild(style);
  els = {
    objective: root.querySelector("#ap-objective"),
    stats: root.querySelector("#ap-stats"),
    ticker: root.querySelector("#ap-ticker"),
  };
  return root;
}

// snap = { objective, zoneId, keys, zonesVisited, zoneCount, recent: [str] }
export function updateOverlay(snap) {
  if (!els) return;
  els.objective.textContent = snap.objective ?? "—";
  const bits = [];
  if (snap.zoneId != null) bits.push(`Zone ${snap.zoneId}`);
  if (snap.hp != null && snap.maxHp != null) bits.push(`HP ${Math.ceil(snap.hp)}/${snap.maxHp}`);
  if (snap.keys != null) bits.push(`Keys ${snap.keys}/6`);
  if (snap.zonesVisited != null && snap.zoneCount != null) {
    bits.push(`Zones ${snap.zonesVisited}/${snap.zoneCount}`);
  }
  if (snap.deaths) bits.push(`Deaths ${snap.deaths}`);
  els.stats.textContent = bits.join("   ");
  els.ticker.textContent = (snap.recent ?? []).join("\n");
}
