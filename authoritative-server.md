# Authoritative Server — SneakBit Online

The endgame is an MMO: party-instanced zones, persistent characters, eventually shops and quests. This document is the single authoritative spec for how the online server is built and how it talks to the client. Nothing else (CLAUDE.md, README.md, code comments) overrides this file.

## Confirmed agreements

1. **Client distribution stays on GitHub Pages** at <https://curzel.it/sneakbit-html>. The VPS hosts only the Node server.
2. **Client has two modes** selected by URL: offline (default, no param) and online (`?online=1`). The two have **separate save state** — switching modes is switching characters, not reconnecting.
3. **Zone instances are party-scoped.** Each `(zoneId, partyId)` is a separate live instance. Two players in the same zone but in different parties see different instances.
4. **Parties are formed by join code** (e.g. `K7MJ2`, 5 alphanumeric chars). No accounts. The Party panel is reachable from the pause menu (HTML, not canvas).
5. **The server is fully authoritative.** Client sends input intents and renders snapshots; it owns nothing simulation-side. Anti-cheat is the natural consequence, not a separate system.

## Vocabulary

- **Zone** — a small, thematically-coherent piece of the map: a single floor of a maze, a house interior, a city, a forest clearing. The map is many zones connected by teleporters. (Formerly "world" in the codebase — renamed.)
- **Zone instance** — a live, ticking copy of a zone. The same zone can have many concurrent instances; each party gets its own.
- **Party** — a user-defined group of online players who share zone instances. A solo online player is a party of one.
- **Client mode** — `offline` or `online`. See agreement 2.
- **Tick** — one step of the authoritative simulation. Server runs at a fixed rate (default 10 Hz).
- **Snapshot** — server-broadcast state delta consumed by every client in a zone instance.
- **Input intent** — a high-level player command (`moveUp`, `interact`, `shoot`). The client sends intents, never authoritative state.

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
- Simulation modules in `shared/` run on both sides. Client-only modules (renderer, audio, input, HUD, save) live in `client/`. Server-only modules (WS, party routing, tick driver) live in `server/`.

## Authority boundaries

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

- On first run, the client generates a **UUIDv4** and persists it in `localStorage` under `sneakbit.online.uuid`. Sent on every WS connect.
- The server uses the UUID as the player key. No usernames, no accounts, no auth in v0.
- Reconnect with the same UUID within 30 seconds → resume position and state. Beyond 30 seconds → respawn at the entry tile of the last known zone.
- Display name in v0: shortened UUID prefix (e.g. `Player-a3f9`). User-chosen names are a Phase 4 concern.

## Parties

**Every online player belongs to exactly one party. Zone instances are scoped to a party.** Two players in the same zone but in different parties see different instances and do not see each other. Two players in the same party always share a zone instance when in the same zone.

- A connected player with no party is auto-assigned a fresh party-of-one.
- Party creation is implicit on connect. The party gets a short, human-typable **join code** (e.g. `K7MJ2`, 5 alphanumeric chars).
- The current party's join code is shown in the client in a dedicated **Party panel** reachable from the pause menu (HTML, not canvas). The panel is the single place to see your code, enter another code, leave the party, and see who else is connected. The HUD itself stays unchanged — local co-op already uses HUD slots for P1/P2, and the online-party state is separate enough to live behind a menu entry.
- Joining: enter a code in the client; server moves the joiner into that party. The joiner's old solo party is destroyed if empty.
- Leaving: explicit "Leave party" action. Returns the player to a fresh party-of-one.
- Party persists while at least one member is online. Once empty, the party (and all its zone instances) is garbage-collected.
- Max party size: **4** in v0. Soft cap, easy to raise.

## Zone instances

- A zone instance is `(zoneId, partyId)`. Lazily created when the first party member enters a zone they don't yet have an instance of.
- When the last party member leaves a zone, the instance is **kept warm for 60 seconds** so brief detours (open door, look around, come back) don't reset state. After 60 s of zero attendance the instance is dropped and its state is forgotten.
- Re-entering a dropped instance respawns it from raw zone data — equivalent to the current offline behavior of "world transitions reload the zone fresh."
- A zone instance only ticks when at least one party member is connected and present in it. Idle instances cost zero CPU.

## Server tick

