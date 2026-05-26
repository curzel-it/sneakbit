# SneakBit Server Spec

The endgame is an MMO: shared zones, persistent characters, parties, eventually shops and quests. The path there is long; this document describes what the server is, what it owns, and the order we build it in.

## Vocabulary

- **Zone** — a small, thematically-coherent piece of the map: a single floor of a maze, a house interior, a city, a forest clearing. The map is many of these connected by teleporters. (Formerly called "world" in the codebase — see the rename in the current commit.)
- **Zone instance** — a live, ticking copy of a zone. The same zone can have many concurrent instances; each party gets its own.
- **Party** — a user-defined group of online players who share zone instances. A solo online player is a party of one.
- **Client mode** — `offline` (default, no URL param) or `online` (`?online=1`). The two have **separate save state** — switching modes is switching characters, not reconnecting.
- **Tick** — one step of the authoritative simulation. Server runs at a fixed rate (default 10 Hz).
- **Snapshot** — server-broadcast state delta consumed by every client in the zone instance.
- **Input intent** — a high-level player command ("step up", "interact with entity ahead", "shoot"). The client sends intents, never authoritative state.

## Architecture at a glance

```
client (online)               server                          client (online)
─────────────────             ─────────────                   ─────────────────
input intents      ────WS───► input queue
                              party / instance routing
                              authoritative tick (10 Hz)
                              snapshot + events  ──WS────►   render
render            ◄────WS─── snapshot + events
```

- Single Node process. One process owns every zone instance, every party, every connection.
- WebSocket transport. JSON frames. Versioned handshake.
- No DB in v0: all state is in process memory. Server restart = everyone disconnects, online progress lost. Acceptable while solo dev iterates.
- Same `js/` modules run in both client and server for *simulation*. Browser-coupled modules (renderer, audio, input, HUD, settings, save) stay client-only.

## Boundaries: who owns what

| Concern | Owner in online mode |
|---|---|
| Player position, HP, inventory, equipment, current zone | server |
| Zone state (entities, gates, pushables, mob HPs, dropped items) | server (per instance) |
| Mob/NPC behavior | server |
| Combat resolution, damage, death, respawn | server |
| Pickups, loot drops | server |
| Zone transitions (teleporters) | server |
| Cutscenes, dialogue progression | server (state); client renders the UI |
| Camera, zoom, animation interpolation | client |
| Audio, music | client |
| HUD, menus, settings, key bindings, touch/gamepad mapping | client |
| Save state (online) | server |
| Save state (offline) | client localStorage (unchanged from today) |
| Creative mode, map editor | client only — **hard-disabled in online mode** |

## Identity

- On first run, the client generates a **UUIDv4** and persists it in `localStorage` under `sneakbit.online.uuid`. The UUID is sent on every WebSocket connect.
- The server uses the UUID as the player key. No usernames, no accounts, no auth in v0.
- Reconnect with the same UUID within 30 seconds → resume position and state. Beyond 30 seconds → respawn at the entry tile of the last known zone.
- Display name in v0: shortened UUID prefix (e.g. `Player-a3f9`). User-chosen names are a Phase 4 concern.

## Parties (group instancing)

The instancing model: **every online player belongs to exactly one party. Zone instances are scoped to a party.** Two players in the same zone but in different parties see different instances of the zone and do not see each other. Two players in the same party always share a zone instance when in the same zone.

- A connected player with no party is auto-assigned a fresh party-of-one.
- Party creation is implicit on connect. The party gets a short, human-typable **join code** (e.g. `K7-MJ2`, 5 alphanumeric chars).
- The current party's join code is shown in the client (Settings or a dedicated "Party" panel — HTML, not canvas).
- Joining: enter a code in the client; server moves the joiner into that party. The joiner's old solo party is destroyed if empty.
- Leaving: explicit "Leave party" action. Returns the player to a fresh party-of-one.
- Party persists while at least one member is online. Once empty, the party (and all its zone instances) is garbage-collected.
- Max party size: **4** in v0. Soft cap, easy to raise.

## Zone instances

- A zone instance is `(zoneId, partyId)`. It's lazily created when the first party member enters a zone they don't yet have an instance of.
- When the last party member leaves a zone, the instance is **kept warm for 60 seconds** so brief detours (open door, look around, come back) don't reset state. After 60 s of zero attendance the instance is dropped and its state is forgotten.
- Re-entering a dropped instance respawns it from raw zone data — equivalent to the current offline behavior of "world transitions reload the world fresh."
- A zone instance only ticks when at least one party member is connected and present in it. Idle instances cost zero CPU.

## Wire protocol

