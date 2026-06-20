// Inventory + equipment panel for the pause menu.
//
// Organised around the two equipment slots: a Ranged panel and a Melee
// panel, each a single-select (radio) list of the weapons you own for that
// slot, with the active one marked. Picking a row equips it — the same
// per-slot model as the in-play quick-switch ribbon (both read
// weaponSlots.weaponsInSlot, so they never disagree). Non-weapon pickups
// are listed plainly below.
//
// Equipping is a bare setEquipped/clearEquipped: host/guest loadout sync
// both listen on onEquipmentChange, so a menu equip propagates in every
// mode without extra wiring here.
//
// Each local player owns a dedicated inventory now. In local co-op the panel
// shows a player selector (P1/P2/…) so any player can manage their own gear
// and consumables; single-player renders just the one hero. Pure DOM; menu.js
// owns open/close.

import { getSpecies } from "./species.js";
import { tr } from "./strings.js";
import {
  setEquipped, clearEquipped, getEquipped,
  SLOT_MELEE, SLOT_RANGED, ARMOR_SLOTS, onEquipmentChange,
} from "./equipment.js";
import { snapshotInventory, onInventoryChange } from "./inventory.js";
import { weaponsInSlot } from "./weaponSlots.js";
import { armorInSlot } from "./armorSlots.js";
import { unlockedSkills, onSkillsChange } from "./skills.js";
import { localPlayerCount } from "./coopMode.js";
import {
  isConsumable, consumableVerb, canUseConsumable, useConsumable,
} from "./consumables.js";
import { onPlayerHealthChange } from "./playerHealth.js";
import { ICON_RES, paintInventoryIcon } from "./inventoryIcon.js";
import {
  ownedSkins, getSelected, setSelected, defaultColumn,
  onSkinChange, DEFAULT_SKIN_ID,
} from "./skins.js";
import { paintHeroPreview, PREVIEW_W, PREVIEW_H } from "./heroPreview.js";

const ICON_PIXELS = 24;
let unsubscribers = [];
// Which local player the panel is currently showing. Clamped to the live
// player count on each draw, so it falls back to P1 when co-op turns off.
let activePlayer = 0;

export function renderInventoryInto(host) {
  if (!host) return;
  teardown();
  draw(host);
  // Re-render live so the panel reflects a quick-switch / pickup that
  // changed a slot while the menu is open. Lazily tears down once the
  // host leaves the DOM (menu closed) — there's no explicit hide hook.
  const rerender = () => { if (host.isConnected) draw(host); else teardown(); };
  unsubscribers.push(onEquipmentChange(rerender));
  unsubscribers.push(onInventoryChange(rerender));
  unsubscribers.push(onSkillsChange(rerender));
  // The Skin slot equips by selection, not equipment — keep it live too.
  unsubscribers.push(onSkinChange(rerender));
  // Health changes flip a consumable's "would this do anything?" state
  // (e.g. a heal potion greys out at full HP, re-enables once you take a
  // hit) while the panel is open.
  unsubscribers.push(onPlayerHealthChange(rerender));
}

function teardown() {
  for (const u of unsubscribers) { try { u(); } catch { /* ignore */ } }
  unsubscribers = [];
}

function draw(host) {
  const idx = activeIdx();
  host.innerHTML = sectionsHtml(idx);
  bindButtons(host, idx);
  paintIcons(host);
  paintHeroPreviews(host);
}

// The player the panel currently edits, clamped to the live local count so a
// stale selection (P3 chosen, then co-op dropped to 2) snaps back in range.
function activeIdx() {
  return Math.min(Math.max(0, activePlayer | 0), localPlayerCount() - 1);
}

// The list HTML embeds blank icon canvases tagged with their [row, col]; paint
// them once the DOM exists. The sprite sheet is loaded by the time the menu
// opens mid-game, so a single pass suffices.
function paintIcons(host) {
  for (const c of host.querySelectorAll("canvas.inv-icon[data-icon-row]")) {
    paintInventoryIcon(c, Number(c.dataset.iconRow), Number(c.dataset.iconCol), c.dataset.iconSheet || "inventory");
  }
}

