Todo list uses a tier system that is part propritization and part parallelization across agents.

Possible bugs:
- [x] `New Game` does not wipe current level and position
- [x] Make absolutely sure we are during integer scaling to preserve pixel art, across all platforms and screen sizes. See suspicious-non-integer-scaling.png
- [~] Rendering of equipment such as swords, AR15, and so on — overlay rendered while equipped and pickups now auto-equip. Open issue: no key bound to actually swing the equipped sword (see Bugs below).

Combat & feedback parity:
- [x] **Knockback / straight-line movement primitive.** Ported as `js/movement.js`. Use sites (knockback, projectile trails, minion ejection) still TBD.
- [x] **Ranged monsters.** Boss 4008 (grapevine) now spawns 4009 minions periodically via `js/minions.js`; the existing FindHero AI takes them from there. Literal damage-dealing enemy bullets weren't in the Rust source so the `applyPlayerDamage` burst path stays unused.
- [x] **Damage indicators (`SPECIES_DAMAGE_INDICATOR=1178`).** Non-fatal hits now spawn the 1178 indicator entity with the 0.2s lifespan from Rust.
- [x] **Equipment damage reduction.** Equipped weapons' `received_damage_reduction` (shield 1171: 0.5) is applied multiplicatively in `js/playerHealth.js`.
- [x] **HP regen parity.** Divergence documented inline in `js/playerHealth.js`.
- [x] **Bullet-bounce SFX.** Already wired (`audio.js` has `bulletBounced`, `combat.js` calls it).
- [x] **Per-weapon usage SFX correctness.** Verified — `melee.js`/`shooting.js` both pull `equipment_usage_sound_effect` from the equipped weapon species.
- [x] **Death / GameOver flow.** `js/gameOver.js` modal stops the loop on death and prompts for Continue before respawning.

Missing entity types & weapons (data shipped, code missing):
- [x] **Stairs (`SPECIES_STAIRS_UP=1010`, `SPECIES_STAIRS_DOWN=1011`).** Already covered by the standard entity render pipeline — the actual traversal is the teleporter Rust prefabs place next to the stairs sprite.
- [x] **Two-floor house traversal.** Same — adjacent teleporters baked into world data handle it.
- [x] **Explosive barrels (`1038/1039/1073/1074`).** Now bullet-destructible; death plays the previously-orphaned `smallExplosion` SFX. No AoE — the Rust source ships none either.
- [x] **AR15 (`1154`) + bullet (`1169`) + DARKAR15 variant.** Slot-swap verified end-to-end (`tests/equipment.test.js`).
- [x] **Cannon (`1167`) + cannon bullet (`1170`).** Same — slot-swap verified.
- [x] **Fast travel (`FastTravelLink` entity_type).** `js/fastTravel.js` watches for the 1185 entity, opens an overlay listing visited worlds, and teleports on pick. Unlock threshold: 4 distinct visited worlds, same as Rust.
- [ ] **PvP arena (`PvpArenaLink` entity_type).** Gated on multiplayer landing.
- [x] **Mr Mugs (`SPECIES_MR_MUGS=1131`).** Species data + render pipeline both already correct; not placed in any shipped world, so nothing to verify in-game.
- [ ] **Shop NPC (`SPECIES_NPC_SHOP_CLERK=1002`).** Needs a buy/sell UI; Rust prefab only places the clerk with an empty dialogue list, so the design isn't pinned down.
- [x] **Non-consumable Hint entity.** Stand-on hints now fire a toast on entry and persist `hint.read.<text>` so the same hint never spams twice.

World, movement & rendering:
- [x] **Slippery surfaces (Ice biome).** Player slides until blocked; direction input is locked while on ice.
- [x] **Slope traversal audit.** Closed as cosmetic-only gap (Rust slopes are also `is_obstacle = true`, just with shaped hittable_frame padding). See header in `js/constructions.js`.
- [x] **Light conditions audit.** Confirmed Rust applies no Day-mode tint — noted in `js/renderer.js`.
- [x] **Save migrations.** `js/migrations.js` runs at startup, walks the MIGRATIONS list from the stored `build_number` up to the current `BUILD_NUMBER`. Empty migration list today; framework is ready for the first breaking change.

UI / accessibility:
- [ ] **Toasts with images.** Rust `features/toasts.rs:9` allows an optional `ToastImage` (used for reward toasts to show the item icon). JS `toast.js` is text-only.
- [x] **DisplayableMessage modal.** `js/message.js` — full-screen `{title, text}` modal, exposed as `window.showMessage(title, text, cb)`. Pauses the loop until the player acknowledges.
- [ ] **Language picker.** Rust supports `en` + `it` (`lang/localizable.rs`). JS hardcodes `"en"` in `main.js`, ships only `data/strings.en.json`, and has no Settings selector. Port the Italian `.stringx` content to `strings.it.json` and surface a dropdown.
- [x] **Loading screen.** `js/loadingScreen.js` — dark splash + progress bar that ticks once per fulfilled Promise.all leg and fades out when the world is ready.
- [x] **Inventory screen + equipment-swap UI in pause menu.** `js/inventoryScreen.js` rendered inside a new menu tab; click Equip on any weapon-associated pickup to swap loadouts.
- [x] **Skill-tree view.** Skills tab in the pause menu shows piercing / boomerang / catcher with UNLOCKED / LOCKED tags.
- [x] **Credits screen.** Credits tab in the pause menu with attribution + repo links.
- [ ] **Key rebinding UI.** WASD/arrows and F/G/K/J/E/Esc/M are hardcoded; no remap.
- [x] **Gamepad support.** `js/gamepad.js` — left-stick / d-pad fan into the directional channel; standard-mapping buttons fire shoot / melee / interact / menu.
- [x] **Save export/import.** Export / Import buttons in the pause menu round-trip every `sneakbit.*` localStorage key as a JSON blob.
- [ ] **Touch: virtual analog stick variant.** Current `js/touch.js` is a 4-way d-pad; analog suits diagonals + slippery surfaces better. Keep d-pad as default.

