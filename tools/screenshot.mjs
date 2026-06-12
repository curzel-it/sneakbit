// Screenshot tool — captures the real HTML build at an arbitrary world +
// player tile + viewport size (in tiles), driven entirely by a JSON spec.
//
// Approach (see docs/screenshot-tool.md): don't pilot the game. Seed the
// saved state in localStorage so the game *boots* directly to the wanted
// zone + tile, size the headless window so auto-zoom (js/zoom.js) renders
// exactly the requested tile count, then let Chrome screenshot the live
// canvas. Zero new game code, zero deps — reuses the e2e CDP harness.
//
//   node tools/screenshot.mjs [path/to/spec.json]   # default: tools/screenshots.json
//
// Self-skips (exit 0) when no Chrome is found; set CHROME_PATH for a
// non-default install.

import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  findChrome, launchChrome, getTargets, connectSession,
  evalExpr, navigate, waitFor,
} from "../tests/e2e/fixtures/chrome.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "..");
const OUT_DIR = join(REPO_ROOT, "docs", "screenshots");

// js/zoom.js resolves `scale` to 2 at deviceScaleFactor=1, so a window of
// (w·32 × h·32) physical px renders exactly w×h tiles. Auto-zoom clamps
// the tile count to these bounds — asking outside the range silently snaps.
const TILE_SIZE = 16;
const SCALE = 2;
const PX_PER_TILE = TILE_SIZE * SCALE; // 32
const MIN_W = 16, MAX_W = 36, MIN_H = 10;

const DIR_TO_INT = { down: 0, up: 1, left: 2, right: 3 };

const STATIC_PORT = Number(process.env.SHOT_STATIC_PORT || 8021);
const CDP_PORT = Number(process.env.SHOT_CDP_PORT || 9333);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));

