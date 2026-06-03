// Tower Defense HUD: the DOM for the run. Two pieces, both DOM (never canvas,
// per CLAUDE.md):
//
//   • a compact, always-visible STATUS BAR (#td-hud) — wave / phase / gold /
//     lives / score plus the button that opens the controls dialog. It sits
//     top-centre, clear of the touch menu/pause button (top-right) so on mobile
//     the pause control is never covered.
//   • a dismissible CONTROLS DIALOG (#td-panel) — the build shop, start-wave /
//     recruit / switch actions, revives, and the build hint. Open/close it from
//     the status bar; it has no opaque backdrop, so the board and the bottom
//     touch controls (d-pad / actions) stay reachable behind it.
//
// Stateless about the run itself — towerDefense.js owns the state machine and
// pushes a fresh model in via updateTdHud each frame; buttons call back through
// the handlers wired at install time. The dialog is plain UI chrome: it does NOT
// pause the sim (mid-wave revive stays a live, premium decision) and does NOT
// bind Escape (Escape stays the pause menu).

import { el } from "./dom.js";
import { onGoldChange, getGold } from "./arcadeCurrency.js";
import { getSprite } from "./assets.js";

let api = {};
let root = null;       // the status bar (#td-hud)
let panel = null;      // the controls dialog (#td-panel)
let installed = false;
let panelOpen = false;
let lastPhase = null;  // tracks Build entry so we can auto-open the dialog once

// Status-bar element refs.
let waveEl, phaseEl, goldEl, livesEl, scoreEl, toggleBtn;
// Dialog element refs.
let panelTitleEl, bestEl, heroEl, statusEl, countdownEl;
let readyBtn, recruitBtn, switchBtn, reviveWrap, shopEl, paletteWrap;
// Build-shop cards, keyed by item id (built once, patched each frame).
const paletteCards = new Map();
let gameOver = null, goTitleEl, goWaveEl, goScoreEl, goBestEl, goNewBest = null;

export function installTdHud(handlers = {}) {
  api = handlers;
  if (installed) return;
  installed = true;
  injectStyles();
  buildStatusBar();
  buildControlsDialog();
  buildGameOver();
  document.body.appendChild(root);
  document.body.appendChild(panel);
  document.body.appendChild(gameOver);
  onGoldChange((g) => { if (goldEl) goldEl.textContent = String(g); });
}

export function showTdHud() {
  if (root) root.style.display = "flex";
  applyPanelVisibility();
}

export function hideTdHud() {
  if (root) root.style.display = "none";
  if (panel) panel.style.display = "none";
  if (gameOver) gameOver.style.display = "none";
}

// — Dialog open/close ————————————————————————————————————————————————————
function openPanel() { panelOpen = true; applyPanelVisibility(); }
function closePanel() { panelOpen = false; applyPanelVisibility(); }
function togglePanel() { panelOpen = !panelOpen; applyPanelVisibility(); }

function applyPanelVisibility() {
  if (!panel) return;
  // Only show the dialog while the run HUD itself is showing.
  const hudShowing = root && root.style.display !== "none";
  panel.style.display = hudShowing && panelOpen ? "flex" : "none";
  if (toggleBtn) toggleBtn.classList.toggle("td-open", panelOpen);
}

