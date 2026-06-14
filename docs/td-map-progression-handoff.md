# TD Bloons-style map progression — handoff

Status as of commit `d666ec0d`. This documents a **partially-landed** feature
(Bloons-style map roster + unlock progression for Tower Defense) so another
agent can finish it. The remaining work is **blocked** on a concurrent TD
economy refactor (gold → coins / `tdSave.js`) that was mid-flight in the same
working tree; the collision-free pieces are committed, the colliding pieces are
specified below.

Full design + rationale: `/Users/curzel/.claude/plans/recursive-sauteeing-oasis.md`.

## Goal (what we're building)
- A finite, ordered **roster of named maps** grouped into difficulty **tiers**.
- Each map has a **wave goal**; clearing it = finishing/"winning" that map.
- Finishing a map mid-run **auto-promotes** the team to the next map (round
  resets to 1, harder map). Run ends on squad wipe / village overrun, or **full
  victory** when the last map is beaten.
- Maps **unlock** Bloons-style: tiers open by cumulative unique-map wins.
- A **map-select screen** starts a run on any unlocked map.
- **Multiplayer is host-led aid:** host/solo own progression + persistence +
  map choice; guests mirror the host's run.

Confirmed design decisions: procedural-per-slot maps (one forest theme for now,
differing by generation difficulty + wave goal); waves **reset per map**;
unlocks tiered by unique wins; map-select screen = yes.

## DONE — committed, collision-free, tests green

| Commit | What |
|---|---|
| `7ac9bcd2` | **`js/tdMaps.js`** + **`js/tdProgress.js`** + unit tests |
| `e11fa5dd` | **`js/tdWaves.js`** param rename (cumulative wave → effective difficulty) |
| `d666ec0d` | **`js/mapSelect.js`** the map-select DOM screen |

### `js/tdMaps.js` — roster data + pure helpers (no storage, no DOM)
- `TIERS` (ordered: beginner @0 unique wins, intermediate @3, advanced @6).
- `ROSTER`: 9 maps, 3 tiers, each `{ id, name, tier, difficulty, waveGoal }`.
  `difficulty` is the integer fed to `generateMap(rawZone, difficulty)` (the old
  ad-hoc `mapIndex`) and to wave scaling; `waveGoal` is the final round.
- Helpers: `mapRoster()`, `mapById(id)`, `mapIndexInRoster(id)`, `firstMapId()`,
  `nextMapId(id)` (null at end = full victory), `waveGoalFor(id)`,
  `difficultyFor(id)`, `tierUnlocked(tierId, uniqueWins)`,
  `mapUnlocked(id, progress)`, `unlockSummary(progress)` (render-ready for the
  screen). All unit-tested in `tests/tdMaps.test.js`.

### `js/tdProgress.js` — persistence over `js/storage.js` (int kv, auto cloud-sync)
- Keys (all `td.*`): `td.map.<id>.wins`, `td.map.<id>.bestRound`,
  `td.uniqueWins` (bumped the first time a map is ever won — no key enumeration
  in storage.js, hence the explicit aggregate). Keeps existing `td.highScore`.
- API: `recordMapWin(id, roundReached)`, `recordRoundReached(id, round)`
  (monotonic best), `getProgress()` → `{ winsById, bestById, uniqueWins }`,
  `resetProgress()`. Unit-tested in `tests/tdProgress.test.js`.
- **Caller must gate writes to host/solo** (`getNetRole() !== "guest"`).

### `js/tdWaves.js` — effective-difficulty scaling
- `waveCount`, `waveInterval`, `buildWaveSpecies`, `startWave` now take an
  **effective difficulty** integer, not a cumulative wave. Math unchanged
  (`tests/tdWaves.test.js` still green). The controller must compute and pass it
  (see Phase 2). Removed the dead `waveNumber` module var.

### `js/mapSelect.js` — the map-select screen (DOM, decoupled)
- `installMapSelect({ onStart })`, `openMapSelect()`, `closeMapSelect()`,
  `isMapSelectOpen()`. Renders `unlockSummary(getProgress())` as a tier grid
  with lock state + per-map wins/best. Choosing an unlocked map calls
  `onStart(mapId)`.
