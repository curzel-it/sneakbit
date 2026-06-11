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
import { getSkin } from "./skins.js";
import { skillInfo } from "./skills.js";
import { mountShowcase, showEntry, stopShowcase } from "./shopShowcase.js";
import {
  isStackable, isEntryOwned, isSkinEntry, isSkillEntry, clampQty, maxAffordable, canBuy, buy,
} from "./shopPurchase.js";
import { isWebStoreEnabled } from "./buildTarget.js";
import { fetchCatalog } from "./storeApi.js";
import { getCurrency, setCurrency, format as formatPrice, SUPPORTED as CURRENCIES } from "./storeCurrency.js";
import { startCheckout } from "./realMoneyShop.js";
import { isSignedIn } from "./accountSession.js";

let root = null;
let listScreen = null;
let detailScreen = null;
let listEl = null;
let coinValEl = null;
let descEl = null;
let showcaseNameEl = null;
let showcasePriceEl = null;
let listShowcaseCanvas = null;
let titleEl = null;
let closeBtn = null;

let open = false;
let stock = [];
let playerIndex = 0;
let detailEntry = null; // the stock entry currently on the detail screen
let qty = 1;

// Real-money catalog (skin refId -> { sku, prices, … }), fetched once from the
// server. Stays empty when the web store is disabled (native builds) or the
// server has payments off (503) — in which case the shop renders coin-only.
const catalogBySkin = new Map();
let catalogLoaded = false;
let currencySelect = null;

export function isShopOpen() { return open; }

