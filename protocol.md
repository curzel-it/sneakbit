# SneakBit Wire Protocol

Companion to `SERVER.md`. This document specifies the messages exchanged between the client (running in `?online=1` mode) and the Node server at `wss://sneakbit.curzel.it/ws`. The high-level architecture (zones, parties, identity, tick rate) lives in `SERVER.md`; this file is the message-by-message contract.

## Transport

- **WebSocket.** TLS in production (`wss://`), plain in dev (`ws://localhost:8090/ws`).
- **Framing:** one JSON object per WebSocket frame. UTF-8.
- **Direction:** full duplex. The client sends input intents continuously; the server pushes snapshots and events at the tick rate.
- **Endpoint:** `/ws`. The dev server may expose it as `/`; the production nginx vhost mounts `/ws` explicitly with WebSocket upgrade headers.

## Versioning

Every connection negotiates a single `protocol` integer.

- The client opens the WebSocket and sends `hello` with the version it speaks (`{"op":"hello","protocol":N,...}`).
- If the server's current protocol matches, it responds with `welcome`.
- If the client's protocol is below the server's `minProtocol`, the server responds with `obsolete` and closes the socket. The client must reload the page.
- There is **no compatibility shim**. Server and client are always deployed together. `protocol` exists so a stale tab can detect a deploy and self-heal.

## Identity

- The client generates a UUIDv4 on first run and persists it in `localStorage` under `sneakbit.online.uuid`.
- The UUID is sent on every `hello`. The server uses it as the player key for the lifetime of the session.
- No accounts, no auth tokens. The UUID is a stable but anonymous identifier. Possession of the UUID is treated as identity — like a session cookie.

## Connection lifecycle

