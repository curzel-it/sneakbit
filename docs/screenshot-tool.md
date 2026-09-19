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
  "defaults": { "w": 30, "h": 20, "direction": "down", "settle": 700 },
  "shots": [
    { "out": "overworld.png", "zone": 1001, "x": 68, "y": 23 },
    { "out": "duskwood.png", "zone": 1011, "x": 40, "y": 40 },
    { "out": "farmland.png", "zone": 1012, "x": 50, "y": 40 }
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
| `kv` | extra storage.js keys to seed, unprefixed — e.g. `{"player.0.inventory.amount.2000": 1}` captures a spot as it looks once the yellow key is held |

**Constraint from auto-zoom:** the driver clamps `w` to `[16, 36]` and `h ≥ 10`
(`MIN_W`/`MAX_W`/`MIN_H` in `tools/screenshot.mjs`) and warns when a requested
`w`/`h` is out of range. Past `MAX_TILES_W` (36) tiles across, `zoom.js` raises
`scale`, so a wider window would no longer render one tile per 32 px.

## Mechanism — `tools/screenshot.mjs` (Node driver, zero deps)

Reuses the existing CDP harness — no puppeteer, matching the no-deps rule:
`tests/e2e/fixtures/chrome.mjs` (`launchChrome`, `connectSession`, `evalExpr`,
`navigate`, `waitFor`) and the static-server fixture.

Per run:

1. Start a static server on the repo root; launch headless Chrome; connect a session.
   Both ports come from the OS, never from a hand-picked constant: the static server
   takes a free port (override with `SHOT_STATIC_PORT`), and Chrome picks its own
   debugger port, which `launchChrome` reads back out of `DevToolsActivePort`.
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
      | `sneakbit.kv.v1.<k>` for each entry of `kv` | that entry's value |

      Seed it *before* the ES modules run: register a
      `Page.addScriptToEvaluateOnNewDocument` script that clears `localStorage` and
      sets the keys, `navigate` to the static server's root, then remove the script
      so it can't leak into the next shot.

      Also seed two more keys in the same step, for a clean boot:
      | localStorage key | value | why |
      |---|---|---|
      | `sneakbit.settings.v1` | `{"showFps":false,"muted":true}` (JSON, no `kv.v1` prefix) | its absence is exactly what `settings.js` treats as **first launch** — seeding it both suppresses the first-launch "audio muted" toast (`firstLaunch.js`) **and** turns off the FPS overlay text |
      | `sneakbit.kv.v1.build_number` | `3` (= `BUILD_NUMBER`) | belt-and-braces: makes `runMigrations()` a no-op so the migration ladder can never touch the seeded `latest_zone`/spawn keys. (Even unseeded it's safe — a null `build_number` just stamps the version and runs nothing — but seeding it is explicit.) |
   3. **Wait for the spot to be live.** Poll the existing debug hook:
      `window.coop.positions()[0]` exists and its `tileX/tileY` equal the seeded
      `x/y` — confirms the seeded spawn landed and the zone is built.
      **Verify the achieved tile count** before capturing: `zoom.js` writes the live
      `tilesW×tilesH` it computed into `document.getElementById('hud').dataset.tiles`
      (e.g. `"30×20 2× dpr=1.00"`). Assert it matches the request — this catches the
      case below where a headless build's `visualViewport` disagrees with the device
      metrics override, instead of silently producing an off-size capture.
   4. **Hide DOM overlays** for a clean frame: inject a `<style id="shot-hide">`
      with `body > *:not(#game){display:none !important}`, which hides `#hud`, the
      HP/ammo cards, toasts and menus and leaves only the game canvas. Then wait
      `settle` ms for the zone cache to bake its chunks (`getZoneChunk` bakes on
      first use) and a couple of rendered frames.
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
  pixels would need a post-capture downscale (at the driver's clamped sizes auto-zoom
  always picks `scale=2`).
- **File layout** (one feature, one file): `tools/screenshot.mjs` (driver) +
  `tools/screenshots.json` (spec). No game code changes required — the seed-and-size
  approach uses only existing boot behavior and the existing `window.coop` readback.

## Status — built

Implemented as `tools/screenshot.mjs` (driver) + `tools/screenshots.json` (spec),
runnable via `npm run shots`. The seed-and-size approach worked as designed: no game
code changed, no new deps. The spec writes `overworld.png`, `duskwood.png` and
`farmland.png`; the README shows `1.png`–`5.png` and `multiplayer.jpeg`, which the
spec does not produce.

Tuning the shots is a matter of editing `tools/screenshots.json` — pick a `zone`,
a player tile `x`/`y`, and a viewport `w`/`h` in tiles. (The starter spec uses
daylight zones to sidestep the darkness caveat above.)
