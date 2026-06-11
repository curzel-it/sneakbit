# Multiplayer — SneakBit

SneakBit has two flavours of multiplayer:

- **Offline** — everyone on one machine. Split-screen co-op (one shared world,
  one viewport per local player) and hotseat turn-based PvP. No netcode.
- **Online** — **host-authoritative** co-op and PvP over WebSocket + WebRTC. One
  player is the **host** and runs the normal single-player game unchanged; up to
  three **guests** join the host's world through a thin relay.

This document is the authoritative spec for both — design, the wire protocol,
the WebRTC transport, and the guest-authoritative movement model. If `README.md`,
`CLAUDE.md`, or code comments disagree, this wins. The bulk is online co-op
(sections from *Online co-op* onward); offline is covered first and briefly.

> **Contributors:** every operational example uses `sneakbit.curzel.it` — the
> maintainer's production relay. **Swap it for your own hostname** on a fork; do
> not rely on `sneakbit.curzel.it` being reachable, having spare capacity, or
> matching your client build. The origin allowlist + `ALLOWED_ORIGINS` env wire a
> client origin to your own relay.

---

# Offline multiplayer

Everyone shares one keyboard / a set of controllers on one machine. No relay, no
prediction, no snapshots — the single game loop simulates every player directly.
Player-vs-player tile collision is **NONE** in every mode (players may share a
tile); this is uniform across offline and online.

## Local split-screen co-op

`coopMode.js` puts 2–4 players in one shared world. Rather than a single averaged
camera (which shoved a partner off-frame the moment players walked apart), each
local player gets **their own viewport slice with a follow-self camera**.

- **`js/splitScreen.js`** owns the layout + per-slice cameras: given the window
  size and the live local-player list, it produces N slice rects (in backing
  pixels) and N cameras. `renderer.js` `renderViewports()` draws each slice
  (clip + translate, slice-local darkness/light-cone), `main.js` wires
  `state.cameras` (`cameras[0]` aliases `state.camera`), `camera.js` follows one
  player per slice (no averaging), `zoom.js` sizes per-slice tile counts, and the
  HUD (`healthHud.js`, `ammoHud.js`) anchors per slice (DOM, never canvas).
- **Layout** (re-evaluated on resize / orientation), aspect = `vw/vh`:
  - 1 player → full window.
  - 2 → wide (aspect > 4:3) side-by-side, tall (< 3:4) stacked.
  - 3 → wide 3 columns, tall 3 rows; **near-square (3:4…4:3) → 2×2 with one empty
    cell**.
  - 4 → always 2×2.
- **Input-gated:** split-screen needs a keyboard and/or controllers — each player
  needs their own input device. Touch-only multi-player is deferred (a phone with
  paired controllers still gets split). It is not desktop-only.
- A dead player keeps their slice (spectator view of where they fell); the grid
  only re-flows when the local player count changes or the window resizes.

Single-player is simply the N=1 case of the same slicing system — no second code
path. **Online never uses split-screen**: every machine already renders its own
follow-self window, so there's no reason to show another player's POV.

Status: **implemented**. Coverage: `tests/splitScreen.test.js` (pure layout math)
+ `tests/e2e/splitScreenLayout.test.mjs`.

## Local turn-based PvP (hotseat)

Turn-based, last-player-standing PvP on one machine, one controller per player.
Entry is menu-driven (pause menu → "PvP (Beta)" → 2–4 players); "Exit PvP" returns
to Duskhaven. The model is ported faithfully from the original Rust core
(`game_core`, the shared source of truth for both delivery modes).

**Canonical model.** PvP is one of three game modes (`RealTimeCoOp`, `Creative`,
`TurnBasedPvp`). PvP-only knobs: `player_hp` **1000** (vs 100), friendly fire
**on**, **only the current player** acts per frame, spawns **one per map corner**,
camera **follows the current player**.

**Turn machine** (`js/turns.js`, port of `turns.rs`). Constants:
`TURN_PREP_DURATION = 3.0`, `TURN_DURATION = 10.0`,
`TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE = 2.0`, `MAX_PLAYERS = 4`. States:
`RealTime` (co-op), `PlayerPrep(info)`, `Player(info)`.

- `number_of_players == 1` **freezes** the machine (a one-participant match idles).
- **Prep** counts down 3 s — a pure pause, nobody acts — then flips to **Player**
  with 10 s.
- **Player** counts down, then advances to the next index (wrapping last→P1) and
  re-enters that player's prep. Only the current player's input is live.
- **Hit-and-the-clock-cuts:** damaging an *enemy* player clamps the turn to
  `min(remaining, 2.0)`. Land a hit → ~2 s to follow up → turn passes. Stops
  poke-and-stall.
- Rotation does **not** skip dead players (a dead slot still gets an idle
  prep+turn); the only early skip is the **active** player's own death.
- **Win/lose:** resolves to `Winner(survivor)` once `dead ≥ N−1`, or
  `UnknownWinner` on a simultaneous wipe. `GameOver` is co-op-only; PvP never
  produces it.
- **Spawns:** corners (TopLeft/TopRight/BottomLeft/BottomRight), facing Down,
  immobilised 0.2 s. **Exit:** back to `RealTimeCoOp`, teleport to Duskhaven
  `(1011, 59, 57)`. Arena is world **1301** (the only map for now).

**Loadout** (`js/pvpLoadout.js`) — per-player, non-persisted: equipped ranged
weapon + a **per-caliber** ammo count, tracked by bullet species. Players spawn
with the kunai launcher and zero ammo and **scavenge the arena** (world 1301 ships
kunai / AR15 / cannon ammo crates and weapon crates): `pickups.js` routes PvP ammo
into the matching caliber and weapon crates swap the equipped weapon, per player;
`shooting.js` fires the equipped weapon and spends its caliber. Kept out of
`inventory.js` so PvP never touches P1's saved story inventory; the arena reloads
each match so pickups respawn and nothing leaks into the save. No melee in PvP.

