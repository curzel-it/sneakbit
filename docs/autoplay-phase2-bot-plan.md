# Autoplay Phase 2 — the in-page bot (comprehensive plan)

Goal: SneakBit plays itself 24/7 in prod for the live stream. The bot runs
inside the real game page (`/play/?autoplay=1`), drives the real engine
through its input seams, and works through the completionist route proven
feasible by the phase-1 offline analysis: every NPC talked to, all loot,
all six keys, every puzzle, the `demon_lord_defeat` finale in 1017, then
endless post-game re-runs. The save is NEVER reset.

Phase 3 (Xvfb + Chrome + ffmpeg on the VPS) is **already built and
idling** — `tools/stream/` shipped in c45a8782/5e98ce58 and was put into
`--stop` standby in 6e5313f4 "until the bot ships". This plan is the
missing middle.

---

## 0. Where things stand (2026-06-12)

### Phase 1 (offline analysis) — green foundation, two open defects

`js/autoplay/{worldIndex,worldModel,objectiveCatalog,zoneGraph,
puzzleSolver,dialogueSim,routePlanner}.js` all run in pure node;
`npm run test:unit` = 990 pass. The two `AUTOPLAY_WIP=1` suites
(autoplayPuzzles, autoplayRoute) are still red, for **diagnosed,
understood** reasons:

**Defect A — infinite loop after the finale (the "hang").** Root-caused
with logging (2000+ identical picks observed):

1. By global pass 4 the sim holds all six keys, enters 1017, and fires
   `demon_lord_defeat` — the finale IS reached.
2. The cutscene's `on_end` spawns the credits entity (id 11974933,
   dialogue `end_game_credits`, `after_dialogue: "Nothing"`).
   `applyObjective` pushes it into `rt.extraTalkables`
   (routePlanner.js:241).
3. `mergedObjectives` (routePlanner.js:141) evicts an extraTalkable only
   on `item_collected.<id> === 1` — a flag only ever written when
   `after_dialogue !== "Nothing"`. The credits entity never qualifies,
   isn't in `model.talkables` (so the `out.find` dedup misses), and is
   re-added as an `auto` objective every iteration. `pickWalkable`
   returns auto objectives unconditionally → `while (true)` in
   `drainZone` never exits.

   **Fix:** evict extraTalkables whose resolved dialogue is exhausted —
   mirror `liveObjectives`' talk check (`resolveEntityDialogue` +
   `dialogue.answer.<text> === 1`), or drop the entry when
   `exhaustEntityDialogue` reads 0 lines. One-file change in
   routePlanner.js + a regression assertion in autoplayRoute.test.js.

**Defect B — solver wall-clock.** Zone 1013's last pickup solve takes
~43 s alone (succeeds; profile: per-state pushable-Map cloning shows up
as `ObjectAssign`/`CloneObjectIC`, plus a full region re-flood per popped
state in `flood()` puzzleSolver.js:398). This single solve blows the
route test's 5 s budget and is why the puzzles suite exceeds 120 s
(same searches repeated from multiple entry tiles). Known optimization
avenues, in order of expected payoff:

  1. Cheaper state representation: replace per-state `Map` clones with a
     sorted int-packed array (tile = y*cols+x fits 16 bits) cloned via
     `slice()`; macroKey becomes a join of ints.
  2. Incremental flood: a push changes one box tile — most floods are
     re-derivable from the parent region (or at least seeded from it).
  3. Memoize `reachableRegion` per (layout, playerRegionRep) — the same
     layout is re-flooded for every queued sibling today.
  4. Tighter heuristic to cut explored states (gateStar already helps;
     plateField could account for box-corridor deadlocks).

Defect B does NOT block the bot's first prod run (the bot solves each
zone once against the live save, and 43 s once is tolerable on stream),
but it must land before the WIP suites can be unskipped, and the bot
must run solves OFF the frame loop (see §5.6) so a slow solve never
freezes the page.

