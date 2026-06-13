// Tower Defense HUD: the DOM for the run. Two always-on, edge-docked pieces
// (both DOM, never canvas, per CLAUDE.md) so the centre playfield — where the
// camera keeps the active hero — is never covered:
//
//   • a compact top STATUS BAR (#td-hud) — wave / phase / lives / gold / score.
//     Top-centre, clear of the top-right pause button.
//   • a bottom BUILD DOCK (#td-dock) — the prominent wave countdown + progress
//     bar + "Start wave" call-early button, and the recruit / switch / revive
//     actions. Bottom-centre, between the touch controls' bottom corners. It
//     never overlaps the hero, so there's nothing to "look behind": you shove
//     stones and move at the same time.
//
// Both follow the Kingdom Rush / Bloons convention — UI lives at the screen
// edges, not in a modal over the field. The dock's content swaps by phase: a
// countdown-to-next-wave while building, an enemies-remaining bar while a wave
// is live. Nothing here pauses the sim or binds Escape (Escape is the pause
// menu).
//
// Stateless about the run itself — towerDefense.js owns the state machine and
// pushes a fresh model in via updateTdHud each frame; buttons call back through
// the handlers wired at install time.

import { el } from "./dom.js";
import { onGoldChange, getGold } from "./arcadeCurrency.js";
import { setTdActionMode } from "./touch.js";

let api = {};
let root = null;       // the status bar (#td-hud)
let dock = null;       // the build dock (#td-dock)
let installed = false;

// Status-bar refs.
let waveEl, phaseEl, goldEl, livesEl, scoreEl;
// Dock refs.
let dockLabelEl, dockValEl, progFillEl, startBtn, recruitBtn, switchBtn, hintEl;
let reviveWrap;
let reviveSig = "";   // signature of the rendered revive set (see renderRevives)
// Game-over refs.
let gameOver = null, goTitleEl, goWaveEl, goScoreEl, goBestEl, goNewBest = null;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

export function installTdHud(handlers = {}) {
  api = handlers;
  if (installed) return;
  installed = true;
  injectStyles();
  buildStatusBar();
  buildDock();
  buildGameOver();
  document.body.appendChild(root);
  document.body.appendChild(dock);
  document.body.appendChild(gameOver);
  onGoldChange((g) => { if (goldEl) goldEl.textContent = String(g); });
}

export function showTdHud() {
  if (root) root.style.display = "flex";
  if (dock) dock.style.display = "flex";
}

export function hideTdHud() {
  if (root) root.style.display = "none";
  if (dock) dock.style.display = "none";
  if (gameOver) gameOver.style.display = "none";
  setTdActionMode(null); // hand the touch cluster back to the normal game
}

