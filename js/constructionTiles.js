// Picks the sprite cell for a construction tile based on its 4 neighbors.
// Port of game_core/src/maps/construction_tiles.rs (setup_textures).
//
// The construction sheet has one column per construction type
// (column = construction id) and 16 rows = the 16 same-or-not patterns
// of (up, right, down, left).

// Returns the y row (0..15) for the given pattern.
export function constructionTextureRow(self, up, right, down, left) {
  const su = up === self;
  const sr = right === self;
  const sd = down === self;
  const sl = left === self;
  const key = (su ? 8 : 0) | (sr ? 4 : 0) | (sd ? 2 : 0) | (sl ? 1 : 0);
  return SAME_PATTERN_TO_ROW[key];
}

// key bits: UP=8, RIGHT=4, DOWN=2, LEFT=1
const SAME_PATTERN_TO_ROW = (() => {
  const t = new Array(16).fill(1);
  // (same_up, same_right, same_down, same_left) → row
  const set = (u, r, d, l, row) => { t[(u ? 8 : 0) | (r ? 4 : 0) | (d ? 2 : 0) | (l ? 1 : 0)] = row; };
  set(false, true,  false, true,  0);
  set(false, false, false, false, 1);
  set(false, false, false, true,  2);
  set(false, true,  false, false, 3);
  set(true,  false, true,  false, 4);
  set(true,  false, false, false, 5);
  set(false, false, true,  false, 6);
  set(true,  true,  false, false, 7);
  set(true,  false, false, true,  8);
  set(false, true,  true,  false, 9);
  set(false, false, true,  true,  10);
  set(true,  true,  true,  false, 11);
  set(true,  false, true,  true,  12);
  set(true,  true,  false, true,  13);
  set(false, true,  true,  true,  14);
  set(true,  true,  true,  true,  15);
  return t;
})();
