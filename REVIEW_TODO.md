# Code Review — Action Items

Punch-list from the senior code review (engine, netcode, server, build/deploy, tests).
Each item: severity, location, the problem, and the fix. Check off as completed.

Severity key: **P0** = exploitable / data-loss / breaks in production · **P1** = real bug or
security gap, fix soon · **P2** = correctness/robustness debt · **P3** = hygiene/polish.

Recurring theme across P0/P1: *the code trusts peers and assumes the happy path holds under
failure.* Almost every item below is a facet of that one blind spot — on the wire (peers),
on disk (quota/IO), or on deploy (the destructive step).

> This list has been verified against the code (claims checked for exploitability, not just
> plausibility) and re-prioritized. Items that the first pass got wrong are noted inline.

---

## Threat model decision (2026-06-03)

"Trust the peers" was hiding **three different trust boundaries**, and the original list filed
them all under one heading. Decision adopted for re-triage:

1. **A peer lying about its *own* state** (HP, position, own ammo). It's JS in the browser —
   unpreventable and, with invite-only friends-only sessions, not worth defending. **Downgrade
   these.**
2. **A peer affecting *other* peers** (input spoofing, despawn/kill, slot hijack). Mostly social
   among friends — *except* where the same bug fires on version skew or a buggy (not malicious)
   client. **Keep only the cheap, double-as-bugfix ones.**
3. **The server / transport getting hurt** (DoS, OOM, slot exhaustion). **"P2P" gives zero cover
   here.** The DataChannel only exists *after* a full WS handshake (hello → host.open/guest.join →
   webrtc.signal), the relay is the *fallback* transport whenever the DC can't open (NAT/TURN), and
   the decompression/control-frame bombs detonate inside `WsConnection` *before* the relay sees a
   session at all (`wsConnection.js:99` inflate → `:102` emit → `relay.js:116`). Reachable by any
   internet client (`originAllowlist.js:32` allows no-Origin). **Keep all of these — they protect
   *you*, not hypothetical victims.**

Application-layer abuse *is* already well-handled (relay field-whitelists every relayed op and
server-stamps `from` — `relay.js:405,432`). The remaining real gaps are one layer down at the WS
**transport** (`wsConnection.js` / `wsFrames.js`), which sits below the P2P-vs-relay distinction.

### Do these regardless of threat model (highest value, cheapest)

- [x] **`maxOutputLength` on inflate** — `wsConnection.js:99`. One option. Turns "OOM the VPS" into
  a clean `close(1007)`. *Single highest-value fix on the list.* (P0)
- [x] **Validate WS control frames** — `wsFrames.js` / `wsConnection.js:65`. Reject opcode ≥ 0x8 with
  `!fin` or payload > 125 → kills PING amplification. (P1)
- [x] **Cap assembled message size across fragments** — `wsConnection.js:73-104`. Bound CONT growth. (P1)
- [x] **`conns.delete(ctx)` in the idle sweep** — `relay.js:133`. Stops the slot leak. (P0)
- [x] **Version/schema tag on game frames** — `snapshotBroadcaster.js`. Pure normal-operation bug:
  every push to `main` is a release, so an old tab + new build corrupt each other. No attacker. (P0)
- [x] **Unconditional `msg.from = remotePlayerId`** — `webrtcTransport.js:65`. One-char fix; removes a
  latent wrong-`from` bug as much as a spoof. (was P0, demoted to bugfix)
- [x] **Cap `netQueuedSteps`** — `hostGuests.js:258`. A buggy client (not just malice) → unbounded
  memory + autopilot. (P0)
- [x] **`.gitignore` + SSH host-key verification** — protects *your* secrets/credentials, nothing to
  do with peers. (P0)

### Safe to downgrade under friends-only (revisit only if sessions ever open to strangers)

- Receive-path op *allowlist* for griefing ops (`peer.left` kills victim, slot hijack) —
  `webrtcTransport.js:64`. Keep the `from` overwrite (above); the op-allowlist half is pure
  malicious-friend, socially mitigated. **Demoted P0 → P2.**
