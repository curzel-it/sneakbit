Todo list uses a tier system that is part propritization and part parallelization across agents.

Possible bugs:
- [ ] `New Game` does not wipe current level and position
- [ ] Make absolutely sure we are during integer scaling to preserve pixel art, across all platforms and screen sizes. See suspicious-non-integer-scaling.png
- [ ] Rendering of equipment such as swords, AR15, and so on

Combat & feedback parity:
- [ ] **Knockback / straight-line movement primitive.** Port Rust `movement/straight_movement.rs::move_straight` + `projected_frames_by_moving_straight`. Building block for hit reactions, projectile trails, and minion ejection.
- [ ] **Ranged monsters.** Mobs only melee right now. Rust enemy bullets spawn via `entities/bullets.rs::make_bullet_ex`. Once added, the unused `applyPlayerDamage` burst path in `js/playerHealth.js` (imported by `js/combat.js` but never called) finally fires.
- [ ] **Damage indicators (`SPECIES_DAMAGE_INDICATOR=1178`).** Rust `features/hits_handling_use_case.rs:47` spawns a short-lived damage-number entity at the hit position. JS combat has no hit numbers, no flash, no shake — biggest "game feel" gap with the original.
- [ ] **Equipment damage reduction.** Rust `equipment/basics.rs::available_weapons` returns per-weapon `received_damage_reduction` (sword reduces incoming damage by 0.5 — already in `data/species.json:4103`). JS `playerHealth.js` ignores it; equipping a sword has no defensive effect.
- [ ] **HP regen parity.** Rust `HERO_RECOVERY_PS=1.0` vs JS `RECOVERY_PER_SEC=3.0` in `js/playerHealth.js:15`. Tuned to 3 deliberately in block A — record the delta so future tuning is informed.
- [ ] **Bullet-bounce SFX.** Rust emits `SoundEffect::BulletBounced`; JS `combat.js:92-102` bounces bullets but `audio.js` has no `bulletBounced` entry.
- [ ] **Per-weapon usage SFX correctness.** Rust `EquipmentUsageSoundEffect` is per-species (`SwordSlash`/`GunShot`/`LoudGunShot`); verify the JS lookups in `melee.js`/`shooting.js` use the equipped weapon's species, not the bullet's species.
- [ ] **Death / GameOver flow.** Rust returns `MatchResult::GameOver` and shows a death screen (palette colour in `ui/components.rs`). JS just teleports back to `STARTING_WORLD_ID` with full HP — no modal, no respawn delay, no continue prompt.

Missing entity types & weapons (data shipped, code missing):
- [ ] **Stairs (`SPECIES_STAIRS_UP=1010`, `SPECIES_STAIRS_DOWN=1011`).** No JS references either ID. Without them, two-floor buildings can't move the player between interior worlds.
- [ ] **Two-floor house traversal.** Three species in `data/species.json` already map to `building.name.house_two_floors`; Rust `prefabs/house_two_floors.rs` chains an upstairs/downstairs interior pair via the stairs species above. Traversal is the missing piece.
- [ ] **Explosive barrels (`SPECIES_BARREL_PURPLE/GREEN/BROWN/WOOD` = 1038/1039/1073/1074).** Rust `is_explosive()` triggers `SoundEffect::SmallExplosion` + radius damage on hit. JS draws them as plain static objects — no detonation, no AOE. The `smallExplosion` audio file is already wired in `js/audio.js` and unused.
- [ ] **AR15 (`1154`) + bullet (`1169`) + DARKAR15 variant.** `equipment.js` hardcodes `DEFAULT_RANGED_WEAPON_ID=1160` (kunai launcher). Verify the slot-swap actually lets these become the active ranged weapon end-to-end.
- [ ] **Cannon (`1167`) + cannon bullet (`1170`).** Same gap as AR15.
- [ ] **Fast travel (`FastTravelLink` entity_type, species in `species.json:4620`).** Rust `features/fast_travel.rs` + FFI surface (`did_request_fast_travel`, `available_fast_travel_destinations_from_current_world_c`). No `fastTravel.js`; link entities sit inert in worlds.
- [ ] **PvP arena (`PvpArenaLink` entity_type).** Rust `features/pvp_arena.rs` + FFI surface. No JS handling — link entities are inert. (Only matters if PvP mode lands; see Z multiplayer.)
- [ ] **Mr Mugs (`SPECIES_MR_MUGS=1131`).** Distinctive named NPC. Verify it picks up the right NPC behaviour, sprite, and dialogues.
- [ ] **Shop NPC (`SPECIES_NPC_SHOP_CLERK=1002`).** Rust prefab `prefabs/shop.rs` places one in shop interiors. No buy/sell flow in JS; needs a shop modal that converts inventory items into other species.
- [ ] **Non-consumable Hint entity.** Rust `entities/hint.rs` shows a Hint-mode toast when the player stands on a non-consumable hint and persists the read flag at `hint.read.<key>`. JS `js/pickups.js:44` only triggers hints when `is_consumable` is set — persistent stand-on hints render as inert static objects.