- Transport: WebSocket at `wss://sneakbit.curzel.it/ws` (and `ws://localhost:8090/ws` for dev).
- Frames: JSON objects with an `op` discriminant. Versioned via a handshake `op:hello`.
- Direction:
  - **Client → server** is small and frequent (input intents, ack/ping).
  - **Server → client** is the bulk (snapshots, events).

### Handshake

```jsonc
// C → S, first frame
{"op":"hello", "protocol":1, "uuid":"...", "joinCode":"K7-MJ2"|null}

// S → C
{"op":"welcome", "playerId":"...", "partyId":"...", "partyCode":"K7-MJ2",
 "members":[{"playerId":"...","name":"Player-a3f9"}],
 "zone":{"id":1001, "snapshot":{...}}}

// On protocol mismatch
{"op":"obsolete", "minProtocol":2}  // client must reload
```

### Client → server

```jsonc
{"op":"input", "intent":"stepUp"|"stepDown"|"stepLeft"|"stepRight"|"interact"|"shoot"|"melee"}
{"op":"travel", "viaEntityId":N}    // resolved server-side
{"op":"party.join", "code":"K7-MJ2"}
{"op":"party.leave"}
{"op":"ping"}
```

Inputs are intents, not raw keypresses. The client interprets keyboard/gamepad/touch into intents and sends those. This keeps the protocol input-method-agnostic.

### Server → client

```jsonc
// Full snapshot on join and zone-change
{"op":"snapshot", "tick":N, "zone":{...full state...}}

// Per-tick delta
{"op":"delta", "tick":N, "players":[...changed only...], "entities":[...changed only...]}

// Discrete events
{"op":"event", "kind":"dialogueOpen", "entityId":N, "lines":[...]}
{"op":"event", "kind":"pickup", "playerId":"...", "speciesId":N, "amount":1}
{"op":"event", "kind":"death", "playerId":"..."}
{"op":"event", "kind":"zoneChange", "zoneId":N, "snapshot":{...}}
{"op":"event", "kind":"partyUpdate", "members":[...]}

{"op":"pong"}
```

### Versioning

The handshake carries `protocol:N`. Server bumps `N` when the wire shape changes. Stale clients receive `obsolete` and must reload. There is no protocol-version compatibility layer in v0 — server and client are always deployed together.

## Server tick

- **Rate:** 10 Hz (configurable; tile-locked movement makes 10 Hz feel fine because the client interpolates).
- **Loop:** for each non-idle instance, drain its input queue, run the sim modules in `tickOrder`, compute delta vs last broadcast, send `delta` to every connected member.
- **Cost:** an idle game world is free. A populated zone is dominated by mob AI and combat, both `O(entities)`.
- The same `tickOrder` the client uses today (player → mobs → monster fusion → minion spawning → combat → after-dialogue → puzzles → cutscenes → trails → pushables → player-health) is reused verbatim on the server. Phase 1 of the rollout makes that possible.

## Client modes

- **Offline (default).** `index.html` with no query param. Current behavior preserved exactly: localStorage save, local tick, creative mode, map editor.
- **Online.** `index.html?online=1`. Optional `&server=ws://host:port` for dev. The client:
  - reads its UUID from localStorage (generates one if missing)
  - skips the local tick
  - opens a WS
  - applies snapshots/deltas to a local render state
  - sends input intents
  - disables creative mode and the map editor
- **Switching modes** is a manual reload with a different URL. Online and offline saves are **separate** — they don't migrate into each other.

## Data files

- `data/` (sprite atlases, species, strings, level JSON) ships in both client and server deploys.
- Server reads `data/` from the local filesystem. Client `fetch`es it. The same loader modules support both via injected I/O.
- Client and server must be deployed together — the protocol is version-locked, not data-version-locked, but mismatched zone JSON would diverge sims.

## Disconnect & reconnect

- Hard disconnect (WS close): server marks the player slot as ghosted with a 30 s timeout. The player's entity stays in the zone instance frozen in place during the grace period.
- Reconnect with the same UUID within the grace period: server clears the ghost flag and resumes. Position and state are exactly where they were.
- Timeout expiry: the ghosted player is removed from the zone. If they reconnect later, they spawn at the entry tile of the last known zone.
- Server restart: every connection drops, every UUID's session is forgotten (in-memory model). Clients receive close codes and show a "server restarted — reconnect?" toast. Reconnect creates a fresh session.

## Persistence (v0: none)

- All state lives in process memory.
- A server restart wipes online progress — both intentionally and unavoidably given the in-memory choice.
- This is acceptable while we iterate. Persistence (SQLite via `better-sqlite3`) is Phase 6.

## Anti-cheat posture (v0)