- **Rate:** 10 Hz (configurable; tile-locked movement makes 10 Hz feel fine because the client interpolates between snapshots).
- **Loop:** for each non-idle instance, drain its input queue, run the sim modules in `tickOrder`, compute delta vs last broadcast, send `delta` to every connected member.
- **Cost:** an idle zone is free. A populated zone is dominated by mob AI and combat, both `O(entities)`.
- The same `tickOrder` the client uses today (player → mobs → monster fusion → minion spawning → combat → after-dialogue → puzzles → cutscenes → trails → pushables → player-health) is reused verbatim on the server. Phase 1 of the rollout makes that possible.

## Client modes

- **Offline (default).** `index.html` with no query param. Current behavior preserved exactly: localStorage save, local tick, creative mode, map editor available.
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
- Server restart: every connection drops, every UUID's session is forgotten (in-memory model). Clients receive close code 4500 and show a "server restarted — reconnect?" toast.

## Persistence (v0: none)

- All state lives in process memory.
- A server restart wipes online progress — both intentionally and unavoidably given the in-memory choice.
- This is acceptable while we iterate. Persistence (`better-sqlite3`) is Phase 6.

## Anti-cheat posture (v0)

- Server is authoritative for everything except UI. Clients cannot edit state — they can only send input intents.
- Input rate-limited per connection (max 30 intents/sec, plenty for keymash combat).
- Sane bounds checked: a movement intent that would land out of zone, on a non-walkable tile, or through an obstacle is dropped silently.
- No deeper anti-cheat in v0. The cost of cheating is "you ruined a casual session with 0–3 strangers." Anything stricter is wasted on a hobby project.

The client cannot:
- Move its own avatar — only send a movement intent; the server validates and applies.
- Add to its inventory — only the server emits `pickup` events.
- Open a gate, push a pushable, deal damage, complete a puzzle, advance dialogue — all server-side.
- Choose its display name in v0.

The client can:
- Render the world however it wants (skins, particles, animation timing).
- Manage its own UI state — open menu, change zoom, mute audio.
- Lie about whether it has paused — irrelevant to the server.

---

# Wire protocol

## Transport

- **WebSocket.** TLS in production (`wss://sneakbit.curzel.it/ws`), plain in dev (`ws://localhost:8090/ws`).
- **Framing:** one JSON object per WebSocket frame. UTF-8.
- **Direction:** full duplex. The client sends input intents on edge (key down/up); the server pushes snapshots and events at the tick rate.
- **Endpoint:** `/ws`. The dev server may expose it as `/`; the production nginx vhost mounts `/ws` explicitly with WebSocket upgrade headers.

## Versioning

Every connection negotiates a single `protocol` integer.

- Client opens the WS and sends `hello` with the version it speaks.
- Server matches → responds with `welcome`.
- Below the server's `minProtocol` → server responds with `obsolete` and closes (code 4001). Client must reload.
- **No compatibility shim.** Server and client are always deployed together. `protocol` exists so a stale tab can detect a deploy and self-heal.

## Connection lifecycle

```
1. Client opens WS
2. C → S: hello
3. S → C: welcome (or obsolete + close)
4. Steady state:
     C → S: input | travel | party.* | ping
     S → C: snapshot | delta | event | pong
5. Either side closes the WS
     - Server-initiated closes carry a 4xxx reason code (see "Close codes")
     - Client-initiated close: clean disconnect, server enters the 30s ghost grace
6. Reconnect: another WS open + hello with the same UUID
     - Within 30s: server clears ghost flag, resumes the player in place
     - After 30s: server creates a fresh session, spawns at the entry tile of the last known zone
```

## Message catalogue

Every message has an `op` discriminant. Below: `C →` means client → server, `S →` means server → client. Unknown ops are dropped silently.

### `hello` (C →)

The first frame on a new WebSocket. The server ignores any other frame until it receives `hello`.

```jsonc
{
  "op": "hello",
  "protocol": 1,
  "uuid": "8a1c1d2e-3b4f-4c5d-9e6f-7a8b9c0d1e2f",
  "joinCode": "K7MJ2" | null,   // present if the client wants to join an existing party on connect
  "client": "sneakbit-html"     // free-form, useful for logs
}
```

### `welcome` (S →)

Sent in response to a valid `hello`. Carries everything the client needs to render the first frame: the party shape, the assigned player id, and a full snapshot of the zone the player landed in.

