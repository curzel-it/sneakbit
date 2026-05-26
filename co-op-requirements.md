# Local Co-op — HTML Spec

A line-by-line inventory of every co-op-specific behavior in the Rust core, with the current state of the HTML port and the parity gap. PvP arena (`GameMode::TurnBasedPvp`) is **explicitly out of scope** — we only port `GameMode::RealTimeCoOp`.

Source: `../dev/sneakbit/game_core/src` (read-only reference). The Rust project is no longer actively developed and format parity with its save files is a non-goal — only behavioral parity matters.

## Scope

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| Co-op mode predicate | `is_real_time_co_op()` derived from `GameMode::RealTimeCoOp` (`multiplayer/modes.rs`) | `isCoopMode()` reads `sneakbit.coop.v1` from localStorage (`js/coopMode.js:25`) | unchanged |
| Number of players | `0..MAX_PLAYERS` runtime-settable via `update_number_of_players` (`features/engine.rs:265-269`, `constants.rs:11`); `MAX_PLAYERS=4` | hardcoded to 1 (single) or 2 (co-op) in `main.js:114` | Pick: stay at 2-player only (web-realistic), OR support up to 4. Recommend **2** (we have at most one keyboard per machine; 4-player needs gamepads we haven't wired). |
| Player entity IDs | Hardcoded `420..423` in `constants.rs:23-30` (`PLAYER1_ENTITY_ID`..`PLAYER4_ENTITY_ID`) | Players don't currently live in `world.entities` — `state.player` / `state.player2` are separate objects | Adopt the same ID convention IF we ever push players into `world.entities`. Otherwise: skip — our split keeps player draw/update simpler. |
| First turn / match rules | `GameTurn::RealTime`, match in-progress until P1 dies (`turns_use_case.rs:91-114`) | No turn system; HP-driven game over | Keep current — turn logic only matters for PvP. |
| Player HP cap | `100.0` for RealTimeCoOp via `modes.rs::player_hp` | `MAX_HP=100` per player in `playerHealth.js:22` | unchanged |

## Activation / Settings UI

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| How it's enabled | `argv` flag on desktop; engine-side FFI `update_game_mode` / `update_number_of_players` | Top-level "Co-op: on/off" button on the pause menu (`menu.js:40, 290-298`) that toggles `setCoopMode` and reloads the page | **Move under Settings.** A "Local co-op" checkbox in the Settings screen, alongside SFX/Music/FPS. Still requires a page reload. |
| Help text | none — desktop-only flag | `confirm()` modal explains the two keymaps | Keep the keymap reminder near the toggle, or expose it under "Key bindings…" once activated. |

## Player Spawning

| Behavior | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| P1 spawn | `spawn_hero_at_last_known_location` → `destination_x_y` (back-teleporter / saved spawn) (`world_setup.rs:129-167`) | Existing `applySavedSpawn` / `snapToEntry` / `world.spawnPoint` flow in `main.js:96-110` and `transitions.js` | unchanged |
| P2-P4 spawn | `spawn_coop_players_around_hero` — each next player is placed at `P1.frame.offset(P1.direction)`, i.e. one tile in P1's facing direction (`world_setup.rs:169-181`) | `makeCoopP2` in `main.js:213-221` places P2 on the **same tile** as P1 (intentional stub — the first move separates them) | Match Rust: spawn P2 one tile in P1's facing direction; fall back to same tile only if blocked. |
| Per-player setup hook | `setup_hero_with_player_index(i)` runs on every spawned hero (`hero.rs:21-36`) — assigns sprite x/y, direction, sprite reset | Not called; P2 has identical sprite metadata as P1 | Add `setup_hero_with_player_index`-equivalent in `player.js`: set per-player sprite-sheet origin and `playerIndex`. |
| Co-op respawn on world transition | Rust re-runs `spawn_players` on every world change, putting P2 back next to P1 | `transitions.js::travelTo` only repositions P1 (`movePlayerTo`) | After `travelTo`, also reposition P2 next to P1 using the same offset rule. |
| Equipment spawning | `spawn_equipment` iterates all players, attaching per-player equipment instances (`world_setup.rs:183-194`) | Equipment is a global single-player slot (`equipment.js`) | See "Per-Player State" — equipment becomes per-player. |
| Slippery surface auto-step | `is_any_hero_on_a_slippery_surface` (`worlds/world.rs:310-330`) is checked per-player | Ice sliding logic in `player.js` only runs on P1 | Apply ice sliding to every active player. |

## Per-Player State

The Rust storage keys are uniformly **player-indexed** for state that should diverge between players, and **global** for state that's shared.

### Per-player (one slot per index)

| State | Rust storage key | Current HTML | Required |
| --- | --- | --- | --- |
| Inventory count | `player.{p}.inventory.amount.{species_id}` (`storage.rs:74-76`) | Single global `sneakbit.inventory.v1` JSON blob (`inventory.js`) | Replace with `player.{p}.inventory.amount.{species_id}` keys. Drive `getAmmo` / `addAmmo` from the **current player index** of the caller — every consumer (shooting, pickups, dialogue rewards, melee swings) must thread who owns the action. |
| Equipped melee | `player.{p}.equipped.melee.weapon` (`storage.rs:62-64`) — `currently_equipped_melee_weapon` | `player.0.equipped.melee` (already per-player by key but only ever index 0) (`equipment.js:12`) | Generalize to take a `playerIndex` argument. |
| Equipped ranged | `player.{p}.equipped.ranged.weapon` | same — `player.0.equipped.ranged` (`equipment.js:11`) | same |
| Equipment auto-default | `is_equipped` defaults to Kunai Launcher per player if unset (`equipment/basics.rs:84-90`) | Currently defaults globally | Per-player default. |
| HP | `world.players[p].props.hp` — live state on the per-player entity props (`hero.rs:70-74`); recovery is `HERO_RECOVERY_PS=1.0` per player | Single global `hp` in `playerHealth.js:32` | Track HP, invuln, and regen-delay per player. Damage and continuous-damage paths take a player index. |
| Player facing / position | `world.players[p].props` cached every tick from `cache_props` (`hero.rs:38-42`) | `state.player.tileX/tileY/direction` + same on `state.player2` | unchanged in concept; rename for clarity. |

### Global / shared (one slot total — keep as-is)

| State | Rust storage key | Current HTML | Required |
| --- | --- | --- | --- |
| Dialogue answer | `dialogue.answer.{text}` (`storage.rs:66-68`) | same (`dialogue.js:128`) | unchanged |
| Dialogue reward collected flag | `dialogue.reward.{text}` (`storage.rs:70-72`) | same | unchanged (reward is one-shot **globally** but credited to the player who interacted — see Pickups below). |
| World visited | `world.visited.{world_id}` | same | unchanged |
| Latest world | `latest_world` | same (`save.js:11`) | unchanged |
| Item-collected | `item_collected.{entity_id}` (per-entity, non-ephemeral worlds) | new this session (`entityVisibility.js` + `afterDialogue.js`) | unchanged |
| Skills | global flags | global flags (`skills.js`) | unchanged — skills are unlocked per save, not per player. |

## Per-Player Sprites

Rust offsets each player's hero sprite within the heroes sheet (`hero.rs:26-36`):

| Player index | Sprite frame x | Sprite frame y |
| --- | --- | --- |
| 0 | 1 | 1 |
| 1 | 5 | 1 |
| 2 | 9 | 1 |
| 3 | 13 | 1 |

These offsets index 4 visually distinct hero sprites on the `heroes.png` sheet (red / black-purple / orange / blue, judging by `assets/heroes.png`). The HTML port currently uses `HERO_BASE_FRAME = { x: 1, y: 1, w: 1, h: 2 }` for **every** player (`player.js:25`).

| Requirement | Notes |
| --- | --- |
| `createPlayer({ index })` accepts a player index | Defaults to 0. |
| `baseFrame.x` derived from index | `1 + index * 4` (matches Rust's `(1, 5, 9, 13)`). |
| Equipment overlays (sword / AR15 / etc.) | Already keyed off `player.direction`. They will continue to render correctly because the per-player offset only changes which **hero** sprite is drawn — not which equipment frame. Verify both players see their own equipped weapons (gun/sword overlays) once equipment is per-player. |

## Per-Player HUD

| Element | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| HP bar | One bar per active player; rendering is platform-layer-driven from `get_players_entity_props()` (`lib.rs:375-391`) | Single `health-hud` DOM element (`healthHud.js`) bound to global HP | Render **one HP bar per active player**. P1 stays top-left; P2's bar sits below it (or top-right — pick the simpler layout). Bars hide when a player is dead. |
| Ammo HUD | `available_weapons(player)` (`equipment/basics.rs:92-114`) returns the per-player recap — desktop draws per-player ammo lists | Single global ammo strip (`ammoHud.js`) | Show ammo for the current "active" interactable player, OR stack both. Recommend: in co-op, show P1's ammo top-left and P2's top-right; in single-player, current behavior. |
| Game-over screen | Triggered only when P1 dies (`turns_use_case.rs:91-99`) | Triggered when single player's HP hits 0 (`main.js:170`) | Trigger when **P1** dies. P2 death is recoverable (see Death/Revive). |

## Input

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| Per-player keyboard provider | `PlayerKeyboardEventsProvider[4]` (`input/keyboard_events_provider.rs:9-23`); FFI `update_keyboard(player, ...)` | `state[1]` / `state[2]` in `input.js:25-28`; co-op fans key events to the right player via `COOP_KEYMAPS` (`coopMode.js:34-53`) | unchanged for 2 players. If we ever go to 3-4, add more keymaps. |
| Gamepad routing | Per-player gamepad slot | Gamepad always feeds P1 (`input.js:86-90`) | Optional: assign a second connected gamepad to P2. Document as a stretch goal. |
| Action keys (interact / shoot / melee) | Per-player FFI hooks `has_ranged_attack_key_been_pressed(player)`, etc. | Per-player via `pickInitiator` / `pickShooter` / `pickMeleeSwinger` (already wired) | unchanged |
| Touch controls | Single touch joystick → P1 | same (`touch.js`) | unchanged (one phone, one player). |
| Pause / menu / dialogue | Affects all players (game-wide pause) | same (`isMenuOpen` / `isDialogueOpen` are global) | unchanged |

## Camera

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| Co-op camera | Averages live players' positions; degenerates to single-player follow when only one is alive or `is_turn_based` (`camera.rs:3-41`) | Always follows P1 (`camera.js::updateCamera(camera, state.player, world)`) | Implement averaging in `camera.js`: take an array of live player positions, average them, then apply existing clamp / interior-world rules. Single-player path unchanged. |
| Dead players excluded | `dead_players.contains(&p.index)` filter (`camera.rs:23`) | n/a | Pass the live-player set to `updateCamera`. |

## Death / Revive

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| Death signal | `PlayerDied(player_index)` → `dead_players.push(index)` + `handle_win_lose` (`engine.rs:163-167`) | `isPlayerDead()` → `handleDeath` immediately shows game over (`main.js:152, 179`) | Track dead players. Only call game over when **P1** dies. |
| P2 death (P1 alive) | Game continues; P2 stays out of play until the world reloads. Toast: `"notification.player.died"` (`engine.rs:275-296`) | n/a | Hide P2's sprite + HP bar; let P1 keep playing. Show a toast. P2 returns to play on the next world transition (which respawns all players via `spawn_players`). |
| P1 death | `MatchResult::GameOver`; engine waits for `revive()` (`turns_use_case.rs:91-99`, `engine.rs:306-313`) | Game over screen → travel to current world's `spawnPoint` (`main.js:262-272`, just landed) | unchanged for P1; ensure the revive path **also resets P2** (re-runs the co-op spawn-around-hero rule and clears `dead_players`). |
| Self-damage / friendly fire | Player bullets can damage other players because Rust's `pvp_allowed` is true in RealTimeCoOp (`hits_handling_use_case.rs:20-35`) | n/a — only player→monster damage is wired | Decision needed. Recommend **off** for co-op (the original is friendly-fire-on, but for a casual web build that's surprising). |
| Slippery / immobilize | `time_immobilized` clears per-player | n/a per-player | After per-player HP/state lands, immobilization tracking moves to the per-player record. |

## Combat / Damage Attribution

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| Bullet ownership | Every bullet records `parent_id` (the shooter entity ID) and `player_index` (resolved via `world.player_index_by_entity_id`, `bullets.rs:133-150`) | Bullets carry `parent_id` only; no `playerIndex` (`shooting.js:96-112`) | Tag spawned bullets with `playerIndex`. Refunds (boomerang catch) credit that player's ammo, not P1's. |
| Catcher refund | Refunds ammo for `bullet.player_index` (`hits_handling_use_case.rs:73-85`) | Refunds always go through global `addAmmo` (`combat.js:80-82`) | Route catcher refund through the bullet's `playerIndex`. |
| Melee monster damage | Applied per-player based on whose hittable frame the monster overlaps (`features/monsters.rs::handle_melee_attack`) | Only P1 takes melee damage (`combat.js::resolveMeleeMonsters(world, player, dt)`) | Iterate every live player; apply continuous damage to whoever's in range. |
| Bullet damage to player | Hero gets hit if a bullet overlaps their `hittable_frame` and the shooter is "allowed" (`hits_handling_use_case.rs`) | Player-vs-bullet check is absent on the HTML side (we only do player→monster) | Add bullet-vs-player resolution if monsters ever shoot. Out of scope for the first co-op pass; flag as TODO. |

## Pickups / Dialogue Rewards

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| Auto-pickup attribution | `world.first_index_of_player_in(area)` picks the player who collects the bundle (`pickable_object.rs:8-13`) | `checkPickup(state)` only checks P1's tile (`pickups.js:26-46`) | Iterate every live player; the first one whose tile overlaps the pickup gets the ammo. |
| Dialogue reward grant | `Dialogue::handle_reward(player)` credits the player who initiated the dialogue (`dialogues.rs:62-88`); reward-collected flag is global | Reward goes to global inventory; `dialogue.reward.{text}` is global (correct) (`dialogue.js:127-137`) | Thread the initiating player index from `interact.js::pickInitiator` into `showDialogue` → `handleReward(d, playerIndex)` → `addAmmo(reward, 1, playerIndex)`. |
| Auto-equip on pickup | Sets `setEquipped(slot, weaponId)` globally | (per-player once equipment moves) | Equip into the picking-up player's slot, not always P1. |

## Sound Effects (player-attributed)

Rust tags every player-originated sound with the player index (`features/state_updates.rs:25-42`):

| Event | Rust enum |
| --- | --- |
| `NoAmmo(PlayerIndex)` | `state_updates.rs:35` |
| `KnifeThrown(PlayerIndex)` | `state_updates.rs:36` |
| `SwordSlash(PlayerIndex)` | `state_updates.rs:37` |
| `GunShot(PlayerIndex)` | `state_updates.rs:38` |
| `LoudGunShot(PlayerIndex)` | `state_updates.rs:39` |

This is so the desktop port can pan / attenuate per player. For the HTML build, the player index is informational at best. **No required change** — current SFX firing in `shooting.js` / `melee.js` is fine. Document as informational.

## Cutscenes / Dialogue Triggers

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| Cutscene trigger | Position-keyed off P1 only (`features/cutscenes.rs:40-81`); marks complete globally on first play | `cutscenes.js` triggers off `state.player` | unchanged |
| NPC interaction dialogue | First adjacent player who's "pressing confirm" wins (`entity.rs::handle_dialogue_interaction` via `index_of_any_player_who_is_pressing_confirm`) | `pickInitiator` picks the player whose interact key was pressed (`interact.js:45-52`) | unchanged |
| Fast travel link | Either player can stand on it; the menu opens, both stop | Only P1 can trigger (`fastTravel.js::findLinkNearPlayer(world, player)`) | Accept either player. The menu acts globally. |

## Save / Load

| Aspect | Rust | Current HTML | Required |
| --- | --- | --- | --- |
| Number-of-players persisted? | No — `update_number_of_players` is a runtime FFI; the desktop client picks per launch | Yes — `sneakbit.coop.v1` localStorage flag (`coopMode.js:15-30`) | unchanged |
| Per-player inventory in save | Each `player.{p}.inventory.amount.{species_id}` saved | Single `sneakbit.inventory.v1` JSON blob | Migrate. Add a v36-equivalent that splits the existing inventory into `player.0.*` and seeds `player.1.*` empty. Old `sneakbit.inventory.v1` becomes the migration's input. |
| Per-player position in save | Cached in `world.players[p].props` for live state only; durable spawn lives in `world.spawn_point` (per-world, not per-player) | `save.js` stores P1 tile + direction | Decision: do we save P2's last position? Recommend **no** — P2 always spawns next to P1 on world load (matches Rust). Document this. |

## Migrations Needed

Concrete migration tasks once the per-player split lands:

1. **Inventory split.** Read the old `sneakbit.inventory.v1` JSON blob; rewrite each `{ speciesId: count }` entry into per-player storage keys under `player.0.inventory.amount.{speciesId}=count`; leave `player.1.*` empty. Delete the old blob.
2. **Equipment fan-out.** The existing `player.0.equipped.melee` / `player.0.equipped.ranged` keys already line up. Seed `player.1.equipped.ranged` with the default kunai launcher on first co-op activation.
3. **Versioning.** Bump `js/migrations.js` to a new revision so the split runs exactly once.

## Out of Scope

These Rust co-op-adjacent features are intentionally **not** ported:

- **PvP arena.** Entire `GameMode::TurnBasedPvp` path, corner-spawn (`world_setup.rs:68-105`), turn rotation (`turns_use_case.rs::Player(turn_info)`), HP=1000.0 cap, world 1301.
- **4-player support.** We target a single keyboard. Stretch goal only.
- **Friendly fire.** Off by default in the HTML port.
- **Per-player sound pan.** Web SFX is mono — `(PlayerIndex)` payloads on sound events stay informational.
- **Save format compatibility with the Rust desktop save.** Behavioral parity only.

## Implementation Order (suggested)

1. **UI**: Move co-op toggle from the pause menu into Settings (small, isolated).
2. **Sprites**: Use the per-index hero offsets (cosmetic, isolated). Visible parity win.
3. **Spawning**: Place P2 in P1's facing direction instead of stacked on the same tile.
4. **HP per player**: Split `playerHealth.js` into a per-player record; render N HP bars.
5. **Inventory per player**: Migrate storage; thread `playerIndex` through `addAmmo`/`removeAmmo`/`getAmmo`. Touches `pickups.js`, `dialogue.js` (reward), `shooting.js` (ammo decrement), `melee.js`.
6. **Equipment per player**: Same fan-out for `equipment.js`. Add to migrations.
7. **Combat per player**: `resolveMeleeMonsters` over all live players; bullets tag `playerIndex`; catcher refunds to that player.
8. **Pickups per player**: First adjacent player wins; equip into that player's slot.
9. **Camera averaging**: `updateCamera(camera, [p1, p2], world)` averages live positions.
10. **P2 death + revive**: Track `deadPlayers`; only P1 death ends the game; respawn-on-world-change resets everyone.

Steps 1-3 are visible wins with very small blast radius. Steps 4-7 are the meat of feature parity. Step 10 closes the loop.
