// Tower Defense hero possession: which hero in the squad each *player* drives.
// Generalizes the old single "active hero" into per-player ownership so the
// same squad can be shared by one local human (solo), several local humans
// (split-screen co-op), or a host + online guests.
//
// Model: an ownership map from input slot (1-based: P1=1, …, online guests 3/4)
// to the hero index (0-based) that slot drives. Heroes nobody owns are "free"
// and run on allyAI. A player switches by *releasing* its current hero (it
// reverts to free/AI) and *possessing* a free one; with heroes == players there
// are no free heroes, so switching is a no-op.
//
// Solo (one owner, slot 1) is a strict special case: slot 1 owns one hero, the
// rest are free, and switching cycles slot 1 through every living hero — exactly
// the old behavior. Heroes ARE players: a hero's 0-based index lines up with its
// player slot, and heroes live exactly where co-op players do (state.player,
// state.player2, state.players[]).

import { updateCamera } from "./camera.js";

// slot (1-based) -> hero index (0-based) it owns.
let owners = new Map();

// Seed default ownership for `playerCount` local players: slot s drives hero
// s-1 (P1→0, P2→1, …). Heroes beyond the player count start free (AI).
export function resetHeroSwitch(playerCount = 1) {
  owners = new Map();
  const n = Math.max(1, playerCount | 0);
  for (let s = 1; s <= n; s++) owners.set(s, s - 1);
}

// The hero index a given slot drives, or null if the slot owns nothing.
export function ownedHeroFor(slot) {
  return owners.has(slot) ? owners.get(slot) : null;
}

// The slot that owns a given hero index, or null if the hero is free.
export function ownerSlotOf(heroIndex) {
  const idx = heroIndex | 0;
  for (const [slot, owned] of owners) if (owned === idx) return slot;
  return null;
}

// Assign `slot` to a specific hero index (used when a guest joins/leaves or a
// hero is created on the fly). Pass null to release the slot's hero to free/AI.
export function setOwnership(slot, heroIndex) {
  if (heroIndex == null) owners.delete(slot);
  else owners.set(slot, heroIndex | 0);
}

// Drop a slot's ownership entirely (a player left). Its hero reverts to AI.
export function releaseSlot(slot) {
  owners.delete(slot);
}

export function ownerSlots() {
  return Array.from(owners.keys()).sort((a, b) => a - b);
}

// Every hero player object in slot order (index 0..3), including dead ones —
// callers filter as needed. Heroes live exactly where co-op players do.
export function squadPlayers(state) {
  const out = [];
  if (state?.player) out.push(state.player);
  if (state?.player2) out.push(state.player2);
  if (Array.isArray(state?.players)) {
    const extras = state.players
      .filter((e) => e.player)
      .sort((a, b) => a.slot - b.slot);
    for (const e of extras) out.push(e.player);
  }
  return out;
}

// The hero player object a slot drives, or null.
export function ownedHeroPlayer(state, slot) {
  const idx = ownedHeroFor(slot);
  if (idx == null) return null;
  return squadPlayers(state).find((p) => (p.index | 0) === idx) || null;
}

// Heroes nobody owns — the AI-driven ones, and exactly what a switch can grab.
export function freeHeroes(state) {
  return squadPlayers(state).filter((p) => ownerSlotOf(p.index | 0) == null);
}

// Switch `slot` to the next free LIVING hero, cycling by index after the one it
// currently drives. Releasing the current hero makes it a candidate too, so the
// solo case cycles through every living hero (old cycle-to-next). Heroes owned
// by *other* slots are off-limits. With no free hero this is a no-op. `isDead`
// is injected (playerHealth.isPlayerDead) to keep this module health-free and
// testable. Returns the slot's hero index after the switch.
export function switchHeroForSlot(state, slot, isDead) {
  const cur = ownedHeroFor(slot);
  const otherOwned = new Set();
  for (const [s, owned] of owners) if (s !== slot) otherOwned.add(owned);
  const candidates = squadPlayers(state)
    .map((p) => p.index | 0)
    .filter((i) => !otherOwned.has(i) && (!isDead || !isDead(i)))
    .sort((a, b) => a - b);
  if (!candidates.length) return cur;
  let next;
  if (cur == null) next = candidates[0];
  else {
    const pos = candidates.indexOf(cur);
    next = pos === -1 ? candidates[0] : candidates[(pos + 1) % candidates.length];
  }
  owners.set(slot, next);
  return next;
}

// If a slot's hero has died, hand the slot to a free living hero so the player
// isn't stuck driving a corpse (waits for revive if none are free). Returns
// true if it switched.
export function ensureLiveOwner(state, slot, isDead) {
  const cur = ownedHeroFor(slot);
  if (cur == null) return false;
  if (!isDead || !isDead(cur)) return false;
  switchHeroForSlot(state, slot, isDead);
  return ownedHeroFor(slot) !== cur;
}

// The hero a slot's camera should follow (its owned hero, or P1 as a fallback).
export function cameraTargetFor(state, slot) {
  return ownedHeroPlayer(state, slot) || state?.player || null;
}

// — Solo conveniences (slot 1) ————————————————————————————————————————————
// Back-compat helpers for single-camera paths and the debug hook: "the active
// hero" is just slot 1's owned hero.
export function getActiveHeroIndex() {
  return ownedHeroFor(1) ?? 0;
}

export function activeHero(state) {
  return ownedHeroPlayer(state, 1);
}

// Point the single shared camera at slot 1's hero (solo / online-host view).
export function followActiveHero(state) {
  const hero = cameraTargetFor(state, 1);
  if (hero) updateCamera(state.camera, hero, state.zone);
}