- **Intentionally does NOT import `towerDefense.js`** (it was in flux) — the run
  start is injected. Wire it in Phase 3.
- Patterned on `partyPanel.js`/`shop.js`: `el()`/`registerMenuSurface`/injected
  `<style>` with `--sb-*` tokens, Esc to close, `priority: 12`.

## TODO — blocked on the concurrent economy refactor

These edit files the other session was modifying uncommitted (`towerDefense.js`,
`tdHud.js`, `touch.js`) or depend on those edits. **Layer on top after the
economy refactor lands.** Note the economy refactor renamed run currency
gold→coins; the e2e test now reads `state().coins` and `window.td.coins(n)`, and
debug/HUD use coins. Keep that — don't reintroduce `gold`.

### Phase 2 — roster-driven lifecycle (`js/towerDefense.js`)
Replace the "every `WAVES_PER_MAP` waves, `mapIndex++` forever, endless" logic.
- **Imports** (add): from `./tdMaps.js` — `mapById, mapRoster, mapIndexInRoster,
  firstMapId, nextMapId, waveGoalFor, difficultyFor, mapUnlocked`; from
  `./tdProgress.js` — `recordMapWin, recordRoundReached, getProgress`.
- **State:** replace `let mapIndex` with `let currentMapId = firstMapId()`. Keep
  `wave` (cumulative, for score/stipend) and `waveInMap` (rounds cleared on the
  current map). Remove `WAVES_PER_MAP`. Add
  `const DIFFICULTY_PER_MAP = 2;` and
  `function effectiveDifficulty(mapId, round) { return difficultyFor(mapId) * DIFFICULTY_PER_MAP + Math.max(1, round|0); }`.
- **`startTowerDefense(opts = {})`:** accept `opts.mapId`; pick start map =
  `opts.mapId` if it exists **and** `mapUnlocked(opts.mapId, getProgress())`,
  else `firstMapId()`. Set `currentMapId` before `loadMap`. Replace the
  `mapIndex = 0` init line; keep `wave = 0`, `waveInMap = 0`. `await loadMap(currentMapId)`.
- **`loadMap(mapId)`** (was `loadMap(idx)`): `const entry = mapById(mapId) ||
  mapById(firstMapId());` call `generateMap(rawZone, entry.difficulty)` and
  `obstacleBatch(entry.difficulty)`; set `currentMapId = entry.id`,
  `waveInMap = 0`. Keep paint/field/relocate/`broadcastTdMap`.
- **`startNextWave`:** after `wave += 1`, compute
  `const round = waveInMap + 1;` and call
  `startWave(effectiveDifficulty(currentMapId, round))` (instead of `startWave(wave)`).
- **`clearWave`:** keep score/stipend on cumulative `wave`. Then:
  ```
  waveInMap += 1;
  if (waveInMap >= waveGoalFor(currentMapId)) {
    onMapFinished();
    if (phase === "gameover") return; // victory ended the run
  }
  enterBuild();
  ```
- **New `onMapFinished()`:**
  ```
  const finished = currentMapId, m = mapById(finished);
  if (getNetRole() !== "guest") recordMapWin(finished, waveInMap);
  const next = nextMapId(finished);
  if (next) { showToast(`${m?.name || "Map"} cleared!`, "hint"); loadMap(next); }
  else gameOver("victory");
  ```
- **`gameOver(reason)`:** capture `const reached = phase === "wave" ? waveInMap + 1 : waveInMap;`
  before flipping phase; if `reason !== "victory" && getNetRole() !== "guest"`
  call `recordRoundReached(currentMapId, reached)`. Add title case:
  `reason === "victory" ? "Run complete!"`. Pass `victory: reason === "victory"`
  into `showTdGameOver(...)`.
- **`buildModel`:** replace `map: mapIndex + 1` with map fields:
  `const m = mapById(currentMapId);` add
  `mapName: m?.name || "—", round: Math.min(waveInMap + 1, m?.waveGoal || 1),
   goal: m?.waveGoal || 0, map: mapIndexInRoster(currentMapId) + 1`.