- NaN/Inf gates on inbound *self* state + HP sync — `guestSelfHpSync.js`, `guestEvents.js`. Host is
  the guest's trust root; self-harm only. **Stays P2, low urgency.**
- forgot-password timing, scrypt cost params, JWT min-length, enumeration oracle — real but low
  stakes for this user base; do opportunistically, not blocking. **Stays P1 but de-urgented.**

---

## P0 — Critical (do first)

- [x] **Allowlist ops on the DataChannel *receive* path (and always overwrite `from`)**
  `js/webrtcTransport.js:64-66` — `onMessage` does `net.emitOp(msg.op, msg)` for **any** `msg.op`;
  the `GAME_OPS` set only gates the *send* interceptor, never receive. Two distinct exploits:
  - `js/webrtcTransport.js:65` `if (!msg.from) msg.from = remotePlayerId;` only stamps when
    absent → a guest pre-sets `from` to another player's id and the host applies its inputs as
    that player (`js/hostGuests.js:201,230`).
  - With no receive allowlist, a guest emits relay-authoritative lifecycle ops the host's
    handlers key off attacker-controlled `playerId`/`slot`, **not** the channel identity
    (`js/hostGuests.js:158-190`): `{op:"peer.left", playerId:<victim>}` despawns / PvP-kills
    any other player, `{op:"peer.joined", slot:2}` hijacks a slot, `{op:"peer.ghosted"}` clears
    their input. Over the WS relay these ops have no guest-sendable route; the DC bypasses it.
  **Fix:** unconditionally `msg.from = remotePlayerId;`, AND restrict re-emitted ops to those a
  peer may legitimately originate (`input`, `move`, `event`, `guest.loadout`, `guest.resync`,
  `webrtc.signal`); drop `peer.*`/`host.*`/`welcome`/`snapshot`/`delta`/`guest.joined` from peers.
  > **Re-triaged 2026-06-03 (friends-only):** split this item. The `from` overwrite half is a
  > one-char fix that also removes a latent wrong-`from` bug → **keep, do now**. The op-allowlist
  > half is pure malicious-friend griefing, socially mitigated → **demoted P0 → P2**, revisit if
  > sessions ever open to strangers.

- [x] **Cap inflate output — permessage-deflate decompression bomb OOM-kills the relay**
  `server/wsConnection.js:99` — `inflateRawSync(appendTrailer(full), { finishFlush: Z_SYNC_FLUSH })`
  sets **no `maxOutputLength`**. The guard at `:91` caps only the *compressed input* (1MB). Raw
  deflate hits ~1000:1 on repetitive data → one 1MB RSV1 frame inflates to ~1GB synchronously,
  blocking the event loop and OOM-killing the single VPS, bypassing every per-frame/byte cap. The
  relay offers permessage-deflate to every browser client.
  **Fix:** pass `{ maxOutputLength: MAX_FRAME_PAYLOAD }`; the existing `catch` already turns the
  resulting `ERR_BUFFER_TOO_LARGE` into a clean `close(1007)`.
  > **2026-06-03:** confirmed pre-auth and P2P-independent — inflate at `wsConnection.js:99` runs
  > before the relay sees a session. Single highest-value fix on the list; do first.

- [x] **Cap `netQueuedSteps` (unbounded memory + map-autopilot)**
  `js/hostGuests.js:258` — `avatar.netQueuedSteps.push(...)` has no length limit. Each step is
  individually valid, but a tampered client streams thousands → memory growth and seconds of
  autopilot ignoring host displacement.
  **Fix:** cap queue length (e.g. ≤ a few steps) and/or drop commits arriving faster than
  `STEP_DURATION_MS` cadence.

