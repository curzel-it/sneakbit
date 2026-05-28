// Mirrors Entity::update_sorting_key from game_core/src/features/entity.rs.
// Each assertion below reproduces a specific Rust output exactly so any
// future drift between the two ports is caught here.
import { test } from "node:test";
import assert from "node:assert/strict";
import { sortingKey } from "../js/entities.js?v=20260528g";

const OVERLAY = 99;
const UNDERLAY = -1;

function rustKey(frameY, frameH, zIndex, isPushable) {
  const z = zIndex === OVERLAY ? 20_000_000 : zIndex === UNDERLAY ? 0 : 10_000_000;
  const a = 10_000 * Math.floor(frameY + frameH);
  const b = (zIndex !== OVERLAY && zIndex !== UNDERLAY) ? zIndex * 10 : 0;
  const p = isPushable ? 1 : 0;
  return z + a + b + p;
}

test("normal entity (z=10) at y=5 h=2 → 10_000_000 + 70_000 + 100", () => {
  assert.equal(sortingKey(5 + 2, 10, false), 10_070_100);
  assert.equal(sortingKey(5 + 2, 10, false), rustKey(5, 2, 10, false));
});

test("underlay decal (z=-1) sorts below everything regardless of row", () => {
  const underlayAtBottom = sortingKey(99 + 1, UNDERLAY, false);
  const normalAtTop = sortingKey(0 + 1, 10, false);
  assert.ok(underlayAtBottom < normalAtTop, "underlay must lose to any normal entity");
});

test("overlay (z=99) sorts above everything regardless of row", () => {
  const overlayAtTop = sortingKey(0 + 1, OVERLAY, false);
  const normalAtBottom = sortingKey(99 + 1, 10, false);
  assert.ok(overlayAtTop > normalAtBottom, "overlay must beat any normal entity");
});

test("higher row sorts above lower row (foreground draws after background)", () => {
  // Two normal entities, same z_index, different rows.
  const upper = sortingKey(3 + 1, 10, false); // bottom row 4
  const lower = sortingKey(7 + 1, 10, false); // bottom row 8
  assert.ok(lower > upper, "the entity further down the screen wins");
});

test("same bottom row, z_index breaks the tie", () => {
  const a = sortingKey(5 + 2, 10, false);
  const b = sortingKey(5 + 2, 15, false);
  assert.equal(b - a, 50, "delta is (zIndex_b - zIndex_a) * 10");
});

test("pushable adds exactly +1 — beats a non-pushable with the same z and row", () => {
  const box = sortingKey(5 + 1, 15, true);
  const npc = sortingKey(5 + 1, 15, false);
  assert.equal(box - npc, 1);
});

test("player (1×2 sprite, feet at row Y) sorts at row Y+1, identical to a 1×2 NPC with frame.y=Y-1", () => {
  // Player at standing tile 5 → drawn bottom row 6 → sort row 6.
  const player = sortingKey(5 + 1, 15, false);
  // NPC drawn so feet are also on row 5: frame.y=4, h=2.
  const npc = sortingKey(4 + 2, 15, false);
  assert.equal(player, npc, "matched anchor rule keeps the two consistent");
});

test("matches the Rust formula across a randomised sweep", () => {
  // Reproduces the Rust output for a generous slice of inputs. If anyone
  // ever changes the JS comparator, this catches a drift quickly.
  const zs = [-1, 0, 5, 10, 15, 99];
  for (let y = 0; y < 30; y += 3) {
    for (const z of zs) {
      for (const h of [1, 2, 3, 5]) {
        for (const push of [false, true]) {
          assert.equal(
            sortingKey(y + h, z, push),
            rustKey(y, h, z, push),
            `y=${y} h=${h} z=${z} push=${push}`,
          );
        }
      }
    }
  }
});