**Also known:** hops 1006→1008, 1014→1015, 1011→1018 fail instantly
(`exhausted (1)`) every sweep pass — expected one-way/pocket edges,
harmless. Whitelisted-unreachable: pickup 11105518 in 1012
(author-verified in-game).

### Phase 3 (stream infra) — done, waiting

`tools/stream/deploy.mjs` manages the VPS Xvfb + Chrome + ffmpeg
pipeline (YT/Twitch), PulseAudio for real game audio. Currently stopped.
When the bot ships, the stream points Chrome at
`https://sneakbit.curzel.it/play/?autoplay=1` and restarts.

---

## 1. Constraints and ground rules

- **No build step for dev; esbuild for prod.** The bot must NOT be in the
  shipped bundle for normal players. Load it with a **computed dynamic
  import** so esbuild can't statically resolve it:
  `const mod = "./autoplay/" + "bot.js"; import(new URL(mod, import.meta.url))`
  — gated on `?autoplay=1`. Verify post-build that `_site/` contains no
  bot code and that `js/autoplay/*.js` get deployed as loose files for
  the dynamic import to fetch (deploy.mjs must ship them — check; if the
  deploy only ships `_site/`, add the autoplay dir to the artifact list).
- **One feature one file.** Bot = several focused files (§4), not one blob.
- **UI in DOM, not canvas.** The objective overlay is a DOM element.
- **Engine code stays untouched where possible.** The bot drives existing
  seams; the only engine-side additions allowed are tiny, explicitly
  listed ones (§3).
- **The save is sacred.** Live storage, no resets, ever. Planning that
  needs "what if" simulation must snapshot/restore around itself (§3.2).
- **Creative mode is single-player-only territory** — irrelevant here,
  but the bot must never enable co-op/PvP/TD paths (it always runs the
  plain offline role).

## 2. Verified engine seams the bot drives

All verified against current code (line numbers as of this commit):

| Need | Seam |
|---|---|
| Hold/steer movement | `pushInputPress(playerIndex, direction)` / `releaseInputHeld` / `clearInputHeld` — js/input.js:44,50,57 |
| Player canonical tile | `state.player.tileX/.tileY` (ints; floats x/y are render-only) — js/player.js |
| Interact with facing NPC | `tryInteractForSlot(slot)` — js/interact.js:71; reach semantics js/interact.js:214-248 |
| Dismiss/advance dialogue | dialogue is DOM + its own window keydown (Space) / click listener — js/dialogue.js:142-165; `isDialogueOpen()` js/dialogue.js:176 |
| Combat | `tryShoot()` js/shooting.js:118, `tryMelee()` js/melee.js:145 |
| Frame cadence | `startGameLoop(step)` is rAF-driven — js/gameLoop.js |
| **Sim pause trap** | main.js:372+ — the sim FREEZES while any overlay is open (dialogue, menu, game-over, shop…). The bot therefore needs its OWN ticker (setInterval), independent of the game loop, to keep dismissing dialogues while the sim is paused. |
| Zone loading | `loadZone(id)` via js/data.js; raw zone JSONs are static files the bot can also prefetch directly |
| Storage | js/storage.js `getValue`/`setValue` — same substrate the planner already uses |
| Boot zone override | `?zone=N` is already parsed in main.js:524 — handy for prod smoke tests |

Phase-1 modules are environment-agnostic by design (data in, plain values
out, no fs/fetch/DOM) — they import cleanly in the browser. `worldIndex`'s
`discoverWorld(loadRawZone)` accepts any sync loader: prefetch all zone
JSONs into a `Map`, pass `map.get.bind(map)`.

## 3. Small engine-side additions (the only allowed touches)

### 3.1 Bot bootstrap hook (main.js, ~3 lines)
After offline state init: if `new URLSearchParams(location.search)
.has("autoplay")` → computed dynamic `import()` of the bot, passing a
narrow context: `{ getState: () => state }`. Everything else the bot
imports itself. (Reuse the existing `() => state` lazy-binding pattern
that installInteract/installShooting already use — main.js:260-262.)

