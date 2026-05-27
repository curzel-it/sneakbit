JS port replaces Rust codebase in production via Electron or similar, across all platforms
- [ ] Do a complete playthrough for testing
- [ ] Add translation support and italian localization
- [ ] Gamepad/controller support (P1 works; online guests not wired)
- [ ] Local co-op with up to 4 players (currently limited to 2)
- [ ] Native wrapper (needs to be an actual app for mobile, single binary for Steam, ...)
- [ ] Full screen support
- [ ] Probably other things I don't remember rn
- [ ] Game remains playable completely offline, like it always was

Miscellanea
- [x] Pushable objects animation is wrong, it seems they "teleport two tiles in the push direction, then, with animation, come back of one", instead, we should see them moving from one tile to the next with a single smooth animation
- [x] Pushable objects have particular feature that covers the "pushed thing in a dead end" corner case. Basically when I pushed an object into a dead end, I can still move forward and go to the same tile it occupies, then, when I move next, the object should follow me. it seems it moves, but does not stay "in front of me", basically I can move it "one tile away from the dead end", but not "keep pushing it"...?
- [x] On mobile, the menu button is rendered on top of the ammo count, making both hard to see
- [x] Behavior of ESC is not consistent across differnet dialogues. For example, it cannot be used to close the "you died" dialog or any submenus.

# Offline co-op

- [x] Player 1 can't shoot kunais
- [x] Player 2 does not seem to have a key for shooting or using sword
- [x] No keybindings for player 2 (one tab per player in exising key bindings dialog?)
- [x] Player 2 is not being targeted by monsters (can still take damage)
- [x] Closing the tab / fresh browser launch should turn off local co-op (back to 1 player). Implemented via sessionStorage — survives F5 within a tab on purpose so an accidental refresh doesn't kick everyone out, but a new tab / cold boot starts in single-player.
 
# Online co-op (spec: docs/server.md)

Urgent:
- [x] It seems that resolution changes after starting a co-op (spotted on mobile)
- [x] When in offline co-op, users are playing on the same screen, so we have the camera be centered on both players. However, when playing online, each player has it's own screen, meaning we can keep the camera centered on the player like we do normally
- [x] After connecting in co-op (as guest), the "in session..." dialogue can be closed automatically
- [x] Labels with player names are shown above each player character, let's remove them
- [x] Like in offline co-op, neither of the players can shoot
- [x] Guest players cannot pick up objects
- [x] Line in offline co-op, guests are not targeted by monsters (can still take damage)
- [x] When hosting on desktop replace "share link" with "copy link"
- [x] The "hosting n/4" thing we see in the top right does not have a style that matches the rest of the hud
- [x] The "hosting n/4" thing we see in the top right covers the ammo count, should probably be next to it or below the hp bar

Phases 0–10 shipped (relay, prediction, events, zone transitions, party panel, WebRTC + STUN/TURN, permessage-deflate). Remaining work below.

Phase 7 events end-to-end
- [x] Hook event:pickup into pickups.js so guest inventory matches host
- [x] Hook event:death / respawn into host emitters and guest UI
- [x] Hook event:dialogueOpen/Advance/Close — guest mirrors host's read-only overlay, predicted self pauses while open
- [x] Hook event:cutsceneStart/End — guest plays the same animation, host owns trigger + onEnd entities

Polish — server
- [x] WS frame size cap ~1 MB in parseFrames (currently > 2 GB before throwing)
- [x] Origin allowlist on WS upgrade
- [x] Structured logging: session open/close, peer join/leave, ping-timeout closes
- [x] /metrics endpoint (active sessions, bytes relayed, drops)
- [x] /version endpoint with git SHA
- [x] LOG_LEVEL env var
- [ ] Graceful drain on SIGTERM: broadcast session.closed{server_restart} before exit
- [ ] Drop /ws=/ alias on server
- [ ] Validate full UUIDv4 shape in onHello (today only length >= 4)
- [ ] Drop unused client→server masking branch from encodeFrame
- [ ] Light cheat resistance on host: range / cooldown sanity checks on inbound intents
- [ ] Reuse mutable getLastSeqMap to avoid GC churn at 20 Hz

