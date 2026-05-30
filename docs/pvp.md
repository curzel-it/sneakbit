# PvP Mode — SneakBit

Turn-based, last-player-standing PvP. This document is the authoritative spec
for PvP in the web port: it first records the **existing Rust model** (the
canonical behaviour, copied faithfully from `../sneakbit/game_core`), then
extends it to two delivery modes the port must support — **local PvP**
(everyone on one machine) and **online PvP** (friends over the relay). Where
`README.md`, `CLAUDE.md`, or code comments disagree, this wins.

The guiding constraint, same as online co-op: **trust model is "friends
playing together."** Cheating prevention is out of scope.

---

## 1. The Rust model (canonical, as shipped)

PvP is one of three game modes. Source: `game_core/src/multiplayer/modes.rs`.

```
GameMode::RealTimeCoOp = 0   // the normal game; player bullets don't hurt players
GameMode::Creative     = 1   // editor
GameMode::TurnBasedPvp = 2   // PvP
```

Mode-dependent knobs:

| Knob | Co-op / Creative | TurnBasedPvp |
|------|------------------|--------------|
| `player_hp()` | 100 | **1000** |
| `allows_pvp()` | false | true |
| `is_turn_based()` | false | true |
| players controlled per frame | all | **only the current player** |
| spawn layout | hero + co-op players around them | **one per map corner** |
| camera | union of living players | **follows the current player** |

### 1.1 Entering the arena

- The arena is reached through an in-world **PvP arena link** entity
  (`EntityType::PvpArenaLink`, `species_id 1185`). `update_pvp_arena` fires an
  `EngineStateUpdate::PvpArena` when the hero is *moving* and *pointed at* the
  link's entrance tile (`frame + (2,3)`, 1×1).