### 3.2 Storage snapshot/restore (storage.js, ~10 lines)
`snapshotStorage(): object` / `restoreStorage(snap)` — flagged in the
phase-1 handoff, needed so the bot can dry-run `planRoute` against a COPY
of the live save without mutating it (planRoute writes flags as it
simulates). In-memory object copy of the backing store; node-safe like
the rest of storage.js. Unit-tested.

### 3.3 Possibly: an input-suppression flag (input.js)
The stream machine has no human, but local testing does — decide whether
the bot disables human keyboard input or coexists (a stray key during
testing just perturbs one step; the bot replans). Default: coexist, no
flag. Revisit only if it bites.

Nothing else in engine files changes.

## 4. New files (one feature, one file)

All under `js/autoplay/`, camelCase, named exports:

| File | Responsibility |
|---|---|
| `bot.js` | Orchestrator + state machine. Owns the bot ticker (setInterval ~50 ms), the mode stack (§5.1), wiring of all sub-features, start/stop. The dynamic-import entry point. |
| `botWorld.js` | Prefetch all zone JSONs (`fetch` each `data/<id>.json`, BFS over destinations like worldIndex does, into a Map), build models/graph ONCE, expose them. Also owns the planRoute dry-run (snapshot → plan → restore) and replan triggers. |
| `botNav.js` | Tile-level navigation: plain BFS path on the CURRENT zone model + live gate state from the player's tile to a target tile (NO monster-avoid overlay — phase-1 handoff: avoid-halos caused permanent route oscillation in the discarded experiment); converts the next path tile into held-direction input; detects stalls (tile unchanged for N ticks → recompute; M consecutive recomputes → report failure upward). |
| `botPush.js` | Executes a solver `push` action: walk to the push-origin tile (via botNav), face the box, hold the push direction until the box tile changes; verifies result against expectation; on mismatch → replan zone. The share-tile mechanics (walk onto pinned box, push from its own tile) come free — they're real engine behavior; botNav just needs to path THROUGH pinned-box tiles the same way the model's flood does. |
| `botCombat.js` | Survival layer: if a monster is within R tiles, preempt navigation — face it, `tryShoot()` (kite backward along the current path while cooling down) or `tryMelee()` when out of ammo and adjacent. Hold-and-shoot kiting; hero outruns melee monsters. Also watches HP/game-over UI and handles death→respawn (dismiss the game-over overlay, replan from wherever the engine respawns us). |
| `botDialogue.js` | Overlay janitor on the bot ticker: while `isDialogueOpen()`, advance via synthesized Space keydown (paced — see §7 watchability) until closed. Also dismisses other known overlays (first-launch popup, message panels) via their public close paths. |
| `botOverlay.js` | DOM overlay for the stream: current objective ("Zone 1009 — fetch the blue key"), key tally, finale countdown, recent-events ticker. Pure DOM, pure display, reads bot state only. |
| `botLog.js` | Structured event log (ring buffer + console) — every objective start/finish, replan, combat episode, death. The stream's debugging lifeline (read via Chrome CDP on the VPS). |

Tests: pure-logic parts (path-to-input conversion, stall detection
thresholds, overlay text formatting, snapshot/restore) get
`tests/*.test.js` node units. Full-bot behavior gets e2e (§8).

## 5. Runtime design

### 5.1 Mode stack (priority order, evaluated every bot tick)
1. **OverlayJanitor** — an overlay is open → dismiss it (sim is frozen
   meanwhile; nothing else can act anyway).
2. **Survive** — monster in range / HP low → botCombat owns input.
3. **ExecuteAction** — current plan step (walk-to / push / interact /
   trigger-cutscene / travel-hop) via botNav/botPush.
4. **Plan** — no current action → pull the next objective from the route
   (or replan if the queue is dirty).
5. **Idle/PostGame** — route exhausted → post-game loop (§6).