Code: `gameMode.js` (`isPvp`, `pvpPlayerHp`), `turns.js`, `pvpSpawn.js`,
`pvpMatch.js` (turn state, dead set, win/lose, `pvpSlotCanAct` gate), `turnHud.js`
(DOM countdown). Status: **implemented** — unit tests (`turns`, `gameMode`,
`pvpSpawn`, `pvpMatch`) + `tests/e2e/pvp.test.mjs`; debug hook `window.pvp`.

---

# Online co-op — host-authoritative

The same architecture covers desktop split-screen via a native wrapper that
bundles the relay on `127.0.0.1` — no special-case "local-only" code path.

## Design tenets

1. **The host's browser is the entire simulation.** The host runs today's
   single-player code unmodified. Guests' avatars are added the same way a second
   local player would be.
2. **The server is a relay + lobby, never a simulator.** It pairs hosts with
   guests by invite code, forwards frames, and stays as small as possible. No tick
   loop, no game logic.
3. **Fluidity is the single hard requirement.** Guests use client-side prediction
   for their own avatar and bullets, and interpolation for everything else. Local
   input has zero perceived latency.
4. **Client and relay share one origin** at <https://sneakbit.curzel.it> — the VPS
   serves the static client and brokers co-op (nginx serves the bundle at `/`,
   proxies the relay on `/ws` + the JSON endpoints).
5. **Role is runtime state, not a URL contract.** `?host=1` / `?join=CODE` are
   deep-link entry points, but switching offline ↔ host ↔ guest happens in place
   via `switchRole`. Save namespaces are kept distinct per role.
6. **Identity is an anonymous UUIDv4** generated by the browser on first run,
   persisted in `localStorage`. No usernames, no accounts, no auth on the relay.
7. **Sessions are formed by invite code** (e.g. `K7MJ2`, 5 alphanumeric chars).
8. **In-memory only.** The relay holds sessions in process memory; a restart drops
   every session. No DB. (The server also hosts a *separate* account/saves
   subsystem — `server/db.js`, `authRoutes.js`, `savesRoutes.js` — that the co-op
   relay never touches.)
9. **Cheating prevention is out of scope.** Trust model: "friends playing
   together." A malicious guest can desync or spam but can't write the world.
10. **Session lifetime = host lifetime** (plus a 30 s grace). No host migration.
11. **Native wrappers reuse the same network model.** A desktop binary bundles the
    relay; local split-screen spawns it on `127.0.0.1` with N webviews using role
    params.

**Why host-authoritative.** A fully-authoritative server is robust but expensive
(every mob and combat resolution runs on the VPS); a peer-ownership model needs an
ownership broker. Host-authoritative is lighter still because the host runs the
game *exactly as today*. The cost — host lag is everyone's lag, host quitting ends
the session — is acceptable for "invite my friend for an hour."

## Vocabulary

- **Host** — the client whose simulation *is* the game. Owns every entity, NPC,
  pickup.
- **Guest** — a client that sends inputs and renders state from the host. Predicts
  its own avatar locally.
- **Session** — a host + 0–3 guests sharing one running world. Lives until the
  host disconnects past grace.
- **Invite code** — 5 alphanumeric chars identifying a session.
- **Relay** — the Node server. Routes frames; runs no game logic.
- **Snapshot** — host-broadcast full world state; **delta** — per-tick sparse
  change set.
- **Seq** — monotonic per-guest sequence number. The host echoes the last-resolved
  step seq per guest (`lastSeq`) in every snapshot/delta.

## Architecture at a glance

```
host (browser)               relay                guest (browser)
─────────────                ─────                ──────────────
existing local tick   ◄───WS/DC───  fan-out  ◄──── committed steps + actions (seq-stamped)
   (unchanged)        ────WS/DC───► fan-out  ────► snapshots / deltas (20 Hz)
                                                    │
                                                    ├──► render host's state (interpolated)
                                                    └──► reconcile own avatar against lastSeq
```

- Single Node process. Maps sessions to connection lists; nothing else.
- WebSocket transport for handshake/lifecycle/signaling; game traffic upgrades to
  a WebRTC DataChannel per guest. JSON frames. Versioned handshake.
- No DB; all relay state is in process memory. Server restart = sessions dropped.
- No `shared/` split. The client grows by a networking module + a prediction
  module on guests + an input-injection module on the host.

## Authority boundaries

| Concern | Owner |
|---|---|
| World state, NPCs, mobs, combat, pickups, gates, puzzles, dialogue, cutscenes, zone transitions | **Host** (always) |
| Guest's own avatar **tile path** | **Guest** commits steps; **host** validates legality + executes (see *Guest-authoritative movement*) |
| Guest's HP, inventory, damage outcomes | **Host** is authoritative; guest predicts visuals |
| Guest's action intents (shoot/melee/interact) | **Guest** sends; host applies |
| Camera, zoom, animation interpolation, audio, HUD, menus, settings, key bindings | Each client locally |
| Save state | Host's localStorage. Guests do not persist session state. |
| Creative mode, map editor | Host only — hard-disabled for guests |

The guest **owns its own tile path and predicts visuals**, but the host decides
HP, damage, and world reactions. On disagreement the host wins and the guest
reconciles.

## Fluidity strategy

Every input must produce a visible response within one frame (≤16 ms), even on a
200 ms-RTT guest.

**Host fluidity** — trivial. Unchanged offline game: input → local tick → render.

**Guest fluidity** — three techniques:

- **a) Client-side prediction (own avatar).** `predictedSelf` is an in-process
  copy of the guest's avatar that consumes local input every frame via the real
  `player.js` model, so movement feels instant. It is *also the source of truth*
  for the avatar's tile path — it streams committed tile-steps to the host. See
  *Guest-authoritative movement*.