- [x] **Add a version/schema tag to game frames (snapshot/delta/event)**
  `js/snapshotBroadcaster.js` (`buildSnapshot`/`buildDelta` emit only `op,t,zoneId,mode,players,
  entities,lastSeq`). The `PROTOCOL=1` hello gate covers only the WS handshake; game frames over
  the DC bypass the relay entirely. Two mismatched client builds silently corrupt each other's
  state. **Fix:** embed a schema/version field on game frames; reject or force-resync on mismatch.

- [x] **Fix relay connection-slot leak in the idle sweep**
  `server/relay.js:133` — sweep calls `ctx.ws.close()` but never `conns.delete(ctx)` (deletion
  only happens on the `close` event, `:118`, which `WsConnection.close()` never emits). Half-open /
  slow-FIN sockets hold slots past timeout, re-counted every sweep against `maxConnections`.
  **Fix:** `conns.delete(ctx)` (guarded against double-close) in the sweep.

- [x] **Enable SSH host-key verification in deploy**
  `deploy.py:302` (`AutoAddPolicy`) + `deploy.py:398` (`StrictHostKeyChecking=no`,
  `UserKnownHostsFile=/dev/null`), combined with `SSH_PASSWORD` to a root-capable account. MITM on
  first connect captures root-equivalent credentials.
  **Fix:** switch to SSH **key** auth with a pinned `known_hosts` (re-pin on VPS reimage); drop
  `sshpass`/password auth entirely.

- [x] **Add `.gitignore` before any `deploy.py --commit` runs**
  Repo has no `.gitignore`; `deploy.py:472` does `git add -A`, and `.env` holds `SSH_PASSWORD`/
  `JWT_SECRET`/`TURN_SECRET`/`SMTP2GO_API_KEY`. First `--commit` can push secrets to origin.
  (Presently dormant — neither the git repo nor `.env` exists on disk yet — but arms the moment
  both do.) **Fix:** add `.gitignore` (`.env`, `venv/`, `_site/`, `dist/`, `node_modules/`,
  `temp/`) now; narrow the commit step to an explicit path set.

---

## P1 — High (security / real failure modes)

- [x] **Stop the two silent save-loss bugs on the storage failure path**
  - `js/storage.js:59-62` updates the in-memory `cache` *before* the disk write, then swallows a
    failing `localStorage.setItem` in `catch {}`. Migration v3 (`js/migrations.js:67-75`) copies
    `latest_world`→`latest_zone` then drops `latest_world`. If the `latest_zone` write throws
    (quota / Safari private mode), the session looks fine (cache holds it) but disk has neither key
    → next load `loadProgress()` returns null → player reset to the starting zone, **save gone**.
  - `js/migrations.js:87-93` — the per-migration `try/catch` only `console.error`s, then
    `setValue(KEY_BUILD, BUILD_NUMBER)` runs **unconditionally**, so a throwing migration advances
    the build number anyway and is permanently skipped (and never recovers the above).
  **Fix:** update `cache` only after a successful `setItem`; stamp `KEY_BUILD` to the highest
  *successfully-applied* `to` and stop the ladder on a throw so it retries next boot.

- [x] **Validate WebSocket control frames (RFC 6455 §5.5) — PING amplification**
  `server/wsFrames.js:80-125` / `server/wsConnection.js:58-72` never reject a control frame
  (opcode ≥ 0x8) with `fin=0` or payload > 125 bytes. A 1MB PING is echoed as a 1MB PONG
  (`wsConnection.js:66`) — bandwidth amplifier below the JSON rate limiter.
  **Fix:** in `parseFrames`, `close(1002)` any opcode ≥ 0x8 with `!fin` or `payload.length > 125`.

- [x] **Reject unmasked client frames (RFC 6455 §5.1)**
  `server/wsFrames.js:110` parses masked and unmasked frames identically. Spec requires failing the
  connection on any unmasked client frame. **Fix:** if `!masked` on an inbound client frame, `close(1002)`.