// model: { wave, phase, score, highScore, lives, maxLives, countdown,
//          countdownMax, earlyBonus, alive, total, activeHeroName, canSwitch,
//          recruit:{cost,can,label}, revives:[{index,name,cost}], buildHint }
export function updateTdHud(model) {
  if (!root) return;
  const build = model.phase === "Build";
  const wave = model.phase === "Wave";
  const touch = onTouch();

  // The dock restyles by phase on touch: a slim, bottom-anchored progress strip
  // during a wave (see injectStyles), the full build panel otherwise.
  dock.classList.toggle("td-dock-build", build);
  dock.classList.toggle("td-dock-wave", wave);

  // — Top status bar (same shape every frame) —————————————————————————————
  waveEl.textContent = `Wave ${model.wave}`;
  phaseEl.textContent = model.phase;
  phaseEl.classList.toggle("td-phase-build", build);
  phaseEl.classList.toggle("td-phase-wave", wave);
  // Guests don't run the local economy — they show the host's gold from the
  // model. Host/local fall back to the live wallet (kept ticking via onGoldChange).
  goldEl.textContent = String(model.gold ?? getGold());
  scoreEl.textContent = String(model.score | 0);
  const lv = model.lives | 0;
  const mx = model.maxLives | 0;
  livesEl.textContent = mx ? `♥ ${lv}/${mx}` : `♥ ${lv}`;
  livesEl.classList.toggle("td-lives-low", mx > 0 && lv <= Math.ceil(mx * 0.25));

  // — Dock: countdown (build) or wave-progress (wave) —————————————————————
  if (build) {
    const cd = Math.max(0, model.countdown ?? 0);
    dockLabelEl.textContent = "Next wave";
    dockValEl.textContent = `${Math.ceil(cd)}s`;
    setProgress(progFillEl, model.countdownMax > 0 ? cd / model.countdownMax : 0, "time");
    // On touch the Start button lives in the action cluster (see touch.js), so
    // the dock keeps only its slim countdown strip.
    startBtn.style.display = touch ? "none" : "";
    startBtn.textContent = model.earlyBonus > 0
      ? `Start wave ▶  +${model.earlyBonus}g`
      : "Start wave ▶";
  } else {
    const left = model.alive | 0;
    const total = model.total | 0;
    dockLabelEl.textContent = wave ? `Wave ${model.wave}` : model.phase;
    dockValEl.textContent = total ? `${left} left` : `${left}`;
    setProgress(progFillEl, total > 0 ? (total - left) / total : 0, "wave");
    startBtn.style.display = "none";
  }

  hintEl.textContent = build
    ? (onTouch() ? "Walk into a stone to push it" : (model.buildHint || "Push the stones to shape the path"))
    : "Defend the village!";

  // — Actions —————————————————————————————————————————————————————————————
  // Read-only (online guest): the economy is host-driven in v1, so hide every
  // action and don't claim the touch cluster — the guest only watches the bars.
  if (model.readOnly) {
    startBtn.style.display = "none";
    recruitBtn.style.display = "none";
    switchBtn.style.display = "none";
    reviveWrap.style.display = "none";
    setTdActionMode(null);
    return;
  }
  // On touch the recruit/switch buttons move into the action cluster, so the
  // dock shows them only on desktop (where there's no cluster).
  recruitBtn.style.display = (build && !touch) ? "" : "none";
  if (build && !touch) {
    const r = model.recruit || {};
    recruitBtn.textContent = r.label || `Recruit hero (${r.cost}g)`;
    recruitBtn.disabled = !r.can;
    recruitBtn.classList.toggle("td-disabled", !r.can);
  }
  switchBtn.style.display = (model.canSwitch && !(touch && (build || wave))) ? "" : "none";

  // Revives can be bought in any phase (mid-wave at a premium).
  reviveWrap.style.display = model.revives?.length ? "" : "none";
  renderRevives(model.revives || []);

  // Hand the touch action cluster the current TD verb. During build there's
  // nothing to tap — movement shoves stones — so the action buttons hide.
  setTdActionMode(build ? "build" : (wave ? "wave" : null), {
    canSwitch: model.canSwitch,
    earlyBonus: model.earlyBonus | 0,
    recruit: model.recruit,
    onStart: api.onReady,
    onRecruit: api.onRecruit,
  });
}

// Are we driving with touch? The body class is toggled by touch.js when the
// on-screen controls show.
function onTouch() {
  return typeof document !== "undefined" && document.body.classList.contains("touch-mode");
}