- **`window.td` (`installDebugHook`):** `state()` — replace `mapIndex` with
  `mapIndex: mapIndexInRoster(currentMapId)` (keeps e2e's `state().mapIndex`
  working) and add `mapId: currentMapId, round: waveInMap + 1,
  goal: waveGoalFor(currentMapId)`. `map()` → `{ mapId: currentMapId,
  mapIndex: mapIndexInRoster(currentMapId), round: waveInMap + 1,
  goal: waveGoalFor(currentMapId) }`. `nextMap()` →
  `loadMap(nextMapId(currentMapId) || currentMapId)`. Add:
  `mapId: () => currentMapId`, `roster: () => mapRoster()`,
  `progress: () => getProgress()`, `selectMap: (id) => startTowerDefense({ mapId: id })`,
  and a test helper `finishMap: () => { waveInMap = Math.max(0, waveGoalFor(currentMapId) - 1); clearWave(); }`.

### Phase 2 — HUD (`js/tdHud.js`)
- Status bar: show **map name** + **"Round X / goal"** (model.mapName / round /
  goal) instead of the bare cumulative `Wave N`. Make it tolerant: fall back to
  `model.wave` if the new fields are absent.
- `showTdGameOver(result)`: support a `result.victory` variant ("Run complete!"
  styling reuses `#td-gameover`). "Play again" should route to the map-select
  screen (see Phase 3) rather than restarting the same map.

### Phase 3 — wiring (`js/main.js`, `js/partyPanel.js`)
- `js/main.js`: `import { installMapSelect } from "./mapSelect.js";` and call
  `installMapSelect({ onStart: (mapId) => startTowerDefense({ mapId }) });` at
  boot (after other installs). Deep link `?mode=td` → `openMapSelect()`; support
  `?mode=td&map=<id>` → boot that map directly (used by e2e).
- `js/partyPanel.js`: `onTowerDefenseClick()` → `openMapSelect()` (import from
  `./mapSelect.js`) instead of calling `startTowerDefense()` directly. Solo +
  offline-coop host only; guests never open it.
- `restartRun()` in `towerDefense.js` (the "Play again" handler) → `hideTdHud();
  openMapSelect();`.

### Phase 4 — co-op + tests
- Guests already get the painted map via `broadcastTdMap()`; the new
  `mapName/round/goal` in `buildModel` ride the existing `tdState` host event to
  the guest HUD automatically (`js/guestEvents.js handleTdState` spreads the
  model) — verify, no new event kind needed. Cleared-map feedback to guests:
  reuse the existing `"toast"` host event if desired.
- **`tests/e2e/towerDefense.test.mjs`** (already updated for coins by the other
  session): the map-advance section at lines ~81–84 does `win(); win();` to hit
  the old `WAVES_PER_MAP` and asserts `state().mapIndex === 1`. Replace with
  `window.td.finishMap()` then `waitFor(... state().mapIndex === 1 ...)`. Boot
  via `?mode=td&map=meadow` if you want determinism. Add assertions: round
  resets to 1 after promotion; finishing the last map shows the victory card.
- `tests/tdMaze.test.js`: unaffected by this feature (generator unchanged), but
  it still references `obstacleBatch(mapIndex)` semantics — fine.
- Run `npm run test:unit` (fast) and `npm run test:e2e` (touches the TD online
  path, so required before pushing).

## Tuning knobs (all in `js/tdMaps.js` unless noted)
- Roster size/order, per-map `difficulty` + `waveGoal`, `TIERS[].unlockAt`.
- `DIFFICULTY_PER_MAP` (in `towerDefense.js`) — how much tougher each map starts.
- Expert tier deferred — add a `TIERS` entry + roster maps to extend.

## Gotchas
- **Shared working tree:** multiple agents edit this checkout. `git diff` before
  staging; stage only your files (`git add <paths>`), never `git commit -a`, or
  you'll bundle someone's WIP. Commit your standalone work promptly so it isn't
  swept into another agent's `-a` commit.
- The map-select start is injected on purpose; don't make `mapSelect.js` import
  `towerDefense.js` at module top if it can be avoided (keeps the screen a pure
  presenter and dodges import cycles).
