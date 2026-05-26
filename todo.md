A: 
- [x] I can currently use teleporters to reach other levels, but not to enter buildings
- [x] Coordinates of the player after using a teleporter to not match original (seem we go one tile above expected)
- [x] Menu button on mobile currently hides the ammo count
- [x] Melee combat button should be hidden if I have no sword equipped
- [x] On mobile, arrow keys should be a bit closer together
- [x] Damage system is currently too gentle, my hp reneration is so fast monsters basically do nothing to me. I don't know why regen is fast, but monsters damage might have been impacted by the new movement system we have. Ideally damage should stay DPS where time is "time passed on the same tile or on adjacent tiles where distance between me and the mob is < 0.9 tile", meaning that if a monster is in the next tile over I start receiving damage when he starts moving towards my tile.
- [x] Ther's some performance issues on mobile, as I move it seems that FPS stays healty (> 60), but the game stutters a lot. might be becase of map generation? is it cached? do we cache the whole level ahead of time? 

B:
- [ ] Start the game as mute by default on all platforms (currently only on mobile)
- [ ] Full save and load like in Rust
- [ ] **Wire skill unlocks to gameplay.** Skills (piercing/boomerang/catcher) persist but are only toggleable from devtools — needs an in-game acquisition path (dialogue reward or pickup).
- [ ] **Pushable objects, pressure plates, locks & keys.** Puzzle primitives from the Rust game, none ported.
- [ ] **Cutscene system.** Scripted sprite animation sequences triggered by proximity (one-shot, persisted).
- [ ] **Monster fusion / minion spawning.** Lower priority — distinctive Rust mechanic but a bigger lift.
- [ ] **Trails / footstep effects.** Polish.
- [ ] Audit the entity z-sort comparator in `js/entities.js` against the Rust ordering — survey flagged remaining z-index discrepancies vs the original.

C:
- [ ] **Knockback / straight-line movement primitive.** Useful as a building block for hit reactions and projectile trails.
- [ ] **Ranged monsters.** Mobs only melee right now. Rust has projectile-firing mobs.
