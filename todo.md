Js port replaces Rust codebase in production via Electron or similar, across all platforms
- [ ] Do a complete playthrough for testing
- [ ] Add translation support and italian localization
- [ ] Gamepad/controller support (P1 works; online guests not wired)
- [ ] Local co-op with up to 4 players (currently limited to 2)
- [ ] Native wrapper (needs to be an actual app for mobile, single binary for Steam, ...)
- [ ] Full screen support
- [ ] Probably other things I don't remember rn
- [ ] Game remains playable completely offline, like it always was

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
- [ ] "Close to friends" button in party panel (host-side runtime close, not just URL navigation)
- [ ] "Open to friends" button in party panel (host runtime open from inside an offline session)
- [ ] "Leave session" button for guests
- [ ] Dedicated event:zoneChange frame with fade — today guests teleport mid-frame to the new zone
- [ ] isMirrorDead (>5 s no frames) → auto-fallback to offline mode
- [ ] Resume-host path: relay.findByUuid returning a guest-session collides; gate by role before falling through to createSession
- [ ] Extend hostGuests beyond slot 2 (P3 / P4) once main.js gains state.players[]
- [ ] Slot reassignment on guest reconnect-after-grace: test coverage for A-drops, B-takes-slot, A-returns
- [ ] Display name rendering above player heads (spec promises Player-a3f9 labels, never wired)

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

Polish — party panel
- [ ] Copy-to-clipboard for the invite code
- [ ] Share-link button (https://curzel.it/sneakbit-html/?join=CODE)
- [ ] Stop nuking innerHTML on every state change; reuse elements (keeps focus / scroll)
- [ ] Responsive layout for small screens
- [ ] Touch / mobile pass on the party panel and join form

Polish — guest mode role gates
- [ ] Suppress saveProgress beforeunload for guests (today the local save accumulates stale state.player data)
- [ ] Gate fastTravel install by role
- [ ] Gate healthHud / ammoHud installs by role (currently render the guest's local inventory, not the host's view)
- [ ] Gate menu's New Game / Reset by role (would wipe the guest's UUID + identity)
- [ ] Gate firstLaunch tutorial by role
- [ ] Defensively gate mapEditor install by role (today only protected by isCreativeMode → guest gate, defense-in-depth)
- [ ] Disable hosting while in creative / map editor
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

Spec deviations to reconcile
- [ ] Update host-authoritative-server.md: snapshot no longer carries zone data (host and guest share level files; mirror loads locally)
- [ ] Snapshot's `t` is a broadcaster counter, not a game tick — either fix code to ship the real tick, or update spec
- [ ] Spec mentions event:zoneChange with embedded snapshot — implement or remove from spec

Future work (spec already defers)
- [ ] WebRTC data channel for snapshots + inputs; relay handles signaling only
- [ ] STUN (free public) + TURN (self-host on same VPS) for NAT traversal
- [ ] Per-message deflate compression
- [ ] Host save resumption: remember last friend list for one-tap re-invite
- [ ] Real accounts (email / OAuth) binding to existing UUID
- [ ] Voice / text chat (separate scope, moderation concern)

Cleanup / minor
- [ ] zoneCache: don't leak old bakes across mirror zone changes
- [ ] getMode() perma-caches mode/code/uuid — document or make explicit (matters if we ever add a "Leave to offline" runtime path)
