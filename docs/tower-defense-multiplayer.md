Plan: Local + Online co-op Tower Defense

Guiding model: per-player hero ownership

Today TD has one global "active hero" (heroSwitch.js: activeIndex): one human drives it, the other heroes are AI, Tab/Q cycles the human through all heroes. I'll
generalize that single active-index into per-player ownership:

- Each player (local input slot 1..K, or an online guest) owns exactly one hero. By default slot s owns hero index s‑1.
- Heroes nobody owns are free → AI-driven (allyAI).
- Starting heroes = number of players, each a distinct archetype by slot (P1 Ninja, P2 Barbarian, P3 Bombardier, P4 Knight — the existing TD_HERO_LOADOUTS order).
- Switching = a player releases their hero (it reverts to AI) and possesses a free hero. With heroes == players there are no free heroes, so it's a no-op. Recruited
heroes (slots beyond the player count) are free/AI and are exactly what switching can grab.

This is a strict generalization: solo (P=1) stays bit-for-bit the current behavior — one owner, cycling through all heroes.

Phase 1 — Refactor heroSwitch.js to ownership (no behavior change)

- Replace activeIndex with an ownership map (input-slot ↔ hero-index, plus "free" set). Keep solo semantics identical.
- New helpers: ownedHeroFor(slot), ownerSlotOf(heroIndex), freeHeroes(state), switchHeroForSlot(slot, isDead), and a generalized cameraTargetFor(slot).
- Rewrite towerDefense.simulate() input loop: per hero, route input by owner — local owner → pollInput(slot); free → seekVisibleArea/driveAlly; (guest owner handled in
Phase 3).
- Tests: rewrite tests/heroSwitch.test.js for ownership; allyAI/TD e2e stay green.
- Files: js/heroSwitch.js, js/towerDefense.js, tests/heroSwitch.test.js.

Phase 2 — Local co-op TD

- startTowerDefense(): stop forcing setLocalPlayerCount(1); honor the current local player count.
- spawnSquad(): spawn P heroes (indices 0..P‑1) on the hero-spawn tiles, distinct archetypes, full HP — generalize the hardcoded 2-hero spawn.
- Party-panel entry: Tower Defense respects the existing 2/3/4 player toggle so it can start a local co-op run.
- Split-screen: for P≥2, TD renders the same per-slice split-screen the normal co-op game uses, each slice's camera following that slot's owned hero (reuse
recomputeSlices/auto-zoom path). Solo/online-host stay single-camera (followActiveHero).
- Per-player switching among free heroes (each local slot has its own switch key via the existing co-op keymaps).
- Tests: unit (spawn-count = player-count, ownership wiring); new tests/e2e/towerDefenseCoop.test.mjs (2 local players each move a distinct hero).
- Files: js/towerDefense.js, js/partyPanel.js, js/heroSwitch.js, tests.

Phase 3 — Online co-op TD

The host stays fully authoritative — it runs the whole TD sim; guests render the mirror. Enemies are zone entities already broadcast at 20 Hz, and mode already syncs,
so the new plumbing is narrow:
- TD shared-state channel: add a td.state host event kind (hostEvents.js allow-list) carrying the buildModel (phase, wave, map, lives, gold, score, countdown,
alive/total, per-player hero names, recruit/revive availability). Broadcast throttled (~5 Hz) + immediately on phase change.
- Host sim drives guest heroes: in simulate(), a guest-owned hero is animated via updateGuestAvatar (committed steps) instead of updatePlayer; guest shoot/melee
already route through hostGuests.dispatchActionForSlot (works once the guest's hero carries its archetype index/loadout).
- Guest TD HUD: guestEvents handles td.state → shows the TD HUD (reuse tdHud.js) populated read-only; hide normal HUD. Enter/exit on mode change (mirrors the pvpStart
precedent).
- Economy is host-only in v1 (recruit / revive / start-wave buttons disabled for guests) to avoid races. (Flagging this — say if you want guests to spend gold too.)
- Guest join/leave: join mid-run → assigned the next free hero if one exists, else spectates; leave → their hero reverts to AI. Run starts with the players connected
at start.
- Guest switch: a guest's Tab/Q sends a tdSwitch intent; host cycles that guest to a free hero.
- Entry: host (already in host role) clicks Tower Defense → starts a TD run without tearing down the session; connected guests adopt td via snapshot. (?join stays
barred from the URL latch.)
- Tests: tests/e2e/towerDefenseCoop.test.mjs host+guest smoke (guest sees waves + HUD, drives its own hero); unit tests for td.state serialize/apply.
- Files: js/towerDefense.js, js/hostEvents.js, js/guestEvents.js, js/tdHud.js, js/hostGuests.js, js/partyPanel.js, tests.

Phase 4 — Polish & cleanup

- HUD button gating per role, edge cases (join mid-wave, all-guests-leave), decide high-score persistence in co-op (I'll keep the local high score solo-only unless you
say otherwise), comment cleanup, update docs/ if it documents TD.

Testing & shipping

- npm run test:unit after every phase (before each commit). npm run test:e2e before any push touching the networking files (Phase 3). Small focused commits, main kept
green. No npm run deploy unless you ask.

====

Additional info

1. all players share teh same gold pool and everyone can spend it (there's no shop for now)
2. players can join layer and immedaitely take control of any free hero. if no free hero, then one is created n the fly
3. High score out of scope