- **b) Exact reconciliation.** Every snapshot/delta echoes `lastSeq[selfId]` and
  the guest's authoritative tile. The guest compares the host's tile to the result
  of its own step #`lastSeq`: match → lockstep, mismatch → hard snap. (Not a fuzzy
  tolerance — exact, because the tile grid is discrete and the guest already ran
  the decision.)
- **c) Entity interpolation (everything else).** Other players, NPCs, mobs,
  pushables, projectiles render by interpolating between the last two
  snapshots/deltas, with forward-extrapolation while a step is in flight. Render
  at `now − INTERP_DELAY_MS` (100 ms). `> STALE_MS` (300 ms) with no frame →
  freeze + "Host lagging…"; `> 1 s` → the guest fires `guest.resync`; ~5 s →
  auto-fallback to offline.

**What the guest does NOT predict:** damage outcomes (it fires the bullet visually;
the host decides if it landed), pickup confirmations (inventory waits for the
host's event/delta), zone transitions (it fades while waiting for the new-zone
snapshot). Movement and spawning own bullets are predicted; world reactions are
not. Standard FPS recipe.

## Identity

- On first run the client generates a **UUIDv4** and persists it under
  `sneakbit.online.uuid`. Sent on every WS connect (`hello`). The relay validates
  the format and rejects a malformed uuid with close `4001`.
- Reconnect with the same UUID within the 30 s grace → resume the same player slot
  in the same session. Beyond grace → fresh entry.
- Display name: shortened UUID prefix (e.g. `Player-a3f9`). Custom names deferred.
- Two tabs with the same UUID → the relay closes the older connection with code
  `4003`.

## Sessions and invites

- **Open** — host sends `host.open`. The relay creates the session, generates a
  5-char code, replies with `host.opened {code, maxGuests}`.
- **Join** — guest navigates to `?join=CODE` or types it; client sends
  `guest.join {code}`. The relay validates capacity (max 3 guests) and pairs them,
  assigning a slot (2/3/4).
- **Leave (guest)** — explicit "Leave co-op" or WS close. Host is told via
  `peer.left` (immediately on explicit leave, after grace on disconnect).
- **Close (host)** — host clicks "End co-op." The relay broadcasts `session.closed`
  to guests; they fall back to offline.
- **Cap** — 4 (1 host + 3 guests).
- **Lifetime** — while the host is connected, plus a 30 s reconnect grace.

A session *is* the group. There is no party model — guests cannot promote, swap,
or persist independently of a host.

**Deep-link `?join=CODE` while already in a session** is honored unconditionally:
the client auto-leaves its current session (`host.close` if hosting, `guest.leave`
if guesting), then auto-joins the new code. Deep-links are typically followed
deliberately; silently ignoring or modal-prompting either traps the user in the
wrong session or adds a click on the most common path.

## Host setup

When the client enters host mode it:
1. Runs the existing single-player game **identically** — same tick, renderer,
   save namespace.
2. Loads/generates the UUID, opens a WS, sends `host.open`; gets
   `host.opened {code}` and shows it in the Party panel.
3. On `peer.joined`/`peer.rejoined`, spawns a guest avatar in the local world,
   reusing local-coop infra: a guest is P2/P3/P4 from the host's perspective
   (`hostGuests.js`; `coopMode.js`/`pickups.js`/`melee.js`/`shooting.js` already
   split inventory/equipment/HP per slot).
4. Runs the 20 Hz broadcaster (`snapshotBroadcaster.js`): a fresh full snapshot on
   join/zone-change/resync, sparse deltas otherwise.
5. On each received `move` (committed step), validates legality and executes step
   animation; on each `input` action, injects it into the per-slot pipeline.
6. On `peer.left`, despawns the guest's avatar and frees the slot (after grace if a
   disconnect).

The host never consumes a snapshot. Its local renderer is the truth.

## Guest setup

When the client enters guest mode it:
1. **Skips its own world simulation** — no host tick, AI, or pickups locally.
2. Loads renderer, input layer, HUD, audio, asset loader, and the mirror/predict
   stack.
3. Loads/generates the UUID, opens a WS, sends `guest.join {code}`; gets
   `guest.joined` and a full `snapshot`.
4. Maintains: a **mirror world** (`mirrorWorld.js`, from snapshots/deltas), a
   **predicted self** (`predictedSelf.js`), a mirror interpolation buffer, and a
   committed-step log (`guestInputForwarder.js`).
5. Renders `predictedSelf` for its own avatar, interpolated mirror for everyone
   else; reconciles on every snapshot/delta.

Creative mode + map editor are hard-disabled; the guest-role boot path skips
host-only installs (migrations, firstLaunch, offline-state HUDs) and hides "New
game"/"Clear cache" while running as guest. Pause menu, settings, audio, key
bindings are all local.

## Tick & snapshot model

- **Host tick rate:** unchanged from offline (`requestAnimationFrame`).
- **Broadcast rate:** 20 Hz (`BROADCAST_INTERVAL_MS = 50`). Independent of the
  local tick; the broadcaster samples the latest state and ships sparse `delta`
  frames, a full `snapshot` on join / `peer.rejoined` / zone change / resync.
- **Quiescent keepalive:** after `KEEPALIVE_TICKS` (4 → 200 ms) of nothing-changed,
  the host ships an empty-entity `delta` carrying all player positions so the
  mirror's `lastFrameAt` stays fresh (no false "Host lagging…") and predicted-self
  reconciliation keeps running.
- **Static zone data is NOT shipped.** Host and guest run the same build and load
  the same level JSON from disk. The guest's mirror calls its local
  `loadZone(zoneId)` on any unfamiliar `zoneId`. Only dynamic state crosses the
  wire.
- **Discrete events** (death, pickup, dialogue, cutscene, zoneChange, toast, …)
  ride alongside as `event` frames, not in the snapshot.

20 Hz with sparse deltas comfortably fits 50–100 KB/s per guest at worst.