```
1. Client opens WS
2. Client → server: hello
3. Server → client: welcome (or obsolete + close)
4. Steady state:
     Client → server: input | travel | party.* | ping  (any number, any time)
     Server → client: snapshot | delta | event | pong  (driven by server tick)
5. Either side closes the WS
     - Server-initiated close codes carry a reason (see "Close codes")
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

Sent in response to a valid `hello`. Carries everything the client needs to render the first frame: the party shape, the assigned player id (server-side), and a full snapshot of the zone the player landed in.

```jsonc
{
  "op": "welcome",
  "protocol": 1,
  "playerId": "p_a3f9b1",                  // server-generated short id used in deltas
  "partyId": "pty_8c3f12",
  "partyCode": "K7MJ2",                    // share this to invite more players
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

Sent in response to a `hello` whose protocol is below the server's `minProtocol`. The server closes the WS immediately after with close code 4001.

```jsonc
{"op":"obsolete","minProtocol":2,"message":"please reload"}
```

### `input` (C →)

The client's input intent for the current frame. Sent only on intent change (key down / key up edge), not per-tick. Server applies it on the next tick.

```jsonc
{
  "op": "input",
  "intent": "moveUp" | "moveDown" | "moveLeft" | "moveRight"
          | "stopMove"                  // released the direction key
          | "interact"
          | "shoot"
          | "melee"
}
```

Rate limit: 30 messages per second per connection. Excess intents are dropped silently.

### `travel` (C →)

Triggered when the player steps onto a teleporter entity. The client *suggests* the teleporter; the server validates and resolves the actual destination zone + tile.

```jsonc
{
  "op": "travel",
  "viaEntityId": 12345     // the teleporter entity the client believes the player is on
}
```

Server replies with an `event:zoneChange` carrying the new zone snapshot. If the entity isn't actually a teleporter under the player's foot, the server drops it silently — the client cannot force a zone change.

### `party.create` (C →)

Leave the current party (if any) and create a fresh party-of-one. Mostly used to "reset" your party.

```jsonc
{"op":"party.create"}
```

Server replies with `event:partyUpdate`.

### `party.join` (C →)

Join an existing party by code. The player's old solo party is destroyed if it becomes empty.

```jsonc
{"op":"party.join","code":"K7MJ2"}
```

Server replies with `event:partyUpdate` on success, or `event:partyJoinFailed` (reasons: `not_found`, `full`, `same_party`).

### `party.leave` (C →)

Leave the current party. The server creates a fresh party-of-one for the leaver.

```jsonc
{"op":"party.leave"}
```

Server replies with `event:partyUpdate`.

### `ping` (C →) / `pong` (S →)

Heartbeat. The server expects a `ping` at least every 30 seconds; missing pings for 60 seconds cause a close with code 4002 (idle timeout).

```jsonc
{"op":"ping"}     // C →
{"op":"pong"}     // S →
```

### `snapshot` (S →)

Full state for one zone instance. Sent on join, on zone change, and on reconnect-after-grace.

```jsonc
{
  "op": "snapshot",
  "tick": 1234,
  "zone": {
    "id": 1001,
    "state": { /* see "Zone snapshot shape" */ }
  }
}
```

### `delta` (S →)

Per-tick deltas. Only changed fields are sent. Sent at the server tick rate (default 10 Hz) to every connection in the same zone instance.

```jsonc
{
  "op": "delta",
  "tick": 1235,
  "players": [
    {"playerId":"p_a3f9b1","x":12.0,"y":7.0,"tileX":12,"tileY":7,"direction":"right","hp":95,"step":"midwalk"},
    {"playerId":"p_b1d2e3","x":15.0,"y":9.0,"tileX":15,"tileY":9,"direction":"down","hp":100}
  ],
  "entities": [
    {"id":4242,"hp":12,"_open":true}     // gate unlocked
  ],
  "removed": {                            // entities that left the zone this tick
    "entities": [9999]
  }
}
```

Notes:
- `players` includes only players whose state changed this tick. Absent = unchanged.
- `entities` is keyed by entity `id`. Only mutated fields appear.
- Sparse deltas. Client maintains its own zone state machine; deltas are merged into it.

### `event` (S →)

Discrete one-shot occurrences that don't fit the per-tick state model. Many `event` kinds exist:

```jsonc
// Zone change — full snapshot + reset of the client's zone-state machine.
{"op":"event","kind":"zoneChange","zoneId":1002,"snapshot":{...},"tick":N}

// Dialogue opens for a player. Client renders the dialogue UI.
{"op":"event","kind":"dialogueOpen","forPlayerId":"p_a3f9b1","entityId":4321,"lines":["..."]}

// Dialogue advanced / closed (server-side state).
{"op":"event","kind":"dialogueAdvance","forPlayerId":"p_a3f9b1","lineIdx":2}
{"op":"event","kind":"dialogueClose","forPlayerId":"p_a3f9b1"}

// Pickup happened to a specific player.
{"op":"event","kind":"pickup","playerId":"p_a3f9b1","speciesId":5,"amount":1}

// Death + respawn.
{"op":"event","kind":"death","playerId":"p_a3f9b1"}
{"op":"event","kind":"respawn","playerId":"p_a3f9b1","zoneId":1001,"x":3.0,"y":3.0}

// Party.
{"op":"event","kind":"partyUpdate","partyId":"...","code":"K7MJ2","members":[...]}
{"op":"event","kind":"partyJoinFailed","reason":"not_found"|"full"|"same_party"}

// Toast / notification surfaced by sim (used by mob death messages, etc).
{"op":"event","kind":"toast","forPlayerId":"p_a3f9b1","textKey":"notification.pickup","args":{"name":"Coin"}}

// Cutscene transitions.
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
  "worldType": "HouseInterior",                // raw upstream field, preserved as `worldType` for now
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
    {"id":4242,"species_id":123,"x":10.5,"y":7.0,"frame":{...},"hp":20,"_open":false,...}
  ],
  "spawnPoint": {"x":3,"y":3}
}
```

Notes:
- Tile grids are unchanged from the raw `data/*.json` shape so existing parsers work.
- `players` is the live, server-authoritative state. Client renders these directly — no local prediction in v0.
- `entities` carries the live entity state, including mob HP, gate `_open` flags, pushable positions, etc.

## Close codes

The server uses non-standard close codes (range 4000–4999) for protocol-specific reasons. The client interprets these for UI:

| Code | Meaning | Client action |
|---|---|---|
| `1000` | Normal closure | Show "Disconnected" toast, offer reconnect |
| `4001` | Obsolete protocol | Force a `location.reload()` |
| `4002` | Idle timeout (no pings) | Auto-reconnect once, then show "Disconnected" |
| `4003` | UUID conflict (same UUID already connected) | Show "Already playing in another tab" |
| `4004` | Rate-limit ban | Show "Disconnected — too many messages" |
| `4500` | Internal server error | Show "Server error — reconnecting…" + auto-reconnect after 3 s |

## Reconnection

- Whenever the WebSocket closes, the client computes a back-off delay (1s, 2s, 4s, 8s, capped at 30s) and re-opens.
- On reopen, it sends the same UUID. Within the 30 s grace window the server restores the same session; after that the server treats it as a fresh login.
- The client should buffer no more than 2 seconds of unsent input — anything older is discarded on reconnect (the server's authoritative state would have evolved past it anyway).

## Rate limits

- Inputs: 30/sec per connection. Excess silently dropped.
- All other ops: 10/sec per connection.
- Severe violations (1000+ msgs in 10 s) result in a 4004 close. The same UUID can reconnect after 60 s.

## Anti-cheat boundary

The server is authoritative for *everything*. The client cannot:
- Move its own avatar — it can only send a movement intent; the server validates and applies.
- Add to its inventory — only the server emits `pickup` events.
- Open a gate, push a pushable, deal damage, complete a puzzle, advance dialogue — all server-side.
- Choose its display name in v0.

The client can:
- Render the world however it wants (skins, particles, animation timing).
- Manage its own UI state — open menu, change zoom, mute audio.
- Lie about whether it has paused — irrelevant to the server.

## Sequence diagrams

### Solo player joins, walks one tile, leaves

```
C → hello {uuid, protocol:1, joinCode:null}
S → welcome {playerId, partyCode, zone}
C → input {intent:"moveDown"}
... server ticks at 10 Hz, broadcasting deltas with the player's updated position ...
S → delta {tick:101, players:[{playerId, tileY:1}]}
S → delta {tick:102, players:[{playerId, tileY:2}]}
C → input {intent:"stopMove"}
C → (WS close)
... server marks player as ghost, 30 s grace ...
... 30 s later: server removes the ghost; party-of-one is GC'd (empty)
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
S → B: delta {removed:{players:[U1]}}     (A vanished from zone 1001)
... B is still in zone 1001 alone. When B teleports too, B will land in the same zone-1002 instance party PA already owns ...
```

## Open questions (deferred)

- **Compression.** Maybe per-message deflate later; not needed at 10 Hz with small payloads.
- **Binary frames.** If/when JSON CPU is the bottleneck.
- **Partial-zone deltas.** Splitting `delta` by region for very large zones. Not relevant at current zone sizes.
- **Server push for matchmaking / find-friend.** Not in v0 — parties are formed by code-sharing out of band.
