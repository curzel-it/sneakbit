// Inventory + equipment-swap panel for the pause menu.
//
// Lists every species the player has picked up (with its localized name
// + count), highlights what's currently equipped in the melee/ranged
// slot, and offers an inline Equip button on weapon-associated items
// so the player can swap loadouts without dropping to devtools.
//
// Local co-op shares one save slot (P1 / P2 fold to index 0 in
// inventory.js + equipment.js), so we render a single section even when
// co-op is on — duplicating it would just show the same numbers twice.
//
// Pure DOM, like the rest of the pause menu. The pause menu owns the
// "open / close / Esc back out" wiring; this file just renders into a
// host element passed by menu.js when the Inventory tab is shown.

import { getSpecies } from "./species.js";
import { tr } from "./strings.js";
import { getEquipped, setEquipped, clearEquipped, SLOT_MELEE, SLOT_RANGED,
         DEFAULT_RANGED_WEAPON_ID } from "./equipment.js";
import { snapshotInventory } from "./inventory.js";
import { isCoopMode } from "./coopMode.js";

export function renderInventoryInto(host) {
  if (!host) return;
  // P1 backs the shared local-coop inventory; in network coop we only
  // ever render the local player's loadout from this screen.
  host.innerHTML = playerSectionHtml(0);
  bindInventoryButtons(host);
}

function playerSectionHtml(playerIndex) {
  const counts = snapshotInventory(playerIndex);
  const equippedMelee  = getEquipped(SLOT_MELEE, playerIndex);
  const equippedRanged = getEquipped(SLOT_RANGED, playerIndex);

  const rows = Object.entries(counts)
    .map(([id, n]) => ({ id: Number(id), count: n | 0 }))
    .filter(r => r.count > 0)
    .map(r => ({ ...r, sp: getSpecies(r.id) }))
    .filter(r => r.sp)
    .sort(byKindThenName);

  const header = isCoopMode() ? `<h2 class="inv-player">Shared</h2>` : "";

  if (rows.length === 0) {
    return `${header}
      <div class="inv-equipped">
        <div><span class="inv-label">Melee:</span>  ${equipName(equippedMelee, playerIndex)}</div>
        <div><span class="inv-label">Ranged:</span> ${equipName(equippedRanged, playerIndex)}</div>
      </div>
      <p class="inv-empty">Inventory is empty.</p>`;
  }

  return `${header}
    <div class="inv-equipped">
      <div><span class="inv-label">Melee:</span>  ${equipName(equippedMelee, playerIndex)}</div>
      <div><span class="inv-label">Ranged:</span> ${equipName(equippedRanged, playerIndex)}</div>
    </div>
    <ul class="inv-list">
      ${rows.map(r => itemRow(r, equippedMelee, equippedRanged, playerIndex)).join("")}
    </ul>
  `;
}

function itemRow(r, equippedMelee, equippedRanged, playerIndex) {
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
      action = `<button data-equip="${weaponId}" data-slot="${isMelee ? "melee" : "ranged"}" data-player="${playerIndex}">Equip</button>`;
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
      const idx = parseInt(btn.dataset.player, 10) | 0;
      setEquipped(slot, id, idx);
      renderInventoryInto(host); // re-render so labels flip
    });
  }
  for (const btn of host.querySelectorAll("[data-unequip-melee]")) {
    btn.addEventListener("click", () => {
      const idx = parseInt(btn.dataset.unequipMelee, 10) | 0;
      clearEquipped(SLOT_MELEE, idx);
      renderInventoryInto(host);
    });
  }
}

function equipName(weaponId, playerIndex) {
  if (!weaponId) return `<em>none</em>`;
  const sp = getSpecies(weaponId);
  const name = sp ? (tr(sp.name) || sp.name) : `Species ${weaponId}`;
  if (weaponId === DEFAULT_RANGED_WEAPON_ID) {
    return `${escapeHtml(name)} <span class="inv-equipped-default">(default)</span>`;
  }
  // Melee can be cleared back to nothing; ranged falls back to the kunai
  // launcher anyway, so the only meaningful unequip button is for melee.
  const sl = sp?.entity_type === "WeaponMelee"
    ? ` <button data-unequip-melee="${playerIndex | 0}">Unequip</button>`
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

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}
