JS port replaces Rust codebase in production via Electron or similar, across all platforms
- [ ] Do a complete playthrough for testing
- [ ] Add translation support and italian localization
- [ ] Gamepad/controller support (P1 works; online guests not wired)
- [ ] Local co-op with up to 4 players (currently limited to 2)
- [ ] Native wrapper (needs to be an actual app for mobile, single binary for Steam, ...)
- [ ] Full screen support
- [ ] Probably other things I don't remember rn
- [ ] Game remains playable completely offline, like it always was

# Online co-op (spec: docs/server.md)

Shipped: phases 0–10 (relay, prediction, events, zone transitions, party panel, WebRTC + STUN/TURN, permessage-deflate) plus post-phase polish — security batch (frame cap, origin allowlist, join-code/?server= gates), guest role gates, Phase 7 discrete events end-to-end, structured logging + /metrics + /version + LOG_LEVEL, SIGTERM graceful drain, mirror resync op, direct-call action dispatch, cooldown cheat-resistance, snapshot delta tightening, mirror animation phase, action-intent buffering on reconnect, TLS smoke gate in deploy.py. Remaining work below.

Polish — server
- [ ] Drop /ws=/ alias on server
- [ ] Validate full UUIDv4 shape in onHello (today only length >= 4)
- [ ] Reuse mutable getLastSeqMap to avoid GC churn at 20 Hz
- [ ] Range sanity checks on inbound action intents (cooldowns already in place; range is the second half of the "light cheat resistance" item)

Polish — client
- [ ] Surface isMirrorStale as "Host lagging…" overlay (not just the toast on host.ghosted)
- [ ] Toast-event allowlist on hostEvents.broadcastHostEvent
- [ ] dev-warn when serializeEntity drops an entity for missing id
- [ ] friendlyReason: generic "Couldn't connect" fallback instead of raw reason string

Future work (spec defers)
- [ ] Real accounts (email / OAuth), uuids to be used as primary key
- [ ] Voice / text chat (separate scope, moderation concern)
- [ ] Snapshot's `t` is a broadcaster counter today — ship the host's real game tick (or wall-clock) for time-based interpolation; would let the mirror render at host-time `t` instead of receive-time, smoothing over dropped frames

Cleanup / minor
- [ ] zoneCache: don't leak old bakes across mirror zone changes
- [ ] getMode() perma-caches mode/code/uuid — document or make explicit (matters if we ever add a "Leave to offline" runtime path)
