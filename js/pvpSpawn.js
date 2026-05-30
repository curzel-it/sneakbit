// Corner spawns for PvP. Port of world_setup.rs's
// spawn_players_at_map_corners: players 0..N start in the TopLeft /
// TopRight / BottomLeft / BottomRight quarters (2 players → diagonal,
// 4 → all corners), each scanning inward from its corner toward the map
// centre for the first walkable, unoccupied tile (Rust
// spawn_position_from_point). Unlike coopSpawn.js (which clusters a
// partner around P1) this spreads players as far apart as the map allows.
//
// Pure tile math: returns a { x, y } feet-tile. pvpMatch/main own the
// actual player placement (position + lastTile bookkeeping).

import { isWalkable, isEntityBlocked } from "./zone.js?v=20260530f";

// Corner i: where its inward scan starts and which way it walks.
function cornerScan(zone, cornerIndex) {
  const lastX = zone.cols - 1;
  const lastY = zone.rows - 1;
  switch (cornerIndex & 3) {
    case 0: return { sx: 0,     sy: 0,     dx: 1,  dy: 1 };  // TopLeft
    case 1: return { sx: lastX, sy: 0,     dx: -1, dy: 1 };  // TopRight
    case 2: return { sx: 0,     sy: lastY, dx: 1,  dy: -1 }; // BottomLeft
    default: return { sx: lastX, sy: lastY, dx: -1, dy: -1 }; // BottomRight
  }
}

function isSpawnableTile(zone, x, y) {
  if (x < 0 || y < 0 || x >= zone.cols || y >= zone.rows) return false;
  if (!isWalkable(zone, x, y)) return false;
  if (isEntityBlocked(zone, x, y)) return false;
  return true;
}

// Spawnable tile nearest the corner `cornerIndex`, searching its quarter of
// the map. Rust scans column-major and takes the *first* hit, but on a maze
// arena (world 1301) that latches onto stray 1-2 tile openings part-way down
// an outer column — players end up mid-edge instead of in the corner pocket.
// Picking the closest spawnable tile to the corner (Chebyshev distance, then
// Manhattan, then column-major order as the final tie-break) realises the same
// "spread players as far apart as the map allows" intent robustly. Falls back
// to the map centre if the whole quarter is blocked.
export function cornerSpawnTile(zone, cornerIndex) {
  if (!zone || !zone.cols || !zone.rows) return { x: 0, y: 0 };
  const { sx, sy, dx, dy } = cornerScan(zone, cornerIndex);
  const xSteps = Math.ceil(zone.cols / 2);
  const ySteps = Math.ceil(zone.rows / 2);
  let best = null;
  let bestCheb = Infinity;
  let bestMan = Infinity;
  for (let xi = 0; xi < xSteps; xi++) {
    const x = sx + xi * dx;
    for (let yi = 0; yi < ySteps; yi++) {
      const y = sy + yi * dy;
      if (!isSpawnableTile(zone, x, y)) continue;
      const cheb = Math.max(Math.abs(x - sx), Math.abs(y - sy));
      const man = Math.abs(x - sx) + Math.abs(y - sy);
      if (cheb < bestCheb || (cheb === bestCheb && man < bestMan)) {
        bestCheb = cheb;
        bestMan = man;
        best = { x, y };
      }
    }
  }
  return best || { x: Math.floor(zone.cols / 2), y: Math.floor(zone.rows / 2) };
}

// Drop a player onto a tile and resync the per-player teleport bookkeeping
// (lastTile / lastTile2 / players[].lastTile) so maybeTeleport doesn't fire on
// the jump. Shared by the local (pvpController) and online (onlineDeathmatch)
// arenas — keyed by object identity so it works for any player slot.
export function placePvpPlayer(state, player, tile) {
  if (!state || !player || !tile) return;
  player.tileX = tile.x; player.tileY = tile.y; player.x = tile.x; player.y = tile.y;
  player.step = null; player.queuedDir = null; player.pendingDir = null;
  player.pendingTimer = 0; player._sliding = false;
  player.direction = "down";
  if (player === state.player) state.lastTile = { x: tile.x, y: tile.y };
  else if (player === state.player2) state.lastTile2 = { x: tile.x, y: tile.y };
  else {
    const s = state.players?.find((e) => e.player === player);
    if (s) s.lastTile = { x: tile.x, y: tile.y };
  }
}
