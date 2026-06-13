// Objectives the completionist bot cares about, extracted from a zone
// model. `zoneObjectives` is the static catalog (everything the zone can
// ever offer); `liveObjectives` filters it through current storage state
// (collected flags, dialogue progress, visibility conditions) to what is
// actionable right now.

import { getValue } from "../storage.js";
import { shouldBeVisible } from "../entityVisibility.js";
import { resolveEntityDialogue, dialogueLines } from "../dialogue.js";

export function zoneObjectives(model) {
  const out = [];
  for (const p of model.pickups) {
    out.push({ kind: "pickup", zone: model.id, entityId: p.entityId, speciesId: p.speciesId, tiles: p.tiles, ref: p });
  }
  for (const h of model.hints) {
    out.push({ kind: "hint", zone: model.id, entityId: h.entityId, tiles: h.tiles, ref: h });
  }
  for (const t of model.talkables) {
    out.push({ kind: "talk", zone: model.id, entityId: t.entityId, tiles: t.talkTiles, ref: t });
  }
  for (const c of model.cutscenes) {
    out.push({ kind: "cutscene", zone: model.id, key: c.key, tiles: [c.triggerTile], ref: c });
  }
  for (const m of model.monsters) {
    out.push({ kind: "monster", zone: model.id, entityId: m.entityId, speciesId: m.speciesId, tiles: [m.tile], generated: m.generated, ref: m });
  }
  for (const t of model.teleporters) {
    out.push({ kind: "exit", zone: model.id, entityId: t.entityId, tiles: t.tiles, dest: t.dest, lock: t.lock, ref: t });
  }
  return out;
}

// Objectives still worth pursuing under the current storage state.
// Monsters are excluded: combat is a runtime behavior, not a plannable
// objective (generated ones respawn every entry anyway). Exits are
// excluded too — travel is the route planner's own concern.
export function liveObjectives(model) {
  const out = [];
  for (const p of model.pickups) {
    if (!shouldBeVisible(p.entity)) continue;
    out.push({ kind: "pickup", zone: model.id, entityId: p.entityId, speciesId: p.speciesId, tiles: p.tiles, ref: p });
  }
  for (const h of model.hints) {
    if (!shouldBeVisible(h.entity)) continue;
    if (!h.consumable && hintAlreadyRead(h.entity)) continue;
    out.push({ kind: "hint", zone: model.id, entityId: h.entityId, tiles: h.tiles, ref: h });
  }
  for (const t of model.talkables) {
    if (!shouldBeVisible(t.entity)) continue;
    if (isShopClerk(t.entity)) continue; // never talk to clerks — see isShopClerk
    const d = resolveEntityDialogue(t.entity);
    if (!d) continue;
    if (getValue(`dialogue.answer.${d.text}`) === 1) continue; // exhausted
    out.push({ kind: "talk", zone: model.id, entityId: t.entityId, tiles: t.talkTiles, ref: t });
  }
  for (const c of model.cutscenes) {
    if (getValue(c.key) === 1) continue;
    out.push({ kind: "cutscene", zone: model.id, key: c.key, tiles: [c.triggerTile], ref: c });
  }
  return out;
}

// A shop clerk: talking to one opens the buy modal (interact.js), which the
// autoplay bot can't use and would loop on forever (the "always" greeting
// re-opens the shop on every interact). So the bot never treats a clerk as a
// talk objective, and never travels into a shop zone (planTravel). Clerks are
// species 3008 (SPECIES_NPC_SHOP_CLERK in prefabs.js); hand-authored shops
// also carry a shop_stock array. Either marks a clerk.
export const SHOP_CLERK_SPECIES = 3008;

export function isShopClerk(entity) {
  return entity?.species_id === SHOP_CLERK_SPECIES
    || (Array.isArray(entity?.shop_stock) && entity.shop_stock.length > 0);
}

// True when a zone is a shop interior (holds a clerk) — the bot avoids
// traveling in (nothing there it can use; just the buy modal it can't).
export function isShopZone(model) {
  return (model?.raw?.entities ?? []).some(isShopClerk);
}

// Persistent hints suppress repeats under `hint.read.<localized text>`
// (pickups.js::triggerHint) — mirror the exact key derivation.
function hintAlreadyRead(entity) {
  const d = resolveEntityDialogue(entity);
  const text = dialogueLines(d).join("\n");
  if (!text) return false;
  return !!getValue(`hint.read.${text}`);
}
