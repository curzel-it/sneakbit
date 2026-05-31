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
// Local co-op shares one save slot (P1 / P2 fold to index 0), so we render
// a single section even when co-op is on. Pure DOM; menu.js owns open/close.

import { getSpecies } from "./species.js";
import { tr } from "./strings.js";
import {
  setEquipped, clearEquipped, getEquipped,
  SLOT_MELEE, SLOT_RANGED, onEquipmentChange,
} from "./equipment.js";
import { snapshotInventory, onInventoryChange } from "./inventory.js";
import { weaponsInSlot } from "./weaponSlots.js";
import { isCoopMode } from "./coopMode.js";

let unsubscribers = [];

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
}

function teardown() {
  for (const u of unsubscribers) { try { u(); } catch { /* ignore */ } }
  unsubscribers = [];
}

function draw(host) {
  host.innerHTML = sectionsHtml(0);
  bindButtons(host, 0);
}

function sectionsHtml(playerIndex) {
  const header = isCoopMode() ? `<h2 class="inv-player">Shared</h2>` : "";
  return `${header}
    ${slotPanelHtml("Ranged", SLOT_RANGED, playerIndex, false)}
    ${slotPanelHtml("Melee",  SLOT_MELEE,  playerIndex, true)}
    <hr class="inv-sep" />
    ${itemsHtml(playerIndex)}`;
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

function rowHtml({ active, name, ammo = null, attrs, raw = false }) {
  const nameHtml = raw ? name : escapeHtml(name);
  const ammoHtml = ammo != null ? `<span class="inv-count">x${ammo}</span>` : "";
  return `<li>
    <button class="inv-slot-row${active ? " is-active" : ""}" ${attrs}>
      <span class="inv-radio">${active ? "◉" : "◯"}</span>
      <span class="inv-name">${nameHtml}</span>
      ${ammoHtml}
    </button>
  </li>`;
}

// Non-weapon pickups — weapons live in the slot panels above.
function itemsHtml(playerIndex) {
  const counts = snapshotInventory(playerIndex);
  const rows = Object.entries(counts)
    .map(([id, n]) => ({ id: Number(id), count: n | 0 }))
    .filter((r) => r.count > 0)
    .map((r) => ({ ...r, sp: getSpecies(r.id) }))
    .filter((r) => r.sp && !isWeaponItem(r.sp))
    .sort(byName);

  if (rows.length === 0) return `<p class="inv-empty">No other items.</p>`;

  return `<ul class="inv-list">${rows.map((r) => {
    const name = tr(r.sp.name) || r.sp.name || `Species ${r.id}`;
    return `<li>
      <span class="inv-name">${escapeHtml(name)}</span>
      <span class="inv-count">×${r.count}</span>
    </li>`;
  }).join("")}</ul>`;
}

function isWeaponItem(sp) {
  const w = sp.associated_weapon;
  if (!w) return false;
  const wsp = getSpecies(w);
  return wsp?.entity_type === "WeaponMelee" || wsp?.entity_type === "WeaponRanged";
}

function bindButtons(host, playerIndex) {
  for (const btn of host.querySelectorAll("[data-equip]")) {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.equip, 10);
      const slot = btn.dataset.slot === SLOT_MELEE ? SLOT_MELEE : SLOT_RANGED;
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