function setProgress(fill, frac, kind) {
  fill.style.width = `${Math.round(clamp01(frac) * 100)}%`;
  fill.classList.toggle("td-prog-time", kind === "time");
  fill.classList.toggle("td-prog-wave", kind === "wave");
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

// Rebuilding these buttons every frame (the dock model is pushed each tick)
// would swap each <button> out from under the pointer between mousedown and
// mouseup, so the click never lands — the element under the cursor at release
// is a brand-new node. Only re-render when the revive set actually changes;
// identical frames keep the same stable, clickable buttons.
function renderRevives(revives) {
  const sig = revives.map((r) => `${r.index}:${r.name}:${r.cost}`).join("|");
  if (sig === reviveSig) return;
  reviveSig = sig;
  reviveWrap.replaceChildren();
  for (const r of revives) {
    reviveWrap.appendChild(el("button", {
      class: "td-btn td-revive",
      text: `Revive ${r.name} (${r.cost}g)`,
      on: { click: () => api.onRevive?.(r.index) },
    }));
  }
}

// — Top status bar — compact, always visible during a run ——————————————————
function buildStatusBar() {
  waveEl = el("span", { class: "td-wave" });
  phaseEl = el("span", { class: "td-phase" });
  goldEl = el("span", { class: "td-gold-val", text: "0" });
  scoreEl = el("span", { class: "td-score-val", text: "0" });
  livesEl = el("span", { class: "td-lives-val", text: "♥ —" });

  root = el("div", { id: "td-hud", style: { display: "none" } }, [
    el("span", { class: "td-bar-group td-bar-wave" }, [
      waveEl, el("span", { class: "td-sep", text: "·" }), phaseEl,
    ]),
    el("span", { class: "td-bar-group" }, [
      el("span", { class: "td-stat td-stat-lives" }, [livesEl]),
      el("span", { class: "td-stat" }, [el("span", { class: "td-coin", text: "●" }), " ", goldEl]),
      el("span", { class: "td-stat td-stat-score" }, [el("span", { class: "td-label", text: "Score " }), scoreEl]),
    ]),
  ]);
}

// — Bottom build dock — countdown + actions, edge-docked ————————————————————
function buildDock() {
  dockLabelEl = el("span", { class: "td-dock-label", text: "Next wave" });
  dockValEl = el("span", { class: "td-dock-val", text: "—" });
  progFillEl = el("div", { class: "td-prog-fill" });
  startBtn = el("button", {
    class: "td-btn td-primary td-start",
    text: "Start wave ▶",
    on: { click: () => api.onReady?.() },
  });

  const timerRow = el("div", { class: "td-dock-timer" }, [
    dockLabelEl,
    el("div", { class: "td-prog" }, [progFillEl]),
    dockValEl,
    startBtn,
  ]);

  recruitBtn = el("button", { class: "td-btn", text: "Recruit hero", on: { click: () => api.onRecruit?.() } });
  switchBtn = el("button", { class: "td-btn td-switch", text: "Switch hero", on: { click: () => api.onSwitch?.() } });
  reviveWrap = el("div", { class: "td-revives" });

  const mainRow = el("div", { class: "td-dock-main" }, [
    el("div", { class: "td-dock-actions" }, [recruitBtn, switchBtn, reviveWrap]),
  ]);

  hintEl = el("span", { class: "td-dock-hint" });

  dock = el("div", { id: "td-dock", style: { display: "none" } }, [timerRow, mainRow, hintEl]);
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
    #td-hud .td-phase { padding: 1px 7px; border-radius: var(--sb-surface-radius); font-size: 11px; font-weight: bold; letter-spacing: 1px; }
    #td-hud .td-phase.td-phase-build { color: #0d160f; background: #8fe6a0; }
    #td-hud .td-phase.td-phase-wave { color: #1a0d0d; background: #ff9b6b; }
    #td-hud .td-sep { color: #666; }
    #td-hud .td-stat { display: flex; align-items: center; gap: 4px; }
    #td-hud .td-label { color: #8a8a96; }
    #td-hud .td-coin { color: #ffcf33; font-size: 10px; }
    #td-hud .td-gold-val { color: #ffd966; font-weight: bold; }
    #td-hud .td-score-val { color: #eee; }
    #td-hud .td-lives-val { color: #ff8a8a; font-weight: bold; }
    #td-hud .td-lives-val.td-lives-low { color: #ff3b3b; }

    /* — Build dock: bottom-centre, between the touch controls' corners — */
    #td-dock {
      position: fixed; bottom: 10px; left: 50%; transform: translateX(-50%);
      z-index: 14; display: none; flex-direction: column; gap: 7px;
      width: min(96vw, 600px); padding: 9px 12px;
      background: var(--sb-surface-bg, rgba(20,20,28,0.92));
      border: var(--sb-surface-border, 1px solid #3a3a4a);
      border-radius: var(--sb-surface-radius, 6px);
      color: var(--sb-text, #eee); font-family: var(--sb-font, monospace); font-size: 13px;
      user-select: none;
      box-shadow: 0 6px 24px rgba(0,0,0,0.4);
    }
    #td-dock .td-dock-timer { display: flex; align-items: center; gap: 10px; }
    #td-dock .td-dock-label { font-weight: bold; color: #cfcfe0; white-space: nowrap; }
    #td-dock .td-dock-val {
      color: #ffd966; font-weight: bold; min-width: 48px; text-align: right;
      font-variant-numeric: tabular-nums; white-space: nowrap;
    }
    #td-dock .td-prog {
      flex: 1 1 auto; height: 12px; min-width: 80px;
      background: #15151c; border: 1px solid #33333f; border-radius: var(--sb-surface-radius); overflow: hidden;
    }
    #td-dock .td-prog-fill { height: 100%; width: 0%; border-radius: var(--sb-surface-radius); transition: width 0.18s linear; }
    #td-dock .td-prog-fill.td-prog-time { background: linear-gradient(90deg, #ffb338, #ffd966); }
    #td-dock .td-prog-fill.td-prog-wave { background: linear-gradient(90deg, #4a9b5a, #8fe6a0); }
    #td-dock .td-start { white-space: nowrap; flex: 0 0 auto; }

    #td-dock .td-dock-main { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    #td-dock .td-dock-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-left: auto; }
    #td-dock .td-revives { display: flex; gap: 6px; flex-wrap: wrap; }
    #td-dock .td-dock-hint { font-size: 11px; color: #8a8a96; text-align: center; }

    #td-dock .td-btn {
      background: #2a2a32; color: #eee; border: 1px solid #44444f;
      padding: 7px 12px; border-radius: var(--sb-surface-radius); cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    #td-dock .td-btn:hover:not(:disabled) { background: #353541; }
    #td-dock .td-primary { background: #2a4a32; border-color: #3f6b4a; font-weight: bold; }
    #td-dock .td-primary:hover:not(:disabled) { background: #335a3d; }
    #td-dock .td-revive { background: #4a2a2a; border-color: #6b3f3f; }
    #td-dock .td-btn:disabled, #td-dock .td-btn.td-disabled { opacity: 0.45; cursor: not-allowed; }

    /* Touch: a slim build dock just under the top status bar. It can't go to
       the bottom (the d-pad + action clusters live in the bottom corners), so
       keep it short and out of the playfield. */
    @media (pointer: coarse) {
      #td-dock {
        bottom: auto; top: 104px; transform: translateX(-50%);
        width: min(94vw, 460px); gap: 6px; padding: 8px 10px; font-size: 12px;
      }
      #td-dock .td-dock-timer { gap: 8px; }
      #td-dock .td-dock-label { font-size: 11px; }
      #td-dock .td-prog { height: 10px; }
      #td-dock .td-dock-main { gap: 6px; }
      #td-dock .td-dock-actions { gap: 6px; }
      #td-dock .td-btn, #td-dock .td-start { min-height: 42px; padding: 7px 10px; }
      #td-dock .td-dock-hint { font-size: 10px; }

      /* Build + wave both collapse the dock into a slim strip pinned to the
         bottom-centre gap between the d-pad and the action cluster. The top
         status bar already carries "Wave N", so the strip is purely the live
         bar — enemies-remaining during a wave, countdown to the next while
         building. The phase actions (Start / Recruit / Switch in build, Switch
         in wave) move to the action cluster, so the strip normally has no
         buttons — make it click-through so it never steals a tap from the
         controls (revive buttons, which can appear in any phase, re-enable
         themselves). */
      #td-dock.td-dock-wave, #td-dock.td-dock-build {
        top: auto; bottom: 8px; transform: translateX(-50%);
        flex-direction: row; align-items: center; flex-wrap: nowrap;
        width: auto; max-width: 92vw; gap: 8px; padding: 6px 12px;
        pointer-events: none;
      }
      #td-dock.td-dock-wave .td-dock-label, #td-dock.td-dock-build .td-dock-label,
      #td-dock.td-dock-wave .td-dock-hint,  #td-dock.td-dock-build .td-dock-hint { display: none; }
      #td-dock.td-dock-wave .td-dock-timer, #td-dock.td-dock-build .td-dock-timer { gap: 8px; }
      #td-dock.td-dock-wave .td-prog, #td-dock.td-dock-build .td-prog { min-width: 96px; }
      #td-dock.td-dock-wave .td-dock-main, #td-dock.td-dock-build .td-dock-main { margin: 0; }
      #td-dock.td-dock-wave .td-dock-actions, #td-dock.td-dock-build .td-dock-actions { margin-left: 0; }
      #td-dock.td-dock-wave .td-btn, #td-dock.td-dock-build .td-btn { pointer-events: auto; }
    }

    /* Narrow screens share the top edge with the HP bar (left) and the touch
       menu/pause button (right) — drop the TD bar below the HP card and shrink
       it so the two never collide. */
    @media (max-width: 820px) {
      #td-hud { top: 58px; font-size: 12px; gap: 8px; padding: 6px 10px; }
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
    #td-gameover .td-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    #td-gameover .td-actions { justify-content: center; margin-top: 18px; }
    #td-gameover .td-btn {
      background: #2a2a32; color: #eee; border: 1px solid #44444f;
      padding: 8px 14px; border-radius: var(--sb-surface-radius); cursor: pointer;
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
  if (dock?.parentNode) dock.parentNode.removeChild(dock);
  if (gameOver?.parentNode) gameOver.parentNode.removeChild(gameOver);
  reviveSig = "";
  root = null; dock = null; gameOver = null; installed = false; api = {};
}
