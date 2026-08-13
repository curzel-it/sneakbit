// Chunk geometry for the tile-layer cache. The bake itself needs a canvas, so
// what's testable in node — and what actually breaks — is the index math that
// decides which chunks cover the camera. Miss a chunk and the player sees a
// strip of unpainted map along an edge.

import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkRangeFor, CHUNK_TILES, getZoneChunk, evictZoneCache } from "../js/zoneCache.js";

const zone = (cols, rows) => ({ cols, rows });

// Every map tile the camera can see must fall inside one of the returned
// chunks. This is the property that matters; the exact indices are incidental.
function assertCovers(z, camera) {
  const { cx0, cy0, cx1, cy1 } = chunkRangeFor(z, camera);
  const firstX = Math.max(0, Math.floor(camera.x));
  const firstY = Math.max(0, Math.floor(camera.y));
  const lastX = Math.min(z.cols - 1, Math.ceil(camera.x + camera.w) - 1);
  const lastY = Math.min(z.rows - 1, Math.ceil(camera.y + camera.h) - 1);
  for (let ty = firstY; ty <= lastY; ty++) {
    for (let tx = firstX; tx <= lastX; tx++) {
      const cx = Math.floor(tx / CHUNK_TILES);
      const cy = Math.floor(ty / CHUNK_TILES);
      assert.ok(
        cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1,
        `tile (${tx},${ty}) → chunk (${cx},${cy}) outside range ` +
        `(${cx0}..${cx1}, ${cy0}..${cy1}) for camera ${JSON.stringify(camera)}`,
      );
    }
  }
}

test("chunk range covers every visible tile at whole-tile camera positions", () => {
  const z = zone(100, 80);
  for (let x = 0; x < 90; x += 7) {
    for (let y = 0; y < 70; y += 5) {
      assertCovers(z, { x, y, w: 13, h: 27 });
    }
  }
});

test("chunk range covers every visible tile mid-step (fractional camera)", () => {
  // The camera slides continuously between tiles, which is when a floor()
  // on the wrong side of the rect drops the trailing chunk.
  const z = zone(100, 80);
  for (const frac of [0.01, 0.25, 0.5, 0.75, 0.99]) {
    for (let x = 0; x < 60; x += 3) {
      assertCovers(z, { x: x + frac, y: 10 + frac, w: 13, h: 27 });
    }
  }
});

test("chunk range stays inside the map at both edges", () => {
  const z = zone(100, 80);
  const atOrigin = chunkRangeFor(z, { x: 0, y: 0, w: 13, h: 27 });
  assert.equal(atOrigin.cx0, 0);
  assert.equal(atOrigin.cy0, 0);

  // Camera pushed past the far edge — clamped, never past the last chunk.
  const past = chunkRangeFor(z, { x: 200, y: 200, w: 13, h: 27 });
  assert.equal(past.cx1, Math.floor((z.cols - 1) / CHUNK_TILES));
  assert.equal(past.cy1, Math.floor((z.rows - 1) / CHUNK_TILES));

  // Negative camera (zone smaller than the viewport) clamps to the origin.
  const negative = chunkRangeFor(z, { x: -5, y: -3, w: 13, h: 27 });
  assert.equal(negative.cx0, 0);
  assert.equal(negative.cy0, 0);
});

test("chunk range covers a zone smaller than the viewport", () => {
  const tiny = zone(6, 4); // smaller than one chunk
  assertCovers(tiny, { x: 0, y: 0, w: 13, h: 27 });
  const r = chunkRangeFor(tiny, { x: 0, y: 0, w: 13, h: 27 });
  assert.equal(r.cx0, 0);
  assert.equal(r.cx1, 0);
  assert.equal(r.cy0, 0);
  assert.equal(r.cy1, 0);
});

test("a viewport spans a bounded number of chunks regardless of map size", () => {
  // The point of chunking: cost scales with the screen, not the map. A phone
  // viewport must span the same handful of chunks on the largest zone as on
  // the smallest.
  // Kept clear of either map's edge, so neither range is clipped short.
  const camera = { x: 10.5, y: 10.5, w: 13, h: 27 };
  const small = chunkRangeFor(zone(60, 60), camera);
  const largest = chunkRangeFor(zone(160, 120), camera);
  const span = (r) => (r.cx1 - r.cx0 + 1) * (r.cy1 - r.cy0 + 1);
  assert.equal(span(small), span(largest));
  assert.ok(span(largest) <= 20, `expected a small chunk span, got ${span(largest)}`);
});

test("out-of-bounds chunks are refused without touching the canvas layer", () => {
  // getZoneChunk bails on bounds before it ever reaches document.createElement,
  // which is what lets this run under node at all.
  const z = zone(100, 80);
  assert.equal(getZoneChunk(z, -1, 0), null);
  assert.equal(getZoneChunk(z, 0, -1), null);
  assert.equal(getZoneChunk(z, Math.ceil(100 / CHUNK_TILES), 0), null);
  assert.equal(getZoneChunk(z, 0, Math.ceil(80 / CHUNK_TILES)), null);
  assert.equal(getZoneChunk(null, 0, 0), null);
});

test("evicting a zone that was never baked is a no-op", () => {
  assert.doesNotThrow(() => evictZoneCache(zone(10, 10)));
  assert.doesNotThrow(() => evictZoneCache(null));
});
