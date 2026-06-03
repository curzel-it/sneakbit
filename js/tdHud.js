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
import { getSprite } from "./assets.js";

let api = {};
let root = null;
let installed = false;

// Live element refs we patch each frame.
let waveEl, phaseEl, goldEl, scoreEl, bestEl, livesEl, heroEl, statusEl, countdownEl;
let readyBtn, recruitBtn, switchBtn, reviveWrap, shopEl, paletteWrap;
// Build-shop cards, keyed by item id (built once, patched each frame).
const paletteCards = new Map();
let gameOver = null, goTitleEl, goWaveEl, goScoreEl, goBestEl, goNewBest = null;

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

// model: { wave, phase, score, highScore, lives, maxLives, countdown, alive,
//          total, activeHeroName, canSwitch, recruit:{cost,can,label},
//          revives:[{index,name,cost}], buildHint }
export function updateTdHud(model) {
  if (!root) return;
  waveEl.textContent = `Wave ${model.wave}`;
  phaseEl.textContent = model.phase;
  goldEl.textContent = String(getGold());
  scoreEl.textContent = String(model.score | 0);
  bestEl.textContent = String(model.highScore | 0);
  heroEl.textContent = model.activeHeroName || "—";

  const lv = model.lives | 0;
  const mx = model.maxLives | 0;
  livesEl.textContent = mx ? `♥ ${lv} / ${mx}` : `♥ ${lv}`;
  livesEl.classList.toggle("td-lives-low", mx > 0 && lv <= Math.ceil(mx * 0.25));
  switchBtn.style.display = model.canSwitch ? "" : "none";

  const build = model.phase === "Build";
  countdownEl.style.display = build && model.countdown != null ? "" : "none";
  if (build && model.countdown != null) {
    countdownEl.textContent = `Next wave in ${Math.ceil(model.countdown)}s`;
  }
  readyBtn.style.display = build ? "" : "none";
  recruitBtn.style.display = build ? "" : "none";

  // Build shop: only meaningful while building.
  shopEl.style.display = build ? "" : "none";
  if (build) renderPalette(model.palette || []);

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
  goTitleEl.textContent = result.title || "Squad defeated";
  goWaveEl.textContent = `You reached wave ${result.wave}`;
  goScoreEl.textContent = `Score: ${result.score | 0}`;
  goBestEl.textContent = `Best: ${result.highScore | 0}`;
  goNewBest.style.display = result.isNewBest ? "" : "none";
  gameOver.style.display = "flex";
}

// Build the shop cards once (the catalog is static), then patch their selected
// / affordable state each frame. Each card shows the item's pixel-art sprite,
// its name and its cost; clicking one tells the controller to switch the active
// build item.
function renderPalette(items) {
  if (paletteCards.size !== items.length) {
    paletteWrap.replaceChildren();
    paletteCards.clear();
    for (const it of items) {
      const icon = el("canvas", { class: "td-shop-icon", width: 30, height: 30 });
      const name = el("span", { class: "td-shop-name", text: it.label });
      const cost = el("span", { class: "td-shop-cost" }, [
        el("span", { class: "td-coin", text: "●" }), ` ${it.cost}`,
      ]);
      const card = el("button", {
        class: "td-shop-item",
        on: { click: () => api.onSelectItem?.(it.id) },
      }, [icon, name, cost]);
      paletteWrap.appendChild(card);
      paletteCards.set(it.id, { card, icon, drawn: false });
    }
  }
  for (const it of items) {
    const entry = paletteCards.get(it.id);
    if (!entry) continue;
    if (!entry.drawn) entry.drawn = drawShopIcon(entry.icon, it.icon);
    entry.card.classList.toggle("td-selected", !!it.selected);
    const blocked = !it.can && !it.selected;
    entry.card.classList.toggle("td-disabled", blocked);
    entry.card.disabled = blocked;
  }
}