- [x] **Cap total assembled WebSocket message size across fragments**
  `server/wsConnection.js:73-104` — per-frame cap (1MB) exists, but unlimited `fin=0` CONT frames
  grow `this.fragments` unbounded → OOM. Lone CONT and mid-stream TEXT mishandled vs RFC 6455 §5.4.
  **Fix:** track running fragment-byte total, close 1009 past a cap; reject CONT with no in-progress
  message; reject a new TEXT/BINARY while a fragmented message is open. (Also enforce a max
  post-decompression message size at this layer — `server/relay.js:141` `JSON.parse`s the whole
  frame *before* `checkRate` at `:144`, so oversized frames are parsed before any limiter applies.)

- [x] **Lock down the Electron renderer (CSP + sandbox + navigation handler)**
  `electron/main.js:33-36` sets only `contextIsolation`/`nodeIntegration:false` — no `sandbox:true`,
  no CSP (neither `index.html` nor `appProtocol.js`), no `setWindowOpenHandler`/`will-navigate`. Any
  XSS in the bundled game (or a malicious `data/*.json` reaching `innerHTML`) runs in a privileged
  context with no backstop — more dangerous than on the website precisely because there's no CSP.
  **Fix:** `sandbox:true`, a strict CSP header in the app-protocol handler,
  `setWindowOpenHandler(()=>({action:'deny'}))`, and a `will-navigate` guard pinned to `app://`.

- [x] **Test the save-migration data transforms**
  `js/migrations.js:36-75` — inventory-blob fan-out (v2, incl. the `count<=0`/non-finite filter at
  `:48-50`) and `latest_world`→`latest_zone` rename (v3) are untested; only bookkeeping is covered
  (`tests/migrations.test.js`, 3 tests). This rewrites real player data and would catch the two
  P1 storage bugs above. **Fix:** unit tests with realistic legacy blobs, including the filter and
  the v3 no-clobber guard.

- [x] **Add per-event idempotency to additive events** *(was: "one slow guest → double ammo")*
  Correction: `canSendNow()` (`js/webrtcTransport.js:128-134`) is all-or-nothing but each frame
  goes over **exactly one** path, so there is no simultaneous dual-delivery today. The real gap is
  that `handlePickup` (`js/guestEvents.js:137-147`) is additive with no seq/dedupe, so any *future*
  duplicate (path switch, replay) double-applies. **Fix:** per-event sequence / idempotency key so a
  doubly-delivered event is a no-op; optionally route each frame via that guest's best path.

- [x] **Enforce `JWT_SECRET` minimum strength at startup**
  `server/jwt.js:32-44` — only checks truthiness. A weak secret = offline-crackable 30-day
  non-revocable bearer tokens (`DEFAULT_TTL_SECONDS`). **Fix:** reject secrets `< 32` bytes at boot.
  (Note: an `alg`-confusion assertion is *not* needed — `verifyToken` already recomputes HMAC-SHA256
  unconditionally and never trusts the header `alg`, so `alg:"none"`/RS256 can't pass without the
  secret. Min-length is the real fix.)

- [x] **Make forgot-password constant-time (close the enumeration oracle)**
  `server/authRoutes.js:161-169` — response is sent only after `await sendEmail` (a real network
  `fetch`) on the user-exists path; non-existent users return immediately. Measurable latency
  difference defeats the always-200 design. **Fix:** fire-and-forget the email, or always await a
  constant-time path.

