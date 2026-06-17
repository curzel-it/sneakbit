// Coin HUD: a small chip showing the coin icon + a hero's balance. DOM, not
// canvas (project rule). Mirrors ammoHud.js but reads the real-game wallet
// (wallet.js) instead of ammo. Hidden in PvP (no coins).
//
// Single-slice (single-player / online): one chip in the shared top row for
// the local hero. In split-screen local play (co-op) one chip per player is
// anchored beside THAT player's HP card — mirroring the per-slice ammo chips
// and HP bars — each showing that player's own dedicated balance.

import { ICON_RES, paintInventoryIcon } from "./inventoryIcon.js";
import { getSpecies } from "./species.js";
import { getCoins, onWalletChange } from "./wallet.js";
import { isPvp } from "./gameMode.js";
import { COIN_SPECIES_ID } from "./coinDrops.js";
import { localPlayerCount } from "./coopMode.js";
import { sliceCount, getSlices } from "./splitScreen.js";
import { topHudRow } from "./topHudRow.js";
import { el } from "./dom.js";

// Match the ammo chip exactly (ammoHud.js) so the two top-of-screen counters
// read as the same size: 28px icon, 6px/10px padding, 8px icon-to-text gap.
const ICON_PIXELS = 28;
const MAX_PLAYERS = 4;

let root = null;
const chips = []; // [{ root, icon, count, lastLabel, index }]

export function installCoinHud() {
  if (root) return root;
  injectStyles();
  // Build all four chips up front; updateCoinHud shows only the active ones
  // (the local player count is hot-toggled, so we can't size the set here).
  for (let i = 0; i < MAX_PLAYERS; i++) chips.push(makeChip(i));
  root = el("div", { id: "coin-hud" }, chips.map((c) => c.root));
  topHudRow().appendChild(root);
  onWalletChange(updateCoinHud);
  return root;
}

function makeChip(index) {
  const icon = el("canvas", {
    width: ICON_RES,
    height: ICON_RES,
    style: { width: `${ICON_PIXELS}px`, height: `${ICON_PIXELS}px` },
  });
  const count = el("span", { text: "0" });
  const card = el("div", { class: "coin-chip" }, [icon, count]);
  return { root: card, icon, count, lastLabel: null, index };
}

export function updateCoinHud() {
  if (!root) return;
  // Real-game currency only — PvP has no coins.
  const visible = !isPvp();
  root.style.display = visible ? "" : "none";
  if (!visible) return;
  // Split-screen local play shows one chip per player, each anchored to its
  // own slice and reading its own wallet. Single-slice (single-player /
  // online) shows just the local hero's chip in the shared top row.
  const split = sliceCount() > 1;
  root.classList.toggle("split", split);
  const slices = split ? getSlices() : null;
  const count = split ? localPlayerCount() : 1;
  // Tag with the player number when more than one chip is on screen.
  const tagged = count > 1;
  for (const c of chips) {
    if (c.index >= count) { c.root.style.display = "none"; continue; }
    c.root.style.display = "";
    const n = getCoins(c.index);
    const label = tagged ? `P${c.index + 1}  ${n}` : String(n);
    if (label !== c.lastLabel) {
      c.count.textContent = label;
      c.lastLabel = label;
    }
    // Lazy-draw the icon the first time the sprite sheet is available (loaded
    // async at startup, so the first frames may not have it).
    if (!c.icon.dataset.painted) paintIcon(c.icon);
    anchorChip(c, slices);
  }
}

// Pin a coin chip just right of its slice's HP card in split-screen, anchored
// to that slice's top-left corner. HP_CARD_W must track the split HP-card
// width in topHudRow.js (#top-hud-row.split .hp-card). Clamped to a 12px
// viewport margin like the HP card. Single-slice resets to the top-row flow.
const ANCHOR_MARGIN = 12;
const HP_CARD_W = 180;
const HP_TO_COIN_GAP = 10;
function anchorChip(c, slices) {
  const css = slices?.[c.index]?.cssRect;
  if (css) {
    Object.assign(c.root.style, {
      position: "fixed",
      left: `${Math.max(ANCHOR_MARGIN, Math.round(css.left + ANCHOR_MARGIN)) + HP_CARD_W + HP_TO_COIN_GAP}px`,
      top: `${Math.max(ANCHOR_MARGIN, Math.round(css.top + ANCHOR_MARGIN))}px`,
    });
  } else {
    Object.assign(c.root.style, { position: "", left: "", top: "" });
  }
}

function paintIcon(iconCanvas) {
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
      flex-direction: column;
      align-items: flex-start;
      gap: 6px;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .coin-chip {
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
      white-space: nowrap;
      pointer-events: none;
    }
    /* Split-screen: anchorChip pins each chip beside its slice's HP card. */
    #coin-hud.split .coin-chip {
      z-index: 11;
    }
  `;
  document.head.appendChild(style);
}
