// Inventory + equipment-swap panel for the pause menu.
//
// Lists every species the player has picked up (with its localized name
// + count), highlights what's currently equipped in the melee/ranged
// slot, and offers an inline Equip button on weapon-associated items
// so the player can swap loadouts without dropping to devtools.
//
// Pure DOM, like the rest of the pause menu. The pause menu owns the
// "open / close / Esc back out" wiring; this file just renders into a
// host element passed by menu.js when the Inventory tab is shown.

import { getSpecies } from "./species.js";
import { tr } from "./strings.js";
import { getEquipped, setEquipped, clearEquipped, SLOT_MELEE, SLOT_RANGED,
         DEFAULT_RANGED_WEAPON_ID } from "./equipment.js";

const PREFIX = "sneakbit.inventory.v1";

export function renderInventoryInto(host) {
  if (!host) return;
  host.innerHTML = inventoryHtml();
  bindInventoryButtons(host);
}

function inventoryHtml() {
  const counts = loadCounts();
  const equippedMelee  = getEquipped(SLOT_MELEE);
  const equippedRanged = getEquipped(SLOT_RANGED);

  const rows = Object.entries(counts)
    .map(([id, n]) => ({ id: Number(id), count: n | 0 }))
    .filter(r => r.count > 0)
    .map(r => ({ ...r, sp: getSpecies(r.id) }))
    .filter(r => r.sp)
    .sort(byKindThenName);

  if (rows.length === 0) {
    return `<p class="inv-empty">Your inventory is empty.</p>`;
  }

  return `
    <div class="inv-equipped">
      <div><span class="inv-label">Melee:</span>  ${equipName(equippedMelee)}</div>
      <div><span class="inv-label">Ranged:</span> ${equipName(equippedRanged)}</div>
    </div>
    <ul class="inv-list">
      ${rows.map(r => itemRow(r, equippedMelee, equippedRanged)).join("")}
    </ul>
  `;
}

function itemRow(r, equippedMelee, equippedRanged) {
  const name = tr(r.sp.name) || r.sp.name || `Species ${r.id}`;
  const weaponId = r.sp.associated_weapon;
  let action = "";
  if (weaponId) {
    const weaponSp = getSpecies(weaponId);
    const isMelee  = weaponSp?.entity_type === "WeaponMelee";
    const isRanged = weaponSp?.entity_type === "WeaponRanged";
    const equippedNow = (isMelee  && equippedMelee  === weaponId) ||
                        (isRanged && equippedRanged === weaponId);
    if (equippedNow) {
      action = `<span class="inv-equipped-tag">Equipped</span>`;
    } else if (isMelee || isRanged) {
      action = `<button data-equip="${weaponId}" data-slot="${isMelee ? "melee" : "ranged"}">Equip</button>`;
    }
  }
  return `<li>
    <span class="inv-name">${escapeHtml(name)}</span>
    <span class="inv-count">×${r.count}</span>
    <span class="inv-action">${action}</span>
  </li>`;
}

function bindInventoryButtons(host) {
  for (const btn of host.querySelectorAll("[data-equip]")) {
    btn.addEventListener("click", () => {
      const id = parseInt(btn.dataset.equip, 10);
      const slot = btn.dataset.slot === "melee" ? SLOT_MELEE : SLOT_RANGED;
      setEquipped(slot, id);
      renderInventoryInto(host); // re-render so labels flip
    });
  }
  const unequipMelee = host.querySelector("[data-unequip-melee]");
  if (unequipMelee) {
    unequipMelee.addEventListener("click", () => {
      clearEquipped(SLOT_MELEE);
      renderInventoryInto(host);
    });
  }
}

function equipName(weaponId) {
  if (!weaponId) return `<em>none</em>`;
  const sp = getSpecies(weaponId);
  const name = sp ? (tr(sp.name) || sp.name) : `Species ${weaponId}`;
  if (weaponId === DEFAULT_RANGED_WEAPON_ID) {
    return `${escapeHtml(name)} <span class="inv-equipped-default">(default)</span>`;
  }
  // Melee can be cleared back to nothing; ranged falls back to the kunai
  // launcher anyway, so the only meaningful unequip button is for melee.
  const sl = sp?.entity_type === "WeaponMelee"
    ? ` <button data-unequip-melee>Unequip</button>`
    : "";
  return `${escapeHtml(name)}${sl}`;
}

// Group weapons first (so the equip controls are at the top), then
// alphabetical by name. Stable enough for a small inventory.
function byKindThenName(a, b) {
  const aw = a.sp.associated_weapon ? 0 : 1;
  const bw = b.sp.associated_weapon ? 0 : 1;
  if (aw !== bw) return aw - bw;
  const an = tr(a.sp.name) || a.sp.name || "";
  const bn = tr(b.sp.name) || b.sp.name || "";
  return an.localeCompare(bn);
}

function loadCounts() {
  try {
    const raw = (typeof localStorage !== "undefined") && localStorage.getItem(PREFIX);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === "object") ? parsed : {};
  } catch {
    return {};
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
