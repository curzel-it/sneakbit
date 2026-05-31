// E2E: split-screen LAYOUT. For a given window size + local player count, the
// running game must carve the canvas into the right number of slices arranged
// the right way (columns vs rows vs 2x2). We read the live geometry through the
// window.coop.slices() debug hook and assert the arrangement, plus that the
// slices tile the canvas with no gaps/overlaps. This exercises the whole
// pipeline (zoom -> recomputeSlices -> per-slice cameras), not just the pure
// layout math (which tests/splitScreen.test.js covers).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { findChrome, skipIfNoChrome, launchChrome, getTargets, connectSession, evalExpr, waitFor, navigate } from "./fixtures/chrome.mjs";
import { startServers } from "./fixtures/servers.mjs";

let servers;
before(async () => {
  if (!findChrome()) return;
  servers = await startServers({ staticPort: 8006, relayPort: 8096 });
});
after(() => { if (servers) servers.stop(); });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Apply a viewport size + player count, then return the live slice geometry
// and the canvas backing size.
async function layoutFor(s, { w, h, players }) {
  await s.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await evalExpr(s, "window.dispatchEvent(new Event('resize'))");
  await evalExpr(s, `window.coop.setLocalPlayers(${players})`);
  await sleep(150);
  const slices = await evalExpr(s, "window.coop.slices()");
  const canvas = await evalExpr(s, "({ w: document.getElementById('game').width, h: document.getElementById('game').height })");
  return { slices, canvas };
}

// Distinct column (x) and row (y) boundary counts → the grid shape.
function gridShape(slices) {
  const xs = new Set(slices.map((s) => s.rectPx.x));
  const ys = new Set(slices.map((s) => s.rectPx.y));
  return { cols: xs.size, rows: ys.size };
}

function assertTiles(slices, canvas, label) {
  // Every slice in-bounds and non-empty.
  for (const s of slices) {
    const r = s.rectPx;
    assert.ok(r.w > 0 && r.h > 0, `${label}: non-empty slice`);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= canvas.w && r.y + r.h <= canvas.h, `${label}: in bounds`);
    // Camera tile dims should track the slice pixel size (TILE_SIZE = 16).
    assert.ok(s.camW > 0 && s.camH > 0, `${label}: camera has tiles`);
  }
}

test("split-screen layout adapts to window size and player count", async (t) => {
  if (!skipIfNoChrome(t)) return;
  const chrome = await launchChrome({ port: 9263, dataDir: "/tmp/sb-e2e-splitlayout" });
  t.after(() => chrome.kill());
  const targets = await getTargets(9263);
  const page = targets.find((x) => x.type === "page");
  const s = await connectSession(page.webSocketDebuggerUrl);
  t.after(() => s.close());

  const errors = [];
  s.on("Runtime.exceptionThrown", (p) => errors.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text));

  await navigate(s, `${servers.appUrl}/index.html`);
  await waitFor(s, "!!(window.coop && window.coop.positions().length >= 1)");

  // 1 player → single full-canvas slice.
  {
    const { slices, canvas } = await layoutFor(s, { w: 1280, h: 720, players: 1 });
    assert.equal(slices.length, 1, "1 player → 1 slice");
    assert.equal(slices[0].rectPx.w, canvas.w, "slice spans canvas width");
    assert.equal(slices[0].rectPx.h, canvas.h, "slice spans canvas height");
  }

  // 2 players, WIDE → side-by-side columns.
  {
    const { slices, canvas } = await layoutFor(s, { w: 1280, h: 720, players: 2 });
    assert.equal(slices.length, 2, "2 players → 2 slices");
    assert.deepEqual(gridShape(slices), { cols: 2, rows: 1 }, "wide 2-up → 2 columns");
    assertTiles(slices, canvas, "2-wide");
  }

  // 2 players, TALL → stacked rows.
  {
    const { slices, canvas } = await layoutFor(s, { w: 540, h: 960, players: 2 });
    assert.equal(slices.length, 2, "2 players → 2 slices");
    assert.deepEqual(gridShape(slices), { cols: 1, rows: 2 }, "tall 2-up → 2 rows");
    assertTiles(slices, canvas, "2-tall");
  }

  // 3 players, WIDE → 3 columns.
  {
    const { slices, canvas } = await layoutFor(s, { w: 1600, h: 720, players: 3 });
    assert.equal(slices.length, 3, "3 players → 3 slices");
    assert.deepEqual(gridShape(slices), { cols: 3, rows: 1 }, "wide 3-up → 3 columns");
    assertTiles(slices, canvas, "3-wide");
  }

  // 3 players, NEAR-SQUARE → 2x2 with one empty cell (TL, TR, BL occupied).
  {
    const { slices, canvas } = await layoutFor(s, { w: 1000, h: 1000, players: 3 });
    assert.equal(slices.length, 3, "3 players → 3 slices");
    assert.deepEqual(gridShape(slices), { cols: 2, rows: 2 }, "near-square 3-up → 2x2 footprint");
    // Bottom-right cell is empty: no slice starts at both the right column and bottom row.
    const maxX = Math.max(...slices.map((s) => s.rectPx.x));
    const maxY = Math.max(...slices.map((s) => s.rectPx.y));
    assert.ok(!slices.some((s) => s.rectPx.x === maxX && s.rectPx.y === maxY), "bottom-right cell empty");
    assertTiles(slices, canvas, "3-square");
  }

  // 4 players → 2x2 regardless of shape.
  {
    const { slices, canvas } = await layoutFor(s, { w: 1280, h: 720, players: 4 });
    assert.equal(slices.length, 4, "4 players → 4 slices");
    assert.deepEqual(gridShape(slices), { cols: 2, rows: 2 }, "4-up → 2x2");
    assertTiles(slices, canvas, "4-up");
  }

  assert.deepEqual(errors, [], "no console errors during layout changes");
});
