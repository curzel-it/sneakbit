# Tower Defense mode — concept

Status: **concept locked, unstarted** · Owner: Federico · Last updated: 2026-06-01

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

### Heroes behave like moving towers (the AI model — locked)

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

## MVP / v1 slice — what validates the concept

The smallest thing worth building, to answer "is this fun?" before investing in
depth:

- **One hand-built board** (a generated placeholder is fine for early testing).
- **Solo, offline.** No online, no split-screen.
- **Start with 1 hero.** Begin a run with a pool of gold; **buy additional heroes
  as you go**, each a **one-time fee** (no upgrade/refund economy yet).
- **3 hero archetypes** to start (e.g. melee / ranged / tank — full roster TBD).
  Heroes are post-anchored "moving towers" per the AI model above.
- **Barricades** placed in the build phase — start as variant **A** (no blocking)
  to prove the loop, then turn on variant **B** mazing (`flowField.js`).
- **Endless escalating waves** from the 4 edges; **local high score** only at
  first. (Global leaderboard + buy-panel polish come right after validation.)
- **Lose** on village-down *or* squad-wipe.

Everything past this line — upgrades/levels, per-account meta, deeper economy,
global leaderboard, online co-op, a roster of distinct hero mechanics, multiple
boards — is **post-validation** and intentionally deferred.

## New feature files (one feature, one file)

- `tdCore.js` — the village objective entity: HP, damage-on-reach, lose
  condition.
- `allyAI.js` — drives an un-possessed hero as a **post-anchored "moving tower"**:
  the `AT_POST → ENGAGING → RETURNING` state machine + a **per-hero rule-set**
  (engage trigger, leash radius, return condition) layered over the existing
  melee/kunai combat. The defining new behavior of this mode. A static turret is
  the leash-0 archetype, so this subsumes `tdTowers.js`.
- `heroSwitch.js` — possession: which slot the human input drives, camera-follow
  on switch, clean hand-off to/from `allyAI` for the vacated/taken slot. A squad
  roster UI (DOM) to see hero HP and pick who to jump to.
- `tdBarricades.js` — barricade/obstacle species + the build/erase interaction
  during the build phase (wraps the `mapEditor` placement primitives, gated to
  the build phase and to legal tiles).
- `tdWaves.js` — spawn director: 4-side edge portals, wave table, escalation.

(No separate `tdTowers.js`: a turret is the leash-0 hero archetype, handled by
`allyAI.js` + the hero behavior config.)
- `flowField.js` — BFS-to-core + anti-wall-off validation. **Variant B only.**
- `arcadeCurrency.js` — gold pool + a build/buy panel. **v1 scope is small:** a
  starting pool, **one-time hero-purchase fees**, and barricade costs. Upgrades /
  refunds / per-account spending are deferred. *No economy exists today*; this is
  net-new. UI lives in the DOM, never the canvas (per CLAUDE.md).
- `tdMode.js` *(or extend `gameMode.js`)* — the mode latch + run state machine
  (build / wave / clear / game-over).
- `tdLeaderboard.js` (client) + a `GET/POST /scores` endpoint in `server/` —
  global high-score board (JSON store, no deps). Local high score needs no server.
- Launch entry in `partyPanel.js` (single-player view) + an arena zone (clone
  the PvP arena `1301` as a TD board template).

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
- Manual: feel-check variant A first (is the loop fun before the flow-field
  exists?).

## Open questions

1. **Variant A vs jump straight to B?** Locked answer: prototype A to settle
   "is it fun", then build B. Revisit only if A already feels complete.
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
