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
import { el } from "./dom.js";

const ICON_PIXELS = 24;

let root = null;
let iconCanvas = null;
let countEl = null;
let lastLabel = null;

export function installCoinHud() {
  if (root) return root;
  injectStyles();
  iconCanvas = el("canvas", {
    width: TILE_SIZE,
    height: TILE_SIZE,
    style: { width: `${ICON_PIXELS}px`, height: `${ICON_PIXELS}px`, imageRendering: "pixelated" },
  });
  countEl = el("span", { text: "0" });
  root = el("div", { id: "coin-hud" }, [iconCanvas, countEl]);
  document.body.appendChild(root);
  onWalletChange(updateCoinHud);
  return root;
}

export function updateCoinHud() {
  if (!root) return;
  // Real-game currency only — TD has its own gold, PvP has no coins.
  const visible = !isTowerDefenseMode() && !isPvp();
  root.style.display = visible ? "" : "none";
  if (!visible) return;
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
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.drawImage(
    sheet,
    col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE,
    0, 0, TILE_SIZE, TILE_SIZE,
  );
  iconCanvas.dataset.painted = "1";
}

function injectStyles() {
  if (document.getElementById("coin-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "coin-hud-styles";
  style.textContent = `
    #coin-hud {
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
      color: var(--sb-text);
      font-family: var(--sb-font);
      font-size: 14px;
      z-index: 11;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
  `;
  document.head.appendChild(style);
}
