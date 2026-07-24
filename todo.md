# The experimental polygon renderer (iso) — orientation for new sessions

## What it is
A second, parallel way to draw the SneakBit world. The shipping renderer is
pixel-art: it blits 16x16 sprites top-down onto a flat canvas. This new one
throws sprites away and instead builds **real flat-shaded 3D geometry** (boxes,
quads, ramps) from the same map data and projects it through a **rotatable
isometric camera** every frame — the clean "drawn 3D" look, with real height so
elevated areas read as actual elevation. It is opt-in via the URL flag `?iso=1`;
without the flag nothing changes and the classic renderer runs untouched.

## Where it comes from
Ported from a sibling project (`~/dev/flyingquake`, `warehouse` branch), a
warehouse-sim prototype that had the same tile-based top-down roots as SneakBit
but moved to this polygon/iso style and looked great — especially its elevated
areas. This branch (`iso-3d-experiment`) is the "what if we did that here" test.
The decision was: **full polygon rebuild** (not pixel-art billboards) with a
**rotatable** camera.

## How it works
Same JSON, tapped one step earlier than the pixel path:
```
data/<id>.json --> zone.js parseZone() --> live zone grids:
    zone.biome[r][c]         numeric biome ids
    zone.construction[r][c]  numeric construction ids
    zone.entities            entity list (species instances)
  pixel path:  grids -> zoneCache bakes sprite canvases -> blit
  iso path:    reads the raw numeric-id grids DIRECTLY, every frame (no bake)
```
Files (each one feature, per repo rules):
- `js/isoCamera.js` — rotatable axonometric projection in tile space (project,
  depth, rotation, screen<->world). Ported from flyingquake `camera.js`.
- `js/isoGeometry.js` — flat-shaded box/quad face builders + Lambert shading.
  Ported from flyingquake `sprites.js`.
- `js/isoPalette.js` — the "art direction": biome id -> floor colour, and each
  construction id -> a geometry spec (box stack / ramp). Hand-authored, currently
  guessed from names not sampled from art.
- `js/isoRenderer.js` — the scene: floors first (depth-sorted), then
  constructions + actors as one painter's-sorted upright pass.
- `js/main.js` — wired behind `?iso=1`; `[`/`]` rotate, `-`/`=` zoom, camera
  follows the player.
Draw model: painter's algorithm (sort by iso depth, near draws last); each shape
is a set of 3D faces sorted within itself and filled as AA polygons.

## Status / how this maps to the TODO below
The **static terrain** (biome floors + construction shapes) renders and rotates.
Everything dynamic or identity-bearing is placeholder or absent. The rest of this
file is the work to close that gap:
- the construction archetypes we must model (sections 1-9),
- what the polygon renderer still can't draw that the pixel one could.
Key architectural next step: geometry must key on `(id, row)` using
`zone.constructionRow[r][c]` (the neighbour-connectivity index the pixel path
uses), which unlocks tree height, wall junctions, etc. Colours/heights should be
sampled from the real sprite sheets instead of guessed.

---

# Iso polygon renderer — construction tiles we need to model

Scope note: **buildings are NOT construction tiles** (the brick facades in
`tiles_constructions.png` are demo-only). Constructions are the 60 ids in
`Construction` (constructions.rs / constructions.js). The classic renderer keys
each tile on `(id, row)` where `row` = the 16 same-neighbour connectivity
patterns `(same_up, same_right, same_down, same_left)`. The iso path currently
keys on `id` only and must start consuming `row` (already in
`zone.constructionRow[r][c]`).

Legend — **Row?** = does geometry need the connectivity row, or is one shape enough.

## 1. Trees — multi-tile, vertical stacking  (Row: YES)
Row encodes trunk vs canopy vs top vs lone sapling via same-above/same-below.
This is where "1 tile = small, 2 tiles = tall" already lives in the data.
- Forest (8)
- Broadleaf (15)
- BroadleafPurple (22)
- SpoiledTree (18)
- WineTree (19)
- SnowyForest (25)
- Bamboo (9)  — tall thin stalks; stacks vertically like trees

## 2. Walls — connected barriers  (Row: YES)
Row selects straight / corner / T / cross / end-cap. All obstacles, ~1.4 tiers.
- LightWall (4)
- StoneWall (12)
- WoodenWall (23)
- DarkRock (3)

## 3. Fences — thin connected barriers  (Row: YES)
Like walls but a thin rail on posts; row selects run vs corner vs post.
- WoodenFence (1)
- MetalFence (16)
- Rail (11)  — walkable (not an obstacle); low ground rail

## 4. Ground cover — single tile, low  (Row: minor)
- TallGrass (7)  — walkable; short foliage clumps

## 5. Props / solids — mostly one shape  (Row: no)
Single-tile objects; ignore connectivity for now.
- Box (10)        — walkable crate
- StoneBox (17)
- Counter (5)
- Library (6)     — shelf block (NOT a building facade)
- SolarPanel (20) — low tilted panel
- Pipe (21)
- SnowPile (24)

## 6. Bridge — flat deck over liquid  (Row: maybe)
Walkable; sits at ground level spanning water/lava. Row may pick deck direction.
- Bridge (14)

