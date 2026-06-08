// Wardrobe — equip owned hero skins. Pure DOM; menu.js owns open/close and
// renders this into the wardrobe screen's body. Buying happens in the shop
// (shopPurchase.js); here you only switch between skins you already own.
//
// Edits the local/primary hero (index 0), the same index the inventory panel
// uses. Local-coop's extra heroes keep their per-index default colors; the
// per-index selection plumbing in skins.js leaves room to add player tabs
// later without touching the data model.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { tr } from "./strings.js";
import {
  getCatalog, getSelected, setSelected, isOwned, defaultColumn, onSkinChange,
} from "./skins.js";

const PLAYER_INDEX = 0;
let unsub = null;

export function renderWardrobeInto(host) {
  if (!host) return;
  teardown();
  injectStyles();
  draw(host);
  // Re-render live so equipping (or a skin bought elsewhere) reflects while
  // the screen is open. Lazily tears down once the host leaves the DOM.
  unsub = onSkinChange(() => { if (host.isConnected) draw(host); else teardown(); });
}

function teardown() {
  if (unsub) { try { unsub(); } catch { /* ignore */ } unsub = null; }
}

function draw(host) {
  host.innerHTML = gridHtml();
  paintPreviews(host);
  bind(host);
}

function gridHtml() {
  const selected = getSelected(PLAYER_INDEX);
  const cards = getCatalog().map((skin) => {
    const owned = isOwned(skin.id, PLAYER_INDEX);
    const equipped = skin.id === selected;
    const column = skin.column == null ? defaultColumn(PLAYER_INDEX) : skin.column;
    const state = equipped
      ? `<span class="wardrobe-state is-equipped">${tr("skins.equipped")}</span>`
      : owned
        ? `<span class="wardrobe-state">${tr("skins.equip")}</span>`
        : `<span class="wardrobe-state is-locked">${tr("skins.locked")} · ${skin.price | 0}</span>`;
    const cls = `wardrobe-card${equipped ? " is-equipped" : ""}${owned ? "" : " is-locked"}`;
    return `<button class="${cls}" data-skin="${skin.id}"${owned ? "" : " disabled"}>
      <canvas class="wardrobe-preview" width="${TILE_SIZE}" height="${TILE_SIZE * 2}"
        style="width:32px;height:64px;image-rendering:pixelated" data-column="${column}"></canvas>
      <span class="wardrobe-name">${escapeHtml(tr(skin.nameKey))}</span>
      ${state}
    </button>`;
  }).join("");
  return `<div class="wardrobe-grid">${cards}</div>`;
}

// Blit each card's hero down-still frame. Row math mirrors player.js
// getPlayerSpriteFrame (down/still = row 5, 2 tiles tall, origin y=1 → y=11).
function paintPreviews(host) {
  let sheet;
  try { sheet = getSprite("heroes"); } catch { return; }
  if (!sheet || !sheet.complete) return;
  for (const c of host.querySelectorAll("canvas.wardrobe-preview[data-column]")) {
    const column = Number(c.dataset.column) | 0;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.drawImage(sheet, column * TILE_SIZE, 11 * TILE_SIZE, TILE_SIZE, TILE_SIZE * 2, 0, 0, TILE_SIZE, TILE_SIZE * 2);
  }
}

function bind(host) {
  for (const btn of host.querySelectorAll("[data-skin]")) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.skin;
      if (id === getSelected(PLAYER_INDEX)) return; // already worn
      setSelected(id, PLAYER_INDEX); // re-render rides onSkinChange
    });
  }
}

function injectStyles() {
  if (document.getElementById("wardrobe-styles")) return;
  const css = `
    #menu .wardrobe-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
      gap: 10px; min-width: 340px; max-height: 320px; overflow-y: auto; padding: 2px;
    }
    #menu .wardrobe-card {
      display: flex; flex-direction: column; align-items: center; gap: 6px;
      padding: 10px 6px; background: #1f1f1f; border: 1px solid #2e2e2e;
      border-radius: var(--sb-surface-radius); color: #eee; font: inherit; cursor: pointer;
    }
    #menu .wardrobe-card:hover:not(:disabled) { background: #292929; }
    #menu .wardrobe-card.is-equipped { background: #1d2440; border-color: #3a4a80; }
    #menu .wardrobe-card.is-locked { opacity: .55; cursor: default; }
    #menu .wardrobe-preview { flex: 0 0 auto; }
    #menu .wardrobe-name { font-size: 12px; text-align: center; }
    #menu .wardrobe-state { font-size: 10px; color: #aaa; letter-spacing: .5px; }
    #menu .wardrobe-state.is-equipped { color: #b8c6ff; }
    #menu .wardrobe-state.is-locked { color: #c9a25a; }
    @media (max-width: 480px) { #menu .wardrobe-grid { min-width: 0; } }
  `;
  const style = document.createElement("style");
  style.id = "wardrobe-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