// A blank icon canvas for the given [row, col] inventory-sheet tile, painted
// after insertion by paintIcons. Renders a same-sized spacer when the tile is
// unknown (e.g. the Unarmed row) so names stay aligned.
function iconHtml(offset, sheet = "inventory") {
  if (!offset) return `<span class="inv-icon inv-icon-empty"></span>`;
  return `<canvas class="inv-icon" width="${ICON_RES}" height="${ICON_RES}"
    style="width:${ICON_PIXELS}px;height:${ICON_PIXELS}px"
    data-icon-row="${offset[0] | 0}" data-icon-col="${offset[1] | 0}" data-icon-sheet="${sheet}"></canvas>`;
}

// A blank hero-portrait canvas for the given heroes-sheet column, painted after
// insertion by paintHeroPreviews. Two tiles tall (16×32 on screen) so an
// outfit's body colour reads, not just the head.
function heroPreviewHtml(column) {
  return `<canvas class="inv-hero" width="${PREVIEW_W}" height="${PREVIEW_H}"
    style="width:16px;height:32px;image-rendering:pixelated"
    data-hero-column="${column | 0}"></canvas>`;
}

function paintHeroPreviews(host) {
  for (const c of host.querySelectorAll("canvas.inv-hero[data-hero-column]")) {
    paintHeroPreview(c, Number(c.dataset.heroColumn));
  }
}

// Display labels for the three armour body slots, in head-to-toe order.
const ARMOR_SLOT_LABELS = {
  helmet: "Helmet",
  chest:  "Chest",
  legs:   "Legs",
};

function sectionsHtml(playerIndex) {
  const armorPanels = ARMOR_SLOTS
    .map((slot) => armorPanelHtml(ARMOR_SLOT_LABELS[slot] || slot, slot, playerIndex))
    .join("");
  return `${playerTabsHtml(playerIndex)}
    ${slotPanelHtml("Ranged", SLOT_RANGED, playerIndex, false)}
    ${slotPanelHtml("Melee",  SLOT_MELEE,  playerIndex, true)}
    ${armorPanels}
    ${skinPanelHtml(playerIndex)}
    <hr class="inv-sep" />
    ${itemsHtml(playerIndex)}`;
}

// One armour slot panel: a "None" row (unequip) plus a single-select list of
// the pieces you own for that body slot, the worn one marked. Mirrors the
// weapon slot panel, but armour icons come from the armour sheet and there's
// no ammo column. An empty slot (no armour worn) selects "None".
function armorPanelHtml(title, slot, playerIndex) {
  const list = armorInSlot(slot, playerIndex);
  const worn = getEquipped(slot, playerIndex) != null;
  const rows = [];

  rows.push(rowHtml({
    active: !worn,
    name: "None",
    attrs: `data-unequip-armor="${slot}" data-player="${playerIndex | 0}"`,
  }));

  for (const e of list) {
    const name = tr(e.species?.name) || e.species?.name || `Species ${e.id}`;
    rows.push(rowHtml({
      active: e.isEquipped,
      name: escapeHtml(name),
      icon: e.species?.inventory_texture_offset,
      iconSheet: "armor",
      attrs: `data-equip="${e.id}" data-slot="${slot}" data-player="${playerIndex | 0}"`,
      raw: true,
    }));
  }

  return `<div class="inv-slot">
    <h2 class="inv-slot-title">${title}</h2>
    <ul class="inv-slot-list">${rows.join("")}</ul>
  </div>`;
}

// In local co-op the panel can edit any player's dedicated inventory; a row of
// P1/P2/… tabs picks which. Single-player renders nothing (one inventory).
function playerTabsHtml(playerIndex) {
  const count = localPlayerCount();
  if (count < 2) return "";
  const tabs = [];
  for (let i = 0; i < count; i++) {
    tabs.push(`<button class="inv-player-tab${i === playerIndex ? " is-active" : ""}" data-player-tab="${i}">P${i + 1}</button>`);
  }
  return `<div class="inv-player-tabs">${tabs.join("")}</div>`;
}

