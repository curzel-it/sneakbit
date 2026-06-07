// Shared top HUD bar: a single unified strip at the top-left that holds, left
// to right, the ☰ menu button, the HP bar, the coin counter and the ammo
// counter — one background, properly spaced. Each of those counters is still
// its own feature/file; this is only the cross-cutting layout container they
// drop into, the structural sibling of dom.js / uiTokens.js.
//
// Single-slice (single-player / online) is the unified look: the bar hugs its
// content (left-aligned, only as wide as the items need) and goes full-width on
// a small phone-portrait screen. The HP bar is the elastic item there so it
// fills the leftover width. Split-screen (local co-op / PvP) is different: the
// HP cards and ammo chips anchor to their own slices, so the bar drops its
// unified background (each chip keeps its own) and the menu button moves back to
// the top-right corner. ammoHud drives that switch via setTopHudSplit().
//
// The menu button lives here (not in touch.js) because it reads as the left end
// of this bar. Tapping it dispatches Escape — exactly what the old touch button
// did — which menu.js listens for. It only shows in touch mode.

import { el } from "./dom.js";

const MENU_ICON =
  `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24"` +
  ` fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"` +
  ` stroke-linejoin="round" aria-hidden="true" focusable="false">` +
  `<line x1="4" y1="7" x2="20" y2="7"></line>` +
  `<line x1="4" y1="12" x2="20" y2="12"></line>` +
  `<line x1="4" y1="17" x2="20" y2="17"></line></svg>`;

let root = null;
let lastSplit = null;

export function topHudRow() {
  if (root) return root;
  injectStyles();
  const menu = el("button", {
    type: "button",
    class: "top-hud-menu",
    title: "Menu",
    html: MENU_ICON,
    on: { click: openMenu },
  });
  root = el("div", { id: "top-hud-row" }, menu);
  document.body.appendChild(root);
  return root;
}

// Switch the bar between its unified single-bar look (single-slice) and the
// transparent pass-through used in split-screen, where each slice owns its own
// chips. Cheap to call every frame — bails when nothing changed.
export function setTopHudSplit(split) {
  const bar = topHudRow();
  if (split === lastSplit) return;
  lastSplit = split;
  bar.classList.toggle("split", split);
}

// The old touch menu button dispatched Escape; menu.js opens/closes on it.
function openMenu() {
  window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape", bubbles: true }));
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("top-hud-row-styles")) return;
  const style = document.createElement("style");
  style.id = "top-hud-row-styles";
  style.textContent = `
    #top-hud-row {
      position: fixed;
      top: 12px;
      left: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      z-index: 11;
      pointer-events: none;
      user-select: none; -webkit-user-select: none;
    }
    /* Fixed left-to-right order, independent of install order. */
    #top-hud-row > .top-hud-menu { order: 0; }
    #top-hud-row > #health-hud   { order: 1; }
    #top-hud-row > #coin-hud     { order: 2; }
    #top-hud-row > #ammo-hud     { order: 3; }

    /* Unified single-bar look (single-slice): one background, flush children,
       width hugging the content so the strip is only as wide as it needs. */
    #top-hud-row:not(.split) {
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
      padding: 5px 12px;
      width: fit-content;
      max-width: calc(100vw - 24px);
    }
    #top-hud-row:not(.split) #health-hud { flex: 0 0 auto; width: 150px; min-width: 0; }
    /* Split-screen: each HP card is anchored position:fixed to its slice corner
       (see healthHud.anchorBar). Without a width, its width:100% resolves to the
       full viewport and the bar stretches across both slices. Pin it to a
       compact panel — the desktop look, one per slice. */
    #top-hud-row.split .hp-card { width: 180px; }
    #top-hud-row:not(.split) .hp-card,
    #top-hud-row:not(.split) #coin-hud,
    #top-hud-row:not(.split) .ammo-chip {
      background: none;
      border: none;
      border-radius: 0;
      padding: 0;
    }

    /* The ☰ menu button: left end of the bar, touch only. */
    #top-hud-row .top-hud-menu {
      display: none;
      order: 0;
      align-self: stretch;
      align-items: center;
      justify-content: center;
      width: 30px;
      padding: 0;
      background: none;
      border: none;
      color: var(--sb-text);
      cursor: pointer;
      pointer-events: auto;
      -webkit-tap-highlight-color: transparent;
    }
    #top-hud-row .top-hud-menu:active { opacity: 0.6; }
    body.touch-mode #top-hud-row .top-hud-menu { display: flex; }
    /* Split-screen: the bar is a transparent shell, so float the menu button
       back to the top-right corner (clear of slice 0's top-left HP card). */
    body.touch-mode #top-hud-row.split .top-hud-menu {
      position: fixed; top: 12px; right: 12px;
      width: 44px; height: 44px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
    }

    /* Phone portrait: full-width bar with the HP section stretching to fill. */
    @media (max-width: 600px) and (orientation: portrait) {
      #top-hud-row:not(.split) {
        left: 8px; right: 8px; width: auto; max-width: none;
      }
      #top-hud-row:not(.split) #health-hud { flex: 1 1 auto; width: auto; }
    }
  `;
  document.head.appendChild(style);
}
