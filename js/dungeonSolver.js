// Dungeon solvability oracle.
//
// Given a raw zone (the same shape buildZone consumes), decide whether a
// player can walk from the entrance teleporter to the exit teleporter,
// pushing boxes onto pressure plates to open gates along the way. This is a
// faithful, tile-discrete replay of the engine's puzzle rules — it exists so
// the generator (dungeonGen.js) can *prove* every dungeon it emits is
// solvable, and so the tests have an independent oracle.
//
// Search shape: a Sokoban-style *push* search. Between pushes the player's
// exact position is irrelevant, only which tiles it can reach, so a state is
// (box positions + the player's reachable region). That collapses the
// player-wiggle blow-up a naive per-step BFS suffers from. Tiles are encoded
// as integers (y*cols + x) so states key off cheap numeric joins.
//
// Fidelity notes (kept deliberately close to the live code):
//   - Walkability mirrors zone.isBlocked: a tile is solid if its construction
//     is an obstacle, or its biome is an obstacle and the construction isn't a
//     bridge (biomes.js / constructions.js, reused below).
//   - A plate is "down" when a box sits on it; a Gate is passable when its
//     colour's plate is down, an InverseGate when it's up (puzzles.js). Plate
//     state is per-colour, like the global pressure_plate_down_<colour> flags.
//     (Player-held plates are ignored: you can never traverse a gate that only
//     opens while you stand off it, so they don't enable any new traversal.)
//   - Pushing shoves a box one tile if the target is walkable and free of
//     another box or a closed gate (pushables.js / player.js).

import { biomeFromChar, biomeIsObstacle } from "./biomes.js";
import {
  constructionFromChar,
  constructionIsObstacle,
  constructionIsBridge,
} from "./constructions.js";

const TELEPORTER_SPECIES_ID = 1019;
const STATE_CAP = 500000; // defensive bound; real dungeons need a few hundred.

function speciesKind(id) {
  if (id >= 1040 && id <= 1045) return "Gate";
  if (id >= 1060 && id <= 1065) return "InverseGate";
  if (id >= 1050 && id <= 1055) return "PressurePlate";
  if (id >= 1030 && id <= 1032) return "Box";
  if (id === TELEPORTER_SPECIES_ID) return "Teleporter";
  return null;
}

function colourOf(e) {
  return String(e.lock_type ?? "None").toLowerCase();
}

// Parse the raw zone into integer-indexed lookup tables. Tile id = y*cols + x.
function parse(zone) {
  const biomeRows = zone.biome_tiles?.tiles ?? [];
  const constrRows = zone.construction_tiles?.tiles ?? [];
  const rows = biomeRows.length;
  const cols = rows ? biomeRows[0].length : 0;
  const n = rows * cols;

  const walkable = new Uint8Array(n);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const b = biomeFromChar(biomeRows[y][x]);
      const c = constructionFromChar(constrRows[y][x]);
      const blocked = constructionIsObstacle(c) || (biomeIsObstacle(b) && !constructionIsBridge(c));
      walkable[y * cols + x] = blocked ? 0 : 1;
    }
  }

  // Per-tile plate colour index and gate descriptor (colour index + inverse).
  // Colour ids are interned to small ints so plate-down can be a bitmask.
  const colourId = new Map();
  const internColour = (c) => {
    if (!colourId.has(c)) colourId.set(c, colourId.size);
    return colourId.get(c);
  };

  const plateColourAt = new Int16Array(n).fill(-1);
  const gateAt = new Map(); // tile -> { colourBit, inverse }
  const boxes = [];
  const teleporters = [];
  for (const e of zone.entities ?? []) {
    const f = e.frame;
    if (!f) continue;
    const t = f.y * cols + f.x;
    const kind = speciesKind(e.species_id);
    if (kind === "PressurePlate") plateColourAt[t] = internColour(colourOf(e));
    else if (kind === "Gate") gateAt.set(t, { bit: 1 << internColour(colourOf(e)), inverse: false });
    else if (kind === "InverseGate") gateAt.set(t, { bit: 1 << internColour(colourOf(e)), inverse: true });
    else if (kind === "Box") boxes.push(t);
    else if (kind === "Teleporter") teleporters.push(t);
  }

  return { cols, rows, n, walkable, plateColourAt, gateAt, boxes, teleporters };
}