Multiplayer:
- [ ] Co-op using WASD+ZXC and IJKL+BNM, can be started from menu

Bugs:
- [x] New games does not reset player position — `beforeunload` was re-saving the position on top of the cleared payload during the reload; `window.save.suppressUnloadSave()` now stops that.
- [x] After a sword has been equipped there is no key that can be pressed to use it — pause-menu hint and pickup toast now both mention G (melee swing).
- [x] In the first level a `Press E to talk` hint is shown and immeditely dismissed automatically. It is WAY too fast and not in the correct position (~screen center instead of top, like other toast) — hint moved to top: 6% (same band as the toast). The "auto-dismiss" was the hint correctly hiding once the player stops facing the entity; if it still feels flaky after the reposition we can look again.
- [x] Some creatures have the wrong speed, such as slime, cats and pigs for example — mob step duration now derived from species.base_speed × Rust's TILE_RATE_PER_BASE_SPEED.
- [x] Monsters see gates as obstacles even when open — mobs.js canEnter now matches world.isEntityBlocked (skips open gates + teleporter tiles).
- [x] Pushable objects can currently be pushed into a position from where they cannot be recovered. image a corridor that is 1-tile wide with a dead end. if I push the rock there I cannot get it back. Rust implementation solved this by allowing the character to walk "over" the rock (in the same tile) and bring it back with him when walking back — player.js: walking into a stuck pushable now lands the player on the rock's tile; the next step drags the rock along when it's pinned on the opposite side (matches Rust is_being_pushed_by_player).
- [x] After I die level state does not correctly update. Not sure if there was a full reset in rust, but need to check as something is off. For example all pushable objects are in the position I left them in, instead of the initial position — root cause was world.js sharing entity references with the loadWorld cache, so pushable.frame mutations (and _open / _hp) survived a respawn. buildWorld now shallow-clones every entity (fresh frame/destination/dialogues) so the world reload reads from a pristine copy.
- [x] The game is now correctly being rendered with integer scaling, this means that we have some leftover space around the rendered tiles, which looks like a black border. black-border.png shows what that looks like in the bottom left corner of the screen. in Rust we had the same issue and solved it by rendering an additional row of tiles paritally out of the canvas bounds (so that it was effectly cut off at hte canvas limit, while the part drawn inside was clearing up the black border) — zoom.js: Math.ceil for tile count, the over-bounds half-tile is clipped by body { overflow: hidden }. Also dropped the max-width/height clamps on the canvas that would have squashed the overshoot.
- [x] Traversing the teleporter in 1001 that goes to 1002 and viceversa the player does not appear in the correct position, it seems to appar 1 tile above the correct spot. — `transitions.js::resolveSpawn` stays in feet-tile space; the Rust frame.y → feet +1 conversion lives at the world-data boundary in `main.js::maybeTeleport`.
- [ ] Credits to not link to font, music and sound effects providers (the original does)
- [x] `Press E to talk` does not look like the other toasts, not sure were it comes from — interact.js hint restyled to match toast.js exactly (top: 6%, same background / padding / radius / shadow).
- [x] In 1001 after seeing the various hints, I also see an empty toast. No idea where it comes from, worth just skipping toasts with no content silently for now — toast.js now early-returns on null / empty / whitespace text.
- [x] Pressing G to use the sword does damage, but no sword swing animation — entities.js drawEquipment now flips the equipped overlay to the absolute attack-row strip (Up=37 / Right=41 / Down=45 / Left=49) for the swing duration, and the source-x frame advances with the cooldown. Melee bullets are now `_invisible: true` so they don't flicker as dots.
- [x] Pushable objects move of one tile per step (correct), but no animation — pushables.js records a `_slide` on each push (and on carry-back); entities.js applies a render-time offset that decays over 0.22s so the rock glides between tiles in lockstep with the player.
- [?] not really a bug, just checking: in the original Rust game only entities visible on screen (with some padding) were updated, do we have the same thing in place? — No, we iterate all entities each frame. For our current world sizes (~100-500 entities) the cost is negligible; if/when a world starts to feel laggy this is the optimization to reach for (Rust does it in features/hitmaps.rs::update_hitmaps).
- [x] We have a regression on how we enter houses, see house-spawn.png; Basically the camera is currently centeredon the player, but the player spawns in the top-left corner of the house interior, on one of the walls, instead of in the correct place defined by the teleporter (or in front of the teleporter as a fallback). This make it so that once I enter a house I can't leave, can't move at all, and have to reset the game. — Caused by the new maybeTeleport +1 shift turning the (0,0) magic value into (0,1), so resolveSpawn missed the back-teleporter fallback. +1 is now suppressed when both x and y are zero.

Notes:
- **Asset gap (cutscenes):** `js/cutscenes.js:110` has an empty `CUTSCENE_SHEETS` map — the demon-lord-defeat PNG isn't bundled. Logic ticks fine but renders nothing. Decide whether to ship the sheet or leave the no-op as intentional.
- **Dead import (intentional, will go live):** `js/combat.js` imports `applyPlayerDamage` from `playerHealth.js` but never calls it. Will fire as soon as ranged monsters land. Leave the import.
- **Rust features not worth porting:** `LinksHandler` (external URL trait — trivial in browser), per-platform native shells (raylib/iOS/Compose), the SwiftUI-style `ui/components.rs` view DSL (HTML already gives us that).