## 7. Slopes — ramps / elevation  (Row: NO — orientation is in the id)
4 biome families x 8 orientations = 32 ids. Orientation (corner TL/TR/BR/BL,
edge T/B/L/R) is the id itself, not the row. These are the seed for real
elevated ground.
- Green:    29-36
- Rock:     37-44
- Sand:     45-52
- DarkRock: 53-60

## 8. Darkness overlays — floor tint, NOT skipped  (Row: no)
Translucent black paint (~15/30/45% opacity) the level designer places on tiles
to hand-shade the map — e.g. darkening water to fake depth. They tint whatever
sits beneath, they are not objects. Iso equivalent: multiply the underlying floor
(or object) colour by (1 - opacity) for that cell — same depth impression in 3D,
no separate geometry. Walkable, not solid.
- Darkness15 (26)  — ~15% black
- Darkness30 (27)  — ~30% black
- Darkness45 (28)  — ~45% black

## 9. Skip — not world geometry
- Nothing (2)          — empty cell, nothing to draw
- IndicatorArrow (13)  — UI arrow marker, belongs to the HUD not the world

---

## What the polygon renderer can't draw that the pixel one could
Comprehensive (not exhaustive-detailed) gap list. Grouped by system.

### Terrain detail
- Biome border / transition autotiling (`zone.biomeCol`) — pixel path blends
  biome edges (grass fading into water, sand meeting rock); iso draws flat solid
  tiles with hard colour seams.
- Water / lava animation — pixel path cycles 4 frames; iso uses one static colour.
- Missing biome floor colours: LIGHT_WOOD (5), ICE (9), FARMLAND (13) — render
  as default grey.
- Darkness paint tint (ids 26-28) — designer-placed shading (e.g. water depth);
  see section 8. Not yet applied in iso.

### Constructions
- Only 1 of up to 16 designs per id (no `(id, row)` connectivity) — see sections
  1-9. Fences/walls don't junction; trees don't stack tall.
- Colours/heights guessed from names, not sampled from `tiles_constructions.png`.

### Species / entities (all ~281)
- Every species draws as a generic tinted box: NPCs, monsters, pickables, gates,
  pressure plates, inverse gates, static objects, teleporters, hints, fast-travel
  links, bundles, world weapons/armour, pushables, buildings.
- No directional facing (sprites have up/down/left/right rows).
- No per-species animation frames.
- No z-index layering — floor-decal underlays (z=-1, e.g. stairs, magic circles)
  and always-on-top overlays (z=99).
- Entity visibility rules (`shouldBeVisible`) not applied.

### Player rig
- Equipment overlays: melee weapon, ranged weapon, armour (helmet/chest/legs).
- Melee swing animation; shooting / muzzle animation.
- Facing-based equipment z-order (in front / behind hero).
- Giant mode (scaled hero); ice aura under the feet.

### Combat / status effects
- Freeze overlay + frozen state; ice buff aura + bullet auras; knockback aura.
- Death animation; vanish effect (alpha + overlay); knockback hop offset.
- Coin / ammo drop render offsets (the little pop/bob).
- Pushable render offset.

### Projectiles & scene effects
- Bullet / projectile trails (`drawTrails`).
- Local effects / muzzle flashes (`drawLocalEffects`).
- Cutscenes (`drawCutscenes`).

### Lighting & scene-level
- Light conditions (`drawDarkness`): Night blue wash, CantSeeShit vision cone.
- First-city / directional guidance arrow.

### Camera / co-op parity
- Split-screen co-op viewports (`renderViewports`) — iso draws a single camera
  only; local split-screen and per-guest windows are not handled.

### Renders fine anyway (DOM, not canvas — NOT missing)
- HUD (HP/coins/ammo/menus), touch controls, zone-transition fades. These sit
  above the canvas and already appear over the iso view.

### Work implied by this list
1. Geometry must key on `(id, row)`, reading `zone.constructionRow`. → unlocks
   trees (1), walls (2), fences (3), bridge (6).
2. Per-archetype geometry builder rather than one box: tree-stack, wall-junction,
   fence-junction, ramp (already have), prop-box (already have).
3. Colours/heights should be sampled from `tiles_constructions.png`, not guessed.

Also missing three biome floor colours: LIGHT_WOOD (5), ICE (9), FARMLAND (13).

---

# Shop items — pricing rework (open)

The system we have to handle shop items is a bit convoluted right now. What we
want is a global price list, a function that applies regional price variation
(none for now) and a function that returns inventory amounts per region. The
last function should have random starting values each day — say 3 potions are
available that day, buy 2 and only 1 remains; next day the values reset. Seeded
random should do. Existing prefab logic can be removed. Just need somewhere with
the default pricing that I can edit.

---

# Co-op TODO — per-player parity with single-player ✅ done

Goal: in co-op (offline split-screen **and** online), every player gets the same
self-contained experience they'd have in single player. No shared/global state for
inventory or wallet — each player owns their own.

- [x] **1. Per-player inventory** — each player has its own dedicated inventory,
  identical to the inventory they'd have in single player.
- [x] **2. NPC interaction** — every player can interact with NPCs.
- [x] **3. Hint interaction** — every player can interact with hints.
- [x] **4. Shop access** — every player can access the shop into *their own* inventory.
- [x] **5. Per-player wallet** — every player has its own wallet.
- [x] **6. Guest starter sword** — guests entering with < 5 kunai and no melee get a sword.
