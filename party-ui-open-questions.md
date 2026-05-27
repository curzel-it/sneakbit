# Party UI redesign — open questions

## Context (for a future session reading this cold)

We're about to implement the **Party UI redesign** tracked in `todo.md` under
"Party UI redesign (single shot — UI + runtime role switching together)".
The implementation plan: move party info/management out of the always-on
top-right overlay (`js/partyPanel.js`) into a dedicated panel reached from
the settings/pause menu, replace the overlay with a small status chip,
add three contextual views (offline / hosting / guest), add a `host.kick`
protocol op, and at the same time refactor role to be runtime state so
switching offline ↔ host ↔ guest happens in-place (no `location.replace`).

Authoritative protocol spec: `host-authoritative-server.md`.
Today's overlay: `js/partyPanel.js`.
Role state today: `js/onlineMode.js` + `js/onlineBootstrap.js` (URL-driven
at boot, cached forever).
Per-role module installs: `js/snapshotBroadcaster.js`, `js/hostGuests.js`,
`js/mirrorWorld.js`, `js/predictedSelf.js`, `js/guestInputForwarder.js`,
`js/guestEvents.js`.

Before writing code I want to lock down 7 product/UX choices below. Each
has my current assumption, the alternative(s), and what changes downstream
depending on the answer. Fill in the **Decision:** line for each, then ping
me (or a future Claude session) with this file.

---

## Reference: session-lifecycle timeline

These are the flows the new UI has to support. The questions below assume
this timeline; if any of the steps need to change, call it out.

### Start session — host opens
1. Host (offline) pauses → opens settings → Party panel.
2. Host clicks "Start hosting".
3. Client runs `switchRole("host")` — installs `snapshotBroadcaster`,
   `hostGuests`; opens WS to relay if not already open.
4. Host → Relay: `hello {protocol, uuid, client}` (first connect only).
5. Relay → Host: `welcome {playerId, name}`.
6. Host → Relay: `host.open`.
7. Relay generates 5-char code, creates in-memory session.
8. Relay → Host: `host.opened {sessionId, code, maxGuests}`.
9. Party panel renders Hosting view: code + Copy / Share buttons + empty
   peer list + "End co-op" button. Status chip → "Hosting · 1/4".
10. Host shares code; game runs locally; broadcaster ticks 20 Hz, empty
    deltas until a guest joins.

### Guest joins
1. Guest pauses → settings → Party. Either types code into "Join with
   code" or opens deep-link `?join=CODE`.
2. `switchRole("guest", { code })` — tears down offline simulation,
   installs `mirrorWorld`, `predictedSelf`, `guestInputForwarder`,
   `guestEvents`; opens WS if needed.
3. Guest → Relay: `hello`.
4. Relay → Guest: `welcome`.
5. Guest → Relay: `guest.join {code}`.
6. Relay validates: not_found / full / host_offline → `guest.joinFailed`,
   stop. Otherwise allocates slot 2/3/4.
7. Relay → Guest: `guest.joined {sessionId, hostName, hostPlayerId,
   selfPlayerId, slot, peers}`.
8. Relay → host + other guests: `peer.joined {playerId, name, slot}`.
9. Host's `hostGuests` spawns the avatar; `setNetworkGuestCount` bumps;
   next broadcaster tick includes the new player. Toast: "Player-x joined".
   Status chip → "Hosting · 2/4".
