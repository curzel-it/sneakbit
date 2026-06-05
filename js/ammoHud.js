// Ammo HUD: small chip in the top-right showing the inventory icon and the
// player's current count. Pins to the corner so it doesn't fight the on-screen
// joystick (bottom) or the HP HUD (top-left). The icon is drawn from the
// dedicated inventory sprite sheet at the species' `inventory_texture_offset`,
// matching the original game's HUD.
//
// Single-slice (single-player / online): one chip, top-right, for the local
// hero. In split-screen local play (co-op or PvP) one chip per player is
// anchored to the top-right of THAT player's slice — mirroring the per-slice
// HP bars — each showing that player's own count.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { getAmmo, onInventoryChange } from "./inventory.js";
import { getEquipped, SLOT_RANGED, onEquipmentChange } from "./equipment.js";
import { getSpecies } from "./species.js";
import { isPvp } from "./gameMode.js";
import { localPlayerCount } from "./coopMode.js";
import { sliceCount, getSlices } from "./splitScreen.js";
import { getPvpAmmo, getPvpRangedWeapon, bulletOfWeapon } from "./pvpLoadout.js";
import { topHudRow, setTopHudSplit } from "./topHudRow.js";
import { openInventory } from "./menu.js";
import { el } from "./dom.js";
const KUNAI_SPECIES_ID = 7000;
const ICON_PIXELS = 28;
// The 28px icon box isn't an integer multiple of the 16px source tile, so a
// straight nearest-neighbour upscale duplicates some source pixels and not
// others — lumpy on round sprites. Paint into a clean integer-multiple (×8)
// backing canvas and let the browser smoothly downscale it to ICON_PIXELS.
const ICON_SUPERSAMPLE = 8;
const ICON_RES = TILE_SIZE * ICON_SUPERSAMPLE;
const MAX_PLAYERS = 4;

let root = null;
const chips = []; // [{ root, icon, count, lastLabel, iconSpecies, index }]

export function installAmmoHud() {
  if (root) return root;
  injectStyles();
  // Build all four chips up front; updateAmmoHud shows only the active ones
  // (the local player count is hot-toggled, so we can't size the set here).
  for (let i = 0; i < MAX_PLAYERS; i++) chips.push(makeChip(i));
  root = el("div", { id: "ammo-hud" }, chips.map((c) => c.root));
  topHudRow().appendChild(root);

  onInventoryChange(updateAmmoHud);
  onEquipmentChange(updateAmmoHud); // chip follows the equipped ranged weapon
  return root;
}

// The bullet the player's equipped ranged weapon fires (story/co-op).
// Falls back to the kunai when no weapon resolves (default loadout / tests).
function rangedBulletFor(playerIndex) {
  const sp = getSpecies(getEquipped(SLOT_RANGED, playerIndex));
  return sp?.bullet_species_id || KUNAI_SPECIES_ID;
}

function makeChip(index) {
  const icon = el("canvas", {
    width: ICON_RES,
    height: ICON_RES,
    style: { width: `${ICON_PIXELS}px`, height: `${ICON_PIXELS}px` },
  });
  const count = el("span", { text: "x0" });
  const card = el("div", { class: "ammo-chip" }, [icon, count]);
  // Tapping the chip is a one-tap shortcut into the Inventory screen (which
  // pauses for non-hosts) — the fastest way to swap weapons/gear mid-run on a
  // phone. The chip opts back into pointer events (the #ammo-hud parent stays
  // pass-through so it never blocks the canvas / joystick).
  card.addEventListener("click", () => openInventory());
  return { root: card, icon, count, lastLabel: null, iconSpecies: -1, index };
}

export function updateAmmoHud() {
  if (!root) return;
  const pvp = isPvp();
  // Split-screen local play shows one chip per player, each anchored to its
  // own slice and reading its own count. Single-slice (single-player / online)
  // shows just the local hero's chip in the shared top-right corner.
  const split = sliceCount() > 1;
  // Drive the shared bar's unified-vs-split look (runs every frame, idempotent).
  setTopHudSplit(split);
  const slices = split ? getSlices() : null;
  const count = split ? localPlayerCount() : 1;
  // Tag with the player number when more than one chip is on screen, or in
  // PvP (where the chip tracks a specific player's scavenged loadout).
  const tagged = pvp || count > 1;
  for (const c of chips) {
    if (c.index >= count) { c.root.style.display = "none"; continue; }
    c.root.style.display = "";
    // PvP draws from the per-player scavenge loadout and follows that player's
    // equipped caliber; outside PvP it's the persisted inventory pool.
    const bulletId = pvp
      ? bulletOfWeapon(getPvpRangedWeapon(c.index))
      : rangedBulletFor(c.index);
    const n = pvp ? getPvpAmmo(c.index, bulletId) : getAmmo(bulletId, c.index);
    const label = tagged ? `P${c.index + 1}  x${n}` : `x${n}`;
    if (label !== c.lastLabel) {
      c.count.textContent = label;
      c.lastLabel = label;
    }
    // Re-paint the icon when the displayed caliber changes (weapon swap).
    if (c.iconSpecies !== bulletId) {
      c.iconSpecies = bulletId;
      c.icon.dataset.painted = "";
    }
    // Lazy-draw the icon the first time the sprite sheet is available
    // (it's loaded async at startup, so the first frames may not have it).
    if (!c.icon.dataset.painted) paintIcon(c.icon, bulletId);
    anchorChip(c, slices);
  }
}

// Position one chip: fixed to the top-right of its slice in split-screen, or
// reset to the shared top-right container flow (single-slice). Mirrors
// healthHud.anchorBar, but right-aligned (translateX) since ammo pins right.
function anchorChip(c, slices) {
  const css = slices?.[c.index]?.cssRect;
  if (css) {
    Object.assign(c.root.style, {
      position: "fixed",
      left: `${Math.round(css.left + css.width - 12)}px`,
      top: `${Math.round(css.top + 12)}px`,
      transform: "translateX(-100%)",
    });
  } else {
    Object.assign(c.root.style, { position: "", left: "", top: "", transform: "" });
  }
}

function injectStyles() {
  if (document.getElementById("ammo-hud-styles")) return;
  const style = document.createElement("style");
  style.id = "ammo-hud-styles";
  // Single-slice: a flex item in the shared top row (topHudRow.js), which owns
  // its position and the gap that clears the ☰ menu button. Split-screen:
  // anchorChip pins each chip to its slice via inline position:fixed, which
  // beats the relative rule here.
  style.textContent = `
    #ammo-hud {
      position: relative;
      flex: 0 0 auto;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      pointer-events: none;
      user-select: none;
      -webkit-user-select: none;
    }
    .ammo-chip {
      padding: 6px 10px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
      color: var(--sb-text);
      font-family: var(--sb-font);
      font-size: 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      pointer-events: auto; /* tappable shortcut into the inventory */
      cursor: pointer;
    }
  `;
  document.head.appendChild(style);
}

function paintIcon(iconCanvas, speciesId = KUNAI_SPECIES_ID) {
  const sp = getSpecies(speciesId);
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
