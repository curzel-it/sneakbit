# Creative Mode — HTML Spec

A line-by-line inventory of every behavior creative mode changes, originally extracted from the Rust core (`../dev/sneakbit`) and adapted for the HTML port.

The Rust project is no longer actively developed. **Format parity with the Rust core is an explicit non-goal**: the HTML schema may drift freely. The only round-trip constraint is internal — every world JSON currently in `data/` must load, play, edit, save, and reload cleanly within the HTML port itself.

Source notes (kept as background, since the original Rust source still maps cleanly onto the gates the HTML port needs):
- `game_core/src/lib.rs::is_creative_mode()` is the single global predicate.
- `game_core/src/multiplayer/modes.rs::GameMode::Creative = 1` (alongside `RealTimeCoOp`, `TurnBasedPvp`).
- The desktop build picked the mode from `argv` (`game/src/main.rs`): `cargo run -- creative` flipped `GameMode::Creative`.
- The HTML port replicates the same predicate, driven by `?creative=true`.

## Activation

| Aspect | Rust | Required in HTML |
| --- | --- | --- |
| Trigger | `argv` flag `creative` | `?creative=true` query param (default `false`) |
| Visible at runtime | `is_creative_mode()` predicate consulted from anywhere | `isCreativeMode()` exported from one feature file |
| Default game mode if not creative | `GameMode::RealTimeCoOp` | unchanged — non-creative is the current behavior |
| HP cap (`modes.rs::player_hp`) | 100 (same as RealTimeCoOp) | nothing to change |
| First turn (`turns_use_case.rs`) | `GameTurn::RealTime` | nothing to change |
| Match result (`turns_use_case.rs`) | `MatchResult::InProgress` always | nothing to change |

## Player / Hero

| Behavior | Rust | File |
| --- | --- | --- |
| Speed multiplier | `2.0` in creative mode, `1.0` otherwise | `entities/hero.rs::setup_hero` |
| Light/limited visibility (e.g. `CantSeeShit` worlds) | Disabled — `is_limited_visibility()` returns `false` regardless of `LightConditions` | `lib.rs::is_limited_visibility` |
| Player HP | Unchanged (100) | `modes.rs::player_hp` |
| Movement gating | Entity AI movement (`perform_movement`) is a no-op for **every entity** in creative — heroes still move because input is handled separately, but every other species (NPCs, monsters, free-wandering critters) freezes in place | `movement/movement_directions.rs::perform_movement` |

## Combat

| Behavior | Rust | File |
| --- | --- | --- |
| Monster melee attacks | Skipped — `update_monster` returns early before `handle_melee_attack` runs, and `handle_melee_attack` itself early-returns | `features/monsters.rs` |
| Monster sprite state | Still updated each frame so visuals match position | `features/monsters.rs::update_monster` |
| Bullet pickup-on-stop | A bullet whose `current_speed == 0.0` does NOT trigger an `object_pick_up_sequence` in creative — bullets just sit on the floor instead of being collected | `entities/bullets.rs` |
| Bullet world-edge despawn | Still happens | `entities/bullets.rs` |

## World Entities

| Entity | Non-creative | Creative |
| --- | --- | --- |
| Generic static / decorative entity (`setup_generic`) | `is_rigid` per species data | `is_rigid = false` (walk through anything) |
| Gate (`Gate`) | Rigid when pressure plate is up | `is_rigid = false` always (`setup_gate` zeroes it; `update_gate` keeps it false even when plate raises) |
| InverseGate | Same dual logic as Gate | Same — never rigid in creative |
| Teleporter | Sprite `frame.y = 6.0`; refuses to teleport when locked (shows locked message) | Sprite `frame.y = 5.0` (different art); locked teleporters teleport anyway |
| Pickable object (consumables, ammo on the ground, equipment pickups, etc.) | Picked up when the player overlaps them | `update_pickable_object` early-returns — nothing is ever auto-collected |
| Hint sign | Sprite uses `SPRITE_SHEET_STATIC_OBJECTS` (placed sign sprite); shows toast when player walks over it | Sprite uses `SPRITE_SHEET_INVENTORY` (inventory-style icon); does NOT trigger toast |
| AfterDialogue `Disappear` | Entity removed | Entity kept (so the level designer can keep talking to NPCs that would normally vanish) |
| Entity visibility (`Entity::should_be_visible`) | Computed from species rules (lock state, story progress, etc.) | Always `true` (every entity is rendered, including ones normally hidden by story flags) |

