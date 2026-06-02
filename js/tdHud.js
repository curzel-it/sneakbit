// Tower Defense HUD: the DOM panel for the run. Shows wave / phase / gold /
// score, the build-phase controls (start wave, recruit a hero, revive a downed
// one, a build hint), the active-hero indicator + switch, and the game-over
// screen. Per CLAUDE.md the UI is DOM, never canvas.
//
// Stateless about the run itself — towerDefense.js owns the state machine and
// pushes a fresh model in via updateTdHud each frame; buttons call back through
// the handlers wired at install time.

import { el, showOnly } from "./dom.js";
import { onGoldChange, getGold } from "./arcadeCurrency.js";

let api = {};
let root = null;
let installed = false;

// Live element refs we patch each frame.
let waveEl, phaseEl, goldEl, scoreEl, bestEl, heroEl, statusEl, countdownEl;
let readyBtn, recruitBtn, switchBtn, reviveWrap;
let gameOver = null, goWaveEl, goScoreEl, goBestEl, goNewBest = null;

export function installTdHud(handlers = {}) {
  api = handlers;
  if (installed) return;
  installed = true;
  injectStyles();
  buildPanel();
  buildGameOver();
  document.body.appendChild(root);
  document.body.appendChild(gameOver);
  onGoldChange((g) => { if (goldEl) goldEl.textContent = String(g); });
}

export function showTdHud() {
  if (root) root.style.display = "flex";
}

export function hideTdHud() {
  if (root) root.style.display = "none";
  if (gameOver) gameOver.style.display = "none";
}

// model: { wave, phase, score, highScore, countdown, alive, total,
//          activeHeroName, canSwitch, recruit:{cost,can,label},
//          revives:[{index,name,cost}], buildHint }
export function updateTdHud(model) {
  if (!root) return;
  waveEl.textContent = `Wave ${model.wave}`;
  phaseEl.textContent = model.phase;
  goldEl.textContent = String(getGold());
  scoreEl.textContent = String(model.score | 0);
  bestEl.textContent = String(model.highScore | 0);
  heroEl.textContent = model.activeHeroName || "—";
  switchBtn.style.display = model.canSwitch ? "" : "none";

  const build = model.phase === "Build";
  countdownEl.style.display = build && model.countdown != null ? "" : "none";
  if (build && model.countdown != null) {
    countdownEl.textContent = `Next wave in ${Math.ceil(model.countdown)}s`;
  }
  readyBtn.style.display = build ? "" : "none";
  recruitBtn.style.display = build ? "" : "none";

  // Revives can be bought in any phase (mid-wave at a premium) — show them
  // whenever the controller offers any.
  reviveWrap.style.display = model.revives?.length ? "" : "none";
  renderRevives(model.revives || []);

  if (build) {
    statusEl.textContent = model.buildHint || "Click a tile to build a wall · right-click to remove";
    const r = model.recruit || {};
    recruitBtn.textContent = r.label || `Recruit hero (${r.cost}g)`;
    recruitBtn.disabled = !r.can;
    recruitBtn.classList.toggle("td-disabled", !r.can);
  } else {
    statusEl.textContent = `Enemies left: ${model.alive | 0}` +
      (model.total ? ` / ${model.total}` : "");
  }
}

export function showTdGameOver(result) {
  if (!gameOver) return;
  goWaveEl.textContent = `You reached wave ${result.wave}`;
  goScoreEl.textContent = `Score: ${result.score | 0}`;
  goBestEl.textContent = `Best: ${result.highScore | 0}`;
  goNewBest.style.display = result.isNewBest ? "" : "none";
  gameOver.style.display = "flex";
}

function renderRevives(revives) {
  reviveWrap.replaceChildren();
  for (const r of revives) {
    reviveWrap.appendChild(el("button", {
      class: "td-btn td-revive",
      text: `Revive ${r.name} (${r.cost}g)`,
      on: { click: () => api.onRevive?.(r.index) },
    }));
  }
}

function buildPanel() {
  waveEl = el("span", { class: "td-wave" });
  phaseEl = el("span", { class: "td-phase" });
  goldEl = el("span", { class: "td-gold-val", text: "0" });
  scoreEl = el("span", { class: "td-score-val", text: "0" });
  bestEl = el("span", { class: "td-best-val", text: "0" });
  heroEl = el("span", { class: "td-hero-val", text: "—" });
  statusEl = el("p", { class: "td-status" });
  countdownEl = el("div", { class: "td-countdown" });

  readyBtn = el("button", { class: "td-btn td-primary", text: "Start wave", on: { click: () => api.onReady?.() } });
  recruitBtn = el("button", { class: "td-btn", text: "Recruit hero", on: { click: () => api.onRecruit?.() } });
  switchBtn = el("button", { class: "td-btn td-switch", text: "Switch (Tab)", on: { click: () => api.onSwitch?.() } });
  reviveWrap = el("div", { class: "td-revives" });

  root = el("div", { id: "td-hud", style: { display: "none" } }, [
    el("div", { class: "td-row td-top" }, [
      waveEl, el("span", { class: "td-sep", text: "·" }), phaseEl,
    ]),
    el("div", { class: "td-row td-stats" }, [
      el("span", { class: "td-stat" }, [el("span", { class: "td-label", text: "Gold " }), goldEl]),
      el("span", { class: "td-stat" }, [el("span", { class: "td-label", text: "Score " }), scoreEl]),
      el("span", { class: "td-stat" }, [el("span", { class: "td-label", text: "Best " }), bestEl]),
    ]),
    el("div", { class: "td-row td-hero" }, [
      el("span", { class: "td-label", text: "Driving: " }), heroEl, switchBtn,
    ]),
    countdownEl,
    statusEl,
    el("div", { class: "td-row td-actions" }, [readyBtn, recruitBtn]),
    reviveWrap,
  ]);
}