- [x] **Store scrypt cost parameters with the hash**
  `server/passwords.js:19` — format is `salt$hash` with no algorithm/cost marker (verify re-derives
  with node's default N=16384). Work factor can never be raised without breaking every existing hash.
  **Fix:** store `scrypt$N$r$p$salt$hash`; read params back on verify.

- [x] **Fix the UUID-conflict connection-slot leak**
  `server/relay.js:178` — `other.ws.close(4003,"uuid conflict")` never `conns.delete(other)`, same
  root cause as the idle-sweep P0. Lower severity (needs two live authed sockets presenting the same
  UUID, so each leak costs the attacker two connections). **Fix:** same `conns.delete` guard.

---

## P2 — Medium (robustness / recovery)

- [ ] **Cap WebSocket upgrades per IP** — `server/index.js:266` + `relay.attach` enforce only a
  *global* `maxConnections` (500). A single non-browser client (no Origin → allowed,
  `originAllowlist.js:32`) opens all 500 slots and denies everyone (worse with the slot-leak P0).
  **Fix:** cap concurrent upgrades per `remoteAddress`.

- [ ] **Throttle `guest.resync` (full-snapshot amplifier)** — `js/snapshotBroadcaster.js:61` rebuilds
  and broadcasts a full zone snapshot to *every* guest with no rate limit; one guest spamming it
  forces repeated whole-zone serialization + fan-out. **Fix:** throttle per-guest (~1/s) and address
  the snapshot to just the requester.

- [ ] **Don't let first sign-in adopt a stale cloud save over newer offline progress**
  `js/cloudSave.js:42` returns `"pull"` whenever `meta.rev == null` and cloud differs, ignoring local
  recency → `reloadForPull` wipes offline progress. **Fix:** compare local divergence/recency vs
  `cloud.updatedAt` before the blind pull; prefer push or prompt.

- [ ] **Don't wipe the kv namespace before a successful write** — `js/saveBlob.js:64-78` deletes all
  `sneakbit.kv.v1.*` then writes inside one `catch {}`; a mid-write quota throw leaves the store
  wiped/half-written. **Fix:** write the new set first, delete-stale only after writes succeed (or
  snapshot+restore on throw).

- [ ] **Validate `seq` on the host independent of transport** — the relay coerces `seq`/coords
  (`server/relay.js:406-438`); the DC path doesn't. `js/hostGuests.js:283-287` only does
  `typeof seq !== "number"`, so `seq: 2e9` jams `lastSeqOut` and desyncs that guest's ack.
  **Fix:** require a finite integer with a sane forward jump before `ackStep`.

- [ ] **Refresh expired TURN credentials + add ICE restart**
  `js/iceConfig.js:13-15,45` — `cachedExpiresAt` is stored but only ever read by a test getter; creds
  are fetched once at boot and reused forever. No ICE-restart anywhere (`js/webrtcChannel.js:107-113`
  goes straight to FAILED). A transient blip kills the channel — the exact case TURN exists for.
  **Fix:** re-fetch creds when past `cachedExpiresAt`; `pc.restartIce()` on `disconnected`/`failed`
  before giving up.

- [ ] **Fix the `host.resumed` reconnect rebuild**
  `js/webrtcTransport.js:117-123` — guest tears down channels but can't rebuild (never stored the
  host's playerId); self-documented as broken. **Fix:** store `hostPlayerId` in the transport;
  recreate the channel on `host.resumed`.

- [ ] **Reject NaN/Inf on inbound game & event frames**
  `js/guestSelfHpSync.js:44-49` — gate is `typeof self.hp !== "number"`, which **passes `NaN`**;
  `setPlayerHp` then propagates it into the HUD. Also cap array lengths before iterating `items`
  (`js/guestEvents.js:139-166`) and mirror `players`/`entities`. Low severity (host is the guest's
  trust root) but cheap. **Fix:** `Number.isFinite` clamps + array-length caps.

- [ ] **Tag replayed action intents with zone/epoch** *(was: "duplicate one-shot events on reconnect")*
  Correction: no host code replays `event` frames; only the guest's *own* buffered action intents
  replay (`js/guestInputForwarder.js:87-100`, TTL-guarded). The real risk is those intents firing
  against a new zone after the host changed zones during the blip. **Fix:** tag each pending intent
  with the zone/epoch it was created in; drop on mismatch at flush.

- [ ] **`shlex.quote` the certbot email** — `deploy.py:615-619` interpolates raw `{email}` into a
  remote root shell while every other shell value is quoted. Metacharacters in `.env` execute as root.

- [ ] **Don't put the Steam password on argv** — `tools/steam_upload.py:212-217` passes it to
  `steamcmd` as plaintext argv (visible via `ps`/`/proc`). **Fix:** feed via stdin / Steam Guard
  build-account flow.

- [ ] **Fix the vacuous deploy SHA health check** — `deploy.py:664` `grep -q '{expected_sha}'`; off-git
  `_local_git_sha()` returns `"unknown"` (`deploy.py:560`), so the strongest gate matches any
  `/version` body containing "unknown". **Fix:** fail/skip when sha=="unknown"; use `grep -qF -- "$sha"`.

- [ ] **Don't ship source maps to production** — `tools/build.mjs:53` (`sourcemap: true`) leaks
  readable source into `_site/`. **Fix:** `sourcemap: "external"` for staging only; exclude `.map`
  from the prod bundle.

- [ ] **Make the production bundle reproducible** — `package.json:49` esbuild `^0.28.0` (caret) +
  `deploy.py:483-485` never runs `npm ci` (the lockfile pins esbuild, but the deployer never installs
  from it). **Fix:** run `npm ci` in the build step on the deployer (or pin esbuild exactly).

- [ ] **Add a deploy rollback / atomic release** — `deploy.py:534-548` rsyncs `--delete` straight into
  live `WEBROOT`; health checks (`:629-687`) only *detect* failure after the destructive step.
  **Fix:** release-dir + symlink swap, or back up previous `_site`/`data.db` before the restart.

---

## P3 — Hygiene / polish

- [ ] **Rate-limit `/turn-credentials`** — `server/index.js:201` mints a valid 1-hour HMAC TURN
  credential per hit with no rate limit (unlike `/metrics`); scrapable by any non-browser client →
  free coturn bandwidth. Apply the metrics-limiter pattern.
- [ ] **Sanitize `EnvironmentFile` values** — `deploy.py:569` writes `.env` values verbatim; an
  embedded `\n` injects extra systemd env vars. Reject/escape newlines.
- [ ] **Guard SMTP-unconfigured logging** — `server/email.js:18-19` logs full reset links (live token)
  to stdout when SMTP is unset; gate on `NODE_ENV`.
- [ ] **Guard `verifyToken` against a non-object payload** — `server/jwt.js:64-65` does `payload.exp`
  on a parsed `null`/primitive → `TypeError` outside the try/catch. Not attacker-reachable (needs a
  valid HMAC) but a refactor landmine. Add `if (!payload || typeof payload !== "object") return null;`.
- [ ] **Map register UNIQUE-violation to 409, not 500** — `server/authRoutes.js:78-83`: concurrent
  same-email registrations race the existence check; the loser's INSERT throws and surfaces as 500.
- [ ] **Thread `keepalive` on the unload cloud flush** — `js/cloudSave.js:60` flush → `putCloudSave`
  never sets `keepalive`, so the last push on tab close is usually killed by teardown (re-syncs next
  load). Thread `keepalive:true` down the unload path.
- [ ] **Harden the build denylist** — `tools/build.mjs:31-44` denies literal `.env` only; a `.env.*`
  or the Steam `temp/` dir would ship into `_site/`. Deny any `.env*` and add `temp`/`build`; better,
  switch to an allowlist.
- [ ] **Reduce `main.js` surface** — 1094 lines; game logic (`maybeTeleport`, `handleHostState`,
  `handleCoopDeaths`, `tickGuestFrame`) has crept into the wiring file. Extract into modules. (No
  correctness bug found inside that logic — hygiene only.)
- [ ] **Add isolated tests for currency** — `js/arcadeCurrency.js` spend/earn/clamp has no dedicated
  test. Note: spend-below-zero/negative are already guarded; the only real weakness is 32-bit `| 0`
  truncation past 2³¹ (unreachable in normal play). Cover the branches anyway — it's ~10 lines.
- [ ] **Comment / whitelist DDL builder** — `server/db.js:62-64` interpolates table/column/type into
  DDL; safe today (hardcoded constants) but a landmine if ever called dynamically.
- [ ] **Tighten real-timer test windows** — `tests/net.test.js:156-163` (30/220ms vs 5/200ms backoff),
  `tests/mirrorWorld.test.js:202`, `tests/snapshotBroadcaster.test.js:381,434` race the wall clock and
  can flake under CI load. Inject a fake clock / deterministic backoff.
- [ ] ~~Resolve the stray `.skip` (allyAI.test.js:54)~~ — **INVALID, removed.** `allyAI.test.js:54` is
  `test("selectTarget skips dying enemies", …)` — a test *name* containing "skips", not a skipped
  test. It runs and passes; there is no `.skip` anywhere in `tests/*.test.js` (the only skips are the
  deliberate `SMOKE_URL`-gated prod smoke tests).

---

## Highest-value missing test coverage

The most dangerous code paths have the thinnest coverage. In priority order:
1. WebRTC receive-path identity/op enforcement (`js/webrtcTransport.js:64`) — assert a peer frame's
   `from` is overwritten and disallowed ops are dropped. Guards the headline P0.
2. Save-migration v2/v3 transforms with realistic legacy blobs — guards real player data + the two
   P1 storage bugs.
3. `netQueuedSteps` cap enforcement (P0).
4. WS fragment-assembly + decompression-output caps (P0/P1 DoS).
5. forgot-password *timing* (not just the 200 status, which gives false confidence).

---

## Progress tracker

Single consolidated view of every actionable item above. Tick a box here as you complete
it (and tick its inline counterpart). Counts exclude the one struck-through invalid P3.

| Severity | Done | Total |
|----------|------|-------|
| P0 — Critical          | 7 | 7  |
| P1 — High              | 11 | 11 |
| P2 — Medium            | 0 | 15 |
| P3 — Hygiene           | 0 | 11 |
| **Total**              | **18** | **44** |

### P0 — Critical (do first)
- [x] Allowlist ops on the DataChannel *receive* path + always overwrite `from` — `js/webrtcTransport.js:64-66`
- [x] Cap inflate output (decompression-bomb OOM) — `server/wsConnection.js:99`
- [x] Cap `netQueuedSteps` (unbounded memory + map-autopilot) — `js/hostGuests.js:258`
- [x] Add version/schema tag to game frames — `js/snapshotBroadcaster.js`
- [x] Fix relay connection-slot leak in idle sweep — `server/relay.js:133`
- [x] Enable SSH host-key verification in deploy — `deploy.py:302,398`
- [x] Add `.gitignore` before any `deploy.py --commit` runs — repo root

### P1 — High (security / real failure modes)
- [x] Stop the two silent save-loss bugs on storage failure path — `js/storage.js:59-62`, `js/migrations.js:67-93`
- [x] Validate WS control frames (PING amplification) — `server/wsFrames.js:80-125`
- [x] Reject unmasked client frames — `server/wsFrames.js:110`
- [x] Cap total assembled WS message size across fragments — `server/wsConnection.js:73-104`
- [x] Lock down Electron renderer (CSP + sandbox + nav handler) — `electron/main.js:33-36`
- [x] Test the save-migration data transforms — `js/migrations.js:36-75`
- [x] Add per-event idempotency to additive events — `js/guestEvents.js:137-147`
- [x] Enforce `JWT_SECRET` minimum strength at startup — `server/jwt.js:32-44`
- [x] Make forgot-password constant-time — `server/authRoutes.js:161-169`
- [x] Store scrypt cost parameters with the hash — `server/passwords.js:19`
- [x] Fix the UUID-conflict connection-slot leak — `server/relay.js:178`

### P2 — Medium (robustness / recovery)
- [ ] Cap WebSocket upgrades per IP — `server/index.js:266`
- [ ] Throttle `guest.resync` (full-snapshot amplifier) — `js/snapshotBroadcaster.js:61`
- [ ] Don't adopt stale cloud save over newer offline progress — `js/cloudSave.js:42`
- [ ] Don't wipe the kv namespace before a successful write — `js/saveBlob.js:64-78`
- [ ] Validate `seq` on the host independent of transport — `js/hostGuests.js:283-287`
- [ ] Refresh expired TURN credentials + add ICE restart — `js/iceConfig.js:13-15,45`
- [ ] Fix the `host.resumed` reconnect rebuild — `js/webrtcTransport.js:117-123`
- [ ] Reject NaN/Inf on inbound game & event frames — `js/guestSelfHpSync.js:44-49`
- [ ] Tag replayed action intents with zone/epoch — `js/guestInputForwarder.js:87-100`
- [ ] `shlex.quote` the certbot email — `deploy.py:615-619`
- [ ] Don't put the Steam password on argv — `tools/steam_upload.py:212-217`
- [ ] Fix the vacuous deploy SHA health check — `deploy.py:664`
- [ ] Don't ship source maps to production — `tools/build.mjs:53`
- [ ] Make the production bundle reproducible — `package.json:49`, `deploy.py:483-485`
- [ ] Add a deploy rollback / atomic release — `deploy.py:534-548`

### P3 — Hygiene / polish
- [ ] Rate-limit `/turn-credentials` — `server/index.js:201`
- [ ] Sanitize `EnvironmentFile` values — `deploy.py:569`
- [ ] Guard SMTP-unconfigured logging — `server/email.js:18-19`
- [ ] Guard `verifyToken` against a non-object payload — `server/jwt.js:64-65`
- [ ] Map register UNIQUE-violation to 409, not 500 — `server/authRoutes.js:78-83`
- [ ] Thread `keepalive` on the unload cloud flush — `js/cloudSave.js:60`
- [ ] Harden the build denylist — `tools/build.mjs:31-44`
- [ ] Reduce `main.js` surface — `js/main.js`
- [ ] Add isolated tests for currency — `js/arcadeCurrency.js`
- [ ] Comment / whitelist DDL builder — `server/db.js:62-64`
- [ ] Tighten real-timer test windows — `tests/net.test.js:156-163`, `tests/mirrorWorld.test.js:202`, `tests/snapshotBroadcaster.test.js:381,434`

### Highest-value test coverage (cross-cuts the above)
- [x] WebRTC receive-path identity/op enforcement test (guards P0 #1) — `tests/webrtcTransport.test.js:200`
- [x] Save-migration v2/v3 transform tests (guards P1 save-loss)
- [x] `netQueuedSteps` cap enforcement test (guards P0 #3) — `tests/hostGuests.test.js:228`
- [ ] WS fragment-assembly + decompression-output cap tests (guards P0/P1 DoS) — fragment-assembly done (`tests/wsConnection.test.js`); decompression-output (inflate bomb → 1007) cap test still missing
- [ ] forgot-password *timing* test (guards P1 enumeration oracle)

---

## Genuine strengths (don't regress these)

- Comment quality explaining *why* + the bug each non-obvious choice prevents.
- `install*(stateGetter)` DI pattern across 142 modules (only one benign cycle).
- Exact tile-result reconciliation anchored to `#lastSeq` (`js/predictedSelf.js:206-228`).
- Relay field-whitelisting, stateless-JWT + `password_changed_at` revocation, constant-time
  comparisons (`server/jwt.js:61-62`, login dummy-verify `authRoutes.js:97`), frame-size/inflate caps.
- Fully parameterized SQL everywhere except the hardcoded DDL; strict numeric `safeId` gate on
  editing routes (no path traversal).
- Layered deploy health checks (service → HTTP → HTTPS+bundle-hash → WS 101 → /version SHA).
- Behavior-driven test suite: real loopback servers, real protocol frames, two-browser e2e over CDP;
  775 unit tests passing (+4 deliberate skips) in ~4s plus 21 e2e (~2 min), no `.only`,
  no assertion-free tests.
