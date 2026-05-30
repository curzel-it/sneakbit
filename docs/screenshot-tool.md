# Screenshot tool — plan

Goal: a repeatable way to produce README/docs screenshots of the **real HTML
build** from a small JSON spec. Input is a world id, a player tile, and a viewport
size in tiles; output is a PNG per entry under `docs/screenshots/`.

Approach (per the steer on this): **don't pilot the game and don't render through a
custom canvas path.** Instead, seed the saved state so the game *boots* directly to
the world + tile we want, size the headless window to the requested tile count, and
let Chrome screenshot the live game as-is. The capture is whatever a real player
would see at that spot.

## Why this works without driving the game

Two facts in the current code make this a seed-and-snap job, not an automation job:

1. **Boot reads the save.** `main.js → initOfflineState()` calls `loadProgress()`
   (`js/save.js`) and, when a save exists, `applySavedSpawn()` drops the player on
   the exact saved tile in the saved zone. So pre-seeding localStorage fully
   determines where the game opens.
   - ⚠️ Do **not** also pass `?zone=ID`. When `?zone` is present, `initOfflineState`
     sets `saved = null` and spawns at the zone's entry/teleporter instead of our
     tile. Seed the save and navigate to a clean `index.html`.

2. **Auto-zoom derives tile count from the window size.** `js/zoom.js` picks an
   integer `scale` and then `tilesW = ceil(physicalWidth / (scale·TILE_SIZE))`. At
   `deviceScaleFactor = 1`, `scale` resolves to `2` (`max(2, round(32/16))`), so a
   window of `w·32 × h·32` physical px renders **exactly** `w × h` tiles. We set the
   window, the game does the rest.

## Input spec — `tools/screenshots.json`

```json
{
  "defaults": { "w": 30, "h": 20, "direction": "down", "settle": 600 },
  "shots": [
    { "out": "overworld.png",  "zone": 1001, "x": 30, "y": 24 },
    { "out": "caves-lava.png", "zone": 12,   "x": 40, "y": 30, "w": 34, "h": 22 }
  ]
}
```

| field | meaning |
|---|---|
| `out` | filename written under `docs/screenshots/` |
| `zone` | world id (the `latest_zone` value) |
| `x`, `y` | player spawn tile — the game centers the camera on it |
| `w`, `h` | viewport size in tiles (overridable per shot) |
| `direction` | facing: `down`/`up`/`left`/`right` (cosmetic) |
| `settle` | ms to wait after spawn before capturing (lets the zone cache bake + a couple of frames run) |

**Constraint from auto-zoom:** `w` is clamped to `[16, 36]` and `h ≥ 10` by
`zoom.js` (`MIN_TILES_W`/`MAX_TILES_W`). Asking for fewer/more tiles silently snaps
to the clamp — the driver should warn when a requested `w`/`h` is out of range.

## Mechanism — `tools/screenshot.mjs` (Node driver, zero deps)

Reuses the existing CDP harness — no puppeteer, matching the no-deps rule:
`tests/e2e/fixtures/chrome.mjs` (`launchChrome`, `connectSession`, `evalExpr`,
`navigate`, `waitFor`) and the static-server fixture.

Per run:

