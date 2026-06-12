# Autoplay AI — Phase 1 handoff (offline world analysis)

## Current status (updated)

Foundation is **executed, validated, and green**: world discovery, zone
model (agrees with the engine's walkability tile-for-tile), zone graph
(arrival resolution incl. y+1 and (0,0) back-resolution), and dialogue
exhaustion all pass. `npm run test:unit` = 990 pass / 0 fail / 14 skipped,
~3.3 s.

Corrections landed vs the original design (author-confirmed mechanics —
see also the `puzzle-mechanics-ground-truth` memory):
- **Keys are pure collectibles**, NOT a puzzle resource. Gates are
  controlled SOLELY by pressure plates. The engine's `gateUnlock.js`
  key-consumption path is not used by the level design — the solver has
  no key logic.
- **Player self-weight IS real** (puzzles.js updatePlates: player OR
  pushable). The earlier "no self-weight" correction was an
  over-correction — zone 1005 has 3 plate colors but only 2 boxes, so it
  is unsolvable without it. Self-weight is transient, so it's modelled
  per-EDGE, not as persistent state: it counts at push time (the engine
  validates a push while the player still stands on the behind tile) and
  for walking exactly one tile from a plate into an adjacent gate
  (canEnter checks gate._open at step-commit time). The region flood is
  therefore directed.
- **Share-tile box mechanics** (player.js canEnter/startStep): the player
  walks ONTO a pinned box and shares its tile; from there, pressing a
  direction the box can slide moves the box (push origin = the box tile
  itself, any direction), otherwise the player steps off — so pinned
  boxes are walk-through-able, and a box parked on a closed gate tile is
  a bridge through it. The solver models all of this.
- **Puzzles are strictly zone-local**: every gate color has a same-zone
  plate (data-invariant test in autoplayPuzzles.test.js). The solver's
  cross-zone global-plate-flag fallback was removed.
- **Explosive barrels** (explosives.js species 1038/1039/1073/1074) die
  to bullets/melee — the solver treats their tiles as smashable, i.e.
  passable (`model.destructibleTiles`; they stay in the rigid sets so
  blockedTiles stays engine-exact). 1005's green key sits behind one —
  it was never a search-strength problem.
- **Macro-state = (pushable layout, player region)**: keying the seen-set
  on layout alone (an earlier bug) silently pruned reachable branches.
  Search is greedy best-first steered by the closed boundary gate nearest
  the goal (goalField + gateStar in puzzleSolver.js); the seen-set dedup
  keeps it complete, so exhaustion still proves unreachability.

**Author-verified unreachable content:** zone 1012's kunai bundle (entity
11105518, species 7001, tile 8,2) sits in a pocket sealed by terrain +
non-destructible power-tower props. The author checked in-game
(2026-06-12): it is NOT reachable. Whitelisted in autoplayPuzzles.test.js
(UNREACHABLE_PICKUPS).

Everything below is the original pre-execution handoff, kept for the
design rationale and engine-semantics references.

---

**State: all phase-1 code is written but has NEVER BEEN EXECUTED.** The
session that wrote it lost shell access (harness outage) right after the
last file was saved. Your first job is `npm run test:unit` and iterate
until green. Expect real failures — the tests are data-driven against all
~80 zones and were designed to surface surprises on first contact.

The approved plan lives at
`~/.claude/plans/stateless-stargazing-starlight.md`. Read it first; this
doc covers what was built, what's verified, and what's guessed.

## Project context (one paragraph)

Goal: an autoplay AI that plays SneakBit 24/7 on the VPS for a live
stream. Completionist behavior (talk to every NPC, all loot/keys/puzzles,
reach the `demon_lord_defeat` finale in zone 1017, then endless post-game
dungeon re-runs — never reset the save). Phase 1 (this work) proves the
world is completable from `data/*.json` alone, in pure node. Phase 2 wires
an in-page bot (`/play/?autoplay=1`, computed dynamic import so esbuild
won't bundle it). Phase 3+ is Xvfb+Chrome+ffmpeg streaming (junkie-style;
see `~/dev/junkie`), real game audio via PulseAudio. Human-watchable
pacing with a DOM objective overlay. A previous autoplay experiment was
discarded uncommitted — do not search for it; this is a fresh start.