- The engine sets `pvp_arena_requested = true`; the game layer opens
  `PvpArenaMenu`. It shows `pvp_arena.menu.title` / `pvp_arena.menu.text`
  ("All players will be using this computer · One controller per player
  required · Turn-based combat · Only one map for now") and a player-count
  list `2..=MAX_PLAYERS` plus *Back*.
- Confirming count `N` calls `handle_pvp_arena(N)`:
  - `game_mode = TurnBasedPvp`
  - `turn = first_turn(TurnBasedPvp)` → `PlayerPrep(P1)`
  - `dead_players.clear()`, `number_of_players = N`
  - teleport to `Destination::nearest(1301)` — **world 1301 is the only arena
    map.** (`engine.rs` guards it: entering 1301 while `!allows_pvp()`
    immediately calls `exit_pvp_arena()`.)

### 1.2 Spawning

`spawn_players_at_map_corners` (`world_setup.rs`): players `0..N` are placed in
the TopLeft / TopRight / BottomLeft / BottomRight quarters respectively (so
2 players are diagonal, 4 fill all corners), facing `Down`, immobilized for
0.2 s. `MAX_PLAYERS = 4`.

### 1.3 The turn machine

Source: `multiplayer/turns.rs` + `turns_use_case.rs`. Constants
(`game_core/src/constants.rs`):

```
TURN_PREP_DURATION                    = 3.0 s
TURN_DURATION                         = 10.0 s
TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE = 2.0 s
```

States: `RealTime` (co-op only), `PlayerPrep(info)`, `Player(info)`. Each
`PlayerTurnInfo` carries `{ player_index, time_remaining, did_reduce... }`.

Flow per match (driven by `updated_turn(turn, N, dt)` each frame):

1. **`number_of_players == 1` freezes the machine** — the turn never advances.
   (Relevant to online: a match with one live participant just idles.)
2. **`PlayerPrep`** counts `TURN_PREP_DURATION` down. The HUD shows
   `prep_for_next_turn` ("Player %PLAYER_NAME%'s turn in %TIME%..."). At ≤0 it
   becomes **`Player`** with `time_remaining = TURN_DURATION`.
   - **Prep is a pure pause — nobody acts.** `currently_active_players()`
     returns `vec![]` during `PlayerPrep` (`lib.rs`), so no slot is live: it is
     the "oh god, it's my turn, where's the controller?!" breather between one
     player's turn and the next. Movement and aim begin only when the state
     flips to `Player`. (`world.rs::update_players` would route input to the
     prep player, but with no active slot the platform sends none — the port
     should simply gate all input off during prep.)
3. **`Player`** counts `TURN_DURATION` down. At ≤0 the turn advances to the
   next player index (wrapping `last → P1`) and re-enters that player's
   `PlayerPrep`.
4. **Only the current player's input is live.** `world.update_players` feeds
   real keyboard to `current_player_index()` and `NO_KEYBOARD_EVENTS` to
   everyone else, so off-turn players are frozen where they stand.

**Hit-and-the-clock-cuts rule.** When the active player lands damage on an
*enemy* player (`EngineStateUpdate::PlayerReceivedDamage`, where the damaged
index ≠ the current player), `update_turn_after_player_damage` clamps the
current turn to `min(remaining, TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE)` =
≤2 s and flags `did_reduce_due_to_ranged_weapon_usage`. You land a hit, you
get ~2 s to follow up, then the turn passes. This stops a player from poking
once and stalling the clock.

### 1.4 Combat resolution

`hits_handling_use_case.rs`: a player-fired bullet damages a player target
only when `!shooter_is_player || pvp_allowed`. So in co-op players can't shoot
each other (the port adds an optional `friendlyFire` toggle on top), but in
PvP every player bullet is live. `player_hp = 1000` makes matches last.

**Weapons.** All weapons are available to every player in PvP — there is no
PvP-specific loadout or weapon restriction. The only thing the mode changes is
the player-vs-player damage gate above; weapon selection, ammo, and pickups on
the arena map behave exactly as in normal play.

**In-flight bullets at a turn boundary.** When a turn ends with a player's
bullet still travelling, the port may do whichever is simpler — despawn it, or
freeze it and resume on the next active turn. This is not gameplay-critical
(it's an edge case worth at most a couple of frames of a bullet); don't build
machinery for it. The Rust core doesn't special-case it.

### 1.5 Death, win/lose, rematch

- On `PlayerDied(index)`: push to `dead_players`; a toast
  `notification.player.died` ("Player %PLAYER_NAME% is gone") shows; if the
  dead player was the active one, skip straight to the next turn (computed
  with `TURN_DURATION * 2` so the corpse's slot is skipped cleanly);
  `handle_win_lose`.
- `handle_win_lose` for PvP: when `dead_players.len() >= N - 1` (one or zero
  left standing) → `Winner(the surviving index)`, or `UnknownWinner` if none
  resolve (simultaneous death). Otherwise `InProgress`. (The fourth
  `MatchResult` variant, `GameOver`, is **co-op-only** — it's returned when P1
  dies in `RealTimeCoOp`. PvP never produces it, so the port's existing
  co-op game-over path is untouched; PvP only adds the winner/unknown screens.)
- The death screen reads `match_result()`:
  - `Winner(i)` → title `death_screen.player_won` (`%PLAYER_NAME%` = `i+1`),
    subtitle `death_screen.start_new_match`.
  - `UnknownWinner` → `death_screen.unknown_result`.
  - Confirm (`E` / any pad confirm) → `revive()` → clears `dead_players`,
    resets the match.
- **Exit:** the in-game menu's *Exit PvP* item (confirmation
  `game.menu.exit_pvp_are_you_sure`) calls `exit_pvp_arena()`:
  `game_mode = RealTimeCoOp`, `number_of_players = 1`, teleport to Duskhaven
  `(1011, 59, 57)`.

All the player-facing strings already ship in `data/strings.{en,it}.json`
(`pvp_arena.*`, `prep_for_next_turn`, `death_screen.*`,
`game.menu.*pvp*`, `game.menu.number_of_players.*`, `notification.player.died`).

---

## 2. Local PvP (one machine, the original assumption)

The Rust design *is* local PvP: same screen, turn-based, "one controller per
player." The port already has the pieces; PvP is mostly wiring a game-mode
enum through them.

### 2.1 What the port already has

- **Per-slot input.** `gamepad.js` routes one pad per player slot;
  `keyBindings.js` / `gamepadBindings.js` hold per-player layouts.
  `coopMode.js` tracks `localPlayerCount()` (currently capped at 2, with a
  roadmap item to reach 4).
- **Multiple heroes** in one world (local co-op spawns P2 around P1).
- **Per-player health** (`playerHealth.js`), **combat** with a `friendlyFire`
  setting (`combat.js` / `settings.js`), **death / game-over** UI
  (`gameOver.js`), and a **camera** that already unions player viewports.

### 2.2 What local PvP adds

1. **A `GameMode` for the port.** Introduce one feature file (e.g.
   `js/gameMode.js`) exporting `getGameMode()` / `setGameMode()` over
   `{ coop, creative, pvp }`, mirroring the Rust enum. `isCoopActive()` and the
   friendly-fire gate both consult it. PvP implies `friendlyFire = true`
   unconditionally and `playerHp = 1000`.
2. **A turn machine** (`js/turns.js`) — a faithful port of `turns.rs` /
   `turns_use_case.rs` with the same three constants. It is the single source
   of "whose turn, how long left, prep vs active." Pure and unit-testable
   (the Rust file already has tests to mirror).
3. **Input gating.** During an active `Player` turn the frame loop forwards real
   input only to `currentPlayerIndex()`; off-turn slots get empty input. During
   `PlayerPrep` **every** slot gets empty input (the pause window — see §1.3).
   This reuses the existing per-slot routing — it just masks slots each frame.
4. **Corner spawns.** A PvP spawn layout placing `0..N` at map corners
   (port of `spawn_players_at_map_corners`), instead of co-op's "around P1."
5. **PvP-aware camera.** In PvP the camera follows the **current player**, not
   the union (port of the `is_turn_based()` branch in `camera.rs`).
6. **Turn HUD.** A non-canvas overlay (per `CLAUDE.md`: UI lives in the DOM)
   showing the prep countdown (`prep_for_next_turn`), the active player's
   remaining time, and the "turn cut to 2 s after a hit" state. This is new UI;
   it belongs in its own file (`js/turnHud.js`).
7. **Match result → death screen.** `gameOver.js` already renders a death
   modal; extend it to read a match result (winner / unknown) and offer
   *Rematch* (`death_screen.start_new_match`) which re-runs spawns + resets the
   turn machine, vs the co-op *try again* path.
8. **Entry + exit.** Two routes, pick per product call:
   - **Menu-driven** (recommended for the port): a "PvP (Beta)" entry in the
     party/menu surface picks player count and starts a match on the arena
     map. Simpler than porting the in-world `PvpArenaLink` entity.
   - **In-world link** (faithful): port the `PvpArenaLink` entity + entrance
     probe. Only worth it if we ship the arena inside the explorable world.
   - *Exit* always returns to story mode at Duskhaven `(1011, 59, 57)`.

### 2.3 Map

World **1301** is the canonical arena (already in `data/`). Ship it as the
single map for the beta, matching `pvp_arena.menu.text` ("Only one map for
now"). Additional arenas are a later content drop, not a code change.

**Soundtrack.** A dedicated arena soundtrack is planned but lands later; for the
beta the arena reuses the existing music. The audio swap is a content/asset
follow-up, not part of the core PvP wiring.

---

## 3. Online PvP (friends over the relay)

Online PvP **reuses the host-authoritative model** in `docs/online-coop.md`
verbatim — host simulates, guests predict + render, the relay forwards frames.
PvP is a different *game mode running on the host*, not a new transport.

> Read `docs/online-coop.md` first. Everything here is a delta on top of it.

### 3.1 What carries over unchanged

- Host runs the whole simulation including the turn machine and hit
  resolution. Guests forward input and render the mirror world.
- Lobby by 5-char invite code, anonymous UUID identity, in-memory sessions,
  session lifetime = host lifetime (+30 s grace), WebRTC data-channel
  transport with the WS relay fallback.
- Snapshot broadcast + interpolation for non-self entities; client-side
  prediction for the guest's own avatar and bullets.

### 3.2 What online PvP changes

1. **Mode is chosen in the lobby, not by walking into a link.** The host
   selects "PvP" + a player count when opening the session. The match starts
   when the lobby is full (or the host force-starts); the host sets
   `GameMode = pvp`, runs corner spawns, and teleports everyone into world
   1301. The in-world arena link is local-only.
2. **One guest = one player slot.** Co-op already adds a guest avatar like a
   second local player; PvP assigns each connected peer a fixed
   `player_index`. Host is always a player (P1) in the simplest model; a
   pure-spectator host is a later option.
3. **Friendly fire is always on.** `allows_pvp()` is true, so the host applies
   player-vs-player damage with no `friendlyFire` setting consulted.
4. **Turn ownership is enforced host-side.** The host already feeds
   `NO_KEYBOARD_EVENTS` to off-turn players; for guests it simply **drops
   forwarded input unless that guest owns the current turn.** A guest cannot
   move or shoot off-turn even if their client sends input (lag, cheating, or
   a mashed button). Client-side, an off-turn guest's prediction is disabled —
   they spectate.
5. **Turn state must be on the wire.** Extend the snapshot/event protocol with
   the turn so every client's HUD is correct:
   ```
   turn: {
     phase: "prep" | "active",
     playerIndex: 0..3,
     timeRemaining: float seconds,
     reducedAfterHit: bool        // the ≤2 s clamp fired
   }
   ```
   This is host→all, broadcast on every change (phase flip, player advance,
   hit-clamp) and on a low-rate heartbeat so a late-joining/​reconnecting
   guest can resync the countdown. It is **authoritative** — guests render it,
   never compute it.
6. **Camera follows the active player for everyone.** Matching Rust's
   turn-based camera: all clients (including off-turn guests) center on the
   current player, so the match reads as a shared spectator view with control
   passing around. The guest whose turn it is sees their own avatar centered
   and predicted; others interpolate it.
7. **Match result is host-authoritative.** The host computes `handle_win_lose`
   and broadcasts a terminal `matchResult` event (`winner(i)` /
   `unknownWinner`). Every client shows the death/winner screen from it.
   *Rematch* is a host action (re-spawn + reset turn machine + rebroadcast);
   guests' confirm is a request the host may honor, not a local restart.
8. **Disconnect = death.** A guest who drops mid-match is treated as a dead
   player for `handle_win_lose` (so the match can still resolve to a winner),
   and their turn is skipped. The 30 s grace from co-op still applies before
   the slot is finalized, but the turn machine must not stall waiting on an
   absent player — an off-turn or current-turn drop advances normally.

### 3.3 Protocol additions (delta on online-coop.md)

| Direction | Message | Purpose |
|-----------|---------|---------|
| host → all | `mode: "pvp"` in the session/start frame | clients enter PvP rendering (turn HUD, spectator camera, FF on) |
| host → all | `turn { phase, playerIndex, timeRemaining, reducedAfterHit }` | authoritative turn state (on change + heartbeat) |
| host → all | `matchResult { kind: "winner"|"unknown", playerIndex? }` | end-of-match screen |
| guest → host | existing input frames | host **ignores** unless guest owns the current turn |
| guest → host | `rematchRequest` | host may honor to restart |

No new transport, no new relay logic — the relay keeps forwarding opaque
frames.

---

## 4. Open questions / product decisions

1. **Host as player vs neutral referee.** Simplest: host is P1. A spectator
   host (host simulates but isn't a combatant) is cleaner for odd-player
   matches and streaming, at the cost of "the host doesn't get to play."
2. **Local + online mixed.** Can a host have 2 local players *and* remote
   guests in one PvP match (e.g. couch 2v2 online)? The slot model allows it;
   input gating must key on `(peer, localSlot)` not just peer.
3. **Turn length tuning.** 10 s active / 3 s prep / 2 s post-hit come straight
   from Rust. They may feel long online with interpolation latency — keep them
   configurable in the turn machine so balancing is data, not code.
4. **Reconnect mid-turn.** If the *current* player reconnects within grace,
   do they resume their remaining time or forfeit the turn? Spec'd default:
   forfeit (turn already advanced on drop); revisit if it feels punishing.
5. **More maps.** The beta ships world 1301 only. Multiple arenas + a map
   vote in the lobby is a content/UI follow-up, not core.

---

## 5. Implementation checklist (suggested order)

- [ ] `js/gameMode.js` — port the `GameMode` enum + mode-dependent knobs.
- [ ] `js/turns.js` — port the turn machine (with the Rust unit tests mirrored).
- [ ] PvP spawn layout (corners) + PvP camera (follow current player).
- [ ] Input gating: only the current player's slot is live each frame.
- [ ] `js/turnHud.js` — DOM turn/prep countdown overlay.
- [ ] Match-result path in `gameOver.js` (winner / unknown / rematch).
- [ ] Local PvP entry/exit (menu-driven; arena map 1301).
- [ ] Online: lobby mode select, turn + matchResult on the wire, host-side
      turn-ownership input gating, spectator camera, disconnect-as-death.