```jsonc
{
  "op": "welcome",
  "protocol": 1,
  "playerId": "p_a3f9b1",
  "partyId": "pty_8c3f12",
  "partyCode": "K7MJ2",
  "members": [
    {"playerId":"p_a3f9b1","name":"Player-a3f9","self":true},
    {"playerId":"p_b1d2e3","name":"Player-b1d2","self":false}
  ],
  "zone": {
    "id": 1001,
    "tick": 0,
    "state": { /* full zone snapshot — see "Zone snapshot shape" */ }
  }
}
```

### `obsolete` (S →)

```jsonc
{"op":"obsolete","minProtocol":2,"message":"please reload"}
```

### `input` (C →)

```jsonc
{
  "op": "input",
  "intent": "moveUp" | "moveDown" | "moveLeft" | "moveRight"
          | "stopMove"
          | "interact"
          | "shoot"
          | "melee"
}
```

Sent on edge (key down / key up), not per-tick. Rate limit: 30/sec per connection; excess dropped silently.

### `travel` (C →)

Client suggests the teleporter under its feet; server validates and resolves the actual destination.

```jsonc
{"op":"travel","viaEntityId":12345}
```

Server replies with an `event:zoneChange`. If the entity isn't actually a teleporter under the player's foot, the server drops the message silently — the client cannot force a zone change.

### Party ops (C →)

```jsonc
{"op":"party.create"}                  // leave current, create a fresh party-of-one
{"op":"party.join","code":"K7MJ2"}     // join existing
{"op":"party.leave"}                   // leave; server creates a fresh party-of-one
```

Each replies with an `event:partyUpdate` on success. `party.join` may reply with `event:partyJoinFailed` (reasons: `not_found`, `full`, `same_party`).

### `ping` (C →) / `pong` (S →)

Heartbeat. The server expects a `ping` at least every 30 seconds; missing pings for 60 seconds cause a close with code 4002 (idle timeout).

### `snapshot` (S →)

Full zone-instance state. Sent on join, zone change, and reconnect-after-grace.

```jsonc
{
  "op": "snapshot",
  "tick": 1234,
  "zone": { "id": 1001, "state": { /* see "Zone snapshot shape" */ } }
}
```

### `delta` (S →)

Per-tick deltas at 10 Hz. Only changed fields appear.

```jsonc
{
  "op": "delta",
  "tick": 1235,
  "players": [
    {"playerId":"p_a3f9b1","x":12.0,"y":7.0,"tileX":12,"tileY":7,"direction":"right","hp":95,"step":"midwalk"}
  ],
  "entities": [
    {"id":4242,"hp":12,"_open":true}
  ],
  "removed": { "entities": [9999] }
}
```

Sparse — the client maintains its own zone state machine and merges deltas in. Absent = unchanged.

### `event` (S →)

Discrete one-shot occurrences. Examples:

```jsonc
{"op":"event","kind":"zoneChange","zoneId":1002,"snapshot":{...},"tick":N}
{"op":"event","kind":"dialogueOpen","forPlayerId":"p_a3f9b1","entityId":4321,"lines":["..."]}
{"op":"event","kind":"dialogueAdvance","forPlayerId":"p_a3f9b1","lineIdx":2}
{"op":"event","kind":"dialogueClose","forPlayerId":"p_a3f9b1"}
{"op":"event","kind":"pickup","playerId":"p_a3f9b1","speciesId":5,"amount":1}
{"op":"event","kind":"death","playerId":"p_a3f9b1"}
{"op":"event","kind":"respawn","playerId":"p_a3f9b1","zoneId":1001,"x":3.0,"y":3.0}
{"op":"event","kind":"partyUpdate","partyId":"...","code":"K7MJ2","members":[...]}
{"op":"event","kind":"partyJoinFailed","reason":"not_found"|"full"|"same_party"}
{"op":"event","kind":"toast","forPlayerId":"p_a3f9b1","textKey":"notification.pickup","args":{"name":"Coin"}}
{"op":"event","kind":"cutsceneStart","zoneId":1001,"id":"intro"}
{"op":"event","kind":"cutsceneEnd","zoneId":1001,"id":"intro"}
```

`event` kinds are extensible; the client must ignore unknown kinds.

## Zone snapshot shape

The `state` payload on `welcome` / `snapshot` / `event:zoneChange` is a single object:

```jsonc
{
  "id": 1001,
  "tick": 1234,
  "zoneType": "HouseInterior",
  "rows": 30, "cols": 60,
  "biomeTiles":        { "sheet_id": N, "tiles": ["...","..."] },
  "constructionTiles": { "sheet_id": N, "tiles": ["...","..."] },
  "lightConditions": "Day",
  "soundtrack": "village",
  "players": [
    {"playerId":"p_a3f9b1","x":...,"y":...,"tileX":...,"tileY":...,
     "direction":"down","hp":100,"hpMax":100,"step":"idle",
     "inventory":{"5":3,"7":1},
     "equipment":{"melee":1,"ranged":2}}
  ],
  "entities": [
    {"id":4242,"species_id":123,"x":10.5,"y":7.0,"frame":{...},"hp":20,"_open":false}
  ],
  "spawnPoint": {"x":3,"y":3}
}
```

- Tile grids are unchanged from the raw `data/*.json` shape so existing parsers work.
- `players` is the live, server-authoritative state. Client renders these directly — no local prediction in v0.
- `entities` carries the live entity state, including mob HP, gate `_open` flags, pushable positions, etc.

## Close codes

| Code | Meaning | Client action |
|---|---|---|
| `1000` | Normal closure | Show "Disconnected" toast, offer reconnect |
| `4001` | Obsolete protocol | Force a `location.reload()` |
| `4002` | Idle timeout (no pings) | Auto-reconnect once, then show "Disconnected" |
| `4003` | UUID conflict (same UUID already connected) | Show "Already playing in another tab" |
| `4004` | Rate-limit ban | Show "Disconnected — too many messages" |
| `4500` | Internal server error / restart | Show "Server error — reconnecting…" + auto-reconnect after 3 s |

## Rate limits

- Inputs: 30/sec per connection. Excess silently dropped.
- All other ops: 10/sec per connection.
- Severe violations (1000+ msgs in 10 s) result in a 4004 close. The same UUID can reconnect after 60 s.

## Reconnection