// model: { wave, phase, score, highScore, lives, maxLives, countdown, alive,
//          total, activeHeroName, canSwitch, recruit:{cost,can,label},
//          revives:[{index,name,cost}], buildHint, palette }
export function updateTdHud(model) {
  if (!root) return;
  const build = model.phase === "Build";

  // Auto-open the dialog the first frame we enter the build phase, so a new
  // player sees their options. Manual toggle takes over after that.
  if (model.phase !== lastPhase) {
    if (build) openPanel();
    lastPhase = model.phase;
  }

  // — Status bar —————————————————————————————————————————————————————————
  waveEl.textContent = `Wave ${model.wave}`;
  phaseEl.textContent = model.phase;
  goldEl.textContent = String(getGold());
  scoreEl.textContent = String(model.score | 0);

  const lv = model.lives | 0;
  const mx = model.maxLives | 0;
  livesEl.textContent = mx ? `♥ ${lv}/${mx}` : `♥ ${lv}`;
  livesEl.classList.toggle("td-lives-low", mx > 0 && lv <= Math.ceil(mx * 0.25));

  // Toggle label: phase word + the build countdown inline.
  const cd = build && model.countdown != null ? ` ${Math.ceil(model.countdown)}s` : "";
  toggleBtn.textContent = `${build ? "Build" : "Squad"}${cd}`;

  // — Dialog —————————————————————————————————————————————————————————————
  panelTitleEl.textContent = build ? "Build phase" : `Wave ${model.wave}`;
  bestEl.textContent = String(model.highScore | 0);
  heroEl.textContent = model.activeHeroName || "—";
  switchBtn.style.display = model.canSwitch ? "" : "none";

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
    statusEl.textContent = model.buildHint || "Pick a barrel, then tap a tile to place it";
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

// — The status bar — compact, always visible during a run ————————————————
function buildStatusBar() {
  waveEl = el("span", { class: "td-wave" });
  phaseEl = el("span", { class: "td-phase" });
  goldEl = el("span", { class: "td-gold-val", text: "0" });
  scoreEl = el("span", { class: "td-score-val", text: "0" });
  livesEl = el("span", { class: "td-lives-val", text: "♥ —" });
  toggleBtn = el("button", {
    class: "td-toggle",
    text: "Build",
    title: "Open / close the build & squad controls",
    on: { click: togglePanel },
  });

  root = el("div", { id: "td-hud", style: { display: "none" } }, [
    el("span", { class: "td-bar-group td-bar-wave" }, [
      waveEl, el("span", { class: "td-sep", text: "·" }), phaseEl,
    ]),
    el("span", { class: "td-bar-group" }, [
      el("span", { class: "td-stat td-stat-lives" }, [livesEl]),
      el("span", { class: "td-stat" }, [el("span", { class: "td-coin", text: "●" }), " ", goldEl]),
      el("span", { class: "td-stat td-stat-score" }, [el("span", { class: "td-label", text: "Score " }), scoreEl]),
    ]),
    toggleBtn,
  ]);
}

// — The controls dialog — openable / closable ————————————————————————————
function buildControlsDialog() {
  panelTitleEl = el("span", { class: "td-panel-title", text: "Build phase" });
  bestEl = el("span", { class: "td-best-val", text: "0" });
  heroEl = el("span", { class: "td-hero-val", text: "—" });
  statusEl = el("p", { class: "td-status" });
  countdownEl = el("div", { class: "td-countdown" });

  readyBtn = el("button", { class: "td-btn td-primary", text: "Start wave", on: { click: () => api.onReady?.() } });
  recruitBtn = el("button", { class: "td-btn", text: "Recruit hero", on: { click: () => api.onRecruit?.() } });
  switchBtn = el("button", { class: "td-btn td-switch", text: "Switch hero", on: { click: () => api.onSwitch?.() } });
  reviveWrap = el("div", { class: "td-revives" });
  paletteWrap = el("div", { class: "td-shop-items" });
  shopEl = el("div", { class: "td-shop" }, [
    el("div", { class: "td-shop-head" }, [
      el("span", { class: "td-shop-title", text: "Build shop" }),
      el("span", { class: "td-shop-hint", text: "tap a tile to place" }),
    ]),
    paletteWrap,
  ]);

  panel = el("div", { id: "td-panel", style: { display: "none" } }, [
    el("div", { class: "td-panel-head" }, [
      panelTitleEl,
      el("button", { class: "td-panel-close", text: "✕", title: "Close", on: { click: closePanel } }),
    ]),
    el("div", { class: "td-row td-hero" }, [
      el("span", { class: "td-label", text: "Driving: " }), heroEl, switchBtn,
    ]),
    countdownEl,
    shopEl,
    statusEl,
    el("div", { class: "td-row td-actions" }, [readyBtn, recruitBtn]),
    reviveWrap,
    el("div", { class: "td-row td-best" }, [
      el("span", { class: "td-label", text: "Best " }), bestEl,
    ]),
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
    /* — Status bar: top-centre, clear of the top-right pause button — */
    #td-hud {
      position: fixed; top: 8px; left: 50%; transform: translateX(-50%);
      z-index: 14; display: none; align-items: center; gap: 10px;
      flex-wrap: wrap; justify-content: center; max-width: 96vw;
      padding: 7px 12px;
      background: var(--sb-surface-bg, rgba(20,20,28,0.86));
      border: var(--sb-surface-border, 1px solid #3a3a4a);
      border-radius: var(--sb-surface-radius, 6px);
      color: var(--sb-text, #eee); font-family: var(--sb-font, monospace); font-size: 13px;
      user-select: none;
    }
    #td-hud .td-bar-group { display: flex; align-items: center; gap: 10px; }
    #td-hud .td-bar-wave { font-weight: bold; letter-spacing: 1px; }
    #td-hud .td-phase { color: #7fd1ff; }
    #td-hud .td-sep { color: #666; }
    #td-hud .td-stat { display: flex; align-items: center; gap: 4px; }
    #td-hud .td-label { color: #8a8a96; }
    #td-hud .td-coin { color: #ffcf33; font-size: 10px; }
    #td-hud .td-gold-val { color: #ffd966; font-weight: bold; }
    #td-hud .td-score-val { color: #eee; }
    #td-hud .td-lives-val { color: #ff8a8a; font-weight: bold; }
    #td-hud .td-lives-val.td-lives-low { color: #ff3b3b; }
    #td-hud .td-toggle {
      background: #2a4a32; color: #eee; border: 1px solid #3f6b4a;
      padding: 6px 12px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 12px; font-weight: bold; white-space: nowrap;
    }
    #td-hud .td-toggle:hover { background: #335a3d; }
    #td-hud .td-toggle.td-open { background: #34343f; border-color: #ffd966; }

    /* — Controls dialog: below the bar, no backdrop, bottom controls free — */
    #td-panel {
      position: fixed; top: 56px; left: 50%; transform: translateX(-50%);
      z-index: 15; display: none; flex-direction: column; gap: 7px;
      width: min(92vw, 360px); max-height: 62vh; overflow-y: auto;
      padding: 12px 14px;
      background: var(--sb-surface-bg, rgba(20,20,28,0.94));
      border: var(--sb-surface-border, 1px solid #3a3a4a);
      border-radius: var(--sb-surface-radius, 6px);
      color: var(--sb-text, #eee); font-family: var(--sb-font, monospace); font-size: 13px;
      user-select: none;
      box-shadow: 0 8px 30px rgba(0,0,0,0.45);
    }
    #td-panel .td-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    #td-panel .td-panel-head { display: flex; align-items: center; justify-content: space-between; }
    #td-panel .td-panel-title { font-size: 14px; font-weight: bold; letter-spacing: 1px; color: #cfcfe0; }
    #td-panel .td-panel-close {
      width: 30px; height: 30px; flex: 0 0 auto;
      background: #2a2a32; color: #ddd; border: 1px solid #44444f;
      border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 14px; line-height: 1;
    }
    #td-panel .td-panel-close:hover { background: #353541; }
    #td-panel .td-label { color: #8a8a96; }
    #td-panel .td-hero-val { color: #9fe6a0; font-weight: bold; }
    #td-panel .td-best-val { color: #eee; }
    #td-panel .td-countdown { color: #ffd966; font-size: 12px; }
    #td-panel .td-status { margin: 2px 0; color: #aaa; font-size: 11px; line-height: 1.4; }
    #td-panel .td-actions { gap: 6px; }
    #td-panel .td-best { font-size: 12px; }
    #td-panel .td-shop {
      display: flex; flex-direction: column; gap: 5px;
      padding: 8px; margin: 2px 0;
      background: rgba(0,0,0,0.22); border: 1px solid #33333f; border-radius: 5px;
    }
    #td-panel .td-shop-head { display: flex; align-items: baseline; justify-content: space-between; }
    #td-panel .td-shop-title { font-size: 11px; letter-spacing: 1px; text-transform: uppercase; color: #cfcfe0; font-weight: bold; }
    #td-panel .td-shop-hint { font-size: 10px; color: #777; }
    #td-panel .td-shop-items { display: flex; flex-direction: column; gap: 4px; }
    #td-panel .td-shop-item {
      display: flex; align-items: center; gap: 9px;
      padding: 7px 8px; text-align: left;
      background: #24242c; color: #eee; border: 1px solid #3a3a46;
      border-radius: 5px; cursor: pointer; font-family: inherit;
    }
    #td-panel .td-shop-item:hover:not(:disabled) { background: #30303c; border-color: #4a4a58; }
    #td-panel .td-shop-item.td-selected {
      background: #34343f; border-color: #ffd966;
      box-shadow: inset 0 0 0 1px #ffd966;
    }
    #td-panel .td-shop-item.td-disabled { opacity: 0.4; cursor: not-allowed; }
    #td-panel .td-shop-icon {
      width: 30px; height: 30px; flex: 0 0 auto;
      image-rendering: pixelated;
      background: #16161c; border-radius: 3px;
    }
    #td-panel .td-shop-name { flex: 1 1 auto; font-size: 12px; }
    #td-panel .td-shop-cost { font-size: 12px; font-weight: bold; color: #ffd966; white-space: nowrap; }
    #td-panel .td-shop-cost .td-coin { color: #ffcf33; font-size: 10px; }
    #td-panel .td-revives { display: flex; flex-direction: column; gap: 4px; }
    #td-panel .td-btn {
      background: #2a2a32; color: #eee; border: 1px solid #44444f;
      padding: 7px 12px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    #td-panel .td-btn:hover:not(:disabled) { background: #353541; }
    #td-panel .td-primary { background: #2a4a32; border-color: #3f6b4a; }
    #td-panel .td-primary:hover:not(:disabled) { background: #335a3d; }
    #td-panel .td-revive { background: #4a2a2a; border-color: #6b3f3f; }
    #td-panel .td-switch { margin-left: auto; padding: 5px 10px; font-size: 11px; }
    #td-panel .td-btn:disabled, #td-panel .td-btn.td-disabled { opacity: 0.45; cursor: not-allowed; }

    /* Touch: roomier tap targets so the dialog is thumb-usable. */
    @media (pointer: coarse) {
      #td-hud .td-toggle, #td-panel .td-btn, #td-panel .td-panel-close { min-height: 44px; }
      #td-panel .td-shop-item { min-height: 44px; }
      #td-panel { width: min(94vw, 380px); }
    }

    /* Narrow screens: the top edge is shared by the HP bar (left) and the
       touch menu/pause button (right), with no horizontal room left for a
       centred status bar. Drop the TD bar (and the dialog under it) to a
       second row so all three stay legible and the pause button is reachable. */
    @media (max-width: 820px) {
      #td-hud { top: 62px; }
      #td-panel { top: 112px; max-height: 56vh; }
    }

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
    #td-gameover .td-btn {
      background: #2a2a32; color: #eee; border: 1px solid #44444f;
      padding: 8px 14px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    #td-gameover .td-btn:hover { background: #353541; }
    #td-gameover .td-primary { background: #2a4a32; border-color: #3f6b4a; }
  `;
  document.head.appendChild(style);
}

// Test seam.
export function _resetTdHudForTesting() {
  if (root?.parentNode) root.parentNode.removeChild(root);
  if (panel?.parentNode) panel.parentNode.removeChild(panel);
  if (gameOver?.parentNode) gameOver.parentNode.removeChild(gameOver);
  paletteCards.clear();
  root = null; panel = null; gameOver = null; installed = false; api = {};
  panelOpen = false; lastPhase = null;
}