// The Skin slot — purely cosmetic, but modelled like the weapon slots: a
// single-select list of the skins you own (default always owned), each
// previewed by its hero portrait. Picking one calls setSelected; buying new
// skins stays in the shop. Selection is per RAW index (skins.js), and the
// inventory panel always edits the local/primary hero (index 0).
function skinPanelHtml(playerIndex) {
  const selected = getSelected(playerIndex);
  const rows = ownedSkins(playerIndex).map((skin) => {
    const column = skin.column == null ? defaultColumn(playerIndex) : skin.column;
    const name = tr(skin.nameKey) || skin.id;
    const label = skin.id === DEFAULT_SKIN_ID
      ? `${escapeHtml(name)} <span class="inv-equipped-default">(default)</span>`
      : escapeHtml(name);
    return `<li>
      <button class="inv-slot-row${skin.id === selected ? " is-active" : ""}" data-skin="${skin.id}" data-player="${playerIndex | 0}">
        <span class="inv-radio">${skin.id === selected ? "◉" : "◯"}</span>
        ${heroPreviewHtml(column)}
        <span class="inv-name">${label}</span>
      </button>
    </li>`;
  }).join("");

  return `<div class="inv-slot">
    <h2 class="inv-slot-title">Skin</h2>
    <ul class="inv-slot-list">${rows}</ul>
  </div>`;
}

function slotPanelHtml(title, slot, playerIndex, withUnarmed) {
  const list = weaponsInSlot(slot, playerIndex);
  const anyEquipped = list.some((e) => e.isEquipped);
  const rows = [];

  if (withUnarmed) {
    rows.push(rowHtml({
      active: !anyEquipped,
      name: "Unarmed",
      attrs: `data-unequip-melee="${playerIndex | 0}"`,
    }));
  }

  for (const e of list) {
    const name = tr(e.species?.name) || e.species?.name || `Species ${e.id}`;
    const label = e.isDefault
      ? `${escapeHtml(name)} <span class="inv-equipped-default">(default)</span>`
      : escapeHtml(name);
    rows.push(rowHtml({
      active: e.isEquipped,
      name: label,
      icon: e.species?.inventory_texture_offset,
      ammo: slot === SLOT_RANGED ? (e.ammo | 0) : null,
      attrs: `data-equip="${e.id}" data-slot="${slot}" data-player="${playerIndex | 0}"`,
      raw: true,
    }));
  }

  return `<div class="inv-slot">
    <h2 class="inv-slot-title">${title}</h2>
    <ul class="inv-slot-list">${rows.join("")}</ul>
  </div>`;
}

function rowHtml({ active, name, icon = null, iconSheet = "inventory", ammo = null, attrs, raw = false }) {
  const nameHtml = raw ? name : escapeHtml(name);
  const ammoHtml = ammo != null ? `<span class="inv-count">x${ammo}</span>` : "";
  return `<li>
    <button class="inv-slot-row${active ? " is-active" : ""}" ${attrs}>
      <span class="inv-radio">${active ? "◉" : "◯"}</span>
      ${iconHtml(icon, iconSheet)}
      <span class="inv-name">${nameHtml}</span>
      ${ammoHtml}
    </button>
  </li>`;
}

// Non-weapon contents, split into three labelled groups: consumables you
// can use, plain pickups (keys, quest items), and the passive skills
// you've earned. All non-selectable; weapons live in the slot panels above.
function itemsHtml(playerIndex) {
  const counts = snapshotInventory(playerIndex);
  const items = Object.entries(counts)
    .map(([id, n]) => ({ id: Number(id), count: n | 0 }))
    .filter((r) => r.count > 0)
    .map((r) => ({ ...r, sp: getSpecies(r.id) }))
    .filter((r) => r.sp && !isWeaponItem(r.sp) && !isArmorItem(r.sp))
    .sort(byName);

  const sections = [
    itemGroupHtml("Consumables", items.filter((r) => isConsumable(r.id)), playerIndex),
    itemGroupHtml("Items", items.filter((r) => !isConsumable(r.id)), playerIndex),
    skillGroupHtml("Skills"),
  ].filter(Boolean);

  if (sections.length === 0) return `<p class="inv-empty">No other items.</p>`;
  return sections.join("");
}

// One labelled group of pickup rows (name × count, plus a use button for
// consumables). Empty string when the group has nothing to show.
function itemGroupHtml(title, rows, playerIndex) {
  if (rows.length === 0) return "";
  const lis = rows.map((r) => {
    const name = tr(r.sp.name) || r.sp.name || `Species ${r.id}`;
    return `<li>
      ${iconHtml(r.sp.inventory_texture_offset)}
      <span class="inv-name">${escapeHtml(name)}</span>
      <span class="inv-count">×${r.count}</span>
      ${actionHtml(r.id, playerIndex)}
    </li>`;
  }).join("");
  return groupHtml(title, lis);
}