Polish — client
- [x] Validate join-code format client-side (/^[A-Z0-9]{5}$/) before sending guest.join
- [x] Restrict ?server= URL override to localhost / 127.0.0.1 (anti-phishing)
- [x] Reset net.js backoff attempts counter on welcome, not on onopen (handshake-fail reconnects currently fast-loop)
- [x] Action intents (shoot/melee/interact): buffer last N, flush on reconnect — today a missed send is a missed shot
- [ ] dispatchActionForSlot: replace synthetic KeyboardEvent with direct tryShootForSlot / tryMeleeForSlot / tryInteractForSlot
- [x] Snapshot delta signature: drop x/y floats from sigPlayer, ship only on tile/direction change, reconstruct float path on guest from step.progress (saves ~80 records/sec while moving)
- [x] Mirror animation phase: align to step start, not free-running nowMs()/120 (sprites currently moonwalk briefly)
- [ ] Mirror resync request op (guest asks host for a fresh full snapshot)
- [ ] Surface isMirrorStale as "Host lagging…" overlay (not just the toast on host.ghosted)
- [ ] Toast-event allowlist on hostEvents.broadcastHostEvent
- [ ] onPeerGhosted: clearInputHeld only for the ghosting slot, not all
- [ ] dev-warn when serializeEntity drops an entity for missing id
- [ ] friendlyReason: generic "Couldn't connect" fallback instead of raw reason string

Polish — guest mode role gates
- [x] Gate fastTravel install by role
- [x] Gate healthHud / ammoHud installs by role (currently render the guest's local inventory, not the host's view)
- [x] Gate menu's New Game / Reset by role (would wipe the guest's UUID + identity)
- [x] Gate firstLaunch tutorial by role
- [x] Defensively gate mapEditor install by role (today only protected by isCreativeMode → guest gate, defense-in-depth)
- [x] Loading screen in guest mode → "Connecting to host…" not "Sprites loaded / Zone loaded"
- [x] Skip runMigrations on guests (a future migration touching the UUID key would be catastrophic)
- [x] Verify tickEntities is read-only on the guest (just bumps a global animClock — confirmed safe)
- [x] Don't load STARTING_ZONE_ID / STARTING_SPAWN / loadProgress on the guest path

Ops / deploy
- [x] Production deploy of the relay (sneakbit.curzel.it/ws) + nginx + TLS
- [x] Health-check /ws upgrade in deploy.py (today step_health hits `/` only — adds insurance against an nginx misconfig that breaks the upgrade path)
- [x] Check nginx config for /ws into the repo (vhost lives as an embedded template in deploy.py — version-controlled and re-applied on every run)
- [x] Check systemd unit sneakbit-server into the repo (same — embedded in deploy.py)
- [ ] Production smoke test: run tests/server.session.test.js against wss://sneakbit.curzel.it/ws after deploy (wsTestClient is plain `node:net` — needs a TLS variant)
- [x] Production smoke test: restartborgo.it remains reachable and serves a static website like before (covered by deploy.py's final `curl -fsSk https://restartborgo.it/` gate)

Future work (spec defers)
- [ ] Real accounts (email / OAuth), uuids to be used as primary key
- [ ] Voice / text chat (separate scope, moderation concern)
- [ ] Snapshot's `t` is a broadcaster counter today — ship the host's real game tick (or wall-clock) for time-based interpolation; would let the mirror render at host-time `t` instead of receive-time, smoothing over dropped frames

Cleanup / minor
- [ ] zoneCache: don't leak old bakes across mirror zone changes
- [ ] getMode() perma-caches mode/code/uuid — document or make explicit (matters if we ever add a "Leave to offline" runtime path)
