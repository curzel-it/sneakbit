// Split-screen layout math. Pure functions — no DOM, no canvas.
// Verifies the spec Requirement 4 truth table and that slices tile the
// surface with no gaps or overlaps.

import { test } from "node:test";
import assert from "node:assert/strict";

const { computeLayout, sliceRectsPx, sliceCount } = await import("../js/splitScreen.js");
const coopMode = await import("../js/coopMode.js");
const gameMode = await import("../js/gameMode.js");
const onlineMode = await import("../js/onlineMode.js");

// Aspect helpers: a clearly-wide, clearly-tall, and near-square surface.
const WIDE = [1600, 900];   // 16:9
const TALL = [900, 1600];
const SQUARE = [1000, 1000]; // 1:1, inside the 3:4..4:3 band

function shape(layout) {
  return { cols: layout.cols, rows: layout.rows, n: layout.cells.length };
}

test("1 player → full window", () => {
  assert.deepEqual(shape(computeLayout(1, ...WIDE)), { cols: 1, rows: 1, n: 1 });
  assert.deepEqual(shape(computeLayout(1, ...TALL)), { cols: 1, rows: 1, n: 1 });
});

test("2 players → side-by-side when wide, stacked when tall", () => {
  assert.deepEqual(shape(computeLayout(2, ...WIDE)), { cols: 2, rows: 1, n: 2 });
  assert.deepEqual(shape(computeLayout(2, ...TALL)), { cols: 1, rows: 2, n: 2 });
});

test("3 players → 3 columns wide, 3 rows tall, 2x2-with-blank near-square", () => {
  assert.deepEqual(shape(computeLayout(3, ...WIDE)), { cols: 3, rows: 1, n: 3 });
  assert.deepEqual(shape(computeLayout(3, ...TALL)), { cols: 1, rows: 3, n: 3 });
  // Near-square: 2x2 grid but only 3 cells (bottom-right omitted).
  assert.deepEqual(shape(computeLayout(3, ...SQUARE)), { cols: 2, rows: 2, n: 3 });
  const sq = computeLayout(3, ...SQUARE);
  assert.deepEqual(sq.cells, [{ col: 0, row: 0 }, { col: 1, row: 0 }, { col: 0, row: 1 }]);
});

test("4 players → 2x2 regardless of window shape", () => {
  assert.deepEqual(shape(computeLayout(4, ...WIDE)), { cols: 2, rows: 2, n: 4 });
  assert.deepEqual(shape(computeLayout(4, ...TALL)), { cols: 2, rows: 2, n: 4 });
  assert.deepEqual(shape(computeLayout(4, ...SQUARE)), { cols: 2, rows: 2, n: 4 });
});

test("count is clamped to 1..4", () => {
  assert.equal(computeLayout(0, ...WIDE).cells.length, 1);
  assert.equal(computeLayout(9, ...WIDE).cells.length, 4);
});

test("aspect band edges: just inside vs just outside near-square (3-up)", () => {
  // aspect slightly > 4:3 → wide (3 columns)
  assert.equal(computeLayout(3, 1335, 1000).cols, 3);
  // aspect slightly < 4:3 → near-square (2x2)
  assert.equal(computeLayout(3, 1330, 1000).cols, 2);
  assert.equal(computeLayout(3, 1330, 1000).rows, 2);
  // aspect slightly < 3:4 → tall (3 rows)
  assert.equal(computeLayout(3, 1000, 1335).rows, 3);
});

test("sliceRectsPx tiles the surface with no gaps or overlaps", () => {
  for (const count of [1, 2, 3, 4]) {
    for (const [w, h] of [WIDE, TALL, SQUARE]) {
      const layout = computeLayout(count, w, h);
      const rects = sliceRectsPx(w, h, layout);
      assert.equal(rects.length, layout.cells.length, `count=${count}`);
      // Every rect lies inside the surface and is non-empty.
      for (const r of rects) {
        assert.ok(r.w > 0 && r.h > 0, `non-empty ${count} ${w}x${h}`);
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h, "in bounds");
      }
      // Adjacent slices share boundaries: total covered area equals the
      // surface for full grids (1/2/4), and is 3/4 for the 3-up blank-cell.
      const covered = rects.reduce((s, r) => s + r.w * r.h, 0);
      const expected = count === 3 && layout.cols === 2 ? (w * h * 3) / 4 : w * h;
      // Allow rounding slop from integer boundaries.
      assert.ok(Math.abs(covered - expected) <= w + h, `area ${count} ${w}x${h}`);
    }
  }
});

test("sliceCount: offline co-op fans out; pvp + online stay single", () => {
  onlineMode._resetOnlineModeForTesting(); // runtime role null → offline
  gameMode.setGameMode("coop");
  coopMode.setLocalPlayerCount(3);
  assert.equal(sliceCount(), 3);

  coopMode.setLocalPlayerCount(1);
  assert.equal(sliceCount(), 1);

  // PvP is always a single current-player window.
  coopMode.setLocalPlayerCount(4);
  gameMode.setGameMode("pvp");
  assert.equal(sliceCount(), 1);
  gameMode.setGameMode("coop");

  // Online (host/guest) is always a single follow-self window.
  onlineMode._setOnlineModeForTesting({ mode: "host" });
  assert.equal(sliceCount(), 1);
  onlineMode._resetOnlineModeForTesting();
  coopMode.setLocalPlayerCount(1);
});