export function isDungeonSolvable(zone) {
  const { cols, n, walkable, plateColourAt, gateAt, boxes, teleporters } = parse(zone);
  if (teleporters.length < 2) return false;
  const start = teleporters[0];
  const goal = teleporters[teleporters.length - 1];

  // Bitmask of colours held down, derived from the boxes-on-plates set.
  const downMask = (boxSet) => {
    let mask = 0;
    for (const t of boxSet) {
      const cId = plateColourAt[t];
      if (cId >= 0) mask |= 1 << cId;
    }
    return mask;
  };
  const gateClosed = (tile, mask) => {
    const g = gateAt.get(tile);
    if (!g) return false;
    const open = g.inverse ? (mask & g.bit) === 0 : (mask & g.bit) !== 0;
    return !open;
  };

  // Flood-fill reachable tiles; returns the visited buffer (boxes/closed gates
  // block) and the smallest reachable tile id as the canonical key.
  const visit = new Int32Array(n).fill(-1);
  let visitStamp = 0;
  const stack = new Int32Array(n);
  const flood = (startTile, boxSet, mask) => {
    const stamp = ++visitStamp;
    let sp = 0;
    stack[sp++] = startTile;
    visit[startTile] = stamp;
    let canonical = startTile;
    while (sp > 0) {
      const tile = stack[--sp];
      const x = tile % cols;
      const neigh = [tile - cols, tile + cols, x > 0 ? tile - 1 : -1, x < cols - 1 ? tile + 1 : -1];
      for (const nt of neigh) {
        if (nt < 0 || nt >= n) continue;
        if (visit[nt] === stamp) continue;
        if (!walkable[nt]) continue;
        if (boxSet.has(nt)) continue;
        if (gateClosed(nt, mask)) continue;
        visit[nt] = stamp;
        if (nt < canonical) canonical = nt;
        stack[sp++] = nt;
      }
    }
    return { stamp, canonical };
  };

  const sortedBoxKey = (arr) => arr.slice().sort((a, b) => a - b).join(",");

  // Floods on dequeue (one per popped state, used immediately while the single
  // visit buffer still holds it); the closed set keys on the canonical
  // reachable tile so equivalent player regions aren't re-expanded.
  const queue = [{ boxes, player: start }];
  const closed = new Set();
  let expanded = 0;

  while (queue.length) {
    if (++expanded > STATE_CAP) return false;
    const { boxes: bx, player } = queue.shift();
    const boxSet = new Set(bx);
    const mask = downMask(boxSet);
    const { stamp, canonical } = flood(player, boxSet, mask);
    const stateKey = sortedBoxKey(bx) + "@" + canonical;
    if (closed.has(stateKey)) continue;
    closed.add(stateKey);
    if (visit[goal] === stamp) return true;

    for (let bi = 0; bi < bx.length; bi++) {
      const boxTile = bx[bi];
      const bxX = boxTile % cols;
      // Four push directions: the tile the player stands on, and where the
      // box lands. Vertical neighbours are bounds-checked by the n-range guard
      // below; horizontal ones guard column edges here to avoid row wrap.
      const dirs = [
        { stand: boxTile + cols, dest: boxTile - cols },
        { stand: boxTile - cols, dest: boxTile + cols },
        { stand: bxX < cols - 1 ? boxTile + 1 : -1, dest: bxX > 0 ? boxTile - 1 : -1 },
        { stand: bxX > 0 ? boxTile - 1 : -1, dest: bxX < cols - 1 ? boxTile + 1 : -1 },
      ];
      for (const d of dirs) {
        const stand = d.stand;
        const dest = d.dest;
        if (stand < 0 || dest < 0 || stand >= n || dest >= n) continue;
        if (visit[stand] !== stamp) continue; // player can't reach the push side
        if (!walkable[dest]) continue;
        if (boxSet.has(dest)) continue;
        if (gateClosed(dest, mask)) continue;

        const nextBoxes = bx.slice();
        nextBoxes[bi] = dest;
        // After the push the player stands where the box was.
        queue.push({ boxes: nextBoxes, player: boxTile });
      }
    }
  }
  return false;
}
