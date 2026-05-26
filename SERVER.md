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
- The current party's join code is shown in the client in a dedicated Party panel reachable from the pause menu (HTML, not canvas). The panel is the single place to see your code, enter another code, leave the party, and see who else is connected. The HUD itself stays unchanged — local co-op already uses HUD slots for P1/P2, and the online-party state is separate enough to live behind a menu entry.
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

See **[`protocol.md`](./protocol.md)** for the full message catalogue (every op, payload shape, close code, sequence diagrams, rate limits).

Summary:
- **Transport:** WebSocket at `wss://sneakbit.curzel.it/ws` (and `ws://localhost:8090/ws` for dev). JSON frames, one object per frame.
- **Handshake:** `hello {protocol, uuid, joinCode?}` → `welcome {playerId, partyCode, members, zone}` (or `obsolete` + close if protocol is stale).
- **Client → server:** `input` (intents, not key events), `travel`, `party.create|join|leave`, `ping`.
- **Server → client:** `snapshot` (full state on join/zone-change), `delta` (per-tick state diffs), `event` (discrete things like dialogue, pickup, death, partyUpdate, zoneChange, toast), `pong`.
- **Versioning:** single integer in the handshake. No compatibility layer — server and client are always deployed together. Stale tabs receive `obsolete` and force-reload.

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
Make the simulation modules run under `node` with no DOM. The final shape is three top-level folders:

```
client/   browser-only code (Canvas, audio, input devices, HUD, modals, IndexedDB, localStorage)
server/   Node-only code (the hello-world is already there; the tick lands here)
shared/   pure simulation and data — imported by both client and server, no browser APIs
```

Hard rules:
- `shared/` MUST NOT import from `client/` or `server/`.
- `client/` may import from `shared/` freely. Same for `server/`.
- Persistence in `shared/` is an injected interface; concrete backends are localStorage (client), in-memory or SQLite (server).
- The protocol is owned by `shared/` if it contains data shapes; the transport (WS server / WS client) lives in `server/` and `client/` respectively.

Outcome: `node -e "import('./shared/zone.js').then(m => m.buildZone(rawJson))"` works.

See `## Phase 1 file classification` below for the per-file landing plan.

### Phase 1 — File classification

Audit of every file in `js/` against direct browser-API use (`document`, `window`, `localStorage`, `fetch`, `Image`, `Audio`, `getContext`, `addEventListener`, `requestAnimationFrame`, `indexedDB`, `location`, `navigator`). Three buckets:

**A. Move to `shared/` as-is — no browser APIs, pure simulation/data:**

| File | Notes |
|---|---|
| `afterDialogue.js` | post-dialogue side-effects on world state |
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

**B. Move to `client/` as-is — pure browser concerns:**

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

**C. Split — one file landing in two places:**

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

### Phase 1 — Order of work
1. Create the `client/`, `server/`, `shared/` skeleton (no code moves yet — just empty directories with a `.gitkeep`).
2. Move bucket A files into `shared/`. Update import paths in their consumers. Run tests after each batch.
3. Move bucket B files into `client/`. Same.
4. Tackle bucket C one file at a time. Each split is its own commit. After every split, `node --test` is green AND the page still loads in a browser.
5. Adjust `index.html` to point at `client/main.js`.
6. Verify `node -e "import('./shared/zone.js')"` loads cleanly with zero browser shims.

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
