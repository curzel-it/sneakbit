// Tower Defense hero possession: which hero in the squad the human is
// driving (the "active" slot), and cycle-to-next switching. The active hero
// takes real input; every other living hero runs on allyAI. v1 is
// cycle-to-next only (no roster-click, no per-hero hotkeys).
//
// Heroes ARE players: the squad reuses the co-op slot infra verbatim, so a
// hero's 0-based index lines up with its player slot (P1 = index 0, …). This
// module owns nothing but the active-index integer + the helpers main's TD
// loop branch uses to route input and follow the camera.

import { updateCamera } from "./camera.js";

let activeIndex = 0;

export function resetHeroSwitch(index = 0) {
  activeIndex = index | 0;
}

export function getActiveHeroIndex() {
  return activeIndex;
}

export function isActiveHero(index) {
  return (index | 0) === activeIndex;
}

// Every hero player object in slot order (index 0..3), including dead ones —
// callers filter as needed. Heroes live exactly where co-op players do.
export function squadPlayers(state) {
  const out = [];
  if (state?.player) out.push(state.player);
  if (state?.player2) out.push(state.player2);
  if (Array.isArray(state?.players)) {
    const extras = state.players
      .filter((e) => e.playerId == null && e.player)
      .sort((a, b) => a.slot - b.slot);
    for (const e of extras) out.push(e.player);
  }
  return out;
}

export function activeHero(state) {
  return squadPlayers(state).find((p) => (p.index | 0) === activeIndex) || null;
}

// Advance possession to the next LIVING hero, wrapping around. `isDead` is
// injected (playerHealth.isPlayerDead) so this module stays free of the
// health dependency and is trivially testable. Returns the new active index.
export function cycleActiveHero(state, isDead) {
  const players = squadPlayers(state);
  if (!players.length) return activeIndex;
  const indices = players.map((p) => p.index | 0).sort((a, b) => a - b);
  const start = indices.indexOf(activeIndex);
  for (let i = 1; i <= indices.length; i++) {
    const cand = indices[(start + i) % indices.length];
    if (!isDead || !isDead(cand)) { activeIndex = cand; break; }
  }
  return activeIndex;
}

// If the active hero has died, hand possession to any living hero so the
// player is never stuck driving a corpse. Returns true if it switched.
export function ensureLiveActive(state, isDead) {
  if (!isDead || !isDead(activeIndex)) return false;
  const before = activeIndex;
  cycleActiveHero(state, isDead);
  return activeIndex !== before;
}

// Point the camera at the active hero (single shared camera — TD is solo).
export function followActiveHero(state) {
  const hero = activeHero(state) || state?.player;
  if (hero) updateCamera(state.camera, hero, state.zone);
}