### Snapshot / delta payload shape

Both frames carry `v` (game-frame schema), `t` (host tick counter), `zoneId`,
`mode` (`getGameMode()`), `players`, `entities`, and `lastSeq`. A `delta` adds
`removed: {entities:[…]}` when entities leave.

- **Players** — every snapshot/delta/keepalive ships **all** players (`playerId`,
  `slot`, `index`, `x`/`y` rounded to 3dp, `tileX`/`tileY`, `direction`, `moving`,
  `hp`). Optional per-player: `sw`/`swd` (melee swing cooldown + duration while
  swinging), `aura` (knockback-aura anim seconds), `pw`/`pa` (PvP equipped weapon +
  ammo). Whether a delta *fires* is gated by a per-player change signature
  (`sigPlayer`: tile/direction/moving/hp/slot/swing-edge/aura — deliberately
  **not** x/y), but when anything fires the payload is always *all* players. This
  is load-bearing: an avatar jammed on a blocker has a frozen signature and would
  otherwise be filtered out, leaving the guest's predicted self to run away
  unbounded.
- **Entities** keep **changed-only** treatment (they're the bandwidth bulk):
  `id`, `species_id`, `frame{x,y,w,h}`, plus optional `hp`, `_open`, `_dead`,
  `_dying`, `_spawned`, `direction`, and `moving` (for AI entities). Host-
  authoritative visibility is applied (`shouldBeVisible`) so a collected pickup or
  flag-gated NPC never reaches guests.

## Disconnect & reconnect

- **Guest disconnects:** the relay marks it ghosted with 30 s grace and tells the
  host via `peer.ghosted`; the host **keeps the avatar in place, frozen**, and
  releases that slot's held keys. Reconnect within grace → resume same UUID/slot
  (`peer.rejoined`). After grace → `peer.left {reason:"timeout"}`, despawn, free
  the slot.
- **Host disconnects:** the relay marks the host ghosted with 30 s grace; guests
  get `host.ghosted` + a "Host lagging…" indicator and freeze their mirrors.
  Reconnect within grace → host re-issues `hello` + `host.open`; the relay matches
  the UUID, resumes the session, fans `host.resumed` to guests, and the broadcaster
  sends a fresh full snapshot. After grace → `session.closed {reason:"host_timeout"}`
  and guests fall back to offline. The host loses no progress (save is local).
- **Server restart:** every WS drops; the drain path broadcasts
  `session.closed {reason:"server_restart"}` first. The host's tab keeps running;
  guests fall back to offline. Both can reconnect after the relay returns.

No host migration.

## Persistence

- The relay holds zero persistent co-op state.
- The host persists its save normally (localStorage, unchanged).
- Guests do **not** persist any session state — each join is fresh from the host's
  world. They keep their UUID across sessions so the host can recognise "the same
  friend" (useful for future per-friend settings, irrelevant today).

## Cheating posture

Out of scope, but for the record:
- A guest can lie about seq, send garbage, or flood — mitigated by per-connection
  rate limits at the relay, an action cooldown + range check on the host
  (`hostGuests.js`), and a bounded queued-step cap.
- A guest cannot write world state — only the host's simulation can. A guest's
  illegal committed step is rejected and snapped back.
- The relay sees JSON over TLS — same trust model as any WS app.

---

# Guest-authoritative movement

This is how movement stays smooth and rubber-band-free. It replaced an earlier
"host re-simulates the guest from forwarded key edges" model that lost junction
races (the host guessed the path between input edges and sometimes guessed wrong).

## Model

**Each player is authoritative for its own avatar's tile path. The host validates
legality; it no longer runs movement *decisions* for guest avatars — only step
animation.**

The tile grid is **discrete** and the guest already runs an authoritative copy of
its own avatar (`predictedSelf`). A committed tile-step is an *already-made
decision*, not a sampled input the host must re-time — so the guest ships
decisions, not inputs, and the host stops guessing the path between edges. This
deletes the whole speculation-race bug class (junctions, late stops, multi-key
holds) and makes reconciliation exact. Applies to **both co-op and PvP** (uniform
path; in PvP the host can reject illegal moves but cannot stop pure lag-timing —
accepted tradeoff).

## Wire format (guest → host)

`predictedSelf` ticks every frame via the real `player.js` model (against a
`predictionZone` — the mirror with self-driven mobs stripped, so a lagged mob the
host already walked past doesn't freeze the guest for an RTT). On each transition it
emits via `forwardMove`:

| Message | Shape | When |
|---|---|---|
| Step commit | `{ op:"move", seq, k:"step", fx, fy, tx, ty, d }` | `predicted.step` goes null→non-null (chained steps each get a new object). `(fx,fy)` = source tile, `(tx,ty)` = target tile, `d` = direction. |
| Face / stop | `{ op:"move", seq, k:"face", x, y, d }` | idle direction change, or step→idle (stopped). |

Action intents carry facing so the host fires the right way and ordering vs a face
update can't matter:

```
{ op:"input", seq, t, intent:"shoot"|"melee"|"interact", d }
```

Movement intents (`moveUp/moveDown/moveLeft/moveRight/stopMove/holdSync`) **no
longer exist** — this was a clean break (one `npm run deploy` flips host and guest
together; a stale cached client breaks until reload, acceptable for opt-in co-op).

## Exact reconciliation contract

The host ships, per guest, `lastSeq[guestId]` alongside the guest's authoritative
tile in every delta/keepalive. The guest keeps a **committed-step log**
(`{seq, tx, ty}` per emitted step). On each incoming snapshot/delta
(`predictedSelf.onAuth`):

- **`snapshot`** (join / resync / zone change) → hard reset: snap predicted to
  auth, clear the step-log unconditionally.
- **`delta`** → re-anchor to the result tile of the newest resolved step, drop
  acked entries, then compare:
  - **Match** (`auth.tile == stepLog[lastSeq].result`) → lockstep; any gap between
    predicted and auth is just unacked in-flight steps. No snap.
  - **Mismatch** → real divergence (rejection / knockback / host displacement) →
    hard snap predicted to auth, clear the step-log; the next frames re-commit from
    currently-held keys (so the snap doesn't undo a key the user is still holding).

There is no fuzzy tolerance and no input replay — both deleted with the old model.

### `lastSeq` definition (host side)

`lastSeq[guest]` = the seq of the most recent step whose outcome is final and
reflected in the avatar's current `tileX/tileY`:

- **Accepted step** → advance `lastSeq` **at the snap** (when `tileX` becomes the
  result tile), not at `startStep` — acking mid-step would read as a false
  mismatch.
- **Rejected step** → advance `lastSeq` **immediately**, tile unchanged. *Load-
  bearing:* a no-displacement rejection (a gate the guest's mirror shows open but
  the host has closed) must still snap the guest — `lastSeq` advances while the tile
  stays put, so the guest sees `auth.tile ≠ stepLog[seq].result` → snap. Without
  this, and with the tolerance gone, the guest would walk a phantom corridor
  forever.
- **Queued step** (arrived mid-step) → do **not** advance until it resolves.
- Action/face seqs share the counter but **never** touch `lastSeq`.

`tileX/tileY` and `lastSeq` update inside the same synchronous `updateGuestAvatar`
call, so the broadcaster always reads a consistent `(tile, seq)` pair.

## Host validate / execute

`hostGuests.onMove` routes by slot. For `k:"step"`:
- **Dead guard** first — reject all moves for a dead avatar.
- **From-tile check** — the commit must originate at the avatar's *chain tip* (its
  current tile when idle, or the target of the last in-flight/queued step). After a
  host displacement the guest commits from a stale tile for ~1 RTT; those reject
  until the next delta snaps it.
- **Idle** → `applyNetStep(avatar, d, zone)` (wraps `player.startStep`, preserving
  pushable carry-back + gate side effects + `canEnter`); accept iff a step was
  produced and its target == `(tx,ty)`, else reject.
- **Mid-step** → stash in `avatar.netQueuedSteps` (consumed at the snap), capped at
  `MAX_NET_QUEUED_STEPS` (6) — past the cap, reject (ack so the guest resyncs)
  rather than grow unbounded.

Validation uses the host's own authoritative zone + `canEnter`, with **no mob
special-casing**: all moving mobs are `is_rigid:false`, so they never block heroes;
the only blockers are static geometry (identical on both ends) or host-owned
dynamic state (gate `_open`, pushable position), where a disagreement is a real
divergence resolved by reject→snap. **No player-vs-player collision** (players may
share a tile, uniformly across all modes).

Actions get a light cheat-resistance pass on the host: a per-guest, per-intent
cooldown (`ACTION_COOLDOWN_MS`: shoot/melee 180 ms, interact 250 ms) and a
range/alive/in-bounds check before dispatch.

## Edge cases

- **Knockback / host displacement** — auth tile ≠ `stepLog[lastSeq].result` → exact
  snap.
- **Ice / slippery** — each slide tile is a committed step, emitted + validated
  individually.
- **Pushables / gates** — executed via `startStep` reuse → authority preserved.
- **Zone change** — full snapshot resets mirror + predicted-self; step-log cleared.
- **Reconnect** — re-emit current move/face from `getPredictedSelf()`; clear the
  step-log; pending action intents flushed sub-TTL.
- **Dead guest** — host rejects moves; predicted-self frozen while dead; PvP respawn
  reposition is a host displacement → caught by reconcile.

Code anchors: `js/predictedSelf.js` (emit + reconcile), `js/guestInputForwarder.js`
(step-log + action/reconnect send), `js/hostGuests.js` (`onMove`/`onStep`/`ackStep`),
`js/player.js` (`applyNetStep`, `updateGuestAvatar`, `setGuestAckSink`),
`js/snapshotBroadcaster.js` (ships tile + `lastSeq`).

---

# Wire protocol

## Transport

- **WebSocket.** TLS in production (`wss://sneakbit.curzel.it/ws`), plain in dev
  (`ws://localhost:8090/ws`). One JSON object per frame, UTF-8. Endpoint `/ws`.
- **Compression:** the relay negotiates RFC 7692 `permessage-deflate` with
  `no_context_takeover` on both sides (`server/wsExtensions.js`). ~60 % shrinkage
  on JSON deltas, no streaming state to manage.
- **`?server=` override** is dev-only — honored only when the page itself is loaded
  from `localhost`/`127.0.0.1`. On a deployed build it's ignored (a malicious
  `?server=wss://attacker/ws` link would otherwise re-route the session); the
  client logs the ignored override.

### WebRTC upgrade path

Once the WS handshake is up, game traffic (snapshots, deltas, events, moves,
inputs) moves to an `RTCDataChannel` between host and each guest. The relay only
forwards offer/answer/ICE via `webrtc.signal` (opaque payload); wire shapes for
game ops are unchanged.

- **Topology:** the **guest is the initiator** for every channel — it creates the
  channel and ships the offer; the host listens and answers. Once a DC is `open`,
  the client's send-side interceptor (`js/webrtcTransport.js`) routes game ops over
  it. The WS stays warm for signaling, lifecycle frames, and as fallback if WebRTC
  fails to negotiate.
- **NAT traversal:** **STUN** — public list in `js/webrtcChannel.js`
  (`DEFAULT_STUN_SERVERS`), enough for most consumer NATs. **TURN** — the relay
  exposes `GET /turn-credentials` returning short-lived HMAC-SHA1 credentials
  (coturn `use-auth-secret`, TURN REST API). When `TURN_SECRET` + `TURN_URLS` are
  unset the endpoint returns **503** and the client uses STUN only.
- WebRTC's SCTP transport handles its own framing — no `permessage-deflate` there.

### Frame schema versioning

Two independent versions:
- **`protocol`** (currently `1`) — the WS handshake version, negotiated in `hello`.
- **`GAME_FRAME_SCHEMA`** (currently `1`) — stamped as `v` on host-authoritative
  game frames (`snapshot`/`delta`/keepalive). These ride the DataChannel and bypass
  the relay, so they carry their own version. A frame with no `v` is treated as
  schema 1; bump only on an incompatible snapshot/delta shape change.

## Versioning & handshake

- Client opens the WS, sends `hello` with the `protocol` it speaks.
- Server matches → `welcome`. Below `minProtocol` (also `1`) → `obsolete` + close
  `4001`; the client reloads.

```
1. Client opens WS
2. C → S: hello
3. S → C: welcome  (or obsolete + close 4001)
4. Role handshake:
     host:  C → S: host.open        ; S → C: host.opened {code, maxGuests}
     guest: C → S: guest.join {code}; S → C: guest.joined {…peers, slot}  or  guest.joinFailed
            S → host: peer.joined {playerId, name, slot}
5. Steady state:
     host → S → guests:  snapshot, delta, event.*
     guest → S → host:   move, input
     either → S → other: webrtc.signal ; C → S: ping (S → C: pong)
6. Either side closes the WS (server-initiated closes carry a 4xxx code)
7. Reconnect: WS open + hello with the same UUID, then the same role handshake
     - Within 30 s grace: resume in place (peer.rejoined / host.resumed)
     - After grace: re-open (host) or re-join (guest)
```

## Message catalogue

Every message has an `op` discriminant. `C →` = client → server; `S →` = server →
client. Frames the server forwards as a relay are noted.

### Handshake — `hello` / `welcome` / `obsolete`
```jsonc
{ "op":"hello", "protocol":1, "uuid":"8a1c…2f", "client":"sneakbit" }
{ "op":"welcome", "protocol":1, "playerId":"p_a3f9b1", "name":"Player-a3f9" }
{ "op":"obsolete", "minProtocol":2, "message":"please reload" }
```

### Host — `host.open` / `host.opened` / `host.close` / `host.kick`
```jsonc
{ "op":"host.open" }
{ "op":"host.opened", "sessionId":"sess_8c3f12", "code":"K7MJ2", "maxGuests":3 }
{ "op":"host.close" }                      // → session.closed to all guests, frees the session
{ "op":"host.kick", "playerId":"p_b1d2e3" }
```
`host.kick`: the relay validates the sender is the session host and the target is a
guest in the same session, closes the kicked guest's WS with **4005**, and fans
`peer.left {reason:"kicked"}` to the host + remaining guests. The kicked client does
not auto-reconnect; there is no kick-list, so a kicked guest may re-attempt
`guest.join` and it's the host's job to kick again.

### Guest — `guest.join` / `guest.joined` / `guest.joinFailed` / `guest.leave`
```jsonc
{ "op":"guest.join", "code":"K7MJ2" }
{ "op":"guest.joined", "sessionId":"sess_8c3f12", "hostName":"Player-a3f9",
  "slot":2, "peers":[{"playerId":"p_b1d2e3","name":"Player-b1d2","slot":3}] }
{ "op":"guest.joinFailed", "reason":"not_found"|"full"|"host_offline" }
{ "op":"guest.leave" }                     // → peer.left to host
```

### `guest.resync` (C guest → S → host)
```jsonc
{ "op":"guest.resync" }
```
The guest's mirror has gone stale (no delta for ~1 s) and asks for a fresh full
snapshot. The relay routes it host-bound (`from:<guestPlayerId>`, like `move`/
`input`). The host's broadcaster reuses its full-snapshot path and fans the result
to **all** guests (re-baselining any other lagging mirrors at no extra cost),
throttled to one rebuild per requesting guest per second. No reply on the request
itself — the snapshot is the answer.

### `guest.loadout` (C guest → S → host → guests)
Carries the guest's equipped melee/ranged selection so the host and other guests
render the right equipment overlay. Mirrored back out as an `event:loadout`.

### Peer lifecycle (S → host + remaining guests)
```jsonc
{ "op":"peer.joined",   "playerId":"p_b1d2e3", "name":"Player-b1d2", "slot":3 }
{ "op":"peer.rejoined", "playerId":"p_b1d2e3", "name":"Player-b1d2", "slot":3 }  // within grace
{ "op":"peer.left",     "playerId":"p_b1d2e3", "reason":"leave"|"disconnect"|"timeout"|"kicked" }
{ "op":"peer.ghosted",  "playerId":"p_b1d2e3" }   // to host: guest dropped, 30 s grace
{ "op":"host.ghosted" }                            // to guests: host dropped, 30 s grace
{ "op":"host.resumed" }                            // to guests: host reconnected within grace
{ "op":"session.closed","reason":"host_quit"|"host_timeout"|"server_restart" }
```
`peer.left` is fanned to the host and every remaining guest so all clients despawn
the departed avatar in lockstep.

### `input` (C guest → S → host) — actions only
```jsonc
{ "op":"input", "seq":12345, "t":1717423424123,
  "intent":"shoot"|"melee"|"interact", "d":"up"|"down"|"left"|"right" }
```
The relay stamps `from:<guestPlayerId>`. `t` is the guest's wall-clock (host uses
it for telemetry only — there is no clock sync). Movement is **not** here (see
`move`).