## World Setup / Persistence

| Behavior | Rust | File |
| --- | --- | --- |
| Player spawn placement | `spawn_hero_at_last_known_location` + `spawn_coop_players_around_hero` (same as RealTimeCoOp) | `worlds/world_setup.rs::spawn_players` |
| Save on menu Save | `engine.save()` writes `StorageKey::latest_world` and dumps `world.save()` (serializes the world JSON back to disk). In non-creative this is a no-op | `features/engine.rs::save` |
| Save on teleport | Same `world.save()` runs whenever you cross a teleporter, so map-editor edits in one room persist when you walk to the next | `features/engine.rs::teleport` |

## Rendering / UI

| Aspect | Rust | File |
| --- | --- | --- |
| Rendering scale | Hard-coded to `2.0` regardless of viewport width (so the level designer always gets the same density of tiles on screen) | `game/src/rendering/window.rs::rendering_scale_for_screen_width` |
| Game menu items | `Save`, `Resume`, `ToggleFullScreen`, `MapEditor`, `GameSettings`, `Exit` | `game/src/gameui/game_menu.rs::setup` |
| Non-creative menu items (for contrast) | `Resume`, `ToggleFullScreen`, `NewGame` (and optionally `ExitPvp`), `GameSettings`, `NumberOfPlayers`, `Exit` | same file |

## Map Editor (only available in creative mode)

The map editor lives at `game/src/gameui/map_editor.rs` and is reachable from the game menu's `MapEditor` entry. It has two states:

1. **SelectingItem** — a grid (20 columns) of every stockable object. Arrow keys move the cursor; wraps top-to-bottom; Enter / confirm enters PlacingItem state.
2. **PlacingItem** — a ghost rectangle of the chosen item follows the mouse/arrow keys.
    - **Left click / Enter / confirm** → places the item.
    - **Right click** → erases (writes `Construction::Nothing`) at the cursor.
    - **While dragging with left** held on a biome/construction-tile selection: keep painting tiles every move (paintbrush mode).
    - **Back / Esc** → returns to SelectingItem.

### Stockable categories (all three types)

#### Biome tiles (paintbrush on the biome layer)

