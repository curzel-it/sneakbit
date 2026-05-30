// PvP turn HUD — a DOM overlay (per CLAUDE.md: UI lives in the DOM, not on
// the canvas) showing whose turn it is and the countdown. Driven each
// frame by main.js from pvpMatch's turn state; it computes nothing itself.
//
//   prep   → "Player N's turn in 3..." (the breather between turns)
//   active → "Player N's turn" + a big seconds counter; flashes the
//            "Hit! Turn ending…" note when the turn was clamped to ≤2s.

import { tr } from "./strings.js?v=20260530g";

let root = null;
let labelEl = null;
let timeEl = null;
let noteEl = null;

export function installTurnHud() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "turnhud";
  root.innerHTML = `
    <div class="th-label"></div>
    <div class="th-time"></div>
    <div class="th-note"></div>
  `;
  Object.assign(root.style, {
    position: "fixed",
    top: "14px",
    left: "50%",
    transform: "translateX(-50%)",
    display: "none",
    textAlign: "center",
    pointerEvents: "none",
    zIndex: "8",
    color: "#e8e2cf",
    fontFamily: "monospace",
    textShadow: "0 2px 6px rgba(0,0,0,0.85)",
  });
  document.body.appendChild(root);
  labelEl = root.querySelector(".th-label");
  timeEl = root.querySelector(".th-time");
  noteEl = root.querySelector(".th-note");
  injectStyles();
  return root;
}

// Render the given turn object (from pvpMatch.getTurn()). Anything that
// isn't a prep/active turn hides the HUD.
export function updateTurnHud(turn) {
  if (!root) return;
  if (!turn || (turn.kind !== "prep" && turn.kind !== "player")) {
    hideTurnHud();
    return;
  }
  const name = String((turn.playerIndex | 0) + 1);
  const secs = Math.max(0, Math.ceil(turn.timeRemaining));

  if (turn.kind === "prep") {
    labelEl.textContent = tr("prep_for_next_turn")
      .replace("%PLAYER_NAME%", name)
      .replace("%TIME%", String(secs));
    timeEl.textContent = "";
    noteEl.textContent = "";
  } else {
    labelEl.textContent = tr("turn.player_turn").replace("%PLAYER_NAME%", name);
    timeEl.textContent = String(secs);
    noteEl.textContent = turn.didReduce ? tr("turn.after_hit") : "";
  }
  root.classList.toggle("th-urgent", turn.kind === "player" && turn.didReduce);
  root.style.display = "block";
}

export function hideTurnHud() {
  if (root) root.style.display = "none";
}

function injectStyles() {
  if (document.getElementById("turnhud-styles")) return;
  const css = `
    #turnhud .th-label { font-size: 14px; letter-spacing: 1px; }
    #turnhud .th-time { font-size: 34px; font-weight: bold; line-height: 1.1; }
    #turnhud .th-note { font-size: 12px; color: #f0c27a; min-height: 14px; }
    #turnhud.th-urgent .th-time { color: #f06a4a; }
  `;
  const style = document.createElement("style");
  style.id = "turnhud-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