async function waitForPort(port, timeoutMs = 5000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/play/`, { signal: AbortSignal.timeout(300) });
      if (r.ok) return true;
    } catch { /* not up yet */ }
    await sleep(100);
  }
  throw new Error(`static server never came up on :${port}`);
}

// Document-start script: wipe any prior profile and seed exactly the keys
// boot reads. Runs before the page's ES modules (CDP addScriptToEvaluate-
// OnNewDocument), so js/storage.js hydrates from it. See the key tables in
// docs/screenshot-tool.md.
function seedScript(shot) {
  const dir = DIR_TO_INT[shot.direction ?? "down"] ?? 0;
  const kv = "sneakbit.kv.v1.";
  return `
    try { localStorage.clear(); } catch (e) {}
    try {
      localStorage.setItem(${JSON.stringify(kv + "latest_zone")}, ${JSON.stringify(String(shot.zone))});
      localStorage.setItem(${JSON.stringify(kv + "player.0.spawn.tileX")}, ${JSON.stringify(String(shot.x))});
      localStorage.setItem(${JSON.stringify(kv + "player.0.spawn.tileY")}, ${JSON.stringify(String(shot.y))});
      localStorage.setItem(${JSON.stringify(kv + "player.0.spawn.direction")}, ${JSON.stringify(String(dir))});
      localStorage.setItem(${JSON.stringify(kv + "build_number")}, "3");
      localStorage.setItem("sneakbit.settings.v1", '{"showFps":false,"muted":true}');
    } catch (e) {}
  `;
}

async function captureShot(s, shot) {
  const w = clamp(shot.w | 0, MIN_W, MAX_W);
  const h = Math.max(MIN_H, shot.h | 0);
  if ((shot.w | 0) !== w) console.warn(`  ! w=${shot.w} out of [${MIN_W},${MAX_W}], using ${w}`);
  if ((shot.h | 0) !== h) console.warn(`  ! h=${shot.h} below ${MIN_H}, using ${h}`);
  const W = w * PX_PER_TILE, H = h * PX_PER_TILE;

  // Size first so the page's initial auto-zoom uses the right viewport.
  await s.send("Emulation.setDeviceMetricsOverride", {
    width: W, height: H, deviceScaleFactor: 1, mobile: false,
  });

  // Seed before boot, navigate, then drop the injected script so it can't
  // leak into the next shot.
  const { identifier } = await s.send("Page.addScriptToEvaluateOnNewDocument", { source: seedScript(shot) });
  await navigate(s, `http://127.0.0.1:${STATIC_PORT}/play/`);
  await s.send("Page.removeScriptToEvaluateOnNewDocument", { identifier });

  // Confirm the seeded spawn landed (proves the zone built and the player
  // is on our tile, not the fallback entry tile).
  await waitFor(
    s,
    `(() => { const p = window.coop && window.coop.positions && window.coop.positions()[0];
              return !!(p && p.tileX === ${shot.x} && p.tileY === ${shot.y}); })()`,
    { timeoutMs: 15000 },
  );

  // Hard-assert the achieved tile count — catches any headless viewport
  // drift instead of writing an off-size PNG. zoom.js stamps it on #hud.
  const tilesStr = await evalExpr(s, `document.getElementById('hud').dataset.tiles || ''`);
  const got = String(tilesStr).split(" ")[0]; // "30×20"
  const want = `${w}×${h}`;
  if (got !== want) {
    throw new Error(`tile-count mismatch for ${shot.out}: wanted ${want}, got "${tilesStr}"`);
  }

  // Hide every DOM overlay (hud controls, HP/ammo cards, toasts, menus) so
  // only the game canvas remains. Anything inside #game can't render, so a
  // blanket "hide top-level non-canvas" rule is safe.
  await evalExpr(s, `(() => {
    let st = document.getElementById('shot-hide');
    if (!st) { st = document.createElement('style'); st.id = 'shot-hide'; document.head.appendChild(st); }
    st.textContent = 'body > *:not(#game){display:none !important}';
  })()`);

  // Let the lazy zone-cache bake and a couple of frames settle.
  await sleep(shot.settle ?? 600);

  const { data } = await s.send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
    captureBeyondViewport: false,
  });
  await writeFile(join(OUT_DIR, shot.out), Buffer.from(data, "base64"));
  console.log(`  ✓ ${shot.out}  zone ${shot.zone} @ (${shot.x},${shot.y})  ${w}×${h} tiles  ${W}×${H}px`);
}

async function main() {
  if (!findChrome()) {
    console.log("Chrome not found (set CHROME_PATH); skipping screenshot run.");
    return;
  }
  const specPath = process.argv[2] ? resolve(process.argv[2]) : join(HERE, "screenshots.json");
  const spec = JSON.parse(await readFile(specPath, "utf8"));
  const defaults = spec.defaults || {};
  const shots = (spec.shots || []).map((s) => ({ ...defaults, ...s }));
  if (!shots.length) { console.log("no shots in spec"); return; }

  await mkdir(OUT_DIR, { recursive: true });

  const staticProc = spawn(
    process.execPath,
    [join(REPO_ROOT, "tests", "e2e", "fixtures", "nodeStaticServer.mjs"), String(STATIC_PORT), REPO_ROOT],
    { stdio: "ignore" },
  );
  let chrome, s;
  try {
    await waitForPort(STATIC_PORT);
    chrome = await launchChrome({ port: CDP_PORT, dataDir: "/tmp/sb-screenshots" });
    const targets = await getTargets(CDP_PORT);
    const page = targets.find((x) => x.type === "page");
    s = await connectSession(page.webSocketDebuggerUrl);

    console.log(`Capturing ${shots.length} shot(s) → ${OUT_DIR}`);
    for (const shot of shots) {
      if (!shot.out || shot.zone == null || shot.x == null || shot.y == null) {
        console.warn(`  ! skipping malformed shot: ${JSON.stringify(shot)}`);
        continue;
      }
      await captureShot(s, shot);
    }
  } finally {
    try { s?.close(); } catch { /* ignore */ }
    try { chrome?.kill(); } catch { /* ignore */ }
    try { staticProc.kill("SIGTERM"); } catch { /* ignore */ }
  }
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
