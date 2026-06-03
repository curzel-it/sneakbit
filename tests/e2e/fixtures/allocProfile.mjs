// Per-frame allocation profiler for the live game in headless Chrome.
//
// Uses CDP's HeapProfiler *sampling* profiler (HeapProfiler.startSampling /
// stopSampling), which attributes allocated bytes to the call frame that
// allocated them. Dividing the sampled total by the number of animation
// frames that elapsed during the window gives a "bytes allocated per frame"
// figure, and the per-call-frame breakdown tells us *where* to cut.
//
// Sampling (not the full HeapProfiler.takeHeapSnapshot) is deliberate: a
// snapshot measures live retained memory, which is not what we care about —
// we care about churn (short-lived per-frame garbage). The sampling profiler
// records allocations as they happen, including the ones the GC has already
// reclaimed by the time we stop.
//
// This is a fixture, not a test. tests/e2e/allocations.test.mjs wraps it with
// a generous regression ceiling; tests/e2e/allocProfile.mjs runs it ad-hoc and
// prints a ranked table (mirrors perfPublic.mjs's "script not test" pattern).

import { evalExpr } from "./chrome.mjs";

// Install a private rAF counter alongside the game's own loop. Same rAF
// cadence as the game step, so its delta == frames the game rendered.
const INSTALL_FRAME_COUNTER = `
  (() => {
    window.__frameCount = 0;
    const tick = () => { window.__frameCount++; requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    return true;
  })()
`;

async function frameCount(session) {
  return (await evalExpr(session, "window.__frameCount|0")) | 0;
}

// Wait until `frames` more animation frames have elapsed (or wallMs lapses).
// Returns the actual number of frames that passed.
async function waitFrames(session, frames, { wallMs = 30_000, pollMs = 100 } = {}) {
  const start = await frameCount(session);
  const t0 = Date.now();
  while (Date.now() - t0 < wallMs) {
    const now = await frameCount(session);
    if (now - start >= frames) return now - start;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return (await frameCount(session)) - start;
}

// Sum selfSize per call frame across the sampling profile's call tree, keeping
// only frames whose script lives under our js/ folder. Returns a sorted list.
function aggregate(head) {
  const bySite = new Map();
  let total = 0;
  let ours = 0;
  const walk = (node) => {
    const cf = node.callFrame || {};
    const size = node.selfSize | 0;
    total += size;
    const url = cf.url || "";
    if (size && /\/js\/[^/]+\.js/.test(url)) {
      ours += size;
      const file = url.replace(/^.*\/js\//, "js/");
      const key = `${cf.functionName || "(anonymous)"} — ${file}:${(cf.lineNumber | 0) + 1}`;
      bySite.set(key, (bySite.get(key) || 0) + size);
    }
    for (const c of node.children || []) walk(c);
  };
  walk(head);
  const topSites = [...bySite.entries()]
    .map(([site, bytes]) => ({ site, bytes }))
    .sort((a, b) => b.bytes - a.bytes);
  return { total, ours, topSites };
}

// Profile a window of frames while `drive(session)` exercises the game.
// `drive` is an async fn that issues input and resolves quickly; the frame
// window is held open by waitFrames regardless of when drive resolves, so a
// drive that just kicks off a held key still gets the full window measured.
export async function profileAllocations(session, { frames = 600, samplingInterval = 2048, drive } = {}) {
  await evalExpr(session, INSTALL_FRAME_COUNTER);
  await session.send("HeapProfiler.enable");
  // collectGarbage gives a clean floor so retained-but-not-churned objects
  // from boot don't smear into the window.
  await session.send("HeapProfiler.collectGarbage");
  await session.send("HeapProfiler.startSampling", { samplingInterval });

  const drivePromise = drive ? Promise.resolve(drive(session)) : Promise.resolve();
  const actualFrames = await waitFrames(session, frames);
  await drivePromise;

  const { profile } = await session.send("HeapProfiler.stopSampling");
  await session.send("HeapProfiler.disable");

  const { total, ours, topSites } = aggregate(profile.head);
  const f = Math.max(1, actualFrames);
  return {
    frames: actualFrames,
    totalBytes: total,
    ourBytes: ours,
    bytesPerFrame: total / f,
    ourBytesPerFrame: ours / f,
    topSites,
  };
}

// Pretty-print a report returned by profileAllocations.
export function printAllocReport(label, r, { topN = 15 } = {}) {
  console.log(`\n[alloc:${label}] frames=${r.frames}  total=${fmt(r.totalBytes)}  ours=${fmt(r.ourBytes)}`);
  console.log(`[alloc:${label}] per-frame: total=${fmt(r.bytesPerFrame)}  ours(js/)=${fmt(r.ourBytesPerFrame)}`);
  const sites = r.topSites.slice(0, topN);
  if (!sites.length) { console.log(`[alloc:${label}]   (no js/ allocations sampled)`); return; }
  const w = Math.max(...sites.map((s) => s.site.length));
  for (const s of sites) {
    console.log(`[alloc:${label}]   ${s.site.padEnd(w)}  ${fmt(s.bytes)}  (${fmt(s.bytes / Math.max(1, r.frames))}/frame)`);
  }
}

function fmt(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}
