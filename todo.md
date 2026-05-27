Js port replaces Rust codebase in production via Electron or similar, across all platforms
- [ ] Do a complete playthrough for testing
- [ ] Add translation support and italian localization
- [ ] Gamepad/controller support (P1 works; online guests not wired)
- [ ] Local co-op with up to 4 players (currently limited to 2)
- [ ] Native wrapper (needs to be an actual app for mobile, single binary for Steam, ...)
- [ ] Full screen support
- [ ] Probably other things I don't remember rn
- [ ] Game remains playable completely offline, like it always was

Miscellanea
- [x] When on mobile the 4 direction buttons work great, but they require me to lift the finger to switch from on direction to the next. Ideally we want users to be able to "drag the finger over the next button" to change direction.
- [x] Sometimes audio does not start muted on mobile

New game mode: online co-op (spec: host-authoritative-server.md)

Phases shipped
- [x] Phase 1: WS relay (server/ws*.js + sessions.js + relay.js)
- [x] Phase 2: client networking (js/net.js + onlineMode.js + onlineBootstrap.js)
- [x] Phase 3: host snapshot broadcaster
- [x] Phase 4: guest mirror world + rendering
- [x] Phase 5: guest input forwarding + host injection
- [x] Phase 6: prediction + reconciliation
- [x] Phase 7: action intents + toast event framework
- [x] Phase 8: zone transitions
- [x] Phase 9: party panel, connection toasts, guest creative-mode gate

Review findings (2026-05-27)

Must fix before sharing with real users
- [x] Gate guest-side keyboard listeners — shooting/melee/interact/touch double-fire into dead local state.zone (and decrement local ammo)
- [x] Make toast broadcast opt-in — showToast(text, mode, { broadcast: true }); host's local toasts ("Equipped", "Player 2 died", peer-joined-self) leak to all guests today
- [x] Relay must fan peer.joined/left/ghosted/rejoined to ALL guests, not just host; mirrorWorld must purge departed players
- [x] predictedSelf: add input ring buffer, drop acked seqs on snapshot, replay unacked inputs after snap (current snap-only reconciliation rubber-bands on bursts)
- [x] Server rate limits (30/s input + snapshot, 10/s other) + close codes 4002 (idle, ping-timeout) and 4004 (rate-ban); net.js: special-case 4002 to one-shot reconnect (today blindly reconnects forever)
- [x] Cap server-advertised maxGuests at 1 until hostGuests handles slots 3/4 — today server accepts 3 guests, host silently drops anyone past slot 2

Phase 7 events end-to-end
- [ ] Hook event:pickup into pickups.js so guest inventory matches host
- [ ] Hook event:death / respawn into host emitters and guest UI
- [ ] Hook event:dialogueOpen/Advance/Close — and decide what the guest does while the host is in a dialogue modal (host pauses tick, guest stays running; predicted self will lurch)
- [ ] Hook event:cutsceneStart/End with the same dialogue concern

Significant gaps 
- [x] Dedicated event:zoneChange frame with fade — today guests teleport mid-frame to the new zone
- [x] isMirrorDead (>5 s no frames) → auto-fallback to offline mode
- [x] Resume-host path: relay.findByUuid returning a guest-session collides; gate by role before falling through to createSession
- [x] Extend hostGuests beyond slot 2 (P3 / P4) once main.js gains state.players[]
- [x] Slot reassignment on guest reconnect-after-grace: test coverage for A-drops, B-takes-slot, A-returns
- [x] Display name rendering above player heads (spec promises Player-a3f9 labels, never wired)

Party UI redesign (single shot — UI + runtime role switching together)
Design decisions:
  · Code generation is lazy: `host.open` is sent only after the user clicks "Start hosting", not on opening the panel — opening settings doesn't claim a session.
  · Role is a runtime piece of state, not a URL contract. Switching offline ↔ host ↔ guest happens in-place; no page reload. `?host=1` / `?join=CODE` stay supported as deep-link entry points but are not the only path.
