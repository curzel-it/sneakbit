New features:
- [x] Allow users to rebind every key on desktop (this is not available in the rust build)

Multiplayer:
- [x] Co-op using WASD+ZXC and IJKL+BNM, can be started from menu (MVP — shared HP/ammo, camera follows P1)

Creative Mode:
- [x] Game should support a ?creative=true (default false) param, which, when true, enables creative mode
- [x] Save export/import should only be avilable when in creative mode 
- [x] Perform a comprehensive review of the rust codebase and create a creative-mode-requirements.md which list every single last feature of the creative mode as implemented in rust

Bugs:
- [x] **Off-screen entities should not update.** Rust only ticks entities visible on screen (with some padding) — see `features/hitmaps.rs::update_hitmaps`. This is a gameplay feature, not just a perf optimization: it lets the player precisely time a kunai launch (setting up traps, triggering doors from remote) and prevents monsters from merging uncontrollably off-screen. We currently iterate all entities every frame.
- [x] Seems that some monsters can walk through buildings, see monster-over-house.png for an example
- [x] `ammo-hud` shows the correct icon, but the icon has an unnecessary black background
- [ ] npcs that are supposed to disappear after dialogue do not disappear... some of them at least? not sure
- [ ] some entity visibility conditions are not respected. for example in 1002 I can see the wizard before I talk with punk