10. Host → Relay → Guest: full `snapshot {zoneId, players, entities,
    lastSeq}` (broadcaster's `peer.joined` listener fires).
11. Guest's `mirrorWorld` loads zoneId locally, applies snapshot;
    `predictedSelf` seeds from mirror copy. Renderer paints host's world.
    Status chip → "Guest · slot 2".

### Steady state (no UI surface)
- Guest keys → `input {seq, intent}` → relay → host injects as P2/3/4.
  Guest also runs `predictedSelf` locally for zero-latency feel.
- Host runs normal tick; broadcaster emits `delta` at 20 Hz; `event`
  frames for discrete things ride alongside.
- On every snapshot guest reconciles `predictedSelf` against
  `lastSeq[selfId]`, replaying any unacked inputs.

### Host kicks a guest
1. Host clicks "Kick" next to a peer in the Hosting view.
2. Host → Relay: `host.kick {playerId}`.
3. Relay validates `ctx.role === "host"` and that playerId belongs to a
   guest in this session.
4. Relay closes kicked guest's WS with code **4005** (kicked).
5. Relay → host + remaining guests: `peer.left {playerId, reason:
   "kicked"}`.
6. Kicked guest: `net.js` does NOT auto-reconnect on 4005 (same family as
   4001/4003); panel shows "You were removed from the session";
   `switchRole("offline")`.
7. Host: `hostGuests.onPeerLeft` despawns; peer list updates; status chip
   drops count.

### Guest leaves voluntarily
1. Guest clicks "Leave co-op".
2. Guest → Relay: `guest.leave`.
3. Guest runs `switchRole("offline")` — tears down mirror/predicted/
   forwarder/events; offline boot resumes from guest's own local save
   (untouched during session).
4. Relay → host + other guests: `peer.left {playerId, reason: "leave"}`.
5. Host despawns avatar after grace; toast: "Player-x left".

### Guest unexpected disconnect
1. WS drops with no `guest.leave`.
2. Relay marks ghosted; 30 s grace timer.
3. Relay → host + others: `peer.ghosted {playerId}`.
4. Host + others freeze avatar in place; toast "Player-x lagging…".
5a. Reconnect within grace → guest re-issues `hello` + `guest.join`,
    relay returns same slot, fans `peer.rejoined`, broadcaster sends
    fresh full snapshot.
5b. Grace expires → relay → host+others `peer.left {reason: "timeout"}`;
    host despawns avatar.

### Host unexpected disconnect
1. Host's WS drops.
2. Relay ghosts host; 30 s grace timer.
3. Relay → all guests: `host.ghosted`.
4. Guests toast "Host lagging…"; mirrors freeze; `isMirrorStale` true.
5a. Host reconnects within grace → `net.js` auto-reconnects, re-issues
    `hello` + `host.open`. Relay matches uuid to still-living session,
    `resumeHost`, replies `host.opened {resumed: true}`, fans
    `host.resumed` to guests. Broadcaster emits fresh full snapshot.
5b. Grace expires → relay → all guests `session.closed {reason:
    "host_timeout"}`. Guests run `switchRole("offline")`. Host's local
    game is untouched; on reconnect they'd start a new session with a
    new code.

### Host ends session voluntarily
1. Host clicks "End co-op".
2. Host → Relay: `host.close`.
3. Relay → each guest: `session.closed {reason: "host_quit"}`, then
   closes their WS with 1000.
4. Relay destroys session, frees the invite code.
5. Host runs `switchRole("offline")` — tears down broadcaster +
   hostGuests; offline play resumes from current world unchanged.
6. Each guest receives `session.closed`; toast "Session ended — back to
   offline"; `switchRole("offline")`.

---

## Open questions

### 1. Host's local game during a session

Today the host plays exactly as offline; ending the session just stops
broadcasting. Should "End co-op" do anything visible to the host
(toast, etc.) beyond returning to plain offline play?

- **My assumption:** brief toast "Session ended" and the status chip
  vanishes; nothing else changes for the host.
- **Alternative:** silent — no toast, status chip just disappears.
- **What changes downstream:** trivial; one line in the End-co-op
  handler.

**Decision:** Brief toast on host's End-co-op click ("Co-op ended"),
status chip vanishes. Session does *not* end when all guests leave —
host stays in hosting state with empty peer list until they explicitly
click End co-op (or disconnect past grace).

---

### 2. Guest's local save during a session

Right now the guest's *own* offline save is left untouched while they're
in a session. On `switchRole("offline")` after leaving, they resume from
wherever their own save was. Confirming that's the intent.

- **My assumption:** guest's offline save is independent of session
  state; nothing the guest does in a session writes to their save.
- **Alternative:** "session progress carries over" — e.g. items the
  guest collected in the host's world would somehow merge into their
  local save when they leave. This was explicitly out of scope per
  `host-authoritative-server.md` § Persistence, but worth confirming
  before I bake the assumption deeper.
- **What changes downstream:** if the answer is "merge progress", we
  need a whole new persistence layer + conflict resolution; spec would
  need an update; significantly bigger work.

**Decision:** Guest's offline save is fully independent of session
state. Co-op is "a visit to the host's world" — nothing the guest does
in-session writes to their local save. Matches `host-authoritative-
server.md` § Persistence; no spec change needed.

---

### 3. Starting a session while in creative / map editor

`todo.md` has a polish item "Disable hosting while in creative / map
editor". What's the desired UX when a host in creative clicks "Start
hosting"?

- **My assumption:** refuse the click, toast "Leave creative mode
  first." Hosting button is greyed out / hidden in creative.
- **Alternative A:** silently force-exit creative + start hosting.
- **Alternative B:** allow hosting in creative, but disable map-editor
  mutations while guests are connected (would need real-time gating).
- **What changes downstream:** alternative A is a one-liner; B is more
  invasive.

**Decision:** Hosting button is disabled (greyed) while in creative /
map editor, with a tooltip "Leave creative mode first." No force-exit,
no live-editing-with-guests. Alt B can revisit later if requested.

---

### 4. Status chip when offline

I assumed *nothing* shows when offline (the chip only appears when
hosting or guesting).

- **My assumption:** empty offline HUD (Party reached via settings only).
- **Alternative:** a small "Play co-op" chip always visible when offline,
  opens the party panel on click. More discoverable; more clutter.
- **What changes downstream:** trivial render branch.

**Decision:** No always-on chip when offline. Party is reached via the
pause/settings menu only. Status chip appears only while hosting or
guesting.

---

### 5. Deep-link `?join=CODE` while already in a session

User opens the offline tab, then somebody navigates them to `?join=CODE`
(or they paste it into the URL bar). What happens?

- **My assumption:** honor it — auto-leave current session (host or
  guest), auto-join new session via the new code. Behaves like a
  fresh-launch deep-link.
- **Alternative A:** ignore it — require explicit Leave first; show a
  toast "Already in a session; leave first to join another."
- **Alternative B:** prompt — modal "Leave current session and join
  CODE?" with Yes/No.
- **What changes downstream:** A is simplest; B is most user-friendly
  for accidents. Spec doesn't say anything; whichever way you choose
  should be documented.

**Decision:** Honor the deep-link. If currently hosting or guesting,
auto-leave (host.close or guest.leave as appropriate), then auto-join
new session via the code. Behaves like a fresh-launch deep-link. To be
documented in `host-authoritative-server.md`.

---

### 6. Kick close code

I picked **4005** (new code in the 4000-4999 application range) for kicks.

- **My assumption:** 4005 = "kicked by host"; net.js does NOT
  auto-reconnect (same family as 4001 obsolete / 4003 uuid conflict).
- **Alternative:** reuse 1000 (normal close) + a `peer.left {reason:
  "kicked"}` that the kicked guest also receives somehow. Keeps the
  close-code table smaller but is less honest about what the close
  meant.
- **What changes downstream:** trivial — picks which constants land
  in `wsFrames.js` / `relay.js` / `net.js`.

**Decision:** 4005 = "kicked by host". Distinct close code in the 4000-
4999 application range; `net.js` treats it as no-auto-reconnect (same
family as 4001/4003). To be added to the close-code table in
`host-authoritative-server.md`.

---

### 7. Reconnect behavior on 4005

I assumed kicks don't auto-reconnect (you got kicked; coming right back
would be hostile to the host).