### 5.2 Planning against the live save
On boot (and on every replan trigger): `snapshotStorage()` →
`resetSimState()` is **NOT** called — `planRoute(world, { startZone:
state.zone.id, startTile: {x: player.tileX, y: player.tileY} })` runs
against a COPY (restore afterwards). The planner already skips
objectives whose flags say done, so a mid-progress save just yields the
remaining route. Replan triggers: zone change committed, objective
completed, action failure from botNav/botPush, death respawn.

### 5.3 Action granularity
The planner's solve actions are waypoint-level (`walkTo`, `push`) by
design (puzzleSolver.js:60-63 comment). The bot expands each into
tile-steps at execution time with botNav's BFS — recomputed cheaply per
step, resilient to perturbation (monster shoved us, dialogue moved us).

### 5.4 Travel hops
A `travel` step = walk to the teleporter tile (botNav) and let the
engine's `maybeTeleport` do the rest; the bot detects arrival by
watching `state.zone.id`, then verifies the arrival tile against
`resolveArrival`'s prediction (mismatch → log + replan, don't assert —
live engine wins).

### 5.5 Interactions
`talk` objective: path to a talk tile, face the NPC (push the facing
direction for one tick), `tryInteractForSlot(0)`, then OverlayJanitor
advances the dialogue. Repeat-interact until the planner's
`exhaustEntityDialogue` expectation (lines exhausted / entity removed)
is met in REAL storage — the live flags are the ground truth.

### 5.6 Keep solves off the frame loop
`solveToTiles` on a hard dungeon can take seconds-to-minutes (Defect B).
Run full solves in a **Web Worker** (the autoplay modules are
DOM-free, so they import cleanly in a worker; feed it the raw zone JSON
+ storage snapshot). The bot idles in place (or does watchable
busy-walking) while the worker thinks. Walk-only BFS (botNav) stays on
the main thread — it's sub-millisecond.

### 5.7 Failure containment
Every action carries a deadline (e.g. walk: 2 s per tile of path
length). Deadline blown → cancel, log, replan zone. Same zone failing
3× → push objective to the back of the queue and move on (the global
sweep retries later) — the stream must never wedge on one puzzle.

## 6. Post-game loop (stream content after the finale)

After `demon_lord_defeat` (and the route fully drained): endless cycle —
fast-travel-free walking tours of the dungeon zones, re-clearing
procedural monsters (they regenerate per entry: raw.monster_spawn),
re-running the maze. Deterministic, low-stakes, watchable. No save
reset. Concretely: loop over a curated zone list (dungeons + maze),
drainZone for monsters only, travel between them. Implemented as the
Idle/PostGame mode; details can evolve once the main route streams.

## 7. Watchability (it's a SHOW)

- **Pacing**: dialogue advance every ~1.2 s/line (not instantly), ~400 ms
  pause after arriving at an objective, brief idle after pickups. One
  `PACING` constants block in bot.js.
- **Overlay**: always-visible current objective + key tally (botOverlay).
- **No teleport spam**: the sweep's hop-by-hop travel already looks like
  walking; avoid replanning loops that ping-pong between zones (the
  fixed BFS sweep order from routePlanner keeps tours coherent).
- Camera/zoom: default; revisit only if the stream looks wrong.

## 8. Testing strategy