`Water`, `Desert`, `Grass`, `DarkGrass`, `Rock`, `DarkRock`, `Snow`, `LightWood`, `DarkWood`, `RockPlates`, `Ice`, `Lava`, `Farmland`, `DarkWater`, `DarkSand`, `SandPlates`. (`Nothing` is intentionally omitted from the editor stock; it's only used as the erase-payload for the right-click clear.)

#### Construction tiles (paintbrush on the construction layer)

`WoodenFence`, `MetalFence`, `DarkRock`, `LightWall`, `Counter`, `Library`, `TallGrass`, `Forest`, `Bamboo`, `Box`, `Rail`, `StoneWall`, `IndicatorArrow`, `Bridge`, `Broadleaf`, `StoneBox`, `SpoiledTree`, `WineTree`, `SolarPanel`, `Pipe`, `BroadleafPurple`, `WoodenWall`, `SnowPile`, `SnowyForest`, `Darkness15`, `Darkness30`, `Darkness45`, plus every slope variant: `SlopeGreen{TL,TR,BR,BL,Bottom,Top,Left,Right}`, `SlopeRock{TL,TR,BR,BL,Bottom,Top,Left,Right}`, `SlopeSand{TL,TR,BR,BL,Bottom,Top,Left,Right}`, `SlopeDarkRock{TL,TR,BR,BL,Bottom,Top,Left,Right}`.

#### Entity species

Every species in `ALL_SPECIES` that:
- has a non-`(0, 0)` `inventory_texture_offset`, AND
- is NOT `EntityType::WeaponMelee` or `EntityType::WeaponRanged` (those are equipment, not placeable props).

Placement rules per entity type:
- `EntityType::Building` → routed through `prefabs::all::new_building`, which expands a single building selection into multiple entities (doors, walls, interior teleporter, etc.) via `WorldStateUpdate::AddEntity`.
- `EntityType::Npc` → frame is offset by `-1.0` on Y before placement (so the NPC's feet land where the cursor was).
- Anything else → `WorldStateUpdate::AddEntity` with the cursor's frame, no offset.

Items are rendered in the editor using the `inventory.png` sprite sheet (sheet id `SPRITE_SHEET_INVENTORY`) at the `inventory_texture_offset` of each species, scaled `1.5×` normally and `1.5 + selection-spacing×` when highlighted.

## What is NOT special-cased

These are worth listing because they could mislead someone reading the codebase:
- Hero HP is **not** changed (still 100, same as co-op).
- Damage indicators, fast travel, pushables, pressure plates, dialogues — all still tick normally.
- The save format is the same JSON; creative mode just *also* writes it back on Save/teleport.
- There is no map-wide undo, multi-tile selection box, or copy/paste — placement is one tile or one entity at a time.

## Authoring & persistence (HTML port)

The browser cannot write to the site's deploy directory, so creative-mode edits live in IndexedDB until the author manually exports them as JSON and commits them back into `./data/`. Three principles drive the design:

1. **No backend.** The site stays a static deploy (`git push` → `curzel.it/sneakbit-html`). Adding a REST API would buy "edit from anywhere" — a feature we don't need, since the map editor is desktop-only — at the cost of hosting, auth, CORS, and an online dependency.
2. **Worlds are already static files.** `js/data.js::loadWorld(id)` fetches `./data/{id}.json`. Creative mode hooks that path; it doesn't replace it.
3. **Existing world JSONs must round-trip.** Every file in `./data/` today must load, play, be editable, be saved, and reload cleanly under the new persistence layer. The format on disk can evolve (Rust parity is dropped), but the existing corpus is the regression bar.

### Load path

`loadWorld(id)` consults the creative override store first, then falls back to the shipped static JSON:

1. If creative mode is on AND an IndexedDB entry exists for `world:<id>`, return it.
2. Otherwise fetch `./data/{id}.json` as today.

In non-creative play the override store is ignored entirely (players never see author edits-in-progress).

### Edit model: edit-then-rebuild

The runtime world (`world.js::buildWorld(raw)`) derives heavy precomputed state — `biomeCol`, `constructionRow`, `collision`, cloned `entities`, etc. — from the compact source schema (tile grids are *strings of single-character codes*, not 2D arrays). Editing the derived state and trying to re-encode it on export is fragile.

Instead: **the creative editor mutates a kept-around copy of the `raw` JSON, then re-runs `buildWorld(raw)` to refresh the derived state.** The performance cost (full rebuild on each placement) is fine for an authoring tool that's not in the hot path. The benefit is that whatever is in IndexedDB and whatever Export emits is, by construction, the same shape as the shipped files in `./data/`.

`data.js::loadWorld(id)` will return the `raw` JSON as today; the creative editor holds the reference and mutates it directly. Calls to `buildWorld(raw)` come from `main.js` / `worldCache.js`; those keep working unchanged.

### Save path

Creative-mode edits are buffered in IndexedDB, keyed by world id, in a **new module** (`js/worldBuffer.js`) — not in `js/storage.js`, which is localStorage-only and stores u32 integers, not blobs. Three user-facing actions in the creative menu:

- **Export world** — serializes the current `raw` world JSON to a downloadable `{id}.json`. The author drops the file into `./data/` and commits. This is the canonical "ship the edit" path.
- **Reset world** — clears the IndexedDB entry for the current world, reverting to the shipped JSON on next load. Lets the author throw away an experiment.
- **(Optional, Chromium-only) Connect repo folder** — uses the File System Access API to remember a directory handle pointing at `./data/`. When set, **Export world** writes the file directly instead of triggering a download. Strictly a quality-of-life nicety for the solo author.

Save-on-teleport (the Rust core's behavior of writing the world out on teleport) maps to "flush the current `raw` to its IndexedDB entry on teleport" — same trigger, just one tier shallower than disk.

### Platform gating

The map editor and its menu entries are **desktop-only**, hidden when `matchMedia("(pointer: coarse)").matches` (same probe `js/touch.js` already uses for the touch overlay). Rationale: the editor is a click-and-drag tool with right-click erase and keyboard shortcuts; a thumb-driven UI for it is out of scope. The `?creative=true` URL flag is still parsed on touch devices (gameplay gates still apply), but the editor and Save/Export menu items simply don't render.

## HTML port — required behavior summary

For the port to be at feature parity with the old Rust creative mode, the following user-visible features must be implemented (in roughly increasing order of effort). Status as of 2026-05-26.

Gameplay gates — each is one branch in the corresponding feature file:

1. ✅ Parse `?creative=true` once at boot; expose `isCreativeMode()` from a single feature file. *(Done — `js/creativeMode.js`.)*
2. ✅ Hero speed `× 2` when creative. *(Done — `js/player.js::stepDuration`.)*
3. ✅ Skip `is_limited_visibility` darkness overlay in creative. *(Done — `js/renderer.js::drawDarkness`.)*
4. ✅ Skip monster melee damage in creative (`tickCombat::resolveMeleeMonsters`). *(Done — `js/combat.js`.)*
5. ✅ Freeze AI-driven entity movement for everything except the hero in creative (`tickMobs`). *(Done — `js/mobs.js`.)*
6. ✅ Skip pickup auto-collection (`pickups.js::checkPickup`). *(Done — early-return covers hint-toast suppression too.)*
7. ✅ Skip hint-toast trigger (toast-on-walk-over) and re-skin the sign sprite from static-objects sheet to inventory sheet. *(Done — toast skip via #6 above; re-skin in `js/entities.js::creativeHintReskin`.)*
8. ✅ Skip the `Disappear` after-dialogue removal in creative. *(Done — `js/afterDialogue.js`.)*
9. ✅ Treat `Entity::should_be_visible` as always-true. *(Done — `js/entityVisibility.js::shouldBeVisible`.)*
10. ✅ Drop `is_rigid` on Generic / Gate / InverseGate setups in creative. *(Done — `js/world.js::isEntityBlocked` short-circuits the listed types; pushables skip via `js/pushables.js::findPushableAt`; player's gate-unlock skip in `js/player.js::canEnter`.)*
11. ✅ Use the creative teleporter sprite row (`frame.y = 5` vs `6`) and skip locked-teleporter messages. *(Done — sprite row override in `js/entities.js::draw`; the HTML port has no locked-teleporter message path so no skip needed.)*

UI gating:

12. ✅ Gate **save/load (export/import) UI** so it's only visible in creative mode. *(Done — `js/menu.js` `[data-creative-only]` + `applyCreativeModeVisibility`.)*
13. ✅ Add menu entries for `Save` and `MapEditor` only when creative — AND only on desktop. *(Done — new `[data-desktop-only]` attribute alongside `[data-creative-only]`; `applyCreativeModeVisibility` ANDs the two.)*

Persistence layer (see addendum):

14. ✅ **World override store**: new `js/worldBuffer.js` module backed by IndexedDB. *(Done — `js/data.js::loadWorld` consults the buffer first in creative.)*
15. ✅ **Save-on-teleport** for creative mode: flush the current `raw` world JSON to its IndexedDB entry whenever the hero crosses a teleporter. *(Done — `js/transitions.js::travelTo` awaits `putBufferedWorld(state.rawWorld)` before tearing down the source world.)*
16. ✅ **Export world** menu action: download the current `raw` world JSON as `{id}.json`. *(Done — `js/menu.js::exportWorld`.)*
17. ✅ **Reset world** menu action: clear the IndexedDB entry for the current world. *(Done — `js/menu.js::resetWorld`.)*
18. (Optional, Chromium-only) **Connect repo folder** via the File System Access API. *(Deferred — quality-of-life only; current Export-world path writes a download.)*

Editor (single feature, several internal pieces):

19. ✅ The map editor itself: stockable grid, click-to-place, right-click-to-erase, drag-paint for tiles. *(Done — `js/mapEditor.js`. NPC placement applies the `-1.0` Y offset. Building-prefab expansion is **deferred**: placing a Building drops a single entity at the cursor instead of expanding to doors / interior teleporter; porting `prefabs::all::new_building` from Rust remains a follow-up.)*

Suggested slicing for first PRs (smallest, most self-contained first):

- **PR 1** — IndexedDB world buffer + `loadWorld` override hook (item 14). No UI yet; verifiable from devtools.
- **PR 2** — Export / Reset menu actions (items 16, 17). Requires PR 1.
- **PR 3** — Desktop / creative gating on the new menu entries (item 13).
- **PR 4** — Save-on-teleport flush (item 15).
- **PR 5+** — Gameplay gates 2–11, one per commit (cheap, but each touches a feature file that wants its own focused review).
- **PR N** — The editor itself (item 19), as its own multi-commit effort, prefab expansion included.