- **My assumption:** 4005 in the no-reconnect list. Kicked guest is back
  to offline and must explicitly re-join (and the host must un-kick by
  letting them).
- **Alternative:** treat 4005 like 1000 (auto-reconnect after backoff).
  Useful if you ever want a "rejoin if host re-invites" loop. Currently
  there's no concept of un-kick / invite-list on the host side.
- **What changes downstream:** if alternative chosen, need a host-side
  "kick list" so the relay can re-reject reconnect attempts from the
  same UUID until the host clears them, otherwise the kick has no teeth.

**Decision:** 4005 is in `net.js`'s no-auto-reconnect list. Kicked
guest goes to offline and must explicitly re-join (if the host allows
it). No host-side kick list / ban list for v1.

---

## After you answer

Hand this file back (or paste the **Decision:** lines) and I'll:

1. Update `host-authoritative-server.md` for any spec-relevant decisions
   (Q2, Q5, Q6, Q7 touch the protocol or persistence model).
2. Update `todo.md`'s Party UI section to reflect the chosen behavior
   per question.
3. Start the implementation work in this order:
   a. Pair install/teardown for the 6 per-role modules.
   b. Implement `switchRole(role, opts)` in `onlineMode`.
   c. New `host.kick` op end-to-end (server relay + close code +
      client handling).
   d. Build the dedicated panel + status chip; wire to settings menu.
   e. Migrate party-panel buttons from `location.replace` to
      `switchRole`.
   f. Boot-time URL handling: offline boot first, then `switchRole` if
      `?host=1` / `?join=CODE`.
