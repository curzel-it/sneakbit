// Shop overlay — the buy screen the clerk opens. DOM-only (project rule),
// modeled on the menu/gameOver modals: a dimmed full-screen surface that
// pauses the world and routes keyboard / gamepad / touch through menuNav.
//
// Two screens switched with showOnly(): a storefront list (icon + name +
// price, description of the focused row, "Owned" for one-of-a-kind goods
// you already hold) and a quantity/confirm screen. All the rules live in
// shopPurchase.js; this file is presentation + input only.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { getSpecies } from "./species.js";
import { getCoins, onWalletChange } from "./wallet.js";
import { COIN_SPECIES_ID } from "./coinDrops.js";
import { tr } from "./strings.js";
import { el, showOnly } from "./dom.js";
import { playSfx } from "./audio.js";
import { showToast } from "./toast.js";
import { registerMenuSurface, focusFirstIn } from "./menuNav.js";
import {
  isStackable, isOwned, clampQty, maxAffordable, canBuy, buy,
} from "./shopPurchase.js";

let root = null;
let listScreen = null;
let detailScreen = null;
let listEl = null;
let coinValEl = null;
let descEl = null;
let titleEl = null;
let closeBtn = null;

let open = false;
let stock = [];
let playerIndex = 0;
let detailEntry = null; // the stock entry currently on the detail screen
let qty = 1;

export function isShopOpen() { return open; }

export function installShop() {
  if (root) return root;
  injectStyles();

  listEl = el("div", { class: "shop-list" });
  descEl = el("div", { class: "shop-desc" });
  closeBtn = el("button", { class: "shop-btn shop-close", text: tr("shop.close"), on: { click: closeShop } });
  listScreen = el("div", { class: "shop-screen", dataset: { screen: "list" } }, [
    listEl,
    descEl,
    closeBtn,
  ]);

  detailScreen = el("div", { class: "shop-screen", dataset: { screen: "detail" }, style: { display: "none" } });

  const coinIcon = el("canvas", {
    class: "shop-coin-icon",
    width: TILE_SIZE,
    height: TILE_SIZE,
    style: { width: "20px", height: "20px", imageRendering: "pixelated" },
  });
  coinValEl = el("span", { class: "shop-coin-val", text: "0" });

  root = el("div", { id: "shop" }, [
    el("div", { class: "shop-card" }, [
      el("div", { class: "shop-head" }, [
        (titleEl = el("h1", { class: "shop-title", text: tr("shop.title") })),
        el("div", { class: "shop-coins" }, [coinIcon, coinValEl]),
      ]),
      listScreen,
      detailScreen,
    ]),
  ]);
  document.body.appendChild(root);

  paintIcon(coinIcon, COIN_SPECIES_ID);
  onWalletChange(refreshCoins);

  // Capture-phase so the shop owns its keys before menuNav / the pause menu:
  // Escape backs out (detail → list → close), Left/Right tune the quantity.
  window.addEventListener("keydown", onKeydownCapture, true);

  // Roving focus + controller nav target the currently-visible screen.
  registerMenuSurface({ root: visibleScreen, isOpen: isShopOpen, priority: 22 });
  return root;
}

// Open the shop for a clerk's stock. `stockList` is the entity's shop_stock
// array ({ item, price, stackable? }); playerIdx is the buyer.
export function openShop(stockList, playerIdx = 0) {
  if (!root) installShop();
  stock = Array.isArray(stockList) ? stockList.filter((e) => e && getSpecies(e.item)) : [];
  playerIndex = playerIdx | 0;
  open = true;
  // Refresh labels built at install time, in case strings hydrated after boot.
  titleEl.textContent = tr("shop.title");
  closeBtn.textContent = tr("shop.close");
  showStorefront();
  root.style.display = "flex";
  refreshCoins();
  focusFirstIn(visibleScreen);
}

export function closeShop() {
  if (!open) return;
  open = false;
  root.style.display = "none";
  detailEntry = null;
  showToast(tr("shop.farewell"), "hint");
}

function visibleScreen() {
  return detailScreen.style.display === "none" ? listScreen : detailScreen;
}

function refreshCoins() {
  if (coinValEl) coinValEl.textContent = String(getCoins(playerIndex));
}

// ---- Storefront ----------------------------------------------------------

function showStorefront() {
  renderList();
  showOnly({ list: listScreen, detail: detailScreen }, "list", "flex");
}

function renderList() {
  listEl.replaceChildren();
  for (let i = 0; i < stock.length; i++) {
    listEl.appendChild(rowFor(stock[i], i));
  }
  // Default the description to the first row so the foot isn't blank.
  if (stock.length) setDesc(stock[0]);
}

