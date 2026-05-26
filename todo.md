Todo list uses a tier system that is part propritization and part parallelization across agents.

Possible bugs:
- [x] `New Game` does not wipe current level and position
- [x] Make absolutely sure we are during integer scaling to preserve pixel art, across all platforms and screen sizes. See suspicious-non-integer-scaling.png
- [~] Rendering of equipment such as swords, AR15, and so on — first pass landed (overlay rendered while equipped), but pickups don't auto-equip yet so it isn't visible end-to-end

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
