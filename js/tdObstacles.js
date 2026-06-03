// Tower Defense build obstacles: the low-level "is this tile blocked by a
// placed prop?" query, shared by the flow field (tdBoard) and the horde's
// stepping (tdEnemies), plus the set of species the build shop can drop.
//
// Kept separate from tdBuild — which owns the player-facing catalog, costs and
// placement UI — so this collision query depends on neither the shop nor the
// board. Both of those import THIS module, never the reverse, so there's no
// import cycle.

// Barrel props: rigid StaticObjects the squad can shoot apart (see
// explosives.js for the matching death-sound set). The ids are duplicated here
// rather than imported so this module stays the single source of truth for
// "what the build shop drops on the board" — extend the set to add more
// placeable obstacle props later.
export const BARREL_SPECIES = Object.freeze({
  purple: 1038,
  green: 1039,
  brown: 1073,
  wood: 1074,
});

const OBSTACLE_SPECIES = new Set(Object.values(BARREL_SPECIES));

export function isBuildObstacleSpecies(id) {
  return OBSTACLE_SPECIES.has(id);
}

// The single tile a placed prop blocks: its feet (bottom) row. Barrels render
// two tiles tall (frame.h === 2) but, like the original, stand on only the one
// tile they occupy — so corridors stay exactly one tile thick and predictable.
export function obstacleFeetTile(frame) {
  return { x: frame.x | 0, y: (frame.y + frame.h - 1) | 0 };
}

// True if a live build prop blocks the tile (x, y). A barrel the squad has
// shot is flagged `_dying` and stops blocking at once — that's what lets a
// corridor collapse mid-wave when stray fire breaks a wall.
export function tdObstacleAt(zone, x, y) {
  const ents = zone?.entities;
  if (!ents) return false;
  for (const e of ents) {
    if (e._dying) continue;
    if (!isBuildObstacleSpecies(e.species_id)) continue;
    const f = e.frame;
    if (!f) continue;
    const feet = obstacleFeetTile(f);
    if (feet.x === x && feet.y === y) return true;
  }
  return false;
}