Product/UX decisions locked in 2026-05-27 (see party-ui-open-questions.md for the full rationale):
  · Q1 — host End-co-op: brief toast "Co-op ended"; status chip vanishes. Session does NOT end when all guests leave (host stays in hosting state, broadcaster ticking, waiting for new joins).
  · Q2 — guest save: fully independent of session state. Nothing the guest does in-session writes to their local save. Matches spec § Persistence.
  · Q3 — hosting + creative: "Start hosting" button is disabled (greyed) while in creative / map editor with a tooltip "Leave creative mode first." No force-exit, no live-editing-with-guests in v0.
  · Q4 — offline status chip: none. Party is reached via the pause/settings menu only when offline. Chip appears only while hosting or guesting.
  · Q5 — deep-link `?join=CODE` while already in a session: honor unconditionally — auto-leave current session, auto-join new one. Documented in spec § Sessions and invites.
  · Q6 — kick close code: 4005 (new entry in spec's close-code table).
  · Q7 — reconnect on 4005: no auto-reconnect; kicked guest must explicitly re-join. No host-side kick list in v0.
UI:
- [x] Move party info/management out of the always-on top-right overlay into a dedicated panel reached from the settings/pause menu
- [x] Replace the overlay with a small status chip ("Hosting · 2/4" / "Guest · slot 2" / nothing when offline) that opens the dedicated panel on click
- [x] Offline view: "Start hosting" button (lazy host.open) + "Join with code" input
- [x] Hosting view: invite code with copy-to-clipboard + share-link buttons, peer list with per-peer Kick, "End co-op" button (emits a "Co-op ended" toast on the host per Q1)
- [x] Guest view: host name + slot + "Leave co-op" button
- [x] Reuse DOM nodes (no innerHTML rebuild) on state changes — keep focus / scroll
- [ ] Responsive layout + touch-friendly for the new party screen (works on desktop and mobile but not specifically tuned)
- [x] Disable the "Start hosting" button while in creative / map editor; show tooltip "Leave creative mode first." (Q3)
- [x] Handle deep-link `?join=CODE` while already in a session: auto-leave current, then auto-join the new code (Q5) — switchRole handles same-role-different-code; URL pastes navigate-and-re-run main, which is also covered
Protocol:
- [x] New op `host.kick { playerId }` — relay closes the guest's WS with close code 4005 and emits `peer.left { reason: "kicked" }` to the host + all remaining guests (server/relay.js + tests/server.session.test.js)
- [x] On 4005 close, net.js does NOT auto-reconnect; client runs `switchRole("offline")` and shows "You were removed from the session" toast (Q7)
Runtime role switching:
- [x] Pair every install with a real teardown: snapshotBroadcaster, hostGuests, mirrorWorld, predictedSelf, guestInputForwarder, guestEvents
- [x] Audit module-level singletons for reset on role change (predictedSelf's `predicted` / `installed` / `lastAckedSeq`; hostGuests' `guestSlotByPlayerId`, etc.)
- [x] Single `switchRole(role, opts)` entry point that drains the current role and brings up the next one in the right order
- [x] Role becomes a runtime piece of `onlineMode` state with subscribers; `getNetRole()` reads it, partyPanel + status chip subscribe to changes
- [x] Reset `state.player` / `state.zone` / save namespace on host ↔ guest transitions (currently set once at boot)
- [x] Party-panel buttons call `switchRole` directly — no `location.replace`
- [x] On boot, honor `?host=1` / `?join=CODE` once by calling `switchRole` after the initial offline boot completes (URL stays a deep-link entry point, not the role contract)

Polish — server
- [ ] WS frame size cap ~1 MB in parseFrames (currently > 2 GB before throwing)
- [ ] Origin allowlist on WS upgrade
- [ ] Structured logging: session open/close, peer join/leave, ping-timeout closes
- [ ] /metrics endpoint (active sessions, bytes relayed, drops)
- [ ] /version endpoint with git SHA
- [ ] LOG_LEVEL env var
- [ ] Graceful drain on SIGTERM: broadcast session.closed{server_restart} before exit
- [ ] Drop /ws=/ alias on server
- [ ] Validate full UUIDv4 shape in onHello (today only length >= 4)
- [ ] Drop unused client→server masking branch from encodeFrame
- [ ] Light cheat resistance on host: range / cooldown sanity checks on inbound intents
- [ ] Reuse mutable getLastSeqMap to avoid GC churn at 20 Hz

Polish — client
- [ ] Validate join-code format client-side (/^[A-Z0-9]{5}$/) before sending guest.join
- [ ] Restrict ?server= URL override to localhost / 127.0.0.1 (anti-phishing)
- [ ] Reset net.js backoff attempts counter on welcome, not on onopen (handshake-fail reconnects currently fast-loop)
- [ ] Action intents (shoot/melee/interact): buffer last N, flush on reconnect — today a missed send is a missed shot
- [ ] dispatchActionForSlot: replace synthetic KeyboardEvent with direct tryShootForSlot / tryMeleeForSlot / tryInteractForSlot
- [ ] Snapshot delta signature: drop x/y floats from sigPlayer, ship only on tile/direction change, reconstruct float path on guest from step.progress (saves ~80 records/sec while moving)
- [ ] Mirror animation phase: align to step start, not free-running nowMs()/120 (sprites currently moonwalk briefly)
- [ ] Mirror resync request op (guest asks host for a fresh full snapshot)
- [ ] Surface isMirrorStale as "Host lagging…" overlay (not just the toast on host.ghosted)
- [ ] Toast-event allowlist on hostEvents.broadcastHostEvent
- [ ] onPeerGhosted: clearInputHeld only for the ghosting slot, not all
- [ ] dev-warn when serializeEntity drops an entity for missing id
- [ ] friendlyReason: generic "Couldn't connect" fallback instead of raw reason string

Polish — guest mode role gates
- [x] Suppress saveProgress beforeunload for guests (wipeGuestState nulls state.zone/player on guest entry; save.js's saveProgress already no-ops in that case)
- [ ] Gate fastTravel install by role
- [ ] Gate healthHud / ammoHud installs by role (currently render the guest's local inventory, not the host's view)
- [ ] Gate menu's New Game / Reset by role (would wipe the guest's UUID + identity)
- [ ] Gate firstLaunch tutorial by role
- [ ] Defensively gate mapEditor install by role (today only protected by isCreativeMode → guest gate, defense-in-depth)
- [ ] Loading screen in guest mode → "Connecting to host…" not "Sprites loaded / Zone loaded"
- [ ] Skip runMigrations on guests (a future migration touching the UUID key would be catastrophic)
- [ ] Verify tickEntities is read-only on the guest (mutations are wiped by the next delta — confirm intent)
- [ ] Don't load STARTING_ZONE_ID / STARTING_SPAWN / loadProgress on the guest path

Ops / deploy
- [ ] Production deploy of the relay (sneakbit.curzel.it/ws) + nginx + TLS
- [ ] Health-check /ws upgrade in deploy.py
- [ ] Check nginx config for /ws into the repo
- [ ] Check systemd unit sneakbit-server into the repo
- [ ] Production smoke test: run tests/server.session.test.js against wss://sneakbit.curzel.it/ws after deploy
- [ ] Production smoke test: restartborgo.it remains reachable and serves a static webiste like before

Spec deviations to reconcile
- [x] Update host-authoritative-server.md: snapshot no longer carries zone data (host and guest share level files; mirror loads locally)
- [x] Spec aligned with Phase 8: event:zoneChange is a heads-up frame `{zoneId, fromZoneId}` followed by a separate snapshot, not inline-payload

Future work (spec already defers)
- [x] WebRTC data channel for snapshots + inputs; relay handles signaling only
      (signaling routed via `webrtc.signal` op; per-peer DataChannel; game
      ops auto-lift off WS once all DCs are open — js/webrtcChannel.js +
      js/webrtcTransport.js)
- [x] STUN (free public) + TURN (self-host on same VPS) for NAT traversal
      (STUN list shipped in webrtcChannel.DEFAULT_STUN_SERVERS; relay's
      /turn-credentials endpoint serves ephemeral REST-API creds when
      TURN_SECRET + TURN_URLS env vars are set. Operator runbook lives in
      deploy.py beside the systemd unit template.)
- [x] Per-message deflate compression (RFC 7692, no_context_takeover both
      sides — server/wsExtensions.js)
- [ ] Real accounts (email / OAuth), uuids to be used as primary key
- [ ] Voice / text chat (separate scope, moderation concern)
- [ ] Snapshot's `t` is a broadcaster counter today — ship the host's real game tick (or wall-clock) for time-based interpolation; would let the mirror render at host-time `t` instead of receive-time, smoothing over dropped frames

Cleanup / minor
- [ ] zoneCache: don't leak old bakes across mirror zone changes
- [ ] getMode() perma-caches mode/code/uuid — document or make explicit (matters if we ever add a "Leave to offline" runtime path)