## Files written (new; no existing game code was touched)

js/autoplay/ (environment-agnostic: data in, plain values out — no fs/fetch/DOM)
- `worldIndex.js` — discoverWorld(loadRawZone, startId=1001): BFS over
  species-1019 teleporter destinations on RAW json (`destination.world`).
- `worldModel.js` — buildZoneModel(raw): wraps the real buildZone, then one
  entity pass precomputes tile-keyed Sets (terrain, rigid-static, locked/
  enterable teleporter tiles, gates, plates, pushables, pickups, hints,
  talkables + talk tiles, monsters, cutscenes w/ onEnd). blockedTiles(model,
  ctx) = memoized merged blocked set; gateIsOpen/gateLock implement the
  contact-open + plate + lock_override semantics. tileKey(x,y) = "x,y".
- `objectiveCatalog.js` — zoneObjectives (static) / liveObjectives
  (filtered through real shouldBeVisible / resolveEntityDialogue / flags).
- `zoneGraph.js` — buildZoneGraph, edgeTraversable (lock===None),
  resolveArrival (y+1 rule, (0,0) back-resolution, stepOutOf replica incl.
  bottom-right-corner quirk and teleporter-tile fallback), reachableZones.
- `puzzleSolver.js` — solveToTiles: ONE BFS over (player tile, pushable
  positions, spent-gate set). Gate state derived per probe from plate
  weights = pushables ∪ {player tile} (models block-on-plate AND the
  transient self-weight hop). Key spends relax closed colored Gates only —
  NEVER InverseGates (engine's tryUnlockGate would burn a key on one).
  solveParkOnPlate = park a pushable on a color plate then reach an exit
  (cross-zone gating). solveUntilPushOn is a near-duplicate of the main
  BFS (known wart — see cleanup).
- `dialogueSim.js` — exhaustEntityDialogue (talk-until-already-read, via
  real resolveEntityDialogue + handleReward; after_dialogue !== "Nothing"
  removes entity + writes item_collected), exhaustDialogues (fixed point).
- `routePlanner.js` — resetSimState + planRoute: forward sim on the REAL
  storage.js/inventory.js. Zone entry resets pushables + rewrites this
  zone's plate flags from occupancy (the cross-zone clobber). Drains
  objectives nearest-first (plate solutions before key spends), travels
  hop-by-hop (per-edge solves), key ledger, unreachable report.

tools/
- `autoplayWorld.mjs` — loadWorldFromDisk(): loads species.json +
  strings.en.json into the registries, returns sync loadRawZone(id).
- `worldReport.mjs` — CLI: zone graph, per-zone objective counts, route
  itinerary, key spends, unreachable list. `node tools/worldReport.mjs`.

tests/ (top-level only — the unit glob is `tests/*.test.js`, subdirs are NOT run)
- `autoplayWorld.test.js` — discovery set vs data dir (UNREACHABLE_ZONES
  whitelist), no missing destinations, model invariants, model-vs-engine
  blocked-set comparison on 250 LCG-sampled tiles/zone (gate tiles excluded
  by design — engine only opens gates on contact/tick).
- `autoplayZoneGraph.test.js` — 1010→1017 unlocked; world fully reachable
  over unlocked edges; Permanent edges non-traversable but never strand a
  zone; y+1 assertion; every traversable edge's arrival tile standable.
- `autoplayPuzzles.test.js` — every pickup + unlocked exit solvable from
  every entry tile of its zone (keysAvailable = one of each color); all six
  key pickups reachable; "Sokoban layer engages somewhere" smoke.
- `autoplayDialogue.test.js` — global fixed-point exhaustion (cutscenes
  assumed fired): every dialogues[].text reachable or whitelisted;
  comma-AND lines reached; one-shot reward exactly-once.
- `autoplayRoute.test.js` — planRoute: finaleReached, six keys, all zones
  visited, unreachable empty modulo whitelist, key balance never negative,
  travel chain connected, < 5000 ms wall-clock.

## Engine semantics these rest on (VERIFIED against code)

- Spawn: zone 1001, STARTING_SPAWN {x:68,y:23} (`js/constants.js:27`).
- Raw destinations use `.world`; buildZone's cloneEntity renames to
  `.zone` (`js/zone.js:209-216`). worldIndex reads raw (.world); everything
  downstream of buildZoneModel reads .zone.
- Teleport arrival: maybeTeleport bumps dest.y+1 (sprite-top → feet)
  EXCEPT (0,0) = back-resolution (`js/main.js:1087-1101`,
  `js/transitions.js:197-240`). stepOutOf order: [preferred-dir, down, up,
  left, right], positive offsets step from frame's bottom-right corner,
  fallback = the teleporter tile itself; no-teleporter fallback = map
  centre.
- isEntityBlocked (`js/zone.js:133-163`): enterable teleporter on tile →
  entity-unblocked; locked teleporter → blocks; rigid entities (and
  PushableObject regardless of is_rigid) block their entityHittableFrame
  feet rect while shouldBeVisible; open gates don't block. Teleporter
  locks are NEVER key-spendable.
- Gates: tryUnlockGate (`js/gateUnlock.js:34-58`) opens lock-None gates on
  contact; colored gates consume a key (inventory species 2000-2004 via
  locks.js mapping) and persist `lock_override.<entityId>` (int-coded).
  It does NOT discriminate Gate vs InverseGate → key-burn hazard.
  tickPuzzles (`js/puzzles.js`): Gate open iff pressure_plate_down_<color>,
  InverseGate iff NOT; flags are GLOBAL per color and rewritten every tick
  from the CURRENT zone's plate occupancy (player center or pushable rect
  overlap). Pushables reset to JSON starts on every zone build.
