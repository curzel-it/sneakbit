# Creative Mode — Rust Reference Spec

A line-by-line inventory of every behavior the Rust core (`C:/dev/sneakbit`) changes when the engine boots into `GameMode::Creative`. The list is sourced from every call site of `is_creative_mode()` and from the menu / map-editor UI that only exists in creative builds.

Source notes:
- `game_core/src/lib.rs::is_creative_mode()` is the single global predicate.
- `game_core/src/multiplayer/modes.rs::GameMode::Creative = 1` (alongside `RealTimeCoOp`, `TurnBasedPvp`).
- The desktop build picks the mode from `argv` (`game/src/main.rs`): `cargo run -- creative` flips `GameMode::Creative`, otherwise `GameMode::RealTimeCoOp`.
- The HTML port must replicate the same predicate but driven by `?creative=true`.

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

## HTML port — required behavior summary

For the port to be at parity with Rust's creative mode, the following user-visible features must be implemented (in roughly increasing order of effort):

1. Parse `?creative=true` once at boot; expose `isCreativeMode()` from a single feature file.
2. Hero speed `× 2` when creative.
3. Skip `is_limited_visibility` darkness overlay in creative.
4. Skip monster melee damage in creative (`tickCombat::resolveMeleeMonsters`).
5. Freeze AI-driven entity movement for everything except the hero in creative (`tickMobs`).
6. Skip pickup auto-collection (`pickups.js::checkPickup`).
7. Skip hint-toast trigger (toast-on-walk-over) and re-skin the sign sprite from static-objects sheet to inventory sheet.
8. Skip the `Disappear` after-dialogue removal in creative.
9. Treat `Entity::should_be_visible` as always-true (i.e. render every entity regardless of `lock_type`, story flags, etc.).
10. Drop `is_rigid` on Generic / Gate / InverseGate setups in creative so the hero can walk through everything.
11. Use the creative teleporter sprite row (`frame.y = 5` vs `6`) and skip locked-teleporter messages.
12. Gate **save/load (export/import) UI** so it's only visible in creative mode (matches Rust's "save is creative-only" rule).
13. Add menu entries for `Save` and `MapEditor` only when creative.
14. Build the map editor itself: stockable grid, click-to-place, right-click-to-erase, drag-paint for tiles, special handling for `Building` (multi-entity) and `Npc` (Y-offset) placements.

Items 1–3 are trivial. Items 4–11 are gated by one branch each in the corresponding feature file. Item 12 is the only requirement the todo.md explicitly carves out today. Items 13–14 are the largest delta and ship together with the map editor.
