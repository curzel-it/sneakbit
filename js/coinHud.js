// Coin HUD: a small chip showing the coin icon + the hero's balance. DOM, not
// canvas (project rule). Mirrors ammoHud.js but reads the real-game wallet
// (wallet.js) instead of ammo. Anchored top-centre; hidden in Tower Defense
// (its own gold HUD) and PvP (no coins).

import { ICON_RES, paintInventoryIcon } from "./inventoryIcon.js";
import { getSpecies } from "./species.js";
import { getCoins, onWalletChange } from "./wallet.js";
import { isTowerDefenseMode, isPvp } from "./gameMode.js";
import { COIN_SPECIES_ID } from "./coinDrops.js";
import { sliceCount, getSlices } from "./splitScreen.js";
import { topHudRow } from "./topHudRow.js";
import { el } from "./dom.js";

// Match the ammo chip exactly (ammoHud.js) so the two top-of-screen counters
// read as the same size: 28px icon, 6px/10px padding, 8px icon-to-text gap.
const ICON_PIXELS = 28;

let root = null;
let iconCanvas = null;
let countEl = null;
let lastLabel = null;

export function installCoinHud() {
  if (root) return root;
  injectStyles();
  iconCanvas = el("canvas", {
    width: ICON_RES,
    height: ICON_RES,
    style: { width: `${ICON_PIXELS}px`, height: `${ICON_PIXELS}px` },
  });
  countEl = el("span", { text: "0" });
  root = el("div", { id: "coin-hud" }, [iconCanvas, countEl]);
  topHudRow().appendChild(root);
  onWalletChange(updateCoinHud);
  return root;
}

export function updateCoinHud() {
  if (!root) return;
  // Real-game currency only — TD has its own gold, PvP has no coins.
  const visible = !isTowerDefenseMode() && !isPvp();
  root.style.display = visible ? "" : "none";
  if (!visible) return;
  // In split-screen the HP bar + ammo chips anchor to each slice, leaving the
  // top row empty — pin the (single, shared) coin counter beside P1's HP card,
  // mirroring the desktop top strip, instead of leaving it stranded mid-screen.
  const split = sliceCount() > 1;
  root.classList.toggle("split", split);
  if (split) anchorCoin(); else { root.style.left = lastLeft = ""; root.style.top = lastTop = ""; }
  const label = String(getCoins(0));
  if (label !== lastLabel) {
    countEl.textContent = label;
    lastLabel = label;
  }
  // Lazy-draw the icon the first time the sprite sheet is available (loaded
  // async at startup, so the first frames may not have it).
  if (!iconCanvas.dataset.painted) paintIcon();
}

// Pin the coin chip just right of P1's HP card in split-screen, anchored to
// slice 0's top-left corner. HP_CARD_W must track the split HP-card width in
// topHudRow.js (#top-hud-row.split .hp-card). Clamped to a 12px viewport margin
// like the HP card, since the centred canvas can start a few px off-screen.
const ANCHOR_MARGIN = 12;
const HP_CARD_W = 180;
const HP_TO_COIN_GAP = 10;
let lastLeft = null, lastTop = null;
function anchorCoin() {
  const css = getSlices()?.[0]?.cssRect;
  if (!css) { if (lastLeft !== "") { root.style.left = lastLeft = ""; root.style.top = lastTop = ""; } return; }
  const left = `${Math.max(ANCHOR_MARGIN, Math.round(css.left + ANCHOR_MARGIN)) + HP_CARD_W + HP_TO_COIN_GAP}px`;
  const top = `${Math.max(ANCHOR_MARGIN, Math.round(css.top + ANCHOR_MARGIN))}px`;
  if (left !== lastLeft) { root.style.left = left; lastLeft = left; }
  if (top !== lastTop) { root.style.top = top; lastTop = top; }
}

function paintIcon() {
  const off = getSpecies(COIN_SPECIES_ID)?.inventory_texture_offset;
  if (!off) return; // `inventory_texture_offset` is [row, col] in the rust source.
  paintInventoryIcon(iconCanvas, off[0], off[1]);
}

function injectStyles() {
  if (document.getElementById("coin-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "coin-hud-styles";
  style.textContent = `
    #coin-hud {
      position: relative;
      flex: 0 0 auto;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
      color: var(--sb-text);
      font-family: var(--sb-font);
      font-size: 14px;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
    /* Split-screen: leave the row; anchorCoin() pins left/top beside P1's card. */
    #coin-hud.split {
      position: fixed;
      z-index: 11;
    }
  `;
  document.head.appendChild(style);
}