// Blit an item's sprite into its shop-icon canvas, scaled to fit while keeping
// the pixel-art aspect ratio (barrels are 1×2). Returns true once drawn —
// sprite sheets load async, so a miss just retries next frame.
function drawShopIcon(canvas, icon) {
  if (!canvas || !icon) return false;
  let sheet;
  try { sheet = getSprite(icon.sheet); } catch { return false; }
  if (!sheet) return false;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const pad = 1;
  const scale = Math.min((canvas.width - pad * 2) / icon.sw, (canvas.height - pad * 2) / icon.sh);
  const dw = Math.round(icon.sw * scale);
  const dh = Math.round(icon.sh * scale);
  const dx = Math.round((canvas.width - dw) / 2);
  const dy = Math.round((canvas.height - dh) / 2);
  ctx.drawImage(sheet, icon.sx, icon.sy, icon.sw, icon.sh, dx, dy, dw, dh);
  return true;
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
  livesEl = el("span", { class: "td-lives-val", text: "♥ —" });
  heroEl = el("span", { class: "td-hero-val", text: "—" });
  statusEl = el("p", { class: "td-status" });
  countdownEl = el("div", { class: "td-countdown" });

  readyBtn = el("button", { class: "td-btn td-primary", text: "Start wave", on: { click: () => api.onReady?.() } });
  recruitBtn = el("button", { class: "td-btn", text: "Recruit hero", on: { click: () => api.onRecruit?.() } });
  switchBtn = el("button", { class: "td-btn td-switch", text: "Switch (Tab)", on: { click: () => api.onSwitch?.() } });
  reviveWrap = el("div", { class: "td-revives" });
  paletteWrap = el("div", { class: "td-shop-items" });
  shopEl = el("div", { class: "td-shop" }, [
    el("div", { class: "td-shop-head" }, [
      el("span", { class: "td-shop-title", text: "Build shop" }),
      el("span", { class: "td-shop-hint", text: "right-click to sell" }),
    ]),
    paletteWrap,
  ]);

  root = el("div", { id: "td-hud", style: { display: "none" } }, [
    el("div", { class: "td-row td-top" }, [
      waveEl, el("span", { class: "td-sep", text: "·" }), phaseEl,
    ]),
    el("div", { class: "td-row td-village" }, [
      el("span", { class: "td-label", text: "Village " }), livesEl,
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
    shopEl,
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
  goTitleEl = el("h1", { text: "Squad defeated" });
  gameOver = el("div", { id: "td-gameover", style: { display: "none" } }, [
    el("div", { class: "td-go-card" }, [
      goTitleEl,
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
    #td-hud .td-village { font-size: 13px; }
    #td-hud .td-lives-val { color: #ff8a8a; font-weight: bold; }
    #td-hud .td-lives-val.td-lives-low { color: #ff3b3b; }
    #td-hud .td-hero-val { color: #9fe6a0; font-weight: bold; }
    #td-hud .td-countdown { color: #ffd966; font-size: 12px; }
    #td-hud .td-status { margin: 2px 0; color: #aaa; font-size: 11px; line-height: 1.4; }
    #td-hud .td-actions { gap: 6px; }
    #td-hud .td-shop {
      display: flex; flex-direction: column; gap: 5px;
      padding: 8px; margin: 2px 0;
      background: rgba(0,0,0,0.22); border: 1px solid #33333f; border-radius: 5px;
    }
    #td-hud .td-shop-head { display: flex; align-items: baseline; justify-content: space-between; }
    #td-hud .td-shop-title { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #cfcfe0; font-weight: bold; }
    #td-hud .td-shop-hint { font-size: 10px; color: #777; }
    #td-hud .td-shop-items { display: flex; flex-direction: column; gap: 4px; }
    #td-hud .td-shop-item {
      display: flex; align-items: center; gap: 9px;
      padding: 5px 8px; text-align: left;
      background: #24242c; color: #eee; border: 1px solid #3a3a46;
      border-radius: 5px; cursor: pointer; font-family: inherit;
    }
    #td-hud .td-shop-item:hover:not(:disabled) { background: #30303c; border-color: #4a4a58; }
    #td-hud .td-shop-item.td-selected {
      background: #34343f; border-color: #ffd966;
      box-shadow: inset 0 0 0 1px #ffd966;
    }
    #td-hud .td-shop-item.td-disabled { opacity: 0.4; cursor: not-allowed; }
    #td-hud .td-shop-icon {
      width: 30px; height: 30px; flex: 0 0 auto;
      image-rendering: pixelated;
      background: #16161c; border-radius: 3px;
    }
    #td-hud .td-shop-name { flex: 1 1 auto; font-size: 12px; }
    #td-hud .td-shop-cost { font-size: 12px; font-weight: bold; color: #ffd966; white-space: nowrap; }
    #td-hud .td-shop-cost .td-coin { color: #ffcf33; font-size: 10px; }
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
  paletteCards.clear();
  root = null; gameOver = null; installed = false; api = {};
}