export function installShop() {
  if (root) return root;
  injectStyles();

  listEl = el("div", { class: "shop-list" });

  // Showcase: a large, animated preview of the currently-focused good. Updates
  // on row focus/hover (setDesc). The sprite canvas is driven by
  // shopShowcase.js; the text mirrors the focused row's name / price / blurb.
  // Hidden on touch devices (no hover) — there the preview moves into the
  // detail/quantity popup instead (see renderDetail).
  listShowcaseCanvas = el("canvas", {
    class: "shop-showcase-sprite",
    width: 80,
    height: 80,
    style: { width: "80px", height: "80px", imageRendering: "pixelated" },
  });
  showcaseNameEl = el("div", { class: "shop-showcase-name" });
  showcasePriceEl = el("div", { class: "shop-showcase-price" });
  descEl = el("div", { class: "shop-desc shop-showcase-desc" });
  const showcaseEl = el("div", { class: "shop-showcase" }, [
    listShowcaseCanvas,
    el("div", { class: "shop-showcase-info" }, [showcaseNameEl, showcasePriceEl, descEl]),
  ]);

  closeBtn = el("button", { class: "shop-btn shop-close", text: tr("shop.close"), on: { click: closeShop } });
  listScreen = el("div", { class: "shop-screen", dataset: { screen: "list" } }, [
    showcaseEl,
    listEl,
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

  // Currency picker for real-money goods. Only shown when the web store is
  // enabled; changing it re-renders prices in the chosen currency.
  currencySelect = el("select", {
    class: "shop-currency",
    style: { display: isWebStoreEnabled() ? "" : "none" },
    on: { change: onCurrencyChange },
  }, CURRENCIES.map((c) => el("option", { value: c, text: c.toUpperCase() })));
  currencySelect.value = getCurrency();

  root = el("div", { id: "shop" }, [
    el("div", { class: "shop-card" }, [
      el("div", { class: "shop-head" }, [
        (titleEl = el("h1", { class: "shop-title", text: tr("shop.title") })),
        el("div", { class: "shop-head-right" }, [
          currencySelect,
          el("div", { class: "shop-coins" }, [coinIcon, coinValEl]),
        ]),
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
  stock = Array.isArray(stockList)
    ? stockList.filter((e) => e && (
        isSkinEntry(e) ? getSkin(e.skin)
        : isSkillEntry(e) ? skillInfo(e.skill)
        : getSpecies(e.item)
      ))
    : [];
  playerIndex = playerIdx | 0;
  open = true;
  // Refresh labels built at install time, in case strings hydrated after boot.
  titleEl.textContent = tr("shop.title");
  closeBtn.textContent = tr("shop.close");
  showStorefront();
  root.style.display = "flex";
  refreshCoins();
  loadCatalog();
  focusFirstIn(visibleScreen);
}

// Fetch the real-money catalog once and re-render so skins show their cash
// price alongside coins. No-op when the web store is disabled; a 503/offline
// just leaves the shop coin-only (catalogBySkin stays empty).
async function loadCatalog() {
  if (catalogLoaded || !isWebStoreEnabled()) return;
  const r = await fetchCatalog();
  if (r.ok && Array.isArray(r.data?.items)) {
    for (const item of r.data.items) {
      if (item?.kind === "skin" && typeof item.refId === "string") catalogBySkin.set(item.refId, item);
    }
    catalogLoaded = true;
    if (open) {
      renderList();
      if (detailScreen.style.display !== "none" && detailEntry) renderDetail();
    }
  }
}

// The catalog entry for a skin stock entry, or null if it isn't a real-money
// skin (or the web store is off / catalog not loaded). Drives every dual-price
// branch below.
function skinSku(entry) {
  if (!isWebStoreEnabled() || !isSkinEntry(entry)) return null;
  return catalogBySkin.get(entry.skin) || null;
}

function onCurrencyChange() {
  setCurrency(currencySelect.value);
  if (!open) return;
  renderList();
  if (detailScreen.style.display !== "none" && detailEntry) renderDetail();
}

// A small "€2.99" tag for a real-money skin, in the selected currency.
function realMoneyTag(cat) {
  return el("span", { class: "shop-row-realprice", text: formatPrice(cat.prices[getCurrency()], getCurrency()) });
}

export function closeShop() {
  if (!open) return;
  open = false;
  root.style.display = "none";
  detailEntry = null;
  stopShowcase();
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
  // The showcase canvas follows the visible screen — point it back at the
  // storefront's before renderList re-shows the focused good.
  mountShowcase(listShowcaseCanvas);
  renderList();
  showOnly({ list: listScreen, detail: detailScreen }, "list", "flex");
}

function renderList() {
  listEl.replaceChildren();
  for (let i = 0; i < stock.length; i++) {
    listEl.appendChild(rowFor(stock[i], i));
  }
  // Default the showcase to the first row so it isn't blank.
  if (stock.length) setDesc(stock[0]);
}

function rowFor(entry, i) {
  const owned = isEntryOwned(entry, playerIndex);
  const affordable = maxAffordable(entry.price, playerIndex) > 0;

  const icon = makeIcon(entry, "shop-row-icon", 32);

  const cat = owned ? null : skinSku(entry);
  const tag = owned
    ? el("span", { class: "shop-row-tag is-owned", text: tr("shop.owned") })
    : el("span", { class: "shop-row-prices" }, [
        el("span", { class: "shop-row-price" }, [String(entry.price | 0), priceCoin()]),
        ...(cat ? [realMoneyTag(cat)] : []),
      ]);

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
    el("span", { class: "shop-row-name", text: entryName(entry) }),
    tag,
  ]);
  return row;
}

// Update the showcase to a focused good: animated sprite, name, price (or
// "Owned"), and the blurb. Drives shopShowcase.js's rAF for the sprite.
function setDesc(entry) {
  showEntry(entry);
  showcaseNameEl.textContent = entryName(entry);
  descEl.textContent = entryDesc(entry);
  if (isEntryOwned(entry, playerIndex)) {
    showcasePriceEl.replaceChildren(el("span", { class: "shop-row-tag is-owned", text: tr("shop.owned") }));
  } else {
    const cat = skinSku(entry);
    showcasePriceEl.replaceChildren(
      el("span", { class: "shop-row-price" }, [String(entry.price | 0), priceCoin()]),
      ...(cat ? [realMoneyTag(cat)] : []),
    );
  }
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
  detailScreen.replaceChildren();

  // The detail popup shows the same animated preview as the storefront
  // showcase — this is the only preview on touch devices, where the pinned
  // storefront showcase is hidden. mounted + started at the tail.
  const preview = el("canvas", {
    class: "shop-detail-showcase",
    width: 96,
    height: 96,
    style: { width: "96px", height: "96px", imageRendering: "pixelated" },
  });

  const children = [
    preview,
    el("div", { class: "shop-detail-name", text: entryName(entry) }),
    el("div", { class: "shop-detail-desc", text: entryDesc(entry) }),
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

  // Real-money option for a catalog skin: a separate row so the coin path stays
  // visually primary. Logged out → routes to the account panel ("sign in to
  // buy"); otherwise redirects to Stripe hosted Checkout.
  const cat = skinSku(entry);
  if (cat) {
    const priceText = formatPrice(cat.prices[getCurrency()], getCurrency());
    const label = isSignedIn()
      ? tr("store.buy_for").replace("%s", priceText)
      : tr("store.sign_in_to_buy");
    children.push(el("div", { class: "shop-detail-real" }, [
      el("div", { class: "shop-detail-real-or", text: tr("store.or_real_money") }),
      el("button", {
        class: "shop-btn shop-buy-real",
        text: label,
        on: { click: () => startCheckout(cat.sku) },
      }),
    ]));
  }

  detailScreen.append(...children);

  // Drive the popup preview (canvas is recreated on every renderDetail).
  mountShowcase(preview);
  showEntry(entry);
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
  const name = entryName(detailEntry);
  const image = (isSkinEntry(detailEntry) || isSkillEntry(detailEntry)) ? null : toastIcon(detailEntry.item);
  showToast(tr("shop.bought").replace("%s", name), "hint", { image });
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

// A stock entry's display name / description, whether it's a skin (string
// `skin` id → skins catalog keys) or a species good (numeric `item`).
function entryName(entry) {
  if (isSkinEntry(entry)) return tr(getSkin(entry.skin)?.nameKey);
  if (isSkillEntry(entry)) return skillInfo(entry.skill)?.name || "";
  return nameOf(getSpecies(entry.item));
}

function entryDesc(entry) {
  if (isSkinEntry(entry)) {
    const key = `skins.desc.${entry.skin}`;
    const text = tr(key);
    return text === key ? "" : text;
  }
  if (isSkillEntry(entry)) return skillInfo(entry.skill)?.desc || "";
  return descOf(getSpecies(entry.item));
}

// Build the icon node for a stock entry. Skins blit a hero preview from the
// `heroes` sheet (1×2 tiles, so the canvas is twice as tall as wide); species
// goods use the square inventory icon.
function makeIcon(entry, className, sizePx) {
  if (isSkinEntry(entry)) {
    const canvas = el("canvas", {
      class: className,
      width: TILE_SIZE,
      height: TILE_SIZE * 2,
      style: { width: `${sizePx / 2}px`, height: `${sizePx}px`, imageRendering: "pixelated" },
    });
    paintHero(canvas, getSkin(entry.skin)?.column);
    return canvas;
  }
  const canvas = el("canvas", {
    class: className,
    width: TILE_SIZE,
    height: TILE_SIZE,
    style: { width: `${sizePx}px`, height: `${sizePx}px`, imageRendering: "pixelated" },
  });
  if (isSkillEntry(entry)) paintIconAt(canvas, skillInfo(entry.skill)?.icon);
  else paintIcon(canvas, entry.item);
  return canvas;
}

// Blit an inventory-sheet tile given a raw [row, col] offset — used for skill
// goods, whose icon lives in skills.js (SKILL_INFO) rather than on a species.
function paintIconAt(canvas, offset) {
  if (!offset) return;
  let sheet;
  try { sheet = getSprite("inventory"); } catch { return; }
  if (!sheet || !sheet.complete) return;
  const [row, col] = offset;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, TILE_SIZE, TILE_SIZE);
  ctx.drawImage(sheet, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0, 0, TILE_SIZE, TILE_SIZE);
}

// Blit a hero's down-facing still frame from the `heroes` sheet at the given
// column. Row math mirrors player.js getPlayerSpriteFrame (down/still = row 5,
// each frame 2 tiles tall, sheet origin y=1) → source y = (1 + 5*2) = 11.
function paintHero(canvas, column) {
  if (column == null) return;
  let sheet;
  try { sheet = getSprite("heroes"); } catch { return; }
  if (!sheet || !sheet.complete) return;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(sheet, column * TILE_SIZE, 11 * TILE_SIZE, TILE_SIZE, TILE_SIZE * 2, 0, 0, TILE_SIZE, TILE_SIZE * 2);
}

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
      border-radius: var(--sb-card-radius); box-shadow: 0 14px 40px rgba(0,0,0,.6);
      overflow: hidden;
    }
    #shop .shop-head {
      display: flex; align-items: center; justify-content: space-between;
      padding: 12px 16px; border-bottom: 1px solid #3a4150;
      background: linear-gradient(180deg, #2b3450 0%, #222a40 100%);
    }
    #shop .shop-title { margin: 0; font-size: 18px; letter-spacing: .5px; }
    #shop .shop-head-right { display: flex; align-items: center; gap: 12px; }
    #shop .shop-coins { display: flex; align-items: center; gap: 6px; font-size: 15px; }
    #shop .shop-currency {
      background: #232a38; color: #eef2ff; border: 1px solid #4a5878;
      border-radius: var(--sb-surface-radius); padding: 4px 8px; font-family: inherit; font-size: 13px; cursor: pointer;
    }
    #shop .shop-screen { padding: 12px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; }
    /* On the storefront the showcase + Close stay pinned; only the rows scroll. */
    #shop .shop-screen[data-screen="list"] { overflow: hidden; min-height: 0; }
    #shop .shop-list { display: flex; flex-direction: column; gap: 6px; max-height: 44vh; overflow-y: auto; }
    #shop .shop-row {
      display: flex; align-items: center; gap: 12px; width: 100%;
      padding: 8px 12px; text-align: left; cursor: pointer;
      background: #232a38; border: 1px solid #39425a; border-radius: var(--sb-surface-radius);
      color: inherit; font-family: inherit; font-size: 15px;
    }
    #shop .shop-row:hover { background: #2c3650; }
    #shop .shop-row-name { flex: 1; }
    #shop .shop-row-prices { display: flex; align-items: center; gap: 10px; }
    #shop .shop-row-price { display: flex; align-items: center; gap: 4px; color: #ffe08a; font-weight: 700; }
    #shop .shop-row-realprice { color: #8fd0ff; font-weight: 700; font-size: 13px; }
    #shop .shop-row-tag.is-owned { color: #8fe39a; font-size: 13px; font-weight: 700; }
    #shop .shop-row.is-owned { opacity: .55; cursor: default; }
    #shop .shop-row.is-poor .shop-row-price { color: #d98a8a; }
    #shop .shop-desc {
      min-height: 2.4em; padding: 8px 12px; font-size: 13px; line-height: 1.4;
      color: #c7d2e6; background: #1a1f29; border-radius: var(--sb-surface-radius); border: 1px solid #2c3444;
    }
    /* Showcase: animated preview of the focused good, pinned above the list. */
    #shop .shop-showcase {
      display: flex; align-items: center; gap: 14px; padding: 12px;
      background: linear-gradient(180deg, #232a3a 0%, #1a1f29 100%);
      border: 1px solid #39425a; border-radius: var(--sb-surface-radius);
    }
    #shop .shop-showcase-sprite {
      flex: 0 0 auto; width: 80px; height: 80px;
      background: #11141b; border: 1px solid #2c3444; border-radius: var(--sb-surface-radius);
    }
    #shop .shop-showcase-info { flex: 1; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    #shop .shop-showcase-name { font-size: 17px; font-weight: 700; letter-spacing: .3px; }
    #shop .shop-showcase-price { display: flex; align-items: center; min-height: 18px; }
    #shop .shop-showcase-desc { min-height: 1.4em; border: none; background: none; padding: 0; }
    /* Touch devices have no hover to drive the pinned showcase, so hide it —
       the animated preview lives in the detail popup there instead. */
    @media (pointer: coarse) { #shop .shop-showcase { display: none; } }
    #shop .shop-screen[data-screen="detail"] { align-items: center; text-align: center; }
    #shop .shop-detail-showcase {
      margin: 4px auto; width: 96px; height: 96px;
      background: #11141b; border: 1px solid #2c3444; border-radius: var(--sb-surface-radius);
    }
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
      background: #2f3b55; border: 1px solid #4a5878; border-radius: var(--sb-surface-radius);
      color: #eef2ff; font-family: inherit; font-size: 15px; font-weight: 700;
    }
    #shop .shop-btn:hover:not(:disabled) { background: #3a486a; }
    #shop .shop-btn:disabled { opacity: .45; cursor: default; }
    #shop .shop-buy { background: #2e6b3e; border-color: #418a55; }
    #shop .shop-buy:hover:not(:disabled) { background: #357d49; }
    #shop .shop-detail-real {
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      margin-top: 10px; padding-top: 10px; border-top: 1px solid #2c3444; width: 100%;
    }
    #shop .shop-detail-real-or { font-size: 12px; color: #9fb0c8; letter-spacing: .3px; }
    #shop .shop-buy-real { background: #2c4a6b; border-color: #3f6da0; }
    #shop .shop-buy-real:hover:not(:disabled) { background: #34588a; }
    #shop .shop-qty-btn { min-width: 52px; font-size: 18px; }
    #shop .shop-close { align-self: center; margin-top: 4px; }
  `;
  document.head.appendChild(style);
}
