// Coin HUD: a small chip showing the coin icon + the hero's balance. DOM, not
// canvas (project rule). Mirrors ammoHud.js but reads the real-game wallet
// (wallet.js) instead of ammo. Anchored top-centre; hidden in Tower Defense
// (its own gold HUD) and PvP (no coins).

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { getSpecies } from "./species.js";
import { getCoins, onWalletChange } from "./wallet.js";
import { isTowerDefenseMode, isPvp } from "./gameMode.js";
import { COIN_SPECIES_ID } from "./coinDrops.js";
import { sliceCount } from "./splitScreen.js";
import { topHudRow } from "./topHudRow.js";
import { el } from "./dom.js";

// Match the ammo chip exactly (ammoHud.js) so the two top-of-screen counters
// read as the same size: 28px icon, 6px/10px padding, 8px icon-to-text gap.
const ICON_PIXELS = 28;
// The icon box (28px) isn't an integer multiple of the 16px source tile, so a
// straight nearest-neighbour upscale duplicates some source pixels and not
// others — lumpy on a round sprite like the coin. Instead we paint into a
// backing canvas that IS a clean integer multiple (×8) and let the browser
// smoothly downscale it to ICON_PIXELS, keeping circular icons round.
const ICON_SUPERSAMPLE = 8;
const ICON_RES = TILE_SIZE * ICON_SUPERSAMPLE;

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
  // top row empty — float the (single, shared) coin counter back to centre so
  // it doesn't sit on top of slice 0's HP card at the top-left corner.
  root.classList.toggle("split", sliceCount() > 1);
  const label = String(getCoins(0));
  if (label !== lastLabel) {
    countEl.textContent = label;
    lastLabel = label;
  }
  // Lazy-draw the icon the first time the sprite sheet is available (loaded
  // async at startup, so the first frames may not have it).
  if (!iconCanvas.dataset.painted) paintIcon();
}

function paintIcon() {
  const sp = getSpecies(COIN_SPECIES_ID);
  if (!sp || !sp.inventory_texture_offset) return;
  let sheet;
  try { sheet = getSprite("inventory"); } catch { return; }
  if (!sheet || !sheet.complete) return;
  // `inventory_texture_offset` is [row, col] in the rust source.
  const [row, col] = sp.inventory_texture_offset;
  const ctx = iconCanvas.getContext("2d");
  ctx.imageSmoothingEnabled = false; // crisp integer upscale into the backing canvas
  ctx.clearRect(0, 0, ICON_RES, ICON_RES);
  ctx.drawImage(
    sheet,
    col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE,
    0, 0, ICON_RES, ICON_RES,
  );
  iconCanvas.dataset.painted = "1";
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
    /* Split-screen: leave the row and centre at the top of the viewport. */
    #coin-hud.split {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 11;
    }
  `;
  document.head.appendChild(style);
}