### `move` (C guest → S → host) — committed tile-steps
```jsonc
{ "op":"move", "seq":12346, "k":"step", "fx":3,"fy":5, "tx":3,"ty":6, "d":"down" }
{ "op":"move", "seq":12347, "k":"face", "x":3,"y":6, "d":"right" }
```
See *Guest-authoritative movement*. The relay stamps `from` and routes host-bound,
identical to `input`.

### `snapshot` / `delta` (C host → S → all guests)
Host-authoritative world state. `snapshot` is a full baseline (join / resync /
zone change); `delta` is the per-tick (20 Hz) sparse change set + quiescent
keepalive. Shape and field semantics are in *Snapshot / delta payload shape* above.
```jsonc
{ "op":"snapshot", "v":1, "t":1234, "zoneId":1001, "mode":"coop",
  "players":[{ "playerId":"p_a3f9b1","slot":1,"index":0,
               "x":3.0,"y":5.0,"tileX":3,"tileY":5,"direction":"down","moving":false,"hp":100 }],
  "entities":[{ "id":4242,"species_id":1019,"frame":{"x":7,"y":2,"w":1,"h":1} }],
  "lastSeq":{ "p_b1d2e3":1240 } }

{ "op":"delta", "v":1, "t":1235, "zoneId":1001, "mode":"coop",
  "players":[ /* all players, same shape */ ],
  "entities":[{ "id":4242,"hp":12,"_open":true }],
  "removed":{ "entities":[9999] },
  "lastSeq":{ "p_b1d2e3":1245 } }
```
Static zone data (biome/construction/decor tiles) is not shipped — host and guest
share level files; the mirror calls local `loadZone(zoneId)` on any unfamiliar
zone.