- Whenever the WebSocket closes, the client computes a back-off delay (1s, 2s, 4s, 8s, capped at 30s) and re-opens.
- On reopen, it sends the same UUID. Within the 30 s grace window the server restores the same session; after that the server treats it as a fresh login.
- The client should buffer no more than 2 seconds of unsent input — anything older is discarded on reconnect (the server's authoritative state would have evolved past it anyway).

## Sequence diagrams

### Solo player joins, walks one tile, leaves

```
C → hello {uuid, protocol:1, joinCode:null}
S → welcome {playerId, partyCode, zone}
C → input {intent:"moveDown"}
... server ticks at 10 Hz, broadcasting deltas with updated position ...
S → delta {tick:101, players:[{playerId, tileY:1}]}
S → delta {tick:102, players:[{playerId, tileY:2}]}
C → input {intent:"stopMove"}
C → (WS close)
... server marks player as ghost, 30 s grace ...
... 30 s later: server removes the ghost; party-of-one is GC'd (empty) ...
```

### Two players, one walks through a teleporter

```
A → hello {uuid:U1, joinCode:null}
S → welcome (party PA, code "ABC12", zone 1001)
B → hello {uuid:U2, joinCode:"ABC12"}
S → welcome (party PA — joined A, zone 1001 — same instance)
A → input {moveDown} ... → S sends deltas to both A and B
A → travel {viaEntityId: 99 (teleporter to zone 1002)}
S → A: event:zoneChange {zoneId:1002, snapshot:{...}}
S → B: delta {removed:{players:[U1]}}
... B is still in zone 1001 alone. When B teleports too, B lands in the same zone-1002 instance party PA already owns.
```

---

# Phase 1 file classification

Audit of every file in `js/` against direct browser-API use (`document`, `window`, `localStorage`, `fetch`, `Image`, `Audio`, `getContext`, `addEventListener`, `requestAnimationFrame`, `indexedDB`, `location`, `navigator`).

The destination layout is:

```
client/   browser-only code (Canvas, audio, input devices, HUD, modals, IndexedDB, localStorage)
server/   Node-only code (the hello-world is already there; the tick lands here)
shared/   pure simulation and data — imported by both client and server, no browser APIs
```

Hard rules:
- `shared/` MUST NOT import from `client/` or `server/`.
- `client/` may import from `shared/` freely. Same for `server/`.
- Persistence in `shared/` is an injected interface; concrete backends are localStorage (client), in-memory or SQLite (server).
- The protocol data shapes live in `shared/`; the transport (WS server / WS client) lives in `server/` and `client/` respectively.

Outcome target: `node -e "import('./shared/zone.js').then(m => m.buildZone(rawJson))"` works with zero browser shims.

## Bucket A — move to `shared/` as-is

| File | Notes |
|---|---|
| `afterDialogue.js` | post-dialogue side-effects on zone state |
| `biomeAnimation.js` | frame counter |
| `biomes.js`, `biomeTiles.js` | biome data + tile-selection rules |
| `camera.js` | camera math (interpolation, world-to-screen) |
| `combat.js` | damage resolution, hitboxes |
| `constants.js` | tile size, sprite-sheet IDs |
| `constructions.js`, `constructionTiles.js` | construction data + tile-selection |
| `cutscenes.js` | cutscene state machine |
| `entities.js` | entity tick driver |
| `entityVisibility.js` | visibility predicates |
| `explosives.js` | explosive state |
| `firstLaunch.js` | first-launch flag (no browser deps) |
| `gateUnlock.js` | gate unlock rules |
| `locks.js` | lock state |
| `minions.js`, `mobs.js`, `monsters.js` | mob AI + spawning |
| `movement.js` | tile-locked stepping math |
| `pickups.js` | pickup resolution |
| `player.js` | player tick |
| `prefabs.js` | raw-zone generator (creative mode) |
| `pushables.js` | pushable resolution |
| `puzzles.js` | puzzle state |
| `save.js` | uses `storage` interface, not localStorage directly — portable |
| `species.js`, `strings.js` | data tables |
| `trails.js` | trail decay |
| `zone.js`, `zoneVisibility.js` | zone state |

## Bucket B — move to `client/` as-is

| File | Why it's client-only |
|---|---|
| `ammoHud.js`, `healthHud.js`, `hud.js` | DOM HUD elements |
| `assets.js` | `new Image()` sprite loading |
| `audio.js`, `music.js` | Web Audio |
| `biomeSheet.js` | Canvas-baked sprite atlas |
| `dialogue.js`, `gameOver.js`, `message.js`, `toast.js`, `inventoryScreen.js`, `loadingScreen.js`, `fastTravel.js`, `menu.js` | DOM modals + event listeners |
| `data.js` | `fetch()` for level/species/strings JSON in browser |
| `gameLoop.js` | `requestAnimationFrame` |
| `gamepad.js`, `input.js`, `keyBindings.js`, `touch.js` | input devices |
| `main.js` | entry point — wires everything browser-side |
| `mapEditor.js` | creative-mode DOM editor |
| `renderer.js` | Canvas 2D drawing |
| `settings.js` | DOM settings UI |
| `zoom.js` | Canvas/DOM zoom |
| `zoneBuffer.js` | IndexedDB-backed zone-state buffer |
| `zoneCache.js` | Canvas-baked static-tile surfaces |

## Bucket C — split, one file lands in two places

| File | shared/ part | client/ part |
|---|---|---|
| `storage.js` | the `getValue`/`setValue` interface + a Map-backed default | localStorage backend that's installed on boot |
| `coopMode.js` | the flag accessor (reads injected storage) | the localStorage backing + Settings toggle |
| `creativeMode.js` | the flag accessor | URL-param read on boot |
| `migrations.js` | migration ladder + storage-only steps | the v2 legacy-inventory scan (raw `localStorage.length` walk) |
| `inventory.js` | per-player amounts + mutation | the legacy `sneakbit.inventory.v1` scan helper |
| `equipment.js` | slot state + getters | `window.equipment` devtools binding |
| `skills.js` | skill resolution + active set | `window.skills` devtools binding + override-key localStorage read |
| `playerHealth.js` | HP + invuln-window state | (re-audit — comment `invuln window` triggered a false positive; likely already pure) |
| `interact.js` | "interact with entity ahead" resolution | `window.addEventListener("keydown", ...)` and the touch-hint DOM element |
| `melee.js` | swing resolution + cooldown | `window.addEventListener("keydown", ...)` |
| `shooting.js` | bullet spawn + ammo decrement | `window.addEventListener("keydown", ...)` |
| `transitions.js` | zone-change + spawn-resolution logic | fade-overlay DOM element |

After the split, each file in the right column is small (input wiring or one DOM element); each file in the left column is the actual simulation surface.

---

# Implementation order

Phases are gated on the previous landing. Each phase ends with a runnable, deployable state — even if "runnable" means "press a button, see one player walk."

## Phase 0 — Foundations (landed)
- [x] Hello-world Node server + `deploy.py` + auto-deploy hook
- [x] Decisions locked: anonymous UUID, party-instanced, in-memory, full server-authoritative tick
- [x] Vocabulary fixed: world → zone everywhere in the codebase
- [x] This document

## Phase 1 — Headless simulation

Make the simulation modules run under `node` with no DOM.

1. Create the `client/`, `server/`, `shared/` skeleton (no code moves yet — just empty directories with a `.gitkeep`).
2. Move bucket A files into `shared/`. Update import paths in their consumers. Run tests after each batch.
3. Move bucket B files into `client/`. Same.
4. Tackle bucket C one file at a time. Each split is its own commit. After every split, `node --test` is green AND the page still loads in a browser.
5. Adjust `index.html` to point at `client/main.js`.
6. Verify `node -e "import('./shared/zone.js')"` loads cleanly with zero browser shims.

## Phase 2 — Smallest server-authoritative slice
One zone, one player, server-authoritative walking. No mobs, no combat, no pickups.

- Server: load zone 1001 (or the starting zone), spawn a player on connect, run a tick that consumes input intents and updates player position via the shared movement module.
- Server emits a snapshot per tick.
- Client: `?online=1` opens a WS, sends intents on key/touch input, renders from snapshots.
- Verify: opening two tabs in `?online=1` shows two avatars in the same zone, both controlled by their respective tabs.

## Phase 3 — Parties + zone transitions
- Implement party creation, join-by-code, leave. Party panel in HTML.
- Per-party zone instance lifecycle (lazy create, 60 s warm idle, drop).
- Server-side teleporter handling: `travel` op resolves the destination, moves the player into the destination zone instance (creating it if needed).
- Verify: two tabs join the same party, both end up in the same zone instance, walk through a teleporter together, end up in the same destination instance.

## Phase 4 — Re-enable systems server-side, one at a time
Each sub-step is its own commit. Test that the offline client is unaffected.

1. Mobs / monster fusion / minion spawning
2. Combat (melee + ranged), damage, death
3. Pickups + inventory mutation
4. Equipment slots
5. Pushables, gates, locks, puzzles
6. After-dialogue, cutscenes, trails
7. Dialogue progression (server tracks state, client renders the modal)
8. Game-over flow + respawn

## Phase 5 — Mode-aware client
- Implement `?online=1` mode toggle in the client cleanly: a single boundary that gates "do we run a local tick or read from snapshots."
- HTML UI for: party code display, join-by-code, leave party.
- Separate online-mode save namespace in localStorage (just UI/settings caches; the canonical state is server-side).
- Disable creative mode + map editor in online mode.

## Phase 6 — Persistence
- `better-sqlite3` on the server.
- Per-player state: position, zone, HP, inventory, equipment.
- Per-party state: members, current zones.
- Save on every snapshot diff or on a debounce — TBD when we get there.
- Survive server restarts.

## Phase 7 — Identity & accounts
- Optional email/password binding to the existing UUID.
- Forgot-password (email link). Friend list. Display names.

## Phase 8+ — MMO surface
Beyond this point we're in proper MMO territory: shops, quests, NPC dialogue trees with branching state, persistent overworld zones, multi-process sharding. Each is its own design discussion.

---

# Open questions / deferred

- **PvP:** out of scope. Same as today.
- **Chat:** out of scope for v0. Even a per-zone shout adds moderation surface — postpone.
- **Real accounts (email/password, OAuth):** Phase 7. The UUID lets us bind retroactively.
- **Friends list, party invites by name:** Phase 7+.
- **Persistent worlds (shared-instance overworld):** explicitly *not* the model. Everything is party-instanced. We may add public zones later (e.g. a "town hub" that's not party-scoped), but the default is party.
- **Server snapshot persistence across deploys:** Phase 6.
- **Time-of-day, weather, daily resets:** not in the current sim. If/when added, server-side.
- **Sharding across processes:** one Node process is enough until profiled. Phase 8+.
- **Mobile / touch quirks of online mode:** same input layer feeds the intent translator, so touch should work for free. Verify in Phase 2.
- **Compression / binary frames:** maybe per-message deflate or binary later; not needed at 10 Hz with small payloads.
- **Partial-zone deltas:** splitting `delta` by region for very large zones. Not relevant at current zone sizes.
- **Matchmaking / find-friend over the wire:** not in v0 — parties are formed by code-sharing out of band.
