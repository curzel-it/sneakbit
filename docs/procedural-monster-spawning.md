# Procedural monster spawning

Status: **implemented** (first zone: 1002) · Owner: Federico · Last updated: 2026-06-07

> First slice of a broader "stop hand-authoring filler content" effort. This spec
> covers **monsters only**. Ammo and barrels are deliberately out of scope — they
> have different rules (ammo scales off threat, barrels fill enclosed space) and
> get their own specs once this one is proven. See [Future companions](#future-companions).

## Why

Today every monster is a hand-placed entity in a zone's `entities[]` array — an
explicit `species_id` at an explicit `frame: {x,y,w,h}` in `data/<zoneId>.json`.
Placing encounters by hand is tedious and the result is static: the same berries
in the same spots forever.

Monsters are the easiest of the three to proceduralise because of a mechanic the
game already has: **fusion**. Per `js/monsters.js`, when two monsters overlap the
higher-id one absorbs the other and tiers up:

```
chokeberry (4003) ┐
                  ├→ blueberry (4005) → strawberry (4006) → gooseberry (4007)
blackberry (4004) ┘
```

So we don't need to place a *variety* of monsters or generate stat variants. We
scatter the **two base tiers** and let fusion manufacture the escalation:

- **density is the difficulty knob** — pack more base monsters into a zone and
  more of them collide and tier up into blueberries/strawberries on their own.
- placement only ever emits **blackberry (4004)** as the staple, with an
  **occasional chokeberry (4003)** for low-end variety. Everything above tier-1
  is emergent, never placed.

## Scope (this slice)

- Generate **blackberry (4004)** by a per-zone density, with a small chance per
  spawn of substituting **chokeberry (4003)**.
- **No persistence.** Generated monsters are ephemeral and regenerate on every
  zone entry. This matches current behaviour — kills already don't persist;
  re-entering a zone brings its monsters back.
- **Deterministic across co-op peers** via a seeded PRNG keyed off the zone id
  (see [Determinism](#determinism)). No network cost, no snapshot bloat.
- **Additive.** Hand-authored monsters (scripted encounters, the grapevine boss
  4008) stay in `data/*.json` and are untouched. Generation *appends*.

Explicitly **not** in this slice: ammo, barrels, stat-rolled variants, per-visit
layout variation, biome-weighted species pools.

## The idea

A post-pass on `buildZone` that, for zones opted in via a JSON field, scatters
base monsters across walkable tiles and appends them to `zone.entities`.

### Opt-in zone data

A new optional field on the zone JSON, absent ⇒ no generation (fully backward
compatible — every existing zone keeps its hand-placed monsters and nothing else
changes):

```json
{
  "id": 1042,
  "world_type": "Exterior",
  "monster_spawn": {
    "density": 0.015,          // fraction of walkable tiles that get a monster
    "chokeberry_chance": 0.2   // P(spawn is 4003 instead of 4004); default 0
  },
  "entities": [ ... ]
}
```

`density` is expressed as a fraction of *eligible* (walkable, non-excluded) tiles
rather than an absolute count, so it scales sensibly with zone size. A 60×40 zone
that's ~60% walkable at `density: 0.015` yields ~20 monsters.

### Placement algorithm

Run inside `populateZone(zone, raw)` (new file, see [Seams](#seams)), after the
authored entities are cloned in:

1. **Build the eligible-tile set.** Walk the `rows × cols` grid; a tile is
   eligible iff `isWalkable(zone, x, y)` (already exported from `js/zone.js` —
   reads the precomputed `collision` mask) **and** it passes the exclusions below.
2. **Exclusions** (hard — never spawn on these):
   - within `SPAWN_CLEAR_RADIUS` tiles of the **player's entry point** into the
     zone, so you don't materialise inside a fresh mob on arrival;
   - within `TELEPORTER_CLEAR_RADIUS` tiles of any **teleporter / door tile**
     (reuse the enterable-teleporter tiles already enumerated for the autoplay
     pathfinding fix), so doorways stay clean;
   - any tile already covered by an **authored entity's footprint** (don't stack a
     generated berry on a placed NPC, chest, or building).
3. **Target count** = `round(density × eligibleTiles.length)`.
4. **Sample with spacing.** Shuffle the eligible list with the seeded PRNG
   (Fisher–Yates, same shape as the existing shuffle in `js/mobs.js` but sourced),
   then greedily accept tiles that are ≥ `MIN_MONSTER_SPACING` from every
   already-accepted tile until we hit the target count or run out. The spacing
   pass is a cheap Poisson-disk approximation — it stops the scatter from clumping
   into one corner and gives fusion room to *develop* rather than fusing
   everything on frame one.
5. **Emit entities.** For each accepted tile, roll `chokeberry_chance` to pick
   4003 vs 4004 and append a monster entity (shape below).

### Generated entity shape

Mirror the ephemeral-coin pattern in `js/coinDrops.js` (`makeCoin`): a minimal
entity whose runtime fields (`_hp`, `_ai`) are written lazily by the combat/AI
ticks, so we only need identity + position + species.

```js
function makeMonster(id, speciesId, tileX, tileY) {
  const sp = getSpecies(speciesId);
  return {
    id,                       // negative, distinct band — see below
    species_id: speciesId,    // 4003 or 4004
    frame: { x: tileX, y: tileY, w: sp.width || 1, h: sp.height || 2 },
    direction: "Down",
    _generated: true,         // marks ephemeral / never-persisted, never snapshot-authoritative seed
  };
}
```

> **ID banding.** Authored entities use large hand-assigned ids; the editor
> decrements from a high value; coins live at `id ≤ -2_000_000`. Generated
> monsters take their **own negative band** (e.g. starting at `-3_000_000` and
> decrementing) so an id never collides with an authored entity, a coin, or a
> spawned bullet. Do **not** set `_spawned` — `isEntityBlocked` skips
> `_spawned` entities (that flag means "bullet"), and a monster must remain a
> normal hittable, fuseable entity.

### Determinism

This is the one hard constraint. The game runs co-op/PvP in lockstep; if host and
guest generate *different* monster layouts the worlds diverge. So:

- A small **`js/rng.js`** — a seeded PRNG (xorshift32 / mulberry32, ~10 lines),
  named export, no deps. **Generation must never call `Math.random`.**
- The seed is **derived from the zone id** (e.g. `seed = (zoneId * GOLDEN) >>> 0`),
  so it's *constant*: both peers compute the identical layout independently, with
  zero bytes on the wire, and the layout is stable visit-to-visit. Monsters won't
  feel static anyway — they immediately path toward the hero (`FindHero`) and fuse.
- Because placement is deterministic and the host stays authoritative for monster
  *movement/combat* as it is today, no extra sync is needed at spawn time. (Confirm
  this against the snapshot path — see [Open questions](#open-questions) Q1.)

## Seams

| Need | Where |
| --- | --- |
| Hook to append generated monsters after authored ones | end of `buildZone` in `js/zone.js`, calling new `populateZone(zone, raw)` |
| Walkability test (reads precomputed collision mask) | `isWalkable(zone, x, y)` — already exported, `js/zone.js` |
| Door/teleporter tiles to keep clear | enterable-teleporter enumeration (autoplay pathfinding fix) |
| Fusion progression (consumes the placed bases) | `tickMonsterFusion`, `isMonsterSpecies` — `js/monsters.js`, unchanged |
| Ephemeral-entity precedent (id band, lazy runtime fields) | `makeCoin` — `js/coinDrops.js` |
| Seeded PRNG | **new** `js/rng.js` |
| Generation logic | **new** `js/spawnMonsters.js` (the `populateZone` body) |

Keeping generation in its own file (`js/spawnMonsters.js`) honours one-feature-one-file
and leaves room for sibling `js/spawnAmmo.js` / `js/spawnBarrels.js` later without
fusing their divergent rules into one module. `js/rng.js` is shared infrastructure
all three (and eventually `coinDrops` / `mobs`) can adopt to retire unsourced
`Math.random`.

## Testing posture

- **Unit (`tests/spawnMonsters.test.js`):** generation is a pure function of
  `(zone, raw, seed)`, so it's directly unit-testable with no DOM:
  - **determinism** — same zone + same seed ⇒ byte-identical entity list (the
    co-op-safety property; assert it explicitly).
  - **density** — count lands within tolerance of `round(density × eligible)`.
  - **exclusions** — no monster on a non-walkable tile, inside the spawn-clear
    radius, on a teleporter tile, or on an authored footprint.
  - **spacing** — no two generated monsters closer than `MIN_MONSTER_SPACING`.
  - **species split** — `chokeberry_chance: 0` ⇒ only 4004; `1` ⇒ only 4003.
  - **opt-out** — a zone with no `monster_spawn` field gets zero generated
    entities and an unchanged `entities` array.
- **E2E:** only if co-op sync turns out to need anything beyond deterministic
  seeding (Q1). If host and guest both generate from the zone-id seed, the
  existing co-op suite already covers that two peers see the same world.
- **Manual:** open a zone opted in with a high `density`, confirm the scatter
  reads natural (no clumps, no blocked doorways) and that walking in triggers
  visible fusion as berries collide.

## Future companions

Out of scope here, captured so the shared seams (`js/rng.js`, the `populateZone`
hook) are designed with them in mind:

- **Ammo** — budget derived from a zone's monster threat; likely sourced from
  barrel/monster drops rather than free-floating pickups, to avoid a re-entry
  farm exploit (no persistence + respawning pickups = infinite ammo).
- **Barrels** — space-filler for enclosed interiors (houses, dungeon rooms);
  needs a **constant** seed so the clutter layout is stable per visit.

## Open questions

- **Q1 — co-op authority at spawn.** Confirm the snapshot/host-authoritative path
  treats deterministically-seeded generated monsters the same as authored ones
  (host drives movement/combat, guest renders). If the guest's locally-generated
  entities must reconcile with the host's by id, the negative id band has to be
  derived identically on both sides (it is — same seed, same order) — but verify
  nothing keys off the authored-id range.
- **Q2 — density units.** Fraction-of-eligible-tiles vs. absolute count vs.
  tiles-per-monster. Fraction scales with zone size but is less intuitive to
  author; pick during first tuning pass.
- **Q3 — spacing vs. fusion feel.** `MIN_MONSTER_SPACING` trades off "natural
  scatter" against "how fast fusion escalates." Too tight ⇒ instant strawberries;
  too loose ⇒ never fuses. A feel constant to tune in-browser.
- **Q4 — chokeberry role.** Is chokeberry pure low-end flavour, or do we want a
  density-linked rule (e.g. more chokeberries in "easy" zones)? Starting simple
  with a flat per-spawn chance.
- **Q5 — interaction with existing authored monsters.** A zone could have both
  hand-placed *and* generated monsters. Confirm that's desirable (set-piece boss +
  ambient filler) vs. opt-in zones being generation-only.
