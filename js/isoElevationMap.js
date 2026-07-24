// Reads the baked `elevation_tiles` height map — the authoritative terrain
// elevation for the iso renderer. Digits '0'..'9' are floor levels; 'A' marks a
// walkable passage (ramp) between floors, resolved here to the lower of its
// neighbouring floor levels (real ramp geometry is a later pass). Returns null
// when a zone carries no height map, so the renderer can fall back.
//
// Ignored entirely outside iso mode: only the iso renderer imports this.

const cache = new WeakMap();
const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];

export function elevationMapFor(zone) {
  const tiles = zone.elevationTiles;
  if (!tiles) return null;
  let grid = cache.get(zone);
  if (!grid) { grid = parse(zone, tiles); cache.set(zone, grid); }
  return grid;
}

function levelOf(ch) {
  return ch >= "0" && ch <= "9" ? ch.charCodeAt(0) - 48 : null;
}

function parse(zone, tiles) {
  const { rows, cols } = zone;
  const lvl = Array.from({ length: rows }, () => new Array(cols).fill(0));
  const passage = Array.from({ length: rows }, () => new Array(cols).fill(false));
  for (let r = 0; r < rows; r++) {
    const line = tiles[r] ?? "";
    for (let c = 0; c < cols; c++) {
      const n = levelOf(line[c]);
      if (n === null) passage[r][c] = true; // 'A' (or any non-digit) is a passage
      else lvl[r][c] = n;
    }
  }
  // Passages sit at the lower of their adjacent floor levels for now.
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!passage[r][c]) continue;
      let m = Infinity;
      for (const [dr, dc] of DIRS) {
        const nr = r + dr, nc = c + dc;
        if (nr < 0 || nr >= rows || nc < 0 || nc >= cols || passage[nr][nc]) continue;
        if (lvl[nr][nc] < m) m = lvl[nr][nc];
      }
      lvl[r][c] = m === Infinity ? 0 : m;
    }
  }
  return lvl;
}
