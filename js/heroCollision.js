// Free-movement collision for heroes against the tile grid. A hero at (x, y)
// stands on the tile cell [x, x+1) × [y, y+1); its hitbox is a small square
// centred in that cell. Tiles block when the biome/construction grid does, or
// a rigid entity covers them; an enterable teleporter always lets the hero in.
// A move may not overlap a blocked tile the hitbox wasn't already touching, so
// a gate closing on a hero or a rock pushed onto one never traps it.

import { isWalkable, isEntityBlocked, hasEnterableTeleporter } from "./zone.js";

export const HERO_HALF_W = 0.3;
export const HERO_HALF_H = 0.3;
const CORNER_NUDGE = 0.45;
const EDGE_EPS = 1e-4;
const SWEEP_STEP = 0.2;

/** @param {any} zone @param {number} tx @param {number} ty */
export function heroTileBlocked(zone, tx, ty) {
  if (!zone) return false;
  if (zone.entities && hasEnterableTeleporter(zone, tx, ty)) return false;
  if (!isWalkable(zone, tx, ty)) return true;
  return isEntityBlocked(zone, tx, ty);
}

function boxTiles(x, y) {
  const l = Math.floor(x + 0.5 - HERO_HALF_W);
  const r = Math.floor(x + 0.5 + HERO_HALF_W - EDGE_EPS);
  const t = Math.floor(y + 0.5 - HERO_HALF_H);
  const b = Math.floor(y + 0.5 + HERO_HALF_H - EDGE_EPS);
  return { l, r, t, b };
}

/** Blocked tiles under the hitbox at (x, y), as [tx, ty] pairs. */
export function blockedTilesAt(zone, x, y) {
  const out = [];
  const { l, r, t, b } = boxTiles(x, y);
  for (let ty = t; ty <= b; ty++) {
    for (let tx = l; tx <= r; tx++) {
      if (heroTileBlocked(zone, tx, ty)) out.push([tx, ty]);
    }
  }
  return out;
}

/** True if a hero at (fromX, fromY) may stand at (x, y). */
export function canHeroOccupy(zone, fromX, fromY, x, y) {
  const now = blockedTilesAt(zone, x, y);
  if (now.length === 0) return true;
  const was = boxTiles(fromX, fromY);
  return now.every(([tx, ty]) => tx >= was.l && tx <= was.r && ty >= was.t && ty <= was.b);
}

/** True if a hero can travel in a straight line from one point to another. */
export function canHeroSweep(zone, fromX, fromY, toX, toY) {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const n = Math.max(1, Math.ceil(dist / SWEEP_STEP));
  let px = fromX, py = fromY;
  for (let i = 1; i <= n; i++) {
    const nx = fromX + (toX - fromX) * (i / n);
    const ny = fromY + (toY - fromY) * (i / n);
    if (!canHeroOccupy(zone, px, py, nx, ny)) return false;
    px = nx; py = ny;
  }
  return true;
}

/**
 * Moves `body` ({x, y}) by (dx, dy) with axis-separated collision, sliding
 * along walls and nudging around corners the hero only clips. Returns the
 * blocked tile per axis ([tx, ty] or null) so callers can push rocks or
 * announce locked doors.
 */
export function moveHero(zone, body, dx, dy) {
  const blockedX = dx ? moveAxis(zone, body, dx, 0, dy === 0) : null;
  const blockedY = dy ? moveAxis(zone, body, 0, dy, dx === 0) : null;
  return { blockedX, blockedY };
}

function moveAxis(zone, body, dx, dy, mayNudge) {
  const nx = body.x + dx, ny = body.y + dy;
  if (canHeroOccupy(zone, body.x, body.y, nx, ny)) {
    body.x = nx; body.y = ny;
    return null;
  }
  const hit = leadingBlockedTile(zone, body, dx, dy);
  if (dx) {
    const lead = dx > 0 ? Math.floor(body.x + 0.5 + HERO_HALF_W + dx) : Math.floor(body.x + 0.5 - HERO_HALF_W + dx);
    const flush = dx > 0 ? lead - 0.5 - HERO_HALF_W - EDGE_EPS : lead + 1 + HERO_HALF_W - 0.5 + EDGE_EPS;
    if ((flush - body.x) * dx > 0 && canHeroOccupy(zone, body.x, body.y, flush, body.y)) body.x = flush;
  } else {
    const lead = dy > 0 ? Math.floor(body.y + 0.5 + HERO_HALF_H + dy) : Math.floor(body.y + 0.5 - HERO_HALF_H + dy);
    const flush = dy > 0 ? lead - 0.5 - HERO_HALF_H - EDGE_EPS : lead + 1 + HERO_HALF_H - 0.5 + EDGE_EPS;
    if ((flush - body.y) * dy > 0 && canHeroOccupy(zone, body.x, body.y, body.x, flush)) body.y = flush;
  }
  if (mayNudge) nudgeAroundCorner(zone, body, dx, dy);
  return hit;
}

function leadingBlockedTile(zone, body, dx, dy) {
  const tiles = blockedTilesAt(zone, body.x + dx, body.y + dy);
  if (!tiles.length) return null;
  const cx = Math.round(body.x), cy = Math.round(body.y);
  tiles.sort((a, b) => (Math.abs(a[0] - cx) + Math.abs(a[1] - cy)) - (Math.abs(b[0] - cx) + Math.abs(b[1] - cy)));
  return tiles[0];
}

// Blocked head-on but only clipping a corner: slide sideways toward the
// nearest open lane so a slightly misaligned hero still slips into doors and
// corridors.
function nudgeAroundCorner(zone, body, dx, dy) {
  const along = Math.abs(dx || dy);
  const perp = dx ? body.y : body.x;
  const lanes = [Math.floor(perp), Math.ceil(perp)].sort((a, b) => Math.abs(a - perp) - Math.abs(b - perp));
  for (const lane of lanes) {
    const off = lane - perp;
    if (Math.abs(off) < EDGE_EPS || Math.abs(off) > CORNER_NUDGE) continue;
    const probeX = dx ? body.x + dx : lane;
    const probeY = dx ? lane : body.y + dy;
    const laneX = dx ? body.x : lane;
    const laneY = dx ? lane : body.y;
    if (!canHeroOccupy(zone, laneX, laneY, probeX, probeY)) continue;
    const step = Math.sign(off) * Math.min(Math.abs(off), along);
    const tx = dx ? body.x : body.x + step;
    const ty = dx ? body.y + step : body.y;
    if (canHeroOccupy(zone, body.x, body.y, tx, ty)) { body.x = tx; body.y = ty; }
    return;
  }
}