### `event` (C host → S → guests)
Discrete one-shots, stamped with a monotonic `eid` (so a duplicate delivery of an
*additive* event like `pickup` can be dropped on a path switch / reconnect replay).
Guests silently ignore unknown kinds. Allowed `kind`s (`hostEvents.js`):
`pickup`, `death`, `respawn`, `dialogueOpen`, `dialogueAdvance`, `dialogueClose`,
`cutsceneStart`, `cutsceneEnd`, `zoneChange`, `toast`, `hostPause`, `loadout`,
`giant`, `ammoSet`, `coins`, `pvpStart`, `pvpResult`, `pvpEnd`.
```jsonc
{ "op":"event","kind":"pickup","playerId":"p_b1d2e3","speciesId":5,"amount":1,"eid":42 }
{ "op":"event","kind":"death","playerId":"p_b1d2e3","eid":43 }
{ "op":"event","kind":"zoneChange","zoneId":1002,"fromZoneId":1001,"eid":44 }
```
`zoneChange` is a heads-up frame, **not** a payload carrier — emitted immediately
*before* the new-zone `snapshot` so the guest can fade its overlay before the
mirror swaps zones underneath it; it fades back in once the snapshot lands.

### `webrtc.signal` (host ↔ guest, relayed)
Opaque pass-through for offer/answer/ICE. The relay never inspects `payload`; it
routes by `to`/`from` (host fan-in for unaddressed guest frames, host fan-out to
the named guest for outbound). Guest frames omit `to` (destination is always the
host); the relay stamps `from`.
```jsonc
{ "op":"webrtc.signal","to":"p_b1d2e3","payload":{"kind":"offer","sdp":"v=0…"} }
{ "op":"webrtc.signal","payload":{"kind":"ice","candidate":{ … }} }
```