function rowFor(entry, i) {
  const sp = getSpecies(entry.item);
  const owned = isOwned(entry.item, playerIndex);
  const affordable = maxAffordable(entry.price, playerIndex) > 0;

  const icon = el("canvas", {
    class: "shop-row-icon",
    width: TILE_SIZE,
    height: TILE_SIZE,
    style: { width: "32px", height: "32px", imageRendering: "pixelated" },
  });
  paintIcon(icon, entry.item);

  const tag = owned
    ? el("span", { class: "shop-row-tag is-owned", text: tr("shop.owned") })
    : el("span", { class: "shop-row-price" }, [String(entry.price | 0), priceCoin()]);

  const row = el("button", {
    class: `shop-row${owned ? " is-owned" : ""}${!owned && !affordable ? " is-poor" : ""}`,
    disabled: owned || undefined,
    dataset: { i: String(i) },
    on: {
      click: () => openDetail(entry),
      focus: () => setDesc(entry),
      mouseenter: () => setDesc(entry),
    },
  }, [
    icon,
    el("span", { class: "shop-row-name", text: nameOf(sp) }),
    tag,
  ]);
  return row;
}

function setDesc(entry) {
  descEl.textContent = descOf(getSpecies(entry.item));
}

// ---- Detail / quantity ---------------------------------------------------

function openDetail(entry) {
  detailEntry = entry;
  qty = clampQty(entry, 1, playerIndex) || 1;
  renderDetail();
  showOnly({ list: listScreen, detail: detailScreen }, "detail", "flex");
  focusFirstIn(detailScreen);
}

function renderDetail() {
  const entry = detailEntry;
  const sp = getSpecies(entry.item);
  detailScreen.replaceChildren();

  const icon = el("canvas", {
    class: "shop-detail-icon",
    width: TILE_SIZE,
    height: TILE_SIZE,
    style: { width: "48px", height: "48px", imageRendering: "pixelated" },
  });
  paintIcon(icon, entry.item);

  const children = [
    icon,
    el("div", { class: "shop-detail-name", text: nameOf(sp) }),
    el("div", { class: "shop-detail-desc", text: descOf(sp) }),
  ];

  const stackable = isStackable(entry);
  if (stackable) {
    children.push(el("div", { class: "shop-qty" }, [
      el("button", { class: "shop-btn shop-qty-btn", text: "◀", on: { click: () => bumpQty(-1) } }),
      el("span", { class: "shop-qty-val", text: String(qty) }),
      el("button", { class: "shop-btn shop-qty-btn", text: "▶", on: { click: () => bumpQty(1) } }),
    ]));
  }

  children.push(el("div", { class: "shop-total" }, [
    `${tr("shop.total")}: `,
    el("span", { class: "shop-total-val", text: String((entry.price | 0) * qty) }),
    priceCoin(),
  ]));

  const verdict = canBuy(entry, qty, playerIndex);
  children.push(el("div", { class: "shop-detail-actions" }, [
    el("button", {
      class: "shop-btn shop-buy",
      text: tr("shop.buy"),
      disabled: verdict.ok ? undefined : true,
      on: { click: confirmBuy },
    }),
    el("button", { class: "shop-btn shop-cancel", text: tr("shop.cancel"), on: { click: showStorefront } }),
  ]));

  if (!verdict.ok && verdict.reason === "poor") {
    children.push(el("div", { class: "shop-warn", text: tr("shop.too_poor") }));
  }

  detailScreen.append(...children);
}

function bumpQty(delta) {
  if (!detailEntry || !isStackable(detailEntry)) return;
  const max = maxAffordable(detailEntry.price, playerIndex);
  if (max <= 0) return;
  qty = Math.max(1, Math.min(max, qty + delta));
  // Patch the live numbers without a full re-render so focus is preserved.
  const valEl = detailScreen.querySelector(".shop-qty-val");
  const totalEl = detailScreen.querySelector(".shop-total-val");
  if (valEl) valEl.textContent = String(qty);
  if (totalEl) totalEl.textContent = String((detailEntry.price | 0) * qty);
}

function confirmBuy() {
  const res = buy(detailEntry, qty, playerIndex);
  if (!res.ok) { renderDetail(); return; }
  playSfx("ammoCollected");
  const name = nameOf(getSpecies(detailEntry.item));
  showToast(tr("shop.bought").replace("%s", name), "hint", { image: toastIcon(detailEntry.item) });
  refreshCoins();
  showStorefront();
  focusFirstIn(listScreen);
}

// ---- Input ---------------------------------------------------------------