1. Start a static server on the repo root; launch headless Chrome; connect a session.
2. For each shot:
   1. **Set the window size** to `clamp(w,16,36)·32 × max(h,10)·32` at
      `deviceScaleFactor = 1` via CDP `Emulation.setDeviceMetricsOverride`.
   2. **Seed the save before the app boots.** The keys live under storage.js's
      `sneakbit.kv.v1.` prefix (values are stringified ints):
      | localStorage key | value |
      |---|---|
      | `sneakbit.kv.v1.latest_zone` | `zone` |
      | `sneakbit.kv.v1.player.0.spawn.tileX` | `x` |
      | `sneakbit.kv.v1.player.0.spawn.tileY` | `y` |
      | `sneakbit.kv.v1.player.0.spawn.direction` | `0`=down `1`=up `2`=left `3`=right |

      Seed it on the page origin *before* the ES modules run — navigate to a blank
      doc on the same origin, `localStorage.setItem(...)`, then `navigate` to
      `index.html`. (Equivalently `Page.addScriptToEvaluateOnNewDocument`.)

      Also seed two more keys in the same step, for a clean boot:
      | localStorage key | value | why |
      |---|---|---|
      | `sneakbit.settings.v1` | `{"showFps":false,"muted":true}` (JSON, no `kv.v1` prefix) | its absence is exactly what `settings.js` treats as **first launch** — seeding it both suppresses the first-launch "audio muted" toast (`firstLaunch.js`) **and** turns off the FPS overlay text |
      | `sneakbit.kv.v1.build_number` | `3` (= `BUILD_NUMBER`) | belt-and-braces: makes `runMigrations()` a no-op so the migration ladder can never touch the seeded `latest_zone`/spawn keys. (Even unseeded it's safe — a null `build_number` just stamps the version and runs nothing — but seeding it is explicit.) |
   3. **Wait for the spot to be live.** Poll the existing debug hook:
      `window.coop.positions()[0]` exists and its `tileX/tileY` equal the seeded
      `x/y` — confirms the seeded spawn landed and the zone is built. Then wait
      `settle` ms for the lazy `getZoneCache` bake and a couple of rendered frames.
      **Verify the achieved tile count** before capturing: `zoom.js` writes the live
      `tilesW×tilesH` it computed into `document.getElementById('hud').dataset.tiles`
      (e.g. `"30×20 2× dpr=1.00"`). Assert it matches the request — this catches the
      case below where a headless build's `visualViewport` disagrees with the device
      metrics override, instead of silently producing an off-size capture.
   4. **Hide debug chrome** for a clean frame: hide the `#hud` element (zone id /
      coords / fps overlay) via `document.getElementById('hud').style.display='none'`.
      The `sneakbit.settings.v1` seed above already disables the FPS text and skips
      the first-launch toast — so no overlay should be open at capture time. (If any
      toast still sneaks in, it lives in its own DOM node and can be hidden the same
      way.)
   5. **Capture** with CDP `Page.captureScreenshot` (`format:"png"`, clip the
      `w·32 × h·32` viewport). The PNG is a clean 2× of the native backing store —
      crisp pixel art, no smoothing (`imageSmoothingEnabled=false` in the renderer).
   6. Base64-decode and write `docs/screenshots/<out>`.
3. Close Chrome and the static server.

Wire as `npm run shots` (`node tools/screenshot.mjs [path/to/spec.json]`,
defaulting to `tools/screenshots.json`). Like `test:e2e`, it self-skips when Chrome
isn't on the path (`findChrome()`); set `CHROME_PATH` for a non-default install.

## Caveats / decisions left open

- **Live frame, not frozen.** We screenshot the running game, so a mob may be
  mid-step and biome tiles mid-animation. That's acceptable for docs. If a specific
  shot needs determinism, options are: capture a few frames and keep the best, or add
  a one-line "pause sim" debug seam later. Not building that now.
- **Darkness zones.** `Night` / `CantSeeShit` zones get the renderer's overlay
  (`drawDarkness`). For a bright doc shot of such a zone we'd need creative mode on
  (`isCreativeMode()` short-circuits the overlay) — out of scope for v1; pick
  daylight zones for the spec, or add a `creative` flag later.
- **Viewport sizing relies on auto-zoom, not a fixed canvas.** We size the *window*
  and let `zoom.js` derive the tile count, so the math depends on `deviceScaleFactor`
  resolving `scale` to `2` and on `window.visualViewport`/`innerWidth` reflecting the
  device-metrics override. The `dataset.tiles` assertion in step 3 turns any drift
  into a hard failure rather than a wrong-size PNG. The capture is a clean 2× of the
  native backing store (integer scale, smoothing off) — fine for docs; true 1:1
  pixels would need a post-capture downscale (auto-zoom never picks `scale=1`).
- **File layout** (one feature, one file): `tools/screenshot.mjs` (driver) +
  `tools/screenshots.json` (spec). No game code changes required — the seed-and-size
  approach uses only existing boot behavior and the existing `window.coop` readback.

## Status — built

Implemented as `tools/screenshot.mjs` (driver) + `tools/screenshots.json` (spec),
runnable via `npm run shots`. The seed-and-size approach worked as designed: no game
code changed, no new deps. The README's three placeholder Rust-release captures were
replaced with real HTML-build captures (`overworld.png`, `duskwood.png`,
`farmland.png`) and the Screenshots note now links here.

Tuning the shots is a matter of editing `tools/screenshots.json` — pick a `zone`,
a player tile `x`/`y`, and a viewport `w`/`h` in tiles. (The starter spec uses
daylight zones to sidestep the darkness caveat above.)
