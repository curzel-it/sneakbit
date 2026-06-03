# Tower Defense mode — concept

Status: **v1 MVP implemented** · Owner: Federico · Last updated: 2026-06-03

> **v1 shipped (2026-06-03).** The locked MVP slice below is built and reachable
> at `?mode=td` (or the party panel's **Tower Defense** button). Files:
> `towerDefense.js` (controller/state machine/score), `tdBoard.js` (goal/spawns
> + flow-field cache), `flowField.js` (BFS gradient + anti-wall-off, unit
> tested), `tdEnemies.js` (flow-field horde + kill/leak hooks), `tdWaves.js`
> (spawn director, unit tested), `allyAI.js` (leashless Ninja/Barbarian),
> `heroSwitch.js` (possession + cycle), `arcadeCurrency.js` (gold),
> `tdBarricades.js` (build-phase walls), `tdHud.js` (DOM panel + game-over),
> board `data/1401.json`. Mode-gated seams: `gameMode.js` (`GAME_MODE.td` +
> `isTowerDefenseMode()`), `sessionLoadouts.js` / `shooting.js` / `melee.js`.
> E2E: `tests/e2e/towerDefense.test.mjs`. Deferred (post-validation): the
> global leaderboard, online co-op, multi-board growth, hero upgrades.

> **Post-MVP feel tweaks (2026-06-03).** Two changes from the locked spec, made
> after the first review pass:
> - **The village has a lives pool, not instant-loss.** A single leak no longer
>   ends the run — the village absorbs **20 lives** (`VILLAGE_LIVES` in
>   `towerDefense.js`), each leak costing **tier-weighted** damage (a fused brute
>   breaching hurts more than a chokeberry) and **breaking the kill combo**. The
>   run ends on **lives → 0** *or* **squad-wipe**; the game-over screen names
>   which ("Village overrun" vs "Squad defeated"). This supersedes the "end of
>   the road, no HP structure" locked answer (pass-2 Q5).
> - **The recruit pool is four distinct heroes, not stubs.** Each squad slot is a
>   real archetype on its own P1–P4 sprite + weapon (`TD_HERO_LOADOUTS` /
>   `HERO_NAMES`): **Ninja** (kunai, fast ranged), **Barbarian** (sword, melee),
>   **Bombardier** (cannon, slow-heavy ranged), **Knight** (darkblade, melee).
>   `allyAI` keys charger-vs-shooter off the loadout, so the two recruits (slots
>   2/3) play differently from the starters rather than being kunai clones.

> **Read this first:** the authoritative, build-ready slice is
> [**v1 MVP — locked spec & implementation plan**](#v1-mvp--locked-spec--implementation-plan)
> below. It is grounded in the current codebase (file/line seams verified
> 2026-06-02) and **overrides** the older conceptual sections where they
> disagree — most notably it drops the post-anchored "moving towers" AI model in
> favour of **leashless hero archetypes** for v1. The conceptual sections that
> follow remain the longer-term vision and the *why*.

A new arcade-style game mode for SneakBit: a **2D grid action mazing squad
defense**. You assemble a **squad of heroes to defend a village**. Between waves
you place **barricades and obstacles to build a maze** for the monsters. During a
wave you **control one hero at a time and switch between them at will**; the
others fight on **AI**. Think **Dungeon of the Endless crossed with Fieldrunners'
mazing**, on a Zelda-style top-down grid.

This is the mode the engine was secretly built for: the tile grid and the
deliberate Gameboy-step movement — liabilities for a swarm-kiting survivors-like
— are *assets* here. Placement wants a grid; "defend a position" doesn't punish
slow stepping the way kiting a horde does. And the squad is nearly free: **a
roster of heroes with one human-controlled and the rest on AI is just SneakBit
co-op with the empty slots filled by an ally AI** — the 4-player slots, per-hero
HP / equipment / inventory, and camera-follow all already exist.

## The genre, pinned down

Not lane defense. The path is **not predrawn**. Enemies pathfind cardinally
(up/down/left/right) across an open grid from edge spawns toward a central
objective, and **the towers the player places are the walls that shape the
route**. Reference points: Desktop Tower Defense, Fieldrunners, Defense Grid —
the "open-field / maze TD" subgenre.

The twist that makes it SneakBit and not just another Fieldrunners clone: the
defense isn't (only) static turrets — it's a **squad of mobile heroes on the
board**, one possessed by the player and the rest on AI. Pure mazing TD has no
avatars; action TD (Dungeon Defenders, Orcs Must Die) is 3D / free-movement. A
**top-down 2D grid where you build the maze, possess heroes one at a time, and
fight in it** is a niche almost nobody occupies — and SneakBit already has every
half built.

The closest reference is **Dungeon of the Endless**: a small hero squad defends a
central objective, you possess one at a time while the rest fight on AI, and you
place defensive structures to shape the maze monsters path through. That's this
pitch almost beat for beat. (Bad North / They Are Billions for the macro
"village besieged from all sides" feel.)

## The two defensive layers

The defense is two layers, both already-present primitives:

- **The squad (heroes as "moving towers")** — up to 4 heroes. The human drives
  one (the *active* hero); `allyAI.js` drives the rest. Switch the active hero at
  will; the camera follows whoever you possess. This *is* the co-op roster with AI
  in the empty slots — reusing per-hero HP, equipment, inventory, and combat
  verbatim.
- **The maze (static)** — barricades / obstacles placed between waves that block
  tiles, reshaping how monsters route to the village. Reuses placement +
  `constructionIsObstacle`.

### Heroes behave like moving towers (the AI model — post-v1 vision)

> ⚠️ **Superseded for v1 (2026-06-02).** v1 ships **leashless archetypes with no
> home posts** — see [Ally AI (v1)](#ally-ai-v1--leashless-no-posts). The
> post-anchored state machine below is the *eventual* model, kept as the target
> the leashless v1 behaviour should grow into; do not build the post-placement UX
> for v1.

Each hero is **anchored to a home post** placed during the build phase (same UX
as barricades), and otherwise behaves like a parametric guard:

- A small state machine — **`AT_POST → ENGAGING → RETURNING`** — per hero.
- **Per-hero rule-sets** decide *when* it leaves post, *how far* it leashes, and
  *when* it walks back. Examples (illustrative; real rules defined incrementally
  as we build heroes):
  - *Long-range shooter* — holds its post almost the whole wave, firing at range;
    only repositions when nothing's left in range.
  - *Bruiser* — chases a target until it's defeated, then paths back to its post,
    re-engaging anything it meets on the way.
- The **possessed hero overrides the machine entirely**; release it and it
  resumes its rules from wherever it stands.

Key consequence: **a static turret is just the degenerate case — a hero with
leash radius 0.** So the squad layer and the "tower" layer are the *same system*
with different parameters. `tdTowers.js` therefore mostly **folds into the hero
behavior config** rather than being a separate feature; "turret" is a hero
archetype, not a different code path.

The heroes are the defense; the barricades are the maze.

### Squad: start with one, recruit more

A run **starts with a single hero**. With gold you **buy additional heroes** into
the squad as the waves escalate (one-time fee each, Dungeon-of-the-Endless
style). Squad size is capped at the **4 co-op slots** for now — going beyond 4
would break the co-op-slot reuse and need new infra, so it's out of v1 scope.
(Recruiting mid-run maps a little awkwardly onto online co-op, where each human
would *be* a hero — deferred; see Open questions.)

## Why it fits — primitives that already exist

Verified in the current codebase (2026-06-01):

| Need | Already there |
| --- | --- |
| Place barricades on the grid | `mapEditor.js` `placeSelection` / `addEntity` — click-to-place entities & constructions. Repurpose into "buy & place barricade". |
| Barricades block movement | `constructions.js` `constructionIsObstacle()` |
| Barricades block bullets | `constructions.js` `constructionStopsBullets()` |
| A squad of heroes | the multi-player slots (up to 4) — per-hero HP, equipment, inventory, combat all already exist (co-op infra) |
| Switch which hero is human-driven | reuse the active-player / input-routing the co-op + camera-follow paths already do |
| An optional tower that shoots | a stationary entity that throws kunai (species 7000) on a cooldown at the nearest enemy = `shooting.js` + `combat.js` with a fixed position |
| Enemy AI toward a goal | `mobs.js` `FindHero → pickClosestVisible → chaseDirections` — targeting is already factored as "pick a goal, walk toward it" |
| Difficulty curve | monster fusion (small → blueberry → strawberry → gooseberry) already escalates the horde for free |
| Co-op (genre home turf) | host-authoritative netcode already shipped |

The normally-hard parts of an action squad-defense — **grid placement**, a
**chasing horde**, and a **roster of controllable heroes** — are all already
primitives. The genuinely new code is the **ally AI**, **hero-switching**, the
**flow-field**, and **currency**.

## The one real engineering fork

What the horde targets, and whether barricades are walls, decides the whole feel:

### Variant A — Village-rush (cheap, ship first)
Retarget the existing chase AI: swap the goal from "closest player" to "the
village tile". Enemies beeline in; **barricades don't block** yet — the defense
is purely the squad. Reuses `chaseDirections` nearly as-is.

- Pro: an afternoon to a playable loop. Proves "is the squad + switching fun".
- Con: `chaseDirections` is *greedy Manhattan*, not real pathfinding — it snags
  on concave obstacles, which is exactly why barricades can't block in A.
- This is the squad layer alone: heroes hold the line, no maze yet.

### Variant B — Mazing (the deep version, the actual pitch)
Barricades block tiles; enemies route *around* them; the player sculpts a
kill-corridor the squad defends. This is where it stops being "hold the line" and
becomes "design the battlefield" — and where "non-lane 4-direction TD" sings.

- Needs **real pathfinding**. Clean answer: a **flow-field** — BFS out from the
  village once per barricade change; every enemy follows the arrow on its tile.
  Cheap at runtime, recompute only on placement.
- Needs an **anti-wall-off rule**: can't fully seal the village (standard
  Desktop-TD constraint). Reject a placement that leaves no path.
- New, but well-trodden, one-file feature (`flowField.js`).

**Plan: build A to prove the loop, then graft B's flow-field on once it's fun.**
A is throwaway-cheap and de-risks the whole idea; B is the destination.

> ⚠️ **Superseded (2026-06-02).** v1 goes **straight to variant B** (flow-field
> mazing from day one); the A-then-B staging is dropped. The A/B analysis above is
> kept for the *why* — see the [v1 MVP spec](#v1-mvp--locked-spec--implementation-plan)
> and Open question 1.

## The loop (shared by A and B)

1. **Build phase** — currency in hand, place/upgrade barricades (and optional
   turrets) on the grid, position the squad. Enemies frozen or not yet spawned.
2. **Wave phase** — enemies pour from the 4 edges toward the village. You possess
   one hero and fight; the rest defend on AI; you switch heroes as the front
   shifts. Fusion escalates pressure.
3. **Clear** — survive the wave → earn currency → back to build. Escalate.
4. **Lose** — **the run is endless**; it ends when *either* the village HP hits
   zero *or* the whole squad is wiped. Both are independent death conditions.

**Endless, escalating, leaderboard-driven.** There is no "win" — difficulty ramps
forever and you play for a **high score**. Scoring spine: tiered kills + combo
multiplier + waves survived. Two boards on the score:

- **Local** high score in `localStorage` (works offline, always present).
- **Global** leaderboard via the server — a small `node:http` `GET/POST /scores`
  with a JSON store (in character with the existing dependency-free `server/`).
  This pulls a *minimal* server component **into scope** (not deferred), but only
  a leaderboard endpoint — it is **not** netcode and is independent of online
  co-op.

## v1 MVP — locked spec & implementation plan

*Locked 2026-06-02. This is the build target. It supersedes the older "MVP / v1
slice" wording and the post-anchored AI model wherever they disagree.*

### Scope in one breath

Reach **`sneakbit.curzel.it?mode=td`** → drop into a **solo, offline** tower-defense
run on a **dedicated empty-grass board**. You command a **squad of heroes** — by
default **the Ninja** (ranged, throws kunai, holds position) and **the Barbarian**
(melee, charges the nearest enemy with a sword). You **possess one hero at a time**
and **cycle to the next** at will; the rest fight on **leashless AI**. Between
waves you **spend gold** to **place barricades** (which **block** enemies and force
them to **route around** — full mazing) and to **recruit more heroes** (up to 4).
Enemies spawn at the board edge and **path to a goal tile**; the run is **endless
and escalating**; it ends on **goal-reached** *or* **squad-wipe**. Score is a
**local high score**.

The four locked answers driving this slice:

1. **Mazing = variant B from day one.** Barricades block; enemies route around via
   a **flow-field**; an **anti-wall-off rule** forbids fully sealing the goal.
2. **Economy = gold + recruiting.** Gold per kill + a per-level stipend; spend on
   barricades, **recruiting heroes** (one-time fee, cap 4), and **revives**.
3. **Heroes = leashless archetypes, no posts.** No home-post placement UX. The
   Ninja roots where it stands and shoots; the Barbarian freely chases the nearest
   enemy. (This *overrides* the post-anchored "moving towers" locked model — that
   becomes the post-v1 target.)
4. **Board = a new dedicated TD zone**, authored as **empty grass** to start
   (spawn edge + goal tile + room to maze), camera-follow mandatory.

### Hard constraint: the existing game is untouched

`?mode=td` is a **new, additive latch**. No existing flow changes behaviour. The
normal game, co-op, PvP, creative, and online paths must all load and play
**byte-identically** when `?mode=td` is absent. Every TD branch is gated behind
`isTowerDefenseMode()`; TD-only files are only imported on that path.

### Mode entry & wiring (the seams, verified 2026-06-02)

- **URL latch.** Parse `?mode=td` once at boot, alongside the existing `?zone=` /
  `?creative=` parsing in `js/main.js` (zone resolution at `main.js:461-467`;
  `?creative` cached in `creativeMode.js`; `?host`/`?join` in `onlineMode.js`).
  Keep it a **cached one-shot read** like the others.
- **Game mode enum.** `js/gameMode.js:11` defines `GAME_MODE = {coop, creative,
  pvp}` and `setGameMode` (`gameMode.js:38`) **hard-rejects** anything else — add
  `td` to both the enum and the allow-list, plus an `isTowerDefenseMode()` getter
  mirroring `isPvp()` (`gameMode.js:47`).
- **Boot decision.** In the startup decision tree (`main.js:318-325`), when the TD
  latch is set: `setGameMode(GAME_MODE.td)`, load the **TD board** instead of the
  saved/STARTING zone, and run the **TD spawn** (squad + goal + wave director)
  instead of the normal player spawn.
- **Loop branch.** The tick already branches by mode at `main.js:405-413`
  (`tickPvpFrame` / `tickOnlineDeathmatch`). Add an `else if
  (isTowerDefenseMode()) tickTowerDefense(dt)` that drives the run state machine,
  ally AI, wave director, and lose-condition checks. World/mob/combat ticks
  (`tickMobs`, `tickCombat`, `tickShooting`, `tickMelee`) are already mode-agnostic
  and reused as-is.
- **Menu entry.** Add a **Tower Defense** button to the single-player view in
  `js/partyPanel.js` (alongside the offline co-op / offline PvP buttons,
  `partyPanel.js:288-719`). Its handler sets the TD latch and boots the run —
  same shape as `onOfflinePvpClick` (`partyPanel.js:711`) which calls
  `startPvpMatch(2)`. The `?mode=td` URL is the deep-link equivalent of this
  button.

### The board

- A **new zone**, e.g. `data/1401.json` (1301 is the PvP arena; 1401 is free —
  add a `TD_ZONE_ID` constant in `js/constants.js` next to `PVP_ARENA_ZONE_ID`,
  `constants.js:32`). Authored **empty grass** initially: a walkable field with
  **one spawn edge** and **one goal tile** marked, sized at roughly one screen and
  meant to **grow by level** later (camera-follow is mandatory; no fixed
  single-screen — Open question 7).
- Loaded through the **normal zone path** (`loadZone` → `buildZone`,
  `data.js:21` / `zone.js:28`) — no special loader. Like the arena (`main.js:466`,
  `main.js:1032`), the TD board is **transient**: never written to the save slot.
- **Goal tile + spawn edge** are TD metadata (a tagged entity or a coords field in
  the zone JSON), read by `tdCore.js` (goal) and `tdWaves.js` (spawn points).

### The squad & the two starter heroes

Heroes **are players** — reuse the co-op slot infra verbatim: `createPlayer({index})`
(`player.js:68`) already gives each slot 0-3 a **distinct hero sprite column**
(`heroFrameForIndex`, `player.js:33`), and HP / equipment / inventory are already
per-index (`playerHealth.js:45`, `equipment.js:19`, `inventory.js:16`).

| Hero | Slot | Weapons (existing species ids) | v1 AI behaviour |
| --- | --- | --- | --- |
| **Ninja** | 0 | ranged = **kunai launcher 1160** (already the per-player default, `equipment.js:15`), firing **kunai bullet 7000** | **Roots** roughly where it stands; throws kunai at the nearest enemy in range; only repositions if nothing is in range. |
| **Barbarian** | 1 | melee = **sword 1159** (default melee is *none*, `equipment.js:4` — must be equipped explicitly on spawn) | **Charges** the nearest enemy and melee-swings; re-targets the next nearest on a kill. Leashless. |

Squad starts with **both** heroes present (not the doc's older "start with 1").
Slots 2-3 are **recruited with gold** (one-time fee), capped at the **4 co-op
slots**. Archetypes beyond Ninja/Barbarian are authored incrementally (Open
question 3); recruiting infra ships in v1 even if the recruit pool is initially
just a third/fourth instance or a stub archetype.

### Hero switching (possession)

- **Cycle-to-next only** in v1 (no roster-click, no per-hero hotkeys — locked
  2026-06-02 pass-2 Q7). One bound action advances the **active slot** to the next
  living hero, wrapping around.
- The seam is clean and already present: input is **per-slot** —
  `pollInput(slot)` (`input.js:26-84`). v1 routes **real input to the active
  slot** and **AI input to the others**; switching = changing `state.activeHeroSlot`.
- **Camera** already supports a single follow target (`camera.js:26-44`,
  `main.js:953`) — on switch, point it at the newly active hero (a quick ease is
  nice-to-have, not required).
- On switch, the vacated hero **hands back to `allyAI`** from wherever it stands;
  the taken hero **drops its AI** mid-step cleanly.

### Ally AI (v1) — leashless, no posts

New file `js/allyAI.js`. For every **non-active, living** hero each frame, it
synthesises an input in the **same `{events, held}` shape** `pollInput` returns,
so `updatePlayer` (`main.js:364`) consumes it unchanged. **No home posts, no
`AT_POST/RETURNING` states** — just two parametric behaviours:

- **Ninja (rooted shooter).** Find nearest enemy (reuse the `pickClosestVisible`
  pattern, `mobs.js:153`, inverted to scan enemies from a hero). If one is within
  fire range, **face it and throw kunai** on the existing shoot cooldown
  (`shooting.js:194`); otherwise idle. Only steps if it must to get *any* target
  in range — it does **not** roam.
- **Barbarian (charger).** Find nearest enemy; **walk toward it** (greedy cardinal
  step, the same axis-dominant logic as `chaseDirections`, `mobs.js:170`) and
  **melee-swing** when adjacent (`melee.js:186`). On a kill, re-target the next
  nearest.

> **Known leashless risk (tuning, not a blocker):** a fully leashless Barbarian
> can over-extend toward spawn and leave the goal exposed. v1 mitigation options
> (pick during feel-tuning, not now): a soft "don't chase past N tiles from the
> goal" clamp, or simply rely on the player possessing it to reposition. Logged as
> Open question 10.

### Enemies & waves

- **Reuse existing mobs + the fusion escalation curve** (locked pass-2 Q6) — no
  TD-specific enemy stats yet. Fusion (small 4003 → 4005 → 4006 → 4007,
  `monsters.js:41`) provides the difficulty ramp for free.
- **New file `js/tdWaves.js`** — the spawn director: spawn points on the board's
  **spawn edge**, a wave table, and per-level escalation (count + fusion tier).
  Spawn by pushing mob entities into `zone.entities` (the minion spawner already
  does exactly this with a negative-id pool, `minions.js:20`).
- **Critical retarget — enemies must seek the GOAL, not the player.** Existing mob
  AI only chases a player **within a 6-tile Manhattan vision** and **wanders
  otherwise** (`mobs.js:17` `VISION_TILES=6`, `pickClosestVisible` at
  `mobs.js:153`). TD enemies must march to the **goal tile** regardless of hero
  proximity. So TD mobs use a **TD goal target** (the flow-field below), **not**
  the player-chase path. Heroes/AI kill them en route; enemies don't path to
  heroes. This is the single biggest behavioural change vs. the base game.
- **Visibility-gating caveat.** Off-screen entities are **frozen** by
  `updateVisibleEntities` (`zoneVisibility.js:23`) — AI, fusion, and combat only
  tick for visible entities. On a board larger than one screen with camera-follow,
  enemies marching off-camera would **freeze**. v1 must either keep the active
  board within the viewport envelope or add enemies/goal to the always-visible set
  (`ALWAYS_VISIBLE_TYPES`) — decide when the board first exceeds one screen.

### Mazing & the flow-field (variant B)

- **New file `js/flowField.js`.** A **BFS out from the goal tile** over the
  walkable grid, producing a per-tile "next step toward goal" gradient. Build on
  the existing BFS (`pathfinding.js:27` `findPathToNearest`, 4-neighbour, uses
  `isWalkable`, ignores entities) — generalise it to a full field rather than a
  single path.
- Each TD enemy reads the **arrow on its current tile** and steps that way (slots
  into the tile-stepping in `mobs.js`).
- **Barricades block** because `canEnter`/`isWalkable` already respect
  construction obstacles (`constructions.js:164` `constructionIsObstacle`); a
  barricade is just a placed obstacle construction. Recompute the field **only on
  placement** (cheap; runtime is a table read).
- **Anti-wall-off rule.** Reject any barricade placement that leaves **no path**
  from spawn to goal (standard Desktop-TD constraint). The BFS itself answers
  this: if the goal can't reach a spawn tile, the placement is illegal.
- **Pure & unit-testable** (BFS correctness, gradient direction, anti-wall-off
  rejection, recompute-on-placement) — ideal for `tests/*.test.js`.

### Build phase & barricades

- **New file `js/tdBarricades.js`** — gates the existing placement primitives to
  the **build phase** and to **legal tiles**. Reuse `mapEditor.js` placement
  (`placeSelection` `mapEditor.js:400`, `addEntity` `mapEditor.js:466`,
  `canvasEventToTile` `mapEditor.js:309`) but wrapped: a barricade is bought with
  gold, placed only between waves, and rejected by the anti-wall-off check.
- **Posts are NOT placed** in v1 (leashless heroes). The build phase places
  **barricades only**; hero positioning is by walking/possession.

### Economy

- **New file `js/arcadeCurrency.js`** — a gold pool + a **DOM** build/buy panel
  (never canvas, per CLAUDE.md). *No currency exists in the codebase today; this is
  net-new.*
- **Income:** gold **per kill** + a **per-level starting stipend** (locked pass-2
  Q3).
- **Spend:** barricade cost; **recruit hero** one-time fee (cap 4); **revive** a
  downed hero — **build-phase price**, with a **~5× mid-wave** price (locked
  pass-2 Q1/Q2). No upgrades, refunds, or per-account spend in v1.

### Run state machine, lose & score

- **New file `js/tdMode.js`** (or extend `gameMode.js`) — the run state machine:
  **build → wave → clear → game-over**, with a **skippable ~30 s countdown**
  between waves (auto-starts, or "Ready" to skip; placement is build-phase only —
  locked pass-2 Q2).
- **New file `js/tdCore.js`** — the **goal tile**: detect enemy-reaches-goal and
  trigger the lose condition. The village is "just the end of the road," no HP
  structure for now (locked pass-2 Q5).
- **Lose** on **goal-reached** *or* **squad-wipe** (revive keeps a hero in play;
  squad-wipe with no affordable revive ends the run).
- **Score:** tiered kills + combo multiplier + waves survived, persisted as a
  **local high score in `localStorage`**. Global leaderboard (`GET/POST /scores`)
  is **deferred to right after validation**, not in this slice.

### What is explicitly NOT in this slice

Online co-op, split-screen, global leaderboard, hero upgrades/levels, per-account
meta, deeper economy (refunds/upgrades), a multi-archetype roster beyond
Ninja+Barbarian, multiple boards, and any new movement model. All deferred to
post-validation.

### Suggested build order (each step leaves the game runnable + tests green)

1. **Mode latch + empty board.** `?mode=td` + `GAME_MODE.td` + the grass zone,
   loading into an idle board. Existing game untouched (regression-check the
   normal boot).
2. **Squad spawn + switching.** Spawn Ninja (slot 0) + Barbarian (slot 1); wire
   `activeHeroSlot` + cycle-to-next + camera follow. Other slot stands idle.
3. **Ally AI.** `allyAI.js` leashless behaviours for the non-active hero.
4. **Waves to goal + flow-field.** `flowField.js` (unit-tested) + `tdWaves.js`
   spawning enemies that march the field to the goal; `tdCore.js` lose-on-reach.
5. **Build phase + barricades + anti-wall-off.** `tdBarricades.js` placement
   gated to build phase, recompute field, reject sealing.
6. **Economy.** `arcadeCurrency.js` gold/recruit/revive + DOM panel.
7. **Run loop + score.** `tdMode.js` state machine, countdown, squad-wipe,
   local high score.

## New feature files (one feature, one file)

*v1 set, reconciled with the locked spec above. `tdTowers.js` and
`tdLeaderboard.js` are out of v1; the post-anchored bits of `allyAI`/`heroSwitch`
are deferred.*

- `tdCore.js` — the **goal tile**: detect enemy-reaches-goal → lose condition. No
  village HP structure in v1 ("end of the road"); locked pass-2 Q5.
- `allyAI.js` — drives an un-possessed hero with **leashless v1 behaviours**
  (rooted shooter / free charger), synthesising the `pollInput` `{events, held}`
  shape so `updatePlayer` consumes it unchanged. **No posts / no
  `AT_POST→RETURNING` in v1** — the post-anchored "moving tower" model is the
  post-v1 target. The defining new behaviour of this mode.
- `heroSwitch.js` — possession: which slot human input drives (`activeHeroSlot`),
  **cycle-to-next only** in v1, camera-follow on switch, clean hand-off to/from
  `allyAI`. (Roster-click UI / hotkeys deferred.)
- `tdBarricades.js` — barricade obstacle species + the build/erase interaction in
  the build phase (wraps `mapEditor` placement, gated to build phase + legal tiles
  + the anti-wall-off check).
- `tdWaves.js` — spawn director: spawn points on the board's **spawn edge** (v1 is
  directional/corridor, not 4-side; Open question 9), wave table, escalation via
  the existing fusion curve.

(No separate `tdTowers.js` in any version: a turret is the leash-0 hero archetype.)
- `flowField.js` — BFS-out-from-goal gradient + anti-wall-off validation.
  **In v1 scope** (variant B is locked from day one). Generalises
  `pathfinding.js`'s BFS.
- `arcadeCurrency.js` — gold pool + a DOM build/buy panel. **v1 scope:** per-kill
  income + per-level stipend; spend on **barricades, recruiting heroes (one-time
  fee, cap 4), and revives (~5× mid-wave)**. Upgrades / refunds / per-account
  spend deferred. *No economy exists today*; net-new. UI in the DOM, never canvas.
- `tdMode.js` *(or extend `gameMode.js`)* — the `GAME_MODE.td` latch + run state
  machine (build / wave / clear / game-over) + the skippable ~30 s countdown +
  local high score.
- Mode entry: parse **`?mode=td`** at boot (next to `?zone=`/`?creative=` in
  `main.js`) **and** a **Tower Defense** launch button in `partyPanel.js`
  (single-player view). Board = a **new dedicated empty-grass zone** (`TD_ZONE_ID`,
  e.g. 1401), *not* a clone of the PvP arena.
- *(Deferred)* `tdLeaderboard.js` (client) + `GET/POST /scores` in `server/` —
  global board, lands right after validation. Local high score needs no server.

## The four quadrants

The mode spans all four from day one *in principle*, in this build order:

| Quadrant | Notes |
| --- | --- |
| Offline · single | **The v1 target.** One human + an AI squad defending the village solo, endless escalating waves, local high score. The squad is *always* present — solo just means more slots are AI. |
| Offline · multi | Local split-screen co-op — two-plus humans, each likely controlling a hero; remaining slots stay on AI. The "recruit more heroes" economy maps awkwardly here — revisit. |
| Online · single | Global leaderboard (`GET/POST /scores`) is a *small* server add and **in scope** post-validation — but it's just a score endpoint, not netcode. |
| Online · multi | Co-op over the existing host-authoritative netcode — **each player controls a hero** (working assumption). Host owns the wave director, flow-field, ally AI, and authoritative village HP. Highest netcode cost (state sync + e2e); do it *after* the offline loop is proven. |

## Non-goals (for v1)

- **Not lane defense.** No predrawn paths, ever — the maze emerges from
  placement.
- **No meta-progression / persistent unlocks** in v1. Hero upgrades/levels *are*
  wanted (per-run vs per-account TBD) but come **after** the loop is validated.
- **No online co-op in v1.** Prove the offline loop first; online co-op is a later
  phase on the existing netcode, gated behind its own e2e coverage. (The *global
  leaderboard* endpoint is separate and small — it can land early.)
- **No deep economy in v1.** Starting gold + one-time hero/barricade fees only;
  upgrades, refunds, and per-account spending are deferred.
- **No new movement model.** Reuse tile-locked stepping as-is — it's an asset
  here, not something to "fix".

## Testing posture

- **Unit (`tests/`, pure node):** `flowField.js` is a pure function over a grid —
  ideal unit test (BFS correctness, anti-wall-off rejection, recompute on
  placement). Wave-table escalation and currency math are also pure and
  DOM-free.
- **E2E (`tests/e2e/*.mjs`):** once online co-op lands, assert host-authoritative
  core HP + spawn sync across host/guest. Reuse the CDP harness.
- Manual: feel-check the loop in the build order above — squad + switching first
  (step 2), then waves-to-goal, then mazing. Answer "is the squad + switching
  fun?" before tuning the economy.

## Open questions

1. **Variant A vs jump straight to B?** *Re-resolved (2026-06-02):* **go
   straight to B** — barricades block and enemies route around (flow-field) from
   day one. Variant A (no blocking) is dropped as a stepping stone. (Earlier plan
   was A-then-B; superseded.)
2. **Hero death mid-wave.** *Resolved (2026-06-02):* **revive for gold.** Reviving
   *mid-wave* costs ~**5×** the build-phase revive price. (Squad-wipe = run over is
   still the lose trigger regardless.)
3. **Per-hero rule-sets & roster.** Framework locked (post + `AT_POST → ENGAGING →
   RETURNING` + leash). Archetypes will include melee / ranged / tank / wizard /
   … but the exact roster and each rule-set's numbers are defined incrementally
   as heroes are built.
4. **Per-run vs per-account progression.** Upgrades/levels are wanted; whether
   they reset each run (roguelite) or persist across runs (meta) is TBD,
   post-validation.
5. **Re-posting mid-wave.** *Resolved (2026-06-02):* **no** — posts are frozen
   once the wave starts; re-assignment only in the build phase.
6. **Online co-op shape.** Working assumption: each human controls a hero. How
   does that square with the solo "recruit heroes with gold" economy and the
   4-slot cap? Revisit when online is on the table.
7. **Board source** — hand-built is the answer; a simple generator is only for
   early testing. *Resolved (2026-06-02):* **camera-follow is mandatory** (a
   fixed single-screen view is off the table — it over-complicates the squad), and
   the **board grows by level**, starting at roughly one screen and expanding as
   waves escalate. Exact board count still open.
8. **Session length / audience / Steam ambition** — deliberately left open (Q10);
   revisit once the loop is proven.
9. **Objective shape vs. "4 edges → center."** *Resolved (2026-06-02):*
   **intentional — v1 is directional/corridor**, not all-sides-toward-center. The
   village is **"the end of the road"** (a goal tile at the path's end); spawns feed
   *toward* that end across a camera-followed, growing board. The original
   open-field "4 edges → central objective" framing is **not** the v1 shape — it
   stays on the table only as a possible later evolution. `tdWaves` spawn placement
   and `flowField` (variant B) should target the corridor model.
10. **AI model: leashless vs post-anchored.** *Resolved for v1 (2026-06-02):*
    **leashless, no posts** — Ninja roots & shoots, Barbarian freely charges. The
    post-anchored `AT_POST→ENGAGING→RETURNING` "moving towers" model (previously
    marked locked) becomes the **post-v1** target, not the v1 build.
11. **Leashless Barbarian over-extension.** *Open (2026-06-02):* a fully leashless
    charger can run toward spawn and leave the goal exposed. Mitigation (decide
    during feel-tuning, not before): a soft "don't chase past N tiles from the
    goal" clamp, or rely on player possession to reposition. This is the v1
    leashless trade-off vs. the deferred post-anchored leash model.

## Decision log

- **2026-06-01:** Locked the concept as *2D grid action mazing TD* (player walks
  the maze and fights, Fieldrunners × top-down fighter) over the other arcade
  candidates (Hades rooms, survivors-like / 20MTD, Brotato, Risk of Rain). Chosen
  because the grid + deliberate movement are *assets* here, and placement + chase
  AI already exist as primitives. Survivors-like was set aside: free-form
  swarm-kiting fights the tile-locked movement.
- **2026-06-01:** Refined into *squad defense*: defend a **village** with a
  **squad of heroes** — possess one at a time, switch at will, the rest fight on
  **AI** — plus **barricades** to build the maze. Key realization: the squad is
  the existing co-op roster with AI in the empty slots, so single- and
  multi-player are the *same system* (humans take some slots, AI the rest). New
  work narrows to `allyAI.js`, `heroSwitch.js`, `flowField.js`, `arcadeCurrency.js`.
  Static turrets demoted to optional. Reference anchor: **Dungeon of the Endless**.
- **2026-06-01:** Locked the **ally AI model**: heroes are **"moving towers"** —
  anchored to a home post placed during build, running an `AT_POST → ENGAGING →
  RETURNING` state machine with **per-hero rule-sets** (engage trigger, leash
  radius, return condition) defined incrementally. A static turret is the leash-0
  archetype, so `tdTowers.js` folds into `allyAI.js` + hero config rather than
  being its own feature. The possessed hero overrides the machine entirely.
- **2026-06-01:** Scoping pass (10 questions) locked: **(1)** endless, escalating,
  high-score-driven — local **and** global leaderboard (a small `GET/POST /scores`
  pulls a minimal, netcode-free server bit into scope). **(2)** MVP = 1 board, ~3
  archetypes, barricades, endless waves, solo/offline, local score. **(3)** economy
  starts as a gold pool + **one-time hero/barricade fees**; upgrades deferred.
  **(4)** start with **1 hero**, recruit more with gold, capped at the 4 co-op
  slots. **(5)** lose on **village-down OR squad-wipe** (either kills the run).
  **(6)** upgrades/levels wanted but per-run-vs-per-account is post-validation.
  **(7)** roster (melee/ranged/tank/wizard/…) defined incrementally. **(8)** boards
  hand-built, a generator only for early testing. **(9)** online co-op = each human
  controls a hero (working assumption, deferred). **(10)** session length / Steam
  ambition left open.
- **2026-06-02:** Second scoping pass (10 implementation-blocking questions) locked:
  **(1)** hero death mid-wave → **revive for gold**, mid-wave revive ~**5×** the
  build-phase price; squad-wipe is still the run-ending wipe. **(2)** wave cadence →
  a **skippable ~30 s countdown** between waves (auto-starts, or click **Ready** to
  skip); placement is **build-phase only**. **(3)** currency → **gold per kill +
  a per-level starting stipend**. **(4)** viewport → **camera-follow is mandatory**
  (no fixed single-screen); the **board grows by level**, starting ~one screen.
  **(5)** the village is **just "the end of the road"** (a goal tile), no structure
  for now → simplifies `tdCore`. **(6)** enemies → **reuse** existing mobs + the
  fusion escalation curve, no TD-specific stats yet. **(7)** hero switching →
  **cycle-to-next** only (no roster-click / hotkeys in v1). **(8)** re-posting
  mid-wave → **no**, posts frozen once a wave starts. **(9)** static turrets →
  **none**; **heroes are the only shooters**, so no separate turret archetype in
  v1. **(10)** per-hero rule-sets → **authored one hero at a time**, later.
  Net consequence (confirmed intentional, Open question 9): v1 feel shifts from the
  original "4 edges → central objective" to **directional/corridor** — spawns feed
  toward the end-of-road goal across a camera-followed, growing board. The
  open-field central-objective shape is demoted to a possible later evolution, not
  the v1 target.
- **2026-06-02:** Third pass — pinned the **build-ready v1 slice** against the live
  codebase (file/line seams verified) and the requested entry point
  **`sneakbit.curzel.it?mode=td`**. Four choices locked: **(a)** mazing =
  **variant B from day one** (barricades block, enemies route around via
  `flowField`; variant A dropped as a stepping stone, Open question 1
  re-resolved). **(b)** economy = **gold + recruiting** (per-kill + stipend income;
  spend on barricades, recruit-hero one-time fee cap 4, revives ~5× mid-wave).
  **(c)** AI = **leashless archetypes, no posts** — Ninja roots & throws kunai,
  Barbarian freely charges with sword; this **overrides** the previously-"locked"
  post-anchored "moving towers" model, which is now the **post-v1** target (Open
  question 10/11). **(d)** board = a **new dedicated empty-grass zone**
  (`TD_ZONE_ID`, e.g. 1401), *not* a clone of the PvP arena. Squad **starts with
  both** the Ninja (slot 0, kunai launcher 1160 / bullet 7000 — already the default
  ranged) and the Barbarian (slot 1, sword 1159 — must be equipped, default melee
  is none), recruiting the 3rd/4th. Hard constraint re-affirmed: **the existing
  game is untouched** — `?mode=td` is an additive latch (`GAME_MODE.td` added to
  the `gameMode.js` enum + allow-list), every TD branch gated behind
  `isTowerDefenseMode()`. **Big behavioural change flagged:** TD enemies must
  target the **goal tile via the flow-field**, not chase players — the base mob AI
  only chases within a 6-tile vision (`mobs.js:17`) and wanders otherwise.
  **Caveat flagged:** off-screen entities freeze under visibility gating
  (`zoneVisibility.js`), which must be handled once the board exceeds one screen.
