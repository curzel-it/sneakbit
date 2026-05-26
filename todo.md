- [x] Rendering of tiles (both bimoe and construction) is properly scaffolded, but we have some bugs. For example, we don't use the correct tile based on neighboring tiles. 
- [x] Seems like we are not using the same sound effects as the old game, I think it's time we port them over
- [x] I need icons to see how much ammo I have (like the old game did)
- [x] I want to be able to shoot kunais
- [x] z-index is not calculated in the same way as it was in the original game. for example, the hero spanws on a magic circle in 1001, but in our js implementation the hero spawns "behind" it
- [x] Supposedly static npcs appear to be walking, such as the wizard in 1001 (who appears to be walking up)
- [x] Single kunais that I can pick up from the ground are usingthe movmenet sprite instead of the "idle" one
- [x] On mobile, toasts notification partially cover the movement joystick, they should instead be shown on the top
- [x] Toast notifications do not be have like the og, for example, some show a "tap to dismiss" thing. They should all be auto-dismiss
- [x] I should be able to collide with other npcs, based on their species
- [x] When traversing a teleporter and loading the new world, the player should appear in the correct place, as indicated in the (source) world json
- [x] We need a pause menu
- [x] Pause menu should show app version somehwere in small text

## Gap-vs-Rust backlog (from 2026-05-26 review)

Ranked roughly by gameplay impact.

- [x] **Dialogue conditionals + rewards.** Ported Rust dialogue system: first-match selection on `{key, expected_value}` via storage.js, plus `dialogue_read.<text>` tracking and one-time reward grant on close (inventory + toast). Includes `AfterDialogueBehavior` (Disappear / FlyAwayEast).
- [x] **Melee combat.** New `melee.js` — G key (and on-screen ⚔ button) spawns five short-lived bullets in the Rust cross pattern around the player, applying `bullet.dps * weapon.melee_dps_multiplier` via combat.js. Cooldown + SFX from the equipped weapon's species data.
- [ ] **Save/load.** At minimum mirror Rust's `latest_world` (respawn point) and `item_collected.<entity_id>` (one-time pickups) keys. Full save snapshots can come later.
- [ ] **Wire skill unlocks to gameplay.** Skills (piercing/boomerang/catcher) persist but are only toggleable from devtools — needs an in-game acquisition path (dialogue reward or pickup).
- [x] **Light conditions.** World JSON's `lightConditions` is now driven by the renderer: `Day` = no-op, `Night` = translucent blue wash, `CantSeeShit` = existing radial darkness.
- [x] **Equipment system.** New `equipment.js` — per-slot (`ranged`/`melee`) currently-equipped weapon species, storage-backed. Defaults: ranged = kunai launcher; melee = none. Shooting derives bullet species from the equipped launcher's `bullet_species_id`. Switchable via `window.equipment` (devtools).
- [ ] **Ranged monsters.** Mobs only melee right now. Rust has projectile-firing mobs.
- [ ] **Pushable objects, pressure plates, locks & keys.** Puzzle primitives from the Rust game, none ported.
- [ ] **Cutscene system.** Scripted sprite animation sequences triggered by proximity (one-shot, persisted).
- [ ] **Italian localization.** i18n framework is already in place; just port `lang/it.stringx`.
- [ ] **Monster fusion / minion spawning.** Lower priority — distinctive Rust mechanic but a bigger lift.
- [ ] **Knockback / straight-line movement primitive.** Useful as a building block for hit reactions and projectile trails.
- [ ] **Trails / footstep effects.** Polish.

### Code-health notes (not features, but worth a look)

- [ ] Audit the entity z-sort comparator in `js/entities.js` against the Rust ordering — survey flagged remaining z-index discrepancies vs the original.