- Dialogues: first entry in `dialogues[]` where keyMatches(key,
  expected_value) wins (`js/dialogue.js:400-409`); close writes
  `dialogue.answer.<text>=1` + one-shot reward w/ bundle expansion
  (`:368-395`). No choice UI — chains advance as flags accumulate.
  keyMatches: "always" → true; unset===null matches expected 0; comma key
  = AND (all sub-keys equal expected); bare `inventory.amount.<sid>`
  expands across `player.<p>.` slots (`js/storage.js:68-99`). storage.js
  is node-safe (in-memory fallback; `_resetStorageForTesting()`).
- Interact reach (`js/interact.js:214-248`): facing ray steps 1..3; step
  s>1 only reached if step s-1 tile is statically non-walkable; hit = full
  FRAME overlap (not feet rect) + non-empty dialogues; Hint entities never
  interact (walk-over toasts; persistent ones dedupe under
  `hint.read.<localized joined lines>` — see pickups.js:279-291).
- Pickups auto-collect on tile overlap (Bundle/PickableObject/Bullet +
  Hints), persist `item_collected.<id>` unless ephemeral
  (`js/pickups.js:42-86`).
- after_dialogue ≠ "Nothing" removes the NPC after the FIRST close and
  persists item_collected (`js/afterDialogue.js`).
- Keys on the map (one each): 2002@1005, 2001@1007, 2003@1009, 2000@1013,
  2004@1016, 2005@1021. locks.js maps colors only to 2000-2004 — species
  2005 (key_white) opens NOTHING via gateUnlock.
- Monsters never block (is_rigid false), authored ones persist removal,
  procedural ones (raw.monster_spawn) regenerate deterministically.
- Finale: `demon_lord_defeat` cutscene in zone 1017 (navigation-triggered,
  not combat), sets the flag, spawns end-game credits via on_end.

## UNVERIFIED assumptions — check these when tests first run

1. **UNREACHABLE_ZONES** in autoplayWorld.test.js (1000, 1099, 1301,
   1401, 1501) came from a sub-agent's report, not from my own eyes. The
   test is self-correcting (compares against the data dir) — adjust the
   set to reality, but UNDERSTAND each entry before whitelisting it.
2. **Coin species id 2010** is hardcoded in routePlanner's collectPickup.
   Replace with `COIN_SPECIES_ID` imported from `js/coinDrops.js` (already
   exported there) — verify it's actually 2010.