World, movement & rendering:
- [ ] **Slippery surfaces (Ice biome).** Rust `movement/input_based_movement.rs:19,29` skips direction changes and keeps momentum while the player is on a slippery frame. JS Ice tiles render but the player walks normally on them. Storage flag `is_player_by_index_on_slippery_surface` is FFI-exposed in Rust for UI feedback too.
- [ ] **Slope traversal audit.** `js/constructions.js` defines ~32 slope variants but treats them as flat tiles. Confirm Rust does the same (likely texture-only) — if so close out as "no gap"; if not, add elevation/cost logic.
- [ ] **Light conditions audit.** Rust has 3 modes (Day/Night/CantSeeShit); JS renderer handles Night (flat blue wash) and CantSeeShit (radial mask). Day is no-op — confirm Rust isn't applying any daylight tint or shader.
- [ ] **Save migrations.** Rust `features/migrations.rs::run_migrations()` runs on `BUILD_NUMBER` bump to upgrade old save formats. JS uses versioned localStorage prefixes (`sneakbit.kv.v1`, `sneakbit.inventory.v1`, `sneakbit.settings.v1`) but has no migration code — bumping a version silently orphans old saves.

UI / accessibility:
- [ ] **Toasts with images.** Rust `features/toasts.rs:9` allows an optional `ToastImage` (used for reward toasts to show the item icon). JS `toast.js` is text-only.
- [ ] **DisplayableMessage modal.** Rust `features/messages.rs` is a full-screen `{title, text}` modal distinct from toasts and dialogues. No JS equivalent.
- [ ] **Language picker.** Rust supports `en` + `it` (`lang/localizable.rs`). JS hardcodes `"en"` in `main.js`, ships only `data/strings.en.json`, and has no Settings selector. Port the Italian `.stringx` content to `strings.it.json` and surface a dropdown.
- [ ] **Loading screen.** First frame is whatever the HTML shows during `await Promise.all` of asset loads. Add a minimal splash + progress bar.
- [ ] **Inventory screen + equipment-swap UI in pause menu.** Currently swapping weapons requires `window.equipment` devtools. Needs an inventory grid + weapon-slot picker accessible from Esc.
- [ ] **Skill-tree view.** Three skill unlocks exist (piercing/boomerang/catcher) but there's no panel that lists them as earned/locked.
- [ ] **Credits screen.**
- [ ] **Key rebinding UI.** WASD/arrows and F/G/K/J/E/Esc/M are hardcoded; no remap.
- [ ] **Gamepad support.** Browser Gamepad API; no entry point in `js/input.js`.
- [ ] **Save export/import.** Single implicit slot — let the user dump/restore the localStorage payload as JSON.
- [ ] **Touch: virtual analog stick variant.** Current `js/touch.js` is a 4-way d-pad; analog suits diagonals + slippery surfaces better. Keep d-pad as default.

Multiplayer:
- [ ] Co-op using WASD+ZXC and IJKL+BNM, can be started from menu

Notes:
- **Asset gap (cutscenes):** `js/cutscenes.js:110` has an empty `CUTSCENE_SHEETS` map — the demon-lord-defeat PNG isn't bundled. Logic ticks fine but renders nothing. Decide whether to ship the sheet or leave the no-op as intentional.
- **Dead import (intentional, will go live):** `js/combat.js` imports `applyPlayerDamage` from `playerHealth.js` but never calls it. Will fire as soon as ranged monsters land. Leave the import.
- **Rust features not worth porting:** `LinksHandler` (external URL trait — trivial in browser), per-platform native shells (raylib/iOS/Compose), the SwiftUI-style `ui/components.rs` view DSL (HTML already gives us that).