// The Skills group: every unlocked passive, listed like keys — a plain
// owned-item row with a short note. Empty string when none are unlocked.
function skillGroupHtml(title) {
  const skills = unlockedSkills();
  if (skills.length === 0) return "";
  const lis = skills.map((s) => `<li>
    ${iconHtml(s.icon)}
    <span class="inv-name">${escapeHtml(s.name)}</span>
    <span class="inv-skill-note">${escapeHtml(s.desc)}</span>
  </li>`).join("");
  return groupHtml(title, lis);
}

function groupHtml(title, lis) {
  return `<div class="inv-group">
    <h2 class="inv-slot-title">${escapeHtml(title)}</h2>
    <ul class="inv-list">${lis}</ul>
  </div>`;
}

// A "use" button for consumable items (the heal potion's "Drink"), disabled
// when using it right now would do nothing. Empty string for plain pickups.
function actionHtml(speciesId, playerIndex) {
  if (!isConsumable(speciesId)) return "";
  const disabled = canUseConsumable(speciesId, playerIndex) ? "" : " disabled";
  return `<span class="inv-action">
    <button data-use="${speciesId}" data-player="${playerIndex | 0}"${disabled}>${escapeHtml(consumableVerb(speciesId))}</button>
  </span>`;
}

// Map a data-slot string onto a real equipment slot, defaulting to ranged for
// the weapon panels (whose rows carry melee/ranged) and passing armour slots
// through unchanged.
function equipSlotOf(slot) {
  if (slot === SLOT_MELEE) return SLOT_MELEE;
  if (ARMOR_SLOTS.includes(slot)) return slot;
  return SLOT_RANGED;
}

function isWeaponItem(sp) {
  const w = sp.associated_weapon;
  if (!w) return false;
  const wsp = getSpecies(w);
  return wsp?.entity_type === "WeaponMelee" || wsp?.entity_type === "WeaponRanged";
}

// An armour-granting pickup (shown in the armour slot panels, not the plain
// Items list).
function isArmorItem(sp) {
  const a = sp.associated_armour;
  if (!a) return false;
  return getSpecies(a)?.entity_type === "Armour";
}

function bindButtons(host, playerIndex) {
  for (const btn of host.querySelectorAll("[data-player-tab]")) {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.playerTab, 10) | 0;
      if (idx === activePlayer) return;
      activePlayer = idx;
      draw(host); // re-render for the newly selected player's inventory
    });
  }
  for (const btn of host.querySelectorAll("[data-equip]")) {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.equip, 10);
      const slot = equipSlotOf(btn.dataset.slot);
      const idx = parseInt(btn.dataset.player, 10) | 0;
      if (getEquipped(slot, idx) === id) return; // already active
      setEquipped(slot, id, idx); // re-render rides onEquipmentChange
    });
  }
  for (const btn of host.querySelectorAll("[data-unequip-melee]")) {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.unequipMelee, 10) | 0;
      clearEquipped(SLOT_MELEE, idx);
    });
  }
  for (const btn of host.querySelectorAll("[data-unequip-armor]")) {
    btn.addEventListener("click", () => {
      const slot = equipSlotOf(btn.dataset.unequipArmor);
      const idx = parseInt(btn.dataset.player, 10) | 0;
      clearEquipped(slot, idx);
    });
  }
  for (const btn of host.querySelectorAll("[data-skin]")) {
    btn.addEventListener("click", () => {
      const id = btn.dataset.skin;
      const idx = parseInt(btn.dataset.player, 10) | 0;
      if (getSelected(idx) === id) return; // already worn
      setSelected(id, idx); // re-render rides onSkinChange
    });
  }
  for (const btn of host.querySelectorAll("[data-use]")) {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.use, 10);
      const idx = parseInt(btn.dataset.player, 10) | 0;
      // Re-render rides onInventoryChange (count drops) / onPlayerHealthChange.
      useConsumable(id, idx);
    });
  }
}

function byName(a, b) {
  const an = tr(a.sp.name) || a.sp.name || "";
  const bn = tr(b.sp.name) || b.sp.name || "";
  return an.localeCompare(bn);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
