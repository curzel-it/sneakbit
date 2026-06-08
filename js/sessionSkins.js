// Per-playerId skin cache for online co-op — the sibling of sessionLoadouts.js
// but for cosmetics. "What skin is this player wearing right now" across host +
// guest views. The host writes its own entry and every guest's entry from
// incoming guest.loadout ops, then fans each change out as event:loadout
// (the same frame that already carries melee/ranged). The guest mirrors what it
// receives here so its renderer sees the right column on every avatar.
//
// resolveSkinColumn (skins.js) consults skinFor(playerId) first, then falls
// back to the local selection by index — so single-player and local-coop
// callers (no playerId on the player object) fall through transparently.

const skins = new Map(); // playerId -> skinId (string)

export function setSessionSkin(playerId, skinId) {
  if (!playerId) return;
  if (skinId == null) skins.delete(playerId);
  else skins.set(playerId, skinId);
}

export function skinFor(playerId) {
  if (!playerId) return null;
  return skins.get(playerId) ?? null;
}

export function deleteSessionSkin(playerId) {
  if (playerId) skins.delete(playerId);
}

export function clearSessionSkins() {
  skins.clear();
}

export function listSessionSkins() {
  return Array.from(skins.entries()).map(([playerId, skinId]) => ({ playerId, skinId }));
}

export function _resetSessionSkinsForTesting() { skins.clear(); }