1. **Unit (node, fast)**: snapshot/restore; path→input conversion; stall
   detector; planner-against-mid-save (start from a synthetic
   half-complete storage and assert the route only contains remaining
   objectives — this also regression-covers Defect A's fix).
2. **E2E (CDP, tests/e2e/)**: `autoplayBot.test.mjs` — serve the repo,
   open `/play/?autoplay=1&zone=1001` headless, wait ≤60 s for: bot
   ticker alive, ≥1 pickup collected flag in storage, ≥1 dialogue
   exhausted, zone travel committed. Self-skips without Chrome, like the
   existing e2e suite.
3. **Long-run local soak**: `?autoplay=1` in a visible browser for an
   hour — eyeball pacing, look for wedges (botLog ring buffer).
4. **Prod smoke**: deploy, open prod URL with `?autoplay=1` in a normal
   browser (bot is opt-in via query param — safe to ship even
   half-done; zero effect on real players).
5. **Stream rehearsal**: VPS `tools/stream` pointed at prod with the bot
   param, watch the private stream for an evening before announcing.

`npm run test:unit` must stay ~fast: bot units are pure logic, no world
loads beyond what phase-1 tests already do.

## 9. Milestones (each = runnable game, green tests, one commit-train)

- **M0 — phase-1 closure**: fix Defect A (extraTalkables eviction) +
  regression test; route test green under `AUTOPLAY_WIP=1` even if slow;
  worldReport eyeballed. *(Defect B perf work can trail — see M2.)*
- **M1 — walk-only smoke bot (first prod-testable!)**: bootstrap hook,
  botWorld prefetch + dry-run plan, botNav, botDialogue, botLog, minimal
  overlay. Scope: talks, pickups, hints, zone travel on walkable routes;
  SKIPS push-puzzles and combat zones (objective queue filters). Ships
  behind `?autoplay=1`. E2E smoke test lands here.
- **M2 — puzzles**: botPush + worker-offloaded solves; solver perf
  (Defect B) lands here at the latest, then UNSKIP the WIP suites
  (delete the `AUTOPLAY_WIP` gates). All six keys collectible live.
- **M3 — combat & survival**: botCombat, death/respawn handling, ammo
  awareness. Bot survives dungeons unattended for hours.
- **M4 — finale + post-game**: cutscene trigger execution, credits
  dismissal (Defect A's live-mode twin), post-game loop. The bot now
  runs 24/7 without intervention.
- **M5 — showtime**: overlay polish, pacing tuning, stream rehearsal,
  `tools/stream` restarted with the bot URL. Announce.

Suggested commit granularity inside each milestone follows the file
list; every commit leaves `npm test` green per CLAUDE.md.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Model-vs-engine drift at runtime (a tile the model says walkable isn't) | botNav stall detection + replan; log mismatches via botLog; fix worldModel, never hack the bot around it (phase-1 rule). |
| Slow solve freezes the page | Web Worker (§5.6); deadline + skip (§5.7). |
| Live monsters shove the player mid-push, breaking a Sokoban line | botPush verifies each push result; zone replan resets pushables knowledge on re-entry (engine resets them too). |
| Dialogue overlay pauses sim at a bad moment (mid-step) | Engine handles it (steps commit atomically); OverlayJanitor runs on the bot's own ticker so dismissal never deadlocks. |
| Bundle pollution / prod 404s for bot modules | Computed dynamic import + post-build grep assertion in the deploy health gate (it already greps the bundle — extend it to assert bot files are absent from the bundle AND present as loose files). |
| Stream box performance (VPS CPU for solves) | Solves are bursty and rare after first completion; post-game loop needs no solver. Worst case: precompute the full route once and cache it in storage. |
| A wedge nobody notices at 4 AM | botLog + the stream deploy's existing health checks; consider a `/health`-style bot heartbeat later (out of scope here). |

## 11. Open questions (author input wanted, none block M0/M1)

1. Post-game loop content (§6): curated dungeon tour OK, or do you want
   specific zones/showpieces on repeat?
2. Pacing numbers (§7): gut-feel defaults proposed — tune on rehearsal?
3. Should the bot pause when a real player opens the page with
   `?autoplay=1` by accident? (Current answer: it only runs when the
   param is present, which no normal player uses — good enough.)
4. Defect B priority: ship M1 with slow-but-cached solves, or land
   solver perf first? (Plan assumes M1 first — visible progress beats
   perfect tests.)

---

*Phase-1 reference: docs/autoplay-phase1-handoff.md. Mechanics ground
truth: keys are pure McGuffins (gates are plate-driven only); player
self-weight counts at push time; puzzles are zone-local; share-tile box
mechanics are walk-through-able. Diagnostic logs for Defects A/B:
/tmp/route-diag*.log (this machine).*
