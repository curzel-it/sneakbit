# Allocation profiling — per-frame heap churn

Goal: a repeatable way to measure **how many bytes the game allocates per frame**
and **which functions allocate them**, run against the real HTML build in
headless Chrome. The point is GC hygiene — short-lived per-frame garbage is what
makes the collector pause mid-play — so we measure *churn* (allocations as they
happen, including the ones already reclaimed), not retained heap.

## TL;DR

```bash
node tests/e2e/allocProfile.mjs              # ranked bytes/frame table, idle + moving
SB_ZONE=1007 node tests/e2e/allocProfile.mjs # busiest zone (323 entities)
SB_FRAMES=1200 node tests/e2e/allocProfile.mjs

npm run test:e2e                             # includes allocations.test.mjs (regression backstop)
```

Self-skips when Chrome isn't on the path (`findChrome()`); set `CHROME_PATH` for
a non-default install, same as the rest of the e2e suite.

## How it works

It reuses the existing CDP harness (`tests/e2e/fixtures/chrome.mjs` —
`launchChrome`, `connectSession`, `evalExpr`, `navigate`, `waitFor`; plus the
static-server fixture). On top of that it drives Chrome's **`HeapProfiler`
sampling profiler**:

1. Install a private `requestAnimationFrame` counter in the page (`window.__frameCount`).
   It rides the same rAF cadence as the game loop, so its delta == frames the
   game rendered during the window.
2. `HeapProfiler.enable` → `collectGarbage` (clean floor) → `startSampling`.
3. Run a workload for N frames (`waitFrames` polls the counter).
4. `HeapProfiler.stopSampling` returns a call-tree; walk it, sum `selfSize` per
   call frame, keep only frames whose script lives under `js/`.
5. Report `bytesPerFrame` (= total sampled ÷ frames) and a ranked top-site list.

**Why sampling, not `takeHeapSnapshot`:** a snapshot measures *live retained*
memory. We care about transient per-frame garbage, which the GC has often already
reclaimed by snapshot time. The sampling profiler records allocations as they
occur, so it captures exactly the churn we want to cut.

Two workloads, both zone-agnostic:
- **idle** — no input; pure render + entity-tick steady-state churn.
- **moving** — holds + flips a movement key every ~600 ms so step / snap / chain /
  animation and the input path run too.

## ⚠️ The optimizer hides the real allocation sites

Under normal V8 optimization the hot rAF loop is **inlined**, so almost everything
collapses into one bucket:

```
[alloc:moving] frame — js/gameLoop.js:7   83.2 KB  (141 B/frame)
```

That single `frame — gameLoop.js:7` line is *everything* the loop inlined
(`collect`, `drawEntities`, `updateVisibleEntities`, `allPlayers`, …). Worse, V8's
**escape analysis scalar-replaces** the short-lived scratch arrays/objects that
never escape the call — so they cost **zero** in production and don't appear at
all, even though the source looks like it allocates.

To see the true per-site distribution, launch Chrome with optimization disabled,
which defeats inlining *and* escape analysis:

```bash
# (the npm script always optimizes; do this inline when you need the breakdown)
chrome --headless=new --js-flags=--no-opt ...
```

With `--no-opt` the buckets split apart and every allocation shows at its real
call frame. Treat the `--no-opt` **distribution** as "where allocations *could*
happen"; treat the optimized **totals** as "what production actually pays". An
allocation that only shows under `--no-opt` is one the optimizer already
eliminates — leave it alone.

Use a smaller `samplingInterval` (e.g. `256` instead of the default `2048`) when
chasing small per-frame allocations — finer sampling, less undersampling, at the
cost of more profiler overhead. `profileAllocations(session, { samplingInterval })`.

## Reading the output

```
[alloc:moving] frames=608  total=124.9 KB  ours=100.6 KB
[alloc:moving] per-frame: total=210 B  ours(js/)=169 B
[alloc:moving]   playTrack — js/music.js:31   4.8 KB  (8 B/frame)
   ...
```

- `total` vs `ours` — all sampled allocation vs only `js/` call frames (ignores
  browser/runtime internals).
- `per-frame` is the number that matters for GC pressure. For scale: ~170 B/frame
  at 60 fps is ~10 KB/s — the young-generation scavenger handles that without a
  visible pause. Hundreds of KB/s is when you start looking.
- The ranked list is each `js/` call frame's share. A *named* function high on
  the `--no-opt` list that's absent from the optimized list is escape-analyzed
  away; ignore it.
- The **moving** workload re-dispatches synthetic key events every 600 ms, so
  `resolveAction` / the keydown listener / `input.js` are over-represented vs real
  play (holding a key fires one keydown). Don't over-read those.

## Files

| file | role |
|---|---|
| `tests/e2e/fixtures/allocProfile.mjs` | shared profiler — `profileAllocations(session, opts)` + `printAllocReport(label, report)` |
| `tests/e2e/allocProfile.mjs` | ad-hoc script (ranked table); `SB_ZONE` / `SB_FRAMES` env overrides |
| `tests/e2e/allocations.test.mjs` | regression backstop — generous bytes/frame ceiling, part of `npm run test:e2e` |

The test ceilings are deliberately loose (~5× the observed baseline): they catch a
regression that puts a `new Set`/array/object back on the hot path, not every byte.
Sampling is statistically noisy run-to-run, so a tight budget would flake.

## What this found (2026-06)

Steady-state churn was already low — ~57 B/frame idle, ~170 B/frame moving even in
the 323-entity zone — because V8 eliminates the obvious scratch. The only things
worth cutting were the allocations that **escape the frame** (the optimizer can't
remove those): `pollInput`'s per-slot `new Set`, and `updateVisibleEntities`'
`out` array (stored on the zone, read later the same frame) — both now reused in
place. Plus `healthHud.redraw`, which fires every continuous-damage/regen tick and
thrashed strings + DOM styles — now memoized. There was no GC bomb; the lesson was
"measure before pre-allocating", because most of the candidate sites cost nothing.