### `ping` / `pong`
Heartbeat. The client sends `ping` every 20 s; the relay replies `pong`. No traffic
for 60 s → idle close `4002`.

## Close codes

| Code | Meaning | Client action |
|---|---|---|
| `1000` | Normal closure / session ended host-side | "Disconnected" toast; nothing to rejoin |
| `1001` | Host/server going away | Fall back to offline |
| `4001` | Obsolete protocol or malformed UUID | `location.reload()` |
| `4002` | Idle timeout (no traffic 60 s) | Auto-reconnect **once**, then "Disconnected" |
| `4003` | UUID conflict (another tab) | "Already playing in another tab" |
| `4004` | Rate-limit ban (severe abuse) | "Disconnected — too many messages"; reconnect after 60 s |
| `4005` | Kicked by host | "You were removed"; **no** auto-reconnect; `switchRole("offline")` |
| `4006` | Server at capacity (`MAX_CONNECTIONS`/`MAX_SESSIONS`/per-IP) | "Server is full"; back off ≥30 s |
| `4500` | Internal error / restart | "Server error — reconnecting…" + auto-reconnect |

The relay also emits standard lower-level codes (`1002`, `1006`, `1007`, `1009`) on
frame/transport errors (oversize frame, inflate failure, abnormal close).

## Rate limits & server caps

- **Inputs + moves (guest):** 30/s per connection. Excess silently dropped.
- **Broadcasts (host):** 30/s per connection (snapshot/delta/event; ~50 % over the
  nominal 20 Hz to allow zone-change bursts). Excess silently dropped.
- **All other ops:** 10/s per connection.
- **Severe abuse:** 1000+ messages in any 10 s window → close `4004`; same UUID may
  reconnect after 60 s.
- **Capacity:** `MAX_CONNECTIONS` (500), `MAX_SESSIONS` (100), and a per-IP
  connection cap (32) → close `4006`.

## Reconnection

- On WS close the client backs off `1 / 2 / 4 / 8 / 16 / 30 s` and reopens, then
  sends `hello` with the same UUID. Backoff resets on `welcome` (not `onopen`), so
  a TLS-OK-but-immediately-closed failure escalates instead of fast-looping at the
  1 s floor.
- Within the 30 s grace, the role handshake restores the session in place. After
  grace it's a fresh connection — the guest re-enters the code; the host gets a new
  code.
- `4001`/`4003`/`4004`/`4005`/`4006`/`1000`/`1001` are no-reconnect; `4002` gets one
  retry.

---

# Online PvP

## Realtime deathmatch — shipped