3. **The "six keys" finale gate mechanism is unknown.** Lore says six keys
   open the way to the maze; there's no special lock type. Likely a
   dialogue or display_conditions gate on `inventory.amount.<key>` flags
   (possibly comma-AND) somewhere in 1010/1017. FIND IT in the data. If it
   tests key INVENTORY, then spending a colored key on a gate could make
   the finale unreachable — the route test's finale assertion will catch
   this; the fix would be a key-spend policy that protects the finale
   condition (or proves no colored gate needs a key at all because every
   one is plate-solvable).
4. **Talk-tile non-emptiness** (`every talkable has ≥1 talk tile`) may
   fail for decorative dialogue-bearing entities; investigate each before
   relaxing.
5. **Model-vs-engine blocked-set comparison** may surface hitbox edge
   cases (fractional feet rects, multi-tile buildings, conditional
   entities). The model must MATCH THE ENGINE — fix worldModel, don't
   widen the test's exclusions beyond gate tiles.
6. **Permanent one-way doors** (claimed: 1008→1009, 1020→1021,
   1012→11110814, 11718859→1013) — unverified; the graph test asserts the
   pattern generically.
7. **Cutscene schema** ({key, trigger_position:[x,y], on_end:[entities]})
   was reported by a sub-agent; verify against `js/cutscenes.js` and
   data/1017.json on first failure.
8. **dialogue.js import in node** is proven safe by tests/dialogue.test.js;
   but objectiveCatalog/dialogueSim/routePlanner import it transitively —
   if node import explodes (DOM touch at module top level somewhere),
   extract the pure parts rather than stubbing globals.

## Known warts to clean up once green (they were deliberate triage)

- `puzzleSolver.js`: solveUntilPushOn duplicates the BFS body of
  solveToTiles — unify into one parameterized search once tests pass.
- `routePlanner.js` drainZone solves EVERY objective per iteration to pick
  the nearest → O(objectives² · BFS) per zone. If the route test blows the
  5 s budget: first do one multi-goal plain-BFS distance map from the
  current tile per iteration and only invoke the full solver on the chosen
  candidate (and on failures).
- `routePlanner.js` has a leftover pointless ternary
  (`o.kind === "talk" ? o.tiles : o.tiles`).
- solveParkOnPlate is exported but the route planner never calls it yet —
  wire it in only if the route test shows objectives blocked on cross-zone
  plate colors (reason strings will say so); otherwise delete it.
- Comment density: prune per CLAUDE.md before committing.

## How to proceed (build order, commit per green step)

1. `node --test tests/autoplayWorld.test.js` — fix discovery/model.
2. `node --test tests/autoplayZoneGraph.test.js` — fix arrivals.
3. `node --test tests/autoplayPuzzles.test.js` — fix solver (tune
   maxStates only with evidence; default 30k).
4. `node --test tests/autoplayDialogue.test.js` — populate
   UNREACHABLE_DIALOGUE_WHITELIST one reviewed entry at a time (each gets
   a reason comment); a large unreachable list usually means a sim bug,
   not data holes — compare against `dialogue-gate-porting-gaps` memory.
5. `node --test tests/autoplayRoute.test.js` — the big one. Iterate.
6. `node tools/worldReport.mjs` — eyeball itinerary/key spends.
7. Full `npm run test:unit` (must stay ~fast; route test owns the 5 s
   budget), then `npm run test:e2e` once (nothing should be affected),
   commit + push. Suggested commits match steps: discovery / model+graph /
   solver / dialogue / route / report+cleanup.

Multiple Claude sessions may share this checkout — `git status` + `git
diff` before staging; stage only the autoplay files listed above.

## Phase-2 preview (so phase-1 API choices make sense)

The in-page bot will: prefetch all zone JSONs into a Map and call
discoverWorld(map.get.bind(map)); plan with the same modules against the
LIVE save's storage (no reset); execute actions through input seams
(`pushInputPress`/`clearInputHeld`, `tryInteractForSlot`, `tryShoot`/
`tryMelee`); combat preempts navigation (hold-and-shoot kiting — hero
outruns melee monsters); plain-BFS objective pathing with NO
monster-avoidance overlay (a previous experiment proved avoid-halos cause
permanent route oscillation). It needs a storage snapshot/restore facility
for dry-run planning — flagged, not built.