- Server is authoritative for everything except UI. Clients cannot edit state — they can only send input intents.
- Input rate-limited per connection (max ~30 intents/sec, plenty for keymash combat).
- Sane bounds checked: a movement intent that would land out of zone, on a non-walkable tile, or through an obstacle is dropped silently.
- No deeper anti-cheat in v0. The cost of cheating is "you ruined a casual session with 0–3 strangers." Anything stricter is wasted on a hobby project.

## Open questions / deferred

- **PvP:** out of scope. Same as today.
- **Chat:** out of scope for v0. Even a per-zone shout adds moderation surface — postpone.
- **Real accounts (email/password, OAuth):** Phase 4. The UUID lets us bind retroactively.
- **Friends list, party invites by name:** Phase 4+.
- **Persistent worlds (shared-instance overworld):** explicitly *not* the model. Everything is party-instanced. We may add public zones later (e.g. a "town hub" that's not party-scoped), but the default is party.
- **Server snapshot persistence across deploys:** Phase 6.
- **Time-of-day, weather, daily resets:** not in the current sim. If/when added, server-side.
- **Sharding across processes:** one Node process is enough until profiled. Phase 7.
- **Mobile / touch quirks of online mode:** same input layer feeds the intent translator, so touch should work for free. Verify in Phase 2.

## Implementation order

Phases are gated on the previous landing. Each phase ends with a runnable, deployable state — even if "runnable" means "press a button, see one player walk."

### Phase 0 — Foundations (this PR)
- [x] Hello-world Node server + `deploy.py` + auto-deploy hook *(landed)*
- [x] Decisions locked: anonymous UUID, party-instanced, in-memory, full server-authoritative tick
- [x] Vocabulary fixed: world → zone everywhere in the codebase
- [x] This document

### Phase 1 — Headless simulation
Make the simulation modules run under `node` with no DOM. Outcome: `node -e "import('./js/zone.js').then(m => m.buildZone(rawJson))"` works.

- Catalog every `js/*.js`: tag as `pure` / `mixed` / `client`.
- For `mixed` files, split: `pure` half becomes the shared module, `client` half stays as a render/UI shim.
- Replace `Image` / `fetch` / `localStorage` references in `pure` files with injected I/O passed in by the host (Node passes filesystem readers, browser passes fetch/blob loaders).
- No behavior change for the client; this is purely a refactor.

### Phase 2 — Smallest server-authoritative slice
One zone, one player, server-authoritative walking. No mobs, no combat, no pickups.

- Server: load zone 1001 (or the starting zone), spawn a player on connect, run a tick that consumes input intents and updates player position via the shared movement module.
- Server emits a snapshot per tick.
- Client: `?online=1` opens a WS, sends intents on key/touch input, renders from snapshots.
- Verify: opening two tabs in `?online=1` shows two avatars in the same zone, both controlled by their respective tabs.

### Phase 3 — Parties + zone transitions
- Implement party creation, join-by-code, leave. Party panel in HTML.
- Per-party zone instance lifecycle (lazy create, 60 s warm idle, drop).
- Server-side teleporter handling: `travel` op resolves the destination, moves the player into the destination zone instance (creating it if needed).
- Verify: two tabs join the same party, both end up in the same zone instance, walk through a teleporter together, end up in the same destination instance.

### Phase 4 — Re-enable systems server-side, one at a time
Each sub-step is its own commit. Test that the offline client is unaffected.

1. Mobs / monster fusion / minion spawning
2. Combat (melee + ranged), damage, death
3. Pickups + inventory mutation
4. Equipment slots
5. Pushables, gates, locks, puzzles
6. After-dialogue, cutscenes, trails
7. Dialogue progression (server tracks state, client renders the modal)
8. Game-over flow + respawn

### Phase 5 — Mode-aware client
- Implement `?online=1` mode toggle in the client cleanly: a single boundary that gates "do we run a local tick or read from snapshots."
- HTML UI for: party code display, join-by-code, leave party.
- Separate online-mode save namespace in localStorage (just UI/settings caches; the canonical state is server-side).
- Disable creative mode + map editor in online mode.

### Phase 6 — Persistence
- `better-sqlite3` on the server.
- Per-player state: position, zone, HP, inventory, equipment.
- Per-party state: members, current zones.
- Save on every snapshot diff or on a debounce — TBD when we get there.
- Survive server restarts.

### Phase 7 — Identity & accounts
- Optional email/password binding to the existing UUID.
- Forgot-password (email link). Friend list. Display names.

### Phase 8+ — MMO surface
Beyond this point we're in proper MMO territory: shops, quests, NPC dialogue trees with branching state, persistent overworld zones, multi-process sharding. Each is its own design discussion.