"Current PvP, but realtime + online." The host picks **Realtime PvP (Beta)** in the
Party panel (needs ≥1 guest). On start the host sets the realtime PvP mode,
broadcasts a **`pvpStart`** event (guests enter PvP rendering — 1000-HP bar, PvP
ammo HUD), travels everyone to arena 1301 (the normal `zoneChange` + full snapshot
carry the guests), corner-spawns host + every guest at 1000 HP, and runs
`pvpMatch.startMatch(n, /*turnBased*/ false)`. Each frame the host
(`tickHostFrame`) notices deaths → `notifyPlayerDied` → `handleWinLose`; the
terminal result broadcasts as **`pvpResult`** and shows via the shared
`gameOver.showMatchResult` on every client. **`pvpEnd`** dismisses the overlay when
the host leaves.

Combat, damage, HP, and positions all ride the unchanged co-op sync;
**follow-self camera is already what online co-op does** (host → own avatar, guest
→ `predictedSelf`). The one bespoke sync: each player's equipped weapon (`pw`) +
current ammo (`pa`) ride the snapshot player record so a guest's own scavenge ammo
HUD is correct (`guestSelfHpSync` applies the self values into `pvpLoadout`).
Host-only controller: `onlineDeathmatch.js`; `isRealtimePvp()`/`isTurnBasedPvp()`
split the variants. Deferred: frags/respawn scoring, spectator host, mixed
local+online, a richer end-of-match lobby return.

## Turn-based — delta on the co-op design (not yet built)

Online turn-based PvP **reuses the host-authoritative model verbatim** — host
simulates (including the turn machine + hit resolution), guests forward input and
render the mirror. What carries over unchanged: lobby/invite/identity/session
lifetime, WebRTC + WS-relay transport, snapshot broadcast + interpolation,
predicted-self. What changes:

1. **Mode is chosen in the lobby**, not by walking into a link. On start the host
   sets `GameMode = pvp`, corner-spawns, teleports everyone into 1301.
2. **One guest = one fixed `player_index`.** Host is P1.
3. **Friendly fire is always on.**
4. **Turn ownership is host-enforced** — the host drops forwarded input unless that
   guest owns the current turn; an off-turn guest's prediction is disabled (they
   spectate).
5. **Turn state is on the wire**, host→all, on every change + a low-rate heartbeat
   so a late/reconnecting guest resyncs the countdown. Authoritative — guests render
   it, never compute it.
6. **Camera follows the active player for everyone** — a shared spectator view with
   control passing around.
7. **Match result is host-authoritative** (`handle_win_lose` → terminal
   `matchResult`). Rematch is a host action; a guest's confirm is a request.
8. **Disconnect = death** for `handle_win_lose` (so the match resolves), turn
   skipped; the 30 s grace still applies before the slot is finalized.

Protocol additions (delta on the catalogue — no new transport):

| Direction | Message | Purpose |
|-----------|---------|---------|
| host → all | `mode:"pvp"` in the start frame | clients enter PvP rendering (turn HUD, spectator camera, FF on) |
| host → all | `turn { phase:"prep"\|"active", playerIndex, timeRemaining, reducedAfterHit }` | authoritative turn state (on change + heartbeat) |
| host → all | `matchResult { kind:"winner"\|"unknown", playerIndex? }` | end-of-match screen |
| guest → host | existing `input`/`move` | host **ignores** unless the guest owns the current turn |
| guest → host | `rematchRequest` | host may honor to restart |

**Open product decisions:** host-as-player vs neutral referee (simplest: host is
P1); local+online mixed (input gating must key on `(peer, localSlot)`); turn-length
tuning (10/3/2 s may feel long with interpolation latency — kept configurable);
reconnect mid-turn (spec'd default: forfeit, turn already advanced on drop); more
maps (beta ships 1301 only; lobby map vote later).

---

# Ops

- **Production** lives at <https://sneakbit.curzel.it> on a shared Ubuntu VPS:
  systemd unit `sneakbit-server`, nginx reverse proxy (serves the bundle at `/`,
  proxies `/ws` + JSON endpoints), TLS via certbot. Deploy with `npm run deploy`
  (`tools/deploy.mjs`, ssh2-based, idempotent, ends with a health gate that also
  protects a co-tenant site on the box).
- **HTTP endpoints:** `GET /health` → `ok` (cheap; keep it that way);
  `GET /version` → `{git, startedAt}`; `GET /metrics` → relay telemetry (optional
  bearer token, rate-limited); `GET /turn-credentials` → ICE servers (503 when TURN
  env is unset).
- **Origin allowlist** (`server/originAllowlist.js`): default `curzel.it`,
  `sneakbit.curzel.it`, `localhost`, `127.0.0.1`; `ALLOWED_ORIGINS` env **replaces**
  the defaults. Enforced on the WS upgrade (403) and HTTP CORS. Other security:
  WS frame-size cap (1 MB) checked before allocation, join-code format gate,
  structured logging (`server/logger.js`), SIGTERM drain.

## Status

Online co-op + realtime PvP are **shipped and live in production** over WebRTC
(WS-relay fallback), with `permessage-deflate`, STUN + TURN-credential endpoint,
discrete-event hooks (pickup/death/respawn/dialogue/cutscene/toast end-to-end),
guest role gates, structured logging, `/metrics` + `/version`, and SIGTERM drain.
Offline split-screen co-op and local turn-based PvP are shipped. Online turn-based
PvP is specced above (not built).

Deferred: PvP frags/respawn scoring, spectator host, mixed local+online sessions, a
richer end-of-match lobby, dedicated arena soundtrack + more arenas, full intent
cheat-resistance hardening.

## Out of scope

- **Chat (text or voice).** Moderation concern; separate scope.
- **Real accounts for co-op identity.** The anonymous UUID can bind to the
  (separate) account layer later, but co-op itself stays account-free.
- **Persistent shared worlds.** Each session is one host's world; quitting ends it.
- **Relay persistence across restarts.** In-memory is enough.
- **Host migration.** Host quits → session ends. Migration would require serializing
  the host's full world state and bootstrapping a new host from it.
- **Cross-mode play.** Hosting requires entering host mode; not available from
  offline.
- **Determinism / lockstep.** The host runs the only sim; nothing else needs to be
  deterministic.