function onKeydownCapture(e) {
  if (!open) return;
  if (e.code === "Escape") {
    if (detailScreen.style.display !== "none") showStorefront();
    else closeShop();
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
  if (detailScreen.style.display !== "none") {
    if (e.code === "ArrowLeft")  { bumpQty(-1); e.preventDefault(); e.stopImmediatePropagation(); }
    if (e.code === "ArrowRight") { bumpQty(1);  e.preventDefault(); e.stopImmediatePropagation(); }
  }
}

// ---- Shared helpers ------------------------------------------------------

function nameOf(sp) {
  return tr(sp?.name) || sp?.name || "";
}

// Description key mirrors the name key: objects.name.X -> objects.desc.X.
// Falls back to empty so a missing description never breaks the row.
function descOf(sp) {
  const name = sp?.name;
  if (typeof name !== "string") return "";
  const descKey = name.replace(/^objects\.name\./, "objects.desc.");
  const text = tr(descKey);
  return text === descKey ? "" : text;
}

function priceCoin() {
  const c = el("canvas", {
    class: "shop-price-coin",
    width: TILE_SIZE,
    height: TILE_SIZE,
    style: { width: "14px", height: "14px", imageRendering: "pixelated" },
  });
  paintIcon(c, COIN_SPECIES_ID);
  return c;
}

function toastIcon(speciesId) {
  const off = getSpecies(speciesId)?.inventory_texture_offset;
  if (!off) return null;
  return {
    url: "./assets/inventory.png",
    sx: (off[1] | 0) * TILE_SIZE,
    sy: (off[0] | 0) * TILE_SIZE,
    sw: TILE_SIZE,
    sh: TILE_SIZE,
    renderSize: 32,
  };
}

// Blit a species' inventory icon onto a canvas (same path as coinHud).
function paintIcon(canvas, speciesId) {
  const sp = getSpecies(speciesId);
  if (!sp || !sp.inventory_texture_offset) return;
  let sheet;
  try { sheet = getSprite("inventory"); } catch { return; }
  if (!sheet || !sheet.complete) return;
  const [row, col] = sp.inventory_texture_offset;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.drawImage(sheet, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
}

function injectStyles() {
  if (document.getElementById("shop-styles")) return;
  const style = document.createElement("style");
  style.id = "shop-styles";
  style.textContent = `
    #shop {
      position: fixed; inset: 0; display: none;
      align-items: center; justify-content: center;
      background: rgba(0,0,0,0.78); z-index: 24;
      font-family: var(--sb-font, monospace); color: var(--sb-text, #eee);
    }
    #shop .shop-card {
      width: min(560px, 92vw); max-height: 88vh; display: flex; flex-direction: column;
      background: linear-gradient(180deg, #20242e 0%, #14161c 100%);
      border: 1px solid #3a4150; border-top-color: #525d70;
      border-radius: 10px; box-shadow: 0 14px 40px rgba(0,0,0,.6);
      overflow: hidden;
    }
    #shop .shop-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid #3a4150;
      background: linear-gradient(180deg, #2b3450 0%, #222a40 100%);
    }
    #shop .shop-title { margin: 0; font-size: 18px; letter-spacing: .5px; }
    #shop .shop-coins { display: flex; align-items: center; gap: 6px; font-size: 15px; }
    #shop .shop-screen { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
    #shop .shop-list { display: flex; flex-direction: column; gap: 6px; }
    #shop .shop-row {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 8px 12px; text-align: left; cursor: pointer;
      background: #232a38; border: 1px solid #39425a; border-radius: 8px;
      color: inherit; font-family: inherit; font-size: 15px;
    }
    #shop .shop-row:hover { background: #2c3650; }
    #shop .shop-row-name { flex: 1; }
    #shop .shop-row-price { display: flex; align-items: center; gap: 4px; color: #ffe08a; font-weight: 700; }
    #shop .shop-row-tag.is-owned { color: #8fe39a; font-size: 13px; font-weight: 700; }
    #shop .shop-row.is-owned { opacity: .55; cursor: default; }
    #shop .shop-row.is-poor .shop-row-price { color: #d98a8a; }
    #shop .shop-desc {
      min-height: 2.4em; padding: 8px 12px; font-size: 13px; line-height: 1.4;
      color: #c7d2e6; background: #1a1f29; border-radius: 8px; border: 1px solid #2c3444;
    }
    #shop .shop-screen[data-screen="detail"] { align-items: center; text-align: center; }
    #shop .shop-detail-icon { margin: 4px auto; }
    #shop .shop-detail-name { font-size: 18px; font-weight: 700; }
    #shop .shop-detail-desc { font-size: 13px; color: #c7d2e6; max-width: 36ch; }
    #shop .shop-qty { display: flex; align-items: center; justify-content: center; gap: 16px; margin: 6px 0; }
    #shop .shop-qty-val { font-size: 22px; font-weight: 700; min-width: 2ch; }
    #shop .shop-total { font-size: 16px; display: flex; align-items: center; justify-content: center; gap: 5px; }
    #shop .shop-total-val { color: #ffe08a; font-weight: 700; }
    #shop .shop-detail-actions { display: flex; gap: 12px; margin-top: 6px; justify-content: center; }
    #shop .shop-warn { color: #d98a8a; font-size: 13px; }
    #shop .shop-btn {
      padding: 9px 18px; min-width: 44px; min-height: 40px; cursor: pointer;
      background: #2f3b55; border: 1px solid #4a5878; border-radius: 8px;
      color: #eef2ff; font-family: inherit; font-size: 15px; font-weight: 700;
    }
    #shop .shop-btn:hover:not(:disabled) { background: #3a486a; }
    #shop .shop-btn:disabled { opacity: .45; cursor: default; }
    #shop .shop-buy { background: #2e6b3e; border-color: #418a55; }
    #shop .shop-buy:hover:not(:disabled) { background: #357d49; }
    #shop .shop-qty-btn { min-width: 52px; font-size: 18px; }
    #shop .shop-close { align-self: center; margin-top: 4px; }
  `;
  document.head.appendChild(style);
}