function buildGameOver() {
  goWaveEl = el("p", { class: "td-go-wave" });
  goScoreEl = el("p", { class: "td-go-score" });
  goBestEl = el("p", { class: "td-go-best" });
  goNewBest = el("p", { class: "td-go-newbest", text: "New best!", style: { display: "none" } });
  gameOver = el("div", { id: "td-gameover", style: { display: "none" } }, [
    el("div", { class: "td-go-card" }, [
      el("h1", { text: "Squad defeated" }),
      goWaveEl, goScoreEl, goBestEl, goNewBest,
      el("div", { class: "td-row td-actions" }, [
        el("button", { class: "td-btn td-primary", text: "Play again", on: { click: () => api.onRestart?.() } }),
        el("button", { class: "td-btn", text: "Exit", on: { click: () => api.onExit?.() } }),
      ]),
    ]),
  ]);
}

function injectStyles() {
  if (typeof document === "undefined" || document.getElementById("td-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "td-hud-styles";
  style.textContent = `
    #td-hud {
      position: fixed; top: 12px; right: 12px; z-index: 14;
      display: none; flex-direction: column; gap: 6px;
      min-width: 220px; padding: 12px 14px;
      background: var(--sb-surface-bg, rgba(20,20,28,0.86));
      border: var(--sb-surface-border, 1px solid #3a3a4a);
      border-radius: var(--sb-surface-radius, 6px);
      color: var(--sb-text, #eee); font-family: var(--sb-font, monospace); font-size: 13px;
      user-select: none;
    }
    #td-hud .td-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    #td-hud .td-top { font-size: 15px; font-weight: bold; letter-spacing: 1px; }
    #td-hud .td-phase { color: #7fd1ff; }
    #td-hud .td-sep { color: #666; }
    #td-hud .td-stats { gap: 14px; }
    #td-hud .td-label { color: #8a8a96; }
    #td-hud .td-gold-val { color: #ffd966; font-weight: bold; }
    #td-hud .td-score-val, #td-hud .td-best-val { color: #eee; }
    #td-hud .td-hero-val { color: #9fe6a0; font-weight: bold; }
    #td-hud .td-countdown { color: #ffd966; font-size: 12px; }
    #td-hud .td-status { margin: 2px 0; color: #aaa; font-size: 11px; line-height: 1.4; }
    #td-hud .td-actions { gap: 6px; }
    #td-hud .td-revives { display: flex; flex-direction: column; gap: 4px; }
    #td-hud .td-btn {
      background: #2a2a32; color: #eee; border: 1px solid #44444f;
      padding: 6px 10px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    #td-hud .td-btn:hover:not(:disabled) { background: #353541; }
    #td-hud .td-primary { background: #2a4a32; border-color: #3f6b4a; }
    #td-hud .td-primary:hover:not(:disabled) { background: #335a3d; }
    #td-hud .td-revive { background: #4a2a2a; border-color: #6b3f3f; }
    #td-hud .td-switch { margin-left: auto; padding: 3px 8px; font-size: 11px; }
    #td-hud .td-btn:disabled, #td-hud .td-btn.td-disabled { opacity: 0.45; cursor: not-allowed; }
    #td-gameover {
      position: fixed; inset: 0; z-index: 22;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.66); backdrop-filter: blur(2px);
      color: #eee; font-family: monospace;
    }
    #td-gameover .td-go-card {
      background: var(--sb-card-bg, #16161e); border: var(--sb-card-border, 1px solid #3a3a4a);
      border-radius: var(--sb-card-radius, 8px); padding: 28px 32px; text-align: center;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5); min-width: 280px;
    }
    #td-gameover h1 { margin: 0 0 16px; font-size: 20px; letter-spacing: 1px; }
    #td-gameover p { margin: 6px 0; }
    #td-gameover .td-go-newbest { color: #ffd966; font-weight: bold; }
    #td-gameover .td-actions { justify-content: center; margin-top: 18px; }
  `;
  document.head.appendChild(style);
}

// Test seam.
export function _resetTdHudForTesting() {
  if (root?.parentNode) root.parentNode.removeChild(root);
  if (gameOver?.parentNode) gameOver.parentNode.removeChild(gameOver);
  root = null; gameOver = null; installed = false; api = {};
}
