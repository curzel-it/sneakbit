# Co-op Motion Smoothness — Design Doc

Status: **shipped + multi-key host-input divergence fix landed**
(2026-05-28, awaiting morning verification).
Scope: guest's perceived smoothness of the host's world (and the
guest's own avatar). Host is unchanged.
Bar: *"never see stutters unless stuff is actually bad"* — i.e. on a
healthy network, the guest's view of the host's world must be
pixel-smooth at 60 fps. Visible chop is allowed only when the network is
genuinely degraded (real packet loss, real jitter, real RTT spikes).

## Tomorrow-you: start here

Read this section first; the rest is history.

**What was wrong** (from a `?debug=snap` capture, `/Users/curzel/Desktop/log.json`
from the 2026-05-28 evening session): the post-stutter-fix bug
("guest sees P2 stuck on host, then teleports back") was *not* the
storage-flag visibility split we initially suspected. The dump showed:

- `currentSeq === lastAckedSeq` every entry → transport / input loss
  ruled out, host is acking every input.
- `authFront.entities` either empty or carrying non-rigid entities the
  auth walked through next tick → no blocker.
- Auth was *moving* the whole window (10 tile-steps in 2.75 s, matching
  predicted's 10 steps). Same rate, **different turn-direction
  choices**: predicted did 9 up + 1 left, auth did 7 up + 4 lateral.

**Root cause**: `hostGuests.applyIntent` collapsed both the press-event
queue and the held set to a single direction with
`clearInputState(slot); pushInputPress(slot, dir)`. So when the user
held Up+Left simultaneously, the guest's predicted (running on slot 1's
real local input) saw `held = {up, left}` and chained via
`HOLD_PRIORITY = ["up", "down", "left", "right"]` → **up**. The host's
slot 2 only had the most recently pressed direction in held = `{left}`
→ chained **left**. Same step rate, perpendicular paths, divergence
grew until the 5-tile snap fired and yanked the user back.

**Fix shipped** (cache-bust `20260528i`, files:
`js/input.js`, `js/guestInputForwarder.js`, `js/hostGuests.js`,
`js/predictedSelf.js`):

1. **Wire**: every movement intent now carries the full guest-side held
   set as `held: ["up", "left"]`.
2. **New intent `holdSync`**: emitted by the forwarder when the user
   releases a key while others remain held — host updates its held set
   without queuing a spurious press event. This closes the previously
   silent gap where `if (next !== lastSentDir) send(...)` dropped the
   "held set shrank" event entirely.
3. **Host (`hostGuests.applyIntent`)**: when `msg.held` is present,
   uses `setNetworkHeld(slot, held)` + `pushPressEvent(slot, dir)` to
   mirror the guest's authoritative held + queue the press. Legacy
   path (no `held` field) preserved for old tests / other tools.
4. **Predicted-self replay** (`replayUnackedInputs`): after replaying
   press events, re-anchors slot 1's held to the latest log entry's
   `held` so a multi-key hold survives a snap-back (previously
   `pushInputPress` could only add, never reflect a release).

`?debug=snap` is still wired in, so reproducing should give a fresh
log. If `__sbSnapDebug` stays empty on tomorrow's session: the fix
worked, delete the debug capture in a follow-up. If captures keep
appearing: read the new entries — `localHeld` isn't in the schema yet,
but `authFront.entities` + the `auth`/`predicted` direction columns
will still tell us whether it's the same multi-key story (in which
case the fix didn't take), or a fresh issue (in which case re-diagnose
from scratch — *don't* assume the doc above is still load-bearing).

**Test coverage added**:
- `tests/guestInputForwarder.test.js`: holdSync emitted on keyup-with-
  others-held, full held set shipped on every press.
- `tests/hostGuests.test.js`: multi-key held mirrored on slot 2;
  holdSync updates held without queuing a press; legacy wire still
  honored.
- Unit suite 440/440, e2e 6/6 (snap events 0 on both transports — no
  regression).

**Revert recipe** (if morning testing finds new issues): one commit
covers the fix (cache-bust + wire + four files). `git revert <sha>`
reverts cleanly; the `?debug=snap` capture commit is separate
(landed earlier today) and can stay live.

## TL;DR — what shipped today (2026-05-28)

Seven commits, all on `main`, cache-bust ended at `?v=20260528g`. The
co-op stutter the user originally reported ("guest's own avatar jumps
and skips the walk animation") is gone. A different, unrelated
"bizarre" symptom is being investigated separately.

| Commit  | Subject                                                              | Why                                                                                                             |
| ------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| bdec30a | online co-op: actually wire up WebRTC DataChannel                    | WebRTC transport was installed with `role=null` and short-circuited; every session was WS-relayed.              |
| 00fb558 | tests: add headless-Chrome e2e suite + co-op smoothness doc          | Adds `tests/e2e/` fixtures + first 4 tests, this doc.                                                           |
| 6cce086 | tests: e2e dynamic imports use `./` not `/`; add perfPublic.mjs      | Origin-relative imports broke against `/sneakbit-html/` base; first prod numbers (WebRTC −197 ms vs WS).        |
| 08f349a | online co-op: stop self-amplifying snap cascade on predicted self    | `shouldSnap` snapped on `behind <= 0` → host-ahead cascade on WebRTC (5 snaps every down-press on prod).        |
| 2c58bb1 | online co-op: widen predictedSelf snap tolerance for WS-RTT jitter   | `MAX_BEHIND 3→5`, `MAX_AHEAD 1→3` to absorb WS-relay jitter spikes that were still cascading.                   |
| fc5e625 | online co-op: drop time-based grace check + interp mirror entities   | `LATENCY_GRACE_MS = 500` jolted on any pause >500 ms; removed entirely. Also lerps mob/pushable/projectile.     |
| d3cf22e | online co-op: drop direction-cross-product in predictedSelf snap     | Cross check fired on every turn (1-tile RTT lag on old axis became orthogonal to new direction).                |

Net effect on prod (`tests/e2e/perfPublicLong.mjs` against
`curzel.it/sneakbit-html` + `wss://sneakbit.curzel.it`):

- WebRTC first-step RTT **304 ms** (was 521 ms via WS-relay; 38% win
  from getting WebRTC actually online).
- Stutter events in 90 s of continuous up/down cycles: **0** on
  WebRTC, **0** on WS-only (was 5 / 0 before the cascade fix; 39 / 0
  before the tolerance bump; persistent direction-change snaps before
  the cross-product removal).

`predictedSelf.shouldSnap` is now a single per-axis tile-distance
bound (5 tiles); orthogonal disagreement and direction-based
projection are gone. See "Final shape of the predicted-self
reconciliation" below.

## Status of original proposals

| #   | Title                                                          | Status                                                                                                             |
| --- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| −1  | Fix WebRTC transport init (not in original audit)              | ✅ shipped — `bdec30a`. `ensureNet` re-installs transport when runtime role transitions; DC `from` stamping fixed. |
| 0   | Stop `predictedSelf.shouldSnap` from killing the walk animation| ✅ shipped — across `08f349a` → `d3cf22e`. Now a 5-tile-box bound; no direction projection.                       |
| 1   | Interpolate entities the same way as players                   | ✅ shipped — `fc5e625`. `refreshMirrorEntities()` lerps `frame.x/y` per render frame.                              |
| 2   | Bump `INTERP_DELAY_MS` to 150 ms                               | Not done. Still at 100 ms. No longer pressing now that snap cascades are gone; revisit if jitter resurfaces.       |
| 3   | Host-time clocking                                             | Not done. Even more clearly belt-and-braces now that #0/#1 absorb the visible issues. Defer.                       |
| 4   | Unreliable + unordered DataChannel                             | Not done. Now actually evaluable (DC is up). No reported lossy-network symptom on prod; defer.                     |
| 5   | rAF-driven broadcaster                                         | Not done. Only relevant to backgrounded-tab strobing; no symptom reported.                                         |
| 6   | Ship `moving` flag on entities                                 | Partially obsolete — entity interp (#1) didn't need the flag for steady-state lerp; mob sprite-row issue may       |
|     |                                                                | still exist but was not separately confirmed in testing.                                                           |
| 7   | DC `from` stamping                                             | ✅ shipped — `bdec30a` (folded into #−1).                                                                          |

## Final shape of the predicted-self reconciliation

After three rounds of iteration the snap check is now:

```js
const MAX_DIVERGENCE_TILES = 5;

function shouldSnap(predicted, auth) {
  if (predicted.tileX === auth.tileX && predicted.tileY === auth.tileY) return false;
  const ddx = Math.abs(auth.tileX - predicted.tileX);
  const ddy = Math.abs(auth.tileY - predicted.tileY);
  if (ddx > MAX_DIVERGENCE_TILES) return true;
  if (ddy > MAX_DIVERGENCE_TILES) return true;
  return false;
}
```

What the iteration looked like:

1. **Original code** projected `(auth - predicted)` onto
   `predicted.direction`. Tolerated `0 < behind <= 3` only (host
   behind us along direction). Anything else, including the host
   being a single tile ahead, snapped.
2. **`08f349a`** added symmetric tolerance: `MAX_AHEAD_TILES = 1` so
   the chained-step race on a fast transport (WebRTC ~10 ms RTT)
   stopped cascading. Stopped the 5-snap-cascade-per-key-press
   observed on prod.
3. **`2c58bb1`** widened the bounds to `5 / 3` to absorb WS-relay
   jitter spikes that were still cascading on the WS path. Cut the
   90-second prod burst count from 39 → 18.
4. **`fc5e625`** removed `LATENCY_GRACE_MS` blanket-snap. The 500 ms
   "if idle too long, any disagreement is real divergence" heuristic
   jolted the avatar on every pause. The tile-distance bound handles
   real divergence by itself.
5. **`d3cf22e`** removed the cross-product/direction projection
   entirely. The check was firing on every turn because the old
   along-axis lag (1-tile RTT shape) became orthogonal to the new
   direction the moment `predicted.direction` flipped. Final form
   bounds each axis independently — L-shaped lag from turns is
   absorbed; only real desync beyond 5 tiles on either axis snaps.

The remaining trade-off: small knockbacks (1-2 tiles orthogonal to
the player's motion) aren't auto-corrected by this path anymore. If
that ever becomes a visible symptom, the right fix is a host-side
`event` op explicitly signalling "snap to this tile" rather than
reintroducing the direction heuristic.

## E2E test framework summary

Built during the diagnosis; everything in `tests/e2e/`:

- `fixtures/chrome.mjs` — Chrome launcher, CDP `Session`, `evalExpr`,
  `waitFor`, `navigate`. Tests self-skip when no Chrome found (set
  `CHROME_PATH` to override).
- `fixtures/servers.mjs` — relay + static-server lifecycle (python3
  with Node-only fallback).
- `fixtures/coopSession.mjs` — `startCoopSession({appUrl, relayWs,
  zone, entry: "deeplink" | "menu", disableWebrtc})`. Two Chrome
  instances (separate `--user-data-dir`s; one Chrome two-tab freezes
  the non-foreground rAF entirely on `--headless=new`). Also exports
  `runStutterWorkload` and `runStutterLongWorkload`.
- `webrtcLifts.test.mjs` — 3 tests guarding the WebRTC init fix.
- `inputLatency.test.mjs` — WS vs WebRTC first-step RTT comparison.
- `predictedSelfStutter.test.mjs` — runs up/down cycles, counts snap
  events via per-frame x/y delta > 0.15 tile.
- `perfPublic.mjs` — one-shot script against the public deployment.
- `perfPublicLong.mjs` — 90-second variant with per-burst context.

`npm test` runs both unit + e2e sequentially (~28 s on a quiet
laptop). `npm run test:unit` for fast inner loop (~2 s).

---

(The rest of this document — the original audit, the proposal write-
ups #0 through #7, and the open-questions section — is preserved
below as historical context. Proposals that have shipped are marked
with their commit; proposals that haven't are still candidates for
future work.)

---

## Reported symptoms (2026-05-28)

Player report after running the audit:

- **Host client:** smooth, nothing to fix.
- **Guest's own avatar:** occasionally *jumps* to the correct end
  position, completely *skipping the walk animation*. End position is
  right; the in-between motion is missing.
- **Mobs (on guest):** occasionally *frame-skip* — different shape than
  the jump above; more like dropped animation frames than a teleport.

These two symptoms map to two different bugs, only one of which the
audit caught:

- The mob frame-skip is the 20 Hz entity-snap problem — proposal **#1**
  below.
- The own-avatar jump is a `predictedSelf.shouldSnap` bug that the
  audit explicitly *dismissed* as "no review action." It is the highest-
  impact fix for the most visible symptom. See proposal **#0** below.

This doc now covers: the predictedSelf fix (#0), the original three
layered smoothness improvements (#1, #2, #3), and three findings from
an audit against the original spec (`host-authoritative-server.md`,
condensed into `docs/server.md` in commit `0dc8116`) — proposals
**#4**, **#5**, **#6**. Several are bug-fixes, not enhancements.

---

## Headless-Chrome probe findings (2026-05-28)

Drove a two-instance headless Chrome rig (host on port 9223, guest on
9224 — same Chrome process throttles the non-foreground tab to 0 fps,
two separate instances avoid that) against a local relay + static
server. Captured 199–290 per-frame samples of the guest's
`predictedSelf` and mirror state while dispatching synthetic
`KeyboardEvent` to the guest's `window`. Second run used `?zone=1001`
to get a long open road south of spawn.

The original throwaway probe (`/tmp/probe.mjs`) has been replaced by a
permanent test suite under `tests/e2e/` — see "What the latency
comparison shows" below.

### ✅ FIXED — WebRTC was not actually in use (resolved 2026-05-28)

Original finding: wrapped `window.RTCPeerConnection` on the guest
before any module loaded — across multiple runs, **0 RTCPeerConnections
constructed**. `getRtcTransport()` returned `null` while `runtimeRole
=== "guest"`. Every co-op session ran entirely over the relay
WebSocket; WebRTC was shipped but never wired up.

Root cause — init ordering bug:

- `main.js:77` called `bootstrapOnline()` *before* `switchRole("guest")`.
- `bootstrapOnline` → `ensureNet()` → `installWebrtcTransport({ role:
  getRuntimeRole() })` ran with `role: null` (switchRole hadn't set
  it yet).
- `webrtcTransport.js` short-circuits when role is neither host nor
  guest, returning null without subscribing to `guest.joined` /
  `peer.joined`.
- Later, `switchRole("guest")` → `ensureNet()` was a no-op due to the
  `if (net) return net` short-circuit.

Fix applied:

1. **`onlineBootstrap.ensureNet`** now tracks `lastTransportRole` and
   re-installs the transport whenever the runtime role transitions
   into host/guest with a role that differs from the last install. The
   first install (during boot) may still be a no-op for role=null;
   `switchRole` then triggers the real install on the next ensureNet
   call. Cleared on `closeNet` and on test reset.
2. **`webrtcTransport.onMessage`** now stamps `from = remotePlayerId`
   on every incoming DC frame. Without this, `hostGuests.onInput` would
   silently drop every guest input arriving via DC (it requires `from`
   to map intent → slot). The relay does this stamping on WS-forwarded
   frames; the DC bypasses the relay so we have to do it ourselves.

Both fixes are guarded by `tests/e2e/webrtcLifts.test.mjs` — three
tests covering deep-link entry, menu entry, and the `disableWebrtc`
test knob.

Post-fix probe confirms:

- `pcCount: 1`, `connectionState: connected`, channel state `open`
- ~100 messages received via DC over a ~5 s session
- 28 KB transferred via DC
- The host correctly processes inputs that arrive via DC (auth tile
  advances as the guest presses keys)

Status of proposal **#4** (unreliable + unordered DC) — was previously
moot because there was no DC. Now actually evaluable. Still requires
a meaningful real-world packet-loss workload to justify; see "What
the latency comparison shows" below.

What the original throwaway probe verified (besides the WebRTC finding
above; these observations have since been folded into the permanent
e2e tests):

- **Input path works end-to-end over the WS-relay.** Guest's keydown
  reached both the local input listener (`input.js`) and the wire
  forwarder (`guestInputForwarder.js`). Host received every input
  frame with `from` correctly populated (relay-stamped). The slot
  lookup in `hostGuests.onInput` succeeds.
- **Host's game loop runs at 60 fps** when its tab is in its own
  Chrome instance. Single-Chrome two-tab setups freeze the host's rAF
  entirely — useful to know for verification work, *not* a real-world
  issue.
- **Long downward walk reproduced.** Zone-1001 run: guest at (68,24),
  jogged one tile east to (69,24), then walked south to (69,39) — 15
  chained steps over ~3.5 s. Both predicted and auth completed every
  step in lockstep (auth ~150 ms behind predicted but converged).
  **Only two `step→null` transitions captured, neither was a snap.**
- **Snap teleport count = 0** under localhost conditions. This is
  consistent: with effectively-zero RTT, the host's auth never gets
  *ahead* of predicted, so the `behind <= 0` branch in `shouldSnap`
  never fires. The user's reported jump is *latency-dependent* — the
  test rig can't reproduce it without artificial throttling. Need to
  re-run with Chrome devtools throttling (Slow 4G or custom RTT 150ms)
  to confirm. The static code trace remains:

  1. Guest holds right. Predicted starts step (5,5)→(6,5), `step` set.
  2. Host receives `moveRight`, applies it, broadcasts auth at (6,5)
     *before* predicted's 220 ms step completes.
  3. `shouldSnap`: predicted.tileX(5) ≠ auth.tileX(6); dir.dx=+1,
     ddx=+1, behind = -1, `behind <= 0` → returns true → snap.
  4. `predicted.step = null` kills the walk animation; `x/y` are
     overwritten to (6,5). Avatar appears to *teleport* one tile.

  With WS-relay round-trip latency in real play (RTT 80–200 ms), step (2)
  can land mid-step and trigger this. On localhost it lands after step
  completion, so they agree.

- **Mob frame-skip not reproduced** in the probe. Zone-1001 had a
  monster nearby (Codex's instruction), but the captured entity
  samples showed `position-change events: 0` for the tracked mob over
  ~3.5 s. The mob's `frame.x/y` on the guest never changed. Possible
  explanations: (a) the mob wasn't moving on the host either (idle
  AI), (b) the broadcaster's `sigEntity` didn't trip on any change so
  no delta shipped, or (c) `rebuildZoneEntities` does snap on tile
  transitions but the test window happened to cover an idle phase.
  Needs a longer capture with the host actively running the mob's AI.

### Transport-layer note — fixed alongside the init bug

Earlier draft flagged that `webrtcTransport.onMessage` re-emits DC
frames without stamping `from`, which would cause `hostGuests.onInput`
to silently drop every guest input arriving via DC once the channel
was live. Fixed in the same commit that addressed the init bug: the
DC's `onMessage` now stamps `msg.from = remotePlayerId` before
re-emitting.

## E2E test framework (tests/e2e/)

The headless-Chrome probe used to diagnose the WebRTC init bug has
been productised into a small e2e test framework under `tests/e2e/`.
Three goals:

1. **Regression coverage** for the WebRTC init fix. The bug shape was
   subtle (early init with role=null, later init short-circuiting) and
   easy to reintroduce without a test that actually proves a
   DataChannel got opened.
2. **A real harness for performance comparisons** — the only useful
   way to tell whether a transport change helped is to drive the same
   workload both ways and read the numbers. The harness is now small
   enough to do that in `npm test`.
3. **A platform for future co-op tests** — adding a new e2e test is a
   matter of a `.test.mjs` file plus `startCoopSession({...})`.

Layout:

```
tests/e2e/
├── fixtures/
│   ├── chrome.mjs          # Chrome launcher, CDP Session class
│   ├── servers.mjs         # relay + static server lifecycle
│   ├── coopSession.mjs     # host + guest session, deeplink/menu entry
│   └── nodeStaticServer.mjs  # python3-less fallback static server
├── webrtcLifts.test.mjs    # 3 tests: deeplink, menu, disableWebrtc
└── inputLatency.test.mjs   # WS vs WebRTC round-trip comparison
```

Scripts:

- `npm test` — unit + e2e (sequential; ~28 s on a quiet laptop)
- `npm run test:unit` — fast path (~2 s) for tight inner loop
- `npm run test:e2e` — e2e only (~26 s); `--test-concurrency=1` so
  files don't race for ports

If Chrome isn't installed at one of the well-known paths and
`CHROME_PATH` isn't set, every e2e test self-skips with a clear
reason — so CI without a browser still goes green.

### What the latency comparison shows

`inputLatency.test.mjs` jogs one tile east (zone 1001's spawn at
(68,24) is bordered south; (69,24) opens onto a long road), then
holds ArrowDown for ~3 s and times every auth tile change. First
change is "input → first auth confirmation" (the transport round-trip
we care about); subsequent changes mostly measure the host's step +
broadcast cadence.

A representative localhost run, post-fix:

```
[latency] WS     first-step RTT 344 ms  inter-step median 250 ms  tiles 13
[latency] WebRTC first-step RTT 321 ms  inter-step median 233 ms  tiles 13
[latency] first-step delta 23 ms (positive = WebRTC wins)
```

And the same comparison against the production deployment
(curzel.it/sneakbit-html + wss://sneakbit.curzel.it):

```
WS     first-step RTT 521 ms  inter-step median 235 ms  tiles 15
WebRTC first-step RTT 324 ms  inter-step median 250 ms  tiles 15
Delta  197 ms (positive = WebRTC wins)
```

DC stats from the WebRTC production run:

```
channels: [{label:"sneakbit", state:"open",
            msgSent:4, msgRecv:105,
            bytesSent:241, bytesRecv:29578}]
transport: {bytesSent:4164, bytesRecv:36322,
            packetsSent:64, packetsRecv:114, dtlsState:"connected"}
selectedPair: {currentRoundTripTime: 0.001}
```

Observations:

- **Localhost** first-step RTT is ~300 ms on either path, dominated by
  `ROTATE_COMMIT_DELAY` (60 ms) + step duration (220 ms) + broadcast
  interval (≤50 ms). Transport contributes single-digit ms here.
- **Production** first-step RTT diverges sharply: WS adds ~200 ms
  because every input round-trips through the relay; WebRTC stays
  near the localhost number because the DC is peer-to-peer
  (`selectedPair.currentRoundTripTime: 0.001`).
- **Inter-step cadence is ~235–250 ms** in both environments, on both
  transports — that's host-bound (broadcaster ticking every 50 ms
  aliased against 220 ms step durations), independent of transport.
- **The 197 ms WebRTC lead** on production first-step RTT is a 38%
  reduction in input-to-confirmation latency. That's the user-felt
  win — every key press that triggers a host-side step (shoot, melee,
  interact, direction change) feels nearly twice as snappy.

What this means for the design proposals:

- Proposal **#4** (unreliable + unordered DC) — was previously
  *evaluable in principle but not in practice* because there was no
  DC. Now there is one, but the localhost benchmark won't distinguish
  it from the reliable+ordered baseline. Validating #4 needs (a) a
  remote relay test and (b) Chrome devtools packet-loss throttling.
  Hold the fix until we can measure.
- Proposal **#3** (host-time clocking) — already framed as
  belt-and-braces in the original audit. With WebRTC live, the
  transport-side jitter argument gets weaker (DTLS over UDP has
  tighter inter-arrival than a relay-WS), so #3's marginal value
  drops further. Continue to defer.
- Proposals **#0**, **#1**, **#6** unchanged — they're client-side
  and independent of transport.

## Preflight — confirm we're actually on WebRTC

The relay WS is dual-purpose: it carries signalling + control, *and*
acts as a fallback transport when the WebRTC DataChannel fails to open
(see `js/webrtcTransport.js` and the `setSendInterceptor` hook in
`js/net.js:64`). When the DC is up, game frames are lifted onto it and
the WS `send` is short-circuited.

DevTools Network only shows the WS. DataChannel traffic is invisible
there. So **"I see only WebSockets in DevTools" does not mean WebRTC
isn't being used** — but it also doesn't prove it is.

Before assuming anything about smoothness, verify the transport:

- Open `chrome://webrtc-internals` during a co-op session.
- Look at the DataChannel stats. If `bytesSent` / `bytesReceived` are
  growing, WebRTC is live and the smoothness bottleneck is genuinely
  client-side (interp / prediction).
- If the channel is missing or stuck "connecting," every game frame is
  going relay-via-WS and the entire #4 proposal (unreliable DC) is
  irrelevant — fix transport first.

This step is cheap and disambiguates which bucket of fixes to apply.

## Audit summary — what we missed

The full original spec is reachable via
`git show 0dc8116^:host-authoritative-server.md`. The condensed doc kept
the design tenets but dropped some implementation specifics. Findings:

1. **Spec requires `t` (host tick number) for "interpolation timing"**
   (`host-authoritative-server.md:175`). The broadcaster ships `t:
   tickCount++` (correct) — but the mirror never reads it. Snapshot
   playback clocks on receive-time, not host-time. Stutter
   amplification straight from network jitter. → Proposal **#3** below
   is the fix, and it's a bug-fix, not an enhancement.

2. **Spec requires entity interpolation for "NPCs, mobs, pushables,
   projectiles"** (`host-authoritative-server.md:91`). Today
   `rebuildZoneEntities` (`mirrorWorld.js:301-308`) writes `snap.curr`
   straight into `zone.entities`. `entitySnaps` already retains
   `prev`/`curr`/`prevAt`/`currAt` — the data is there, the consumer
   isn't. → Proposal **#1** is the fix, also a bug-fix.

3. **Mobs render as "still" on the guest, even while moving.**
   `entities.isEntityMoving` (`entities.js:54-58`) reads
   `e._ai?.step` — but `_ai` is a host-only field populated by
   `mobs.ensureAi`. The mirror ships only the serialized fields from
   `serializeEntity` (which doesn't include `_ai`). Every moving mob on
   the guest plays its still-pose sprite row. Independent of stutter,
   but ugly. → Proposal **#6** below.

4. **WebRTC DataChannel is fully reliable + ordered**
   (`webrtcChannel.js:119`: `{ ordered: true }` with no
   `maxRetransmits`). On any packet loss, every subsequent snapshot
   queues behind the retransmit — classic head-of-line blocking. The
   stutter signature is "wedge of frozen frames followed by a burst
   catch-up." → Proposal **#4** below; arguably the single biggest
   real-world stutter source.

5. **Broadcaster runs on `setInterval(50ms)`, decoupled from `rAF`.**
   `setInterval` is throttled to 1 Hz on backgrounded tabs (the host
   becomes a strobe to its guests), 4 ms-quantized otherwise, and
   sampled out-of-phase with the host's `rAF` tick. Mid-step samples
   are noisy as a result. Easy improvement: sample inside `rAF` with a
   50 ms accumulator. → Proposal **#5** below.

The original three smoothness proposals (entity interp, larger
`INTERP_DELAY`, host-time clocking) are renumbered to #1, #2, #3 and
followed by the new findings as #4, #5, #6.

---

## Where we are today

Recent commits already moved the needle:

- `5189791` — `mirrorWorld.interpolatePlayer` forward-extrapolates moving
  avatars past `currAt` at `STEP_TILES_PER_MS`, capped at the next tile
  boundary. Killed the "buttery 50 % / frozen 50 %" pattern.
- `bd29310` — `predictedSelf.shouldSnap` tolerates the host being up to
  3 tiles behind along the move direction. Stops self-rubber-banding.

The wire format is unchanged: `sigPlayer` deliberately omits `x/y`
(`snapshotBroadcaster.js:321-329`), so a moving avatar emits ~2 deltas
per 220 ms tile-step (step start + step end). The mirror reconstructs
the float path by lerp + extrapolation.

`INTERP_DELAY_MS = 100` (`mirrorWorld.js:18`).
Broadcaster cadence = 50 ms.
Host step duration = 220 ms.

## What's still choppy

1. **Mobs/NPCs/pushables teleport at 20 Hz.** `rebuildZoneEntities`
   (`mirrorWorld.js:301-308`) writes `snap.curr` straight into
   `zone.entities`. `entitySnaps` already holds `prev`/`curr` per
   entity but nothing consumes `prev`. Meanwhile `sigEntity`
   (`snapshotBroadcaster.js:331-342`) includes `frame.x/y`, so moving
   mobs ship a delta every broadcaster tick — and every one of those is
   rendered as a 50 ms positional snap. At 60 fps this is a visible
   micro-stutter on every animated thing that isn't a player avatar.

2. **`INTERP_DELAY_MS = 100` barely covers normal jitter.** Step-end
   deltas arrive ~220 ms apart. Wi-Fi jitter of 30–80 ms is normal, and
   a single late delta causes `renderTime` to extrapolate past where
   the next lerp will start. When the delta lands, the lerp begins
   *behind* the extrapolated position → backward stutter. A bigger
   buffer absorbs it almost for free; the only cost is "other players
   are 50–80 ms older," invisible at this scale.

3. **Mirror clocks on receive time, not host time.** `currAt = nowMs()`
   at packet arrival (`ingestPlayer`, line 260). Network jitter shows
   up directly in lerp timing. A delta delayed by 80 ms gets stamped
   80 ms late, so the inter-sample `span` shrinks/grows non-uniformly
   and lerp velocity jitters. The broadcaster already stamps `t:
   tickCount++` per frame; promoting that to a real timestamp lets the
   mirror playback on a monotonic host timeline. Eliminates the last
   class of jitter-induced velocity wobble.

---

## Proposal 0 — ✅ FIXED 2026-05-28 — Stop `predictedSelf.shouldSnap` from killing the walk animation

### What's happening

`predictedSelf.js:159-165`, on every auth message:

```js
if (shouldSnap(predicted, auth)) {
  predicted.tileX = auth.tileX;
  predicted.tileY = auth.tileY;
  predicted.x = auth.x;
  predicted.y = auth.y;
  predicted.direction = auth.direction || predicted.direction;
  predicted.step = null;          // ← nukes the in-progress walk
  replayUnackedInputs();
}
```

`shouldSnap` (line 100-120) snaps whenever `behind <= 0` — i.e. the
host is *ahead of us* along our move direction. The comment frames this
as "we missed inputs, snap forward." But the same condition fires in
*normal* continuous motion:

```
guest at (5,5), holding right, predicted starts step → (6,5)
host received the input earlier on its clock, already advanced auth to (6,5)
auth arrives: auth.tileX = 6, predicted.tileX = 5
ddx = +1, dir.dx = +1 → behind = -1 → snap
```

Result: `predicted.x/y` are overwritten with the host's end-of-step
position and `predicted.step = null` kills the walk animation. The
avatar appears to *teleport* one tile forward with no animation —
exactly the reported symptom.

The audit dismissed this with "tuned in `bd29310`, no review action."
That tuning fixed host-*behind* lag (MAX_BEHIND_TILES = 3) but it left
host-*ahead* completely unguarded. Symmetric tolerance is missing.

### What changes

`js/predictedSelf.js`:

- Add a host-ahead tolerance, analogous to `MAX_BEHIND_TILES`. When the
  host is at most 1 tile ahead along the direction we're *actively
  stepping toward* (i.e. `predicted.step` exists and points that way),
  treat it as expected lag, not a divergence — let the local step
  complete.
- Guard the `predicted.step = null` write behind a stricter condition:
  only null the step when the auth tile is orthogonal or far enough
  away that the local step couldn't possibly reach it.

Sketch:

```js
function shouldSnap(predicted, auth, now = nowMs()) {
  if (predicted.tileX === auth.tileX && predicted.tileY === auth.tileY) return false;
  const dir = DIR_VEC[(predicted.direction || "").toLowerCase()];
  if (!dir) return true;
  const recentlyMoving = !!predicted.step || (now - lastMovingAt) <= LATENCY_GRACE_MS;
  if (!recentlyMoving) return true;
  const ddx = auth.tileX - predicted.tileX;
  const ddy = auth.tileY - predicted.tileY;
  const cross = Math.abs(ddx * dir.dy - ddy * dir.dx);
  if (cross !== 0) return true;                          // orthogonal: real divergence
  const behind = -(ddx * dir.dx + ddy * dir.dy);
  if (behind > MAX_BEHIND_TILES) return true;            // host way behind
  if (behind < -MAX_AHEAD_TILES) return true;            // host way ahead
  return false;                                          // either-direction lag, ride it out
}
```

With `MAX_AHEAD_TILES = 1`, the "host advanced me one step early" case
no longer snaps. The predicted step finishes its 220 ms locally, the
guest sees a continuous walk, and the next auth message confirms us at
the new tile — `tileX === auth.tileX`, no snap, normal flow resumes.

### Risks

- If auth says we're one tile ahead and we *aren't* actually stepping
  there (e.g. the host applied an input we never sent), we'll drift
  for up to 220 ms before the next auth catches the disagreement. In
  practice this can't happen — auth advancing us along our direction
  means the host *processed* our input, so we did send it.
- The opposite case (host-behind tolerance) already exists and is fine.
- Tests in `predictedSelf.test.js` will need a new case for "host
  ahead by 1, predicted mid-step, should NOT snap."

### Test plan

- Unit test: predicted mid-step right, auth at next tile, assert
  `shouldSnap === false`.
- Unit test: predicted mid-step right, auth at next-tile + 1, assert
  `shouldSnap === true` (real divergence).
- Visual: walk continuously on the guest, watch for the jump-without-
  animation pattern. Should disappear entirely.

### Estimated size

~10 lines added, ~3 changed in `predictedSelf.js`. Two new unit tests.
Single commit. **Highest impact per LOC of any proposal in this doc.**

---

## Proposal 1 — ✅ FIXED 2026-05-28 — Interpolate entities the same way as players

### What changes

`mirrorWorld.js`:

- Add `interpolateEntity({ prev, curr, prevAt, currAt }, renderTime)`
  modelled on `interpolatePlayer`. Lerp `frame.x` / `frame.y` between
  `prev` and `curr`.
- Replace the `snap.curr` write in `rebuildZoneEntities` with a clone
  of `curr` whose `frame.x`/`frame.y` come from the interpolator.
- Forward-extrapolate when the entity is mid-step. Players know their
  direction from `curr.direction`; entities have `e.direction` too
  (set by `mobs.js:112`), so we can apply the same step-velocity
  projection.

### Open questions

- **Entity step duration is not constant.** `mobs.stepDurationFor`
  derives it from `species.base_speed × 1.6`. The mirror doesn't load
  species data on the guest? It does — `loadZone` + `data.js` already
  ship species, so `getSpecies(e.species_id).base_speed` is available.
  Use the same formula on the guest to know how long a step lasts and
  cap extrapolation accordingly.
- **What about non-AI entities?** Pickups, pressure plates, gates,
  cutscene actors don't have a step model. Easy: only extrapolate when
  `curr.direction` is set AND the position actually moved between
  `prev` and `curr`. Static entities will have `prev.frame.x ===
  curr.frame.x`, so lerp returns `curr` immediately — no behavior
  change for them.
- **Projectiles (`e._spawned`).** Bullets/kunai move fast and short-
  lived. The host emits a position delta per tick. Lerp between the
  last two ticks gives correct motion; no extrapolation needed because
  they're not tile-locked.

### Risks

- Mob AI on the host can change a mob's destination mid-step. The
  guest's extrapolation would briefly point at the old destination,
  then snap to the new one on the next delta. In practice
  imperceptible because mob steps are ~400–600 ms and direction
  reversals are rare.
- Frame-clone cost: ~50 entities × per-frame allocation. Already doing
  this in `mergeEntity`; the additional alloc is negligible.

### Test plan

- Extend `mirrorWorld.test.js`:
  - mob lerps between two `frame.x/y` samples
  - mob extrapolates forward when `direction` is set and mid-step
  - static entity (no direction) returns `curr` unchanged
  - projectile lerps tick-to-tick correctly
- Visual check: spawn-rich zone (graveyards, monsters near the path),
  walk past, eyeball whether mobs slide smoothly.

### Estimated size

~40 lines added, ~5 changed. Single commit.

---

## Proposal 2 — Bump `INTERP_DELAY_MS` to 150 ms

### What changes

`mirrorWorld.js:18`: `INTERP_DELAY_MS = 100` → `150`.

That's it.

### Why this is almost free

- The guest's own avatar uses `predictedSelf`, so input-to-pixel
  latency is unchanged.
- Other players and entities are already rendered "in the past" — the
  user has no ground-truth reference to compare against. 50 ms older
  is indistinguishable visually.
- Buys ~50 ms more jitter tolerance, which is half of normal Wi-Fi
  jitter. Combined with proposal 1 (which means every entity also gets
  the bigger buffer), this should eliminate most of the residual chop.

### Risks

- `STALE_MS = 300` and `RESYNC_AFTER_STALE_MS = 1000` thresholds are
  measured against `lastFrameAt`, not `renderTime`, so they're
  unaffected.
- Reconciliation (`predictedSelf.onAuth`) is also unaffected — it
  compares tile coords, not render timestamps.
- The existing test `mirrorWorld.test.js` asserts on specific
  positions at specific times; need to scan for any test that relies
  on the literal `100` value vs reading the constant. (Quick check
  during implementation.)

### Test plan

- Re-run the suite; expect a small number of timing-dependent test
  tweaks if any.
- Visual check: head-to-head A/B on host+guest tabs, walk continuously.

### Estimated size

1 line. Possibly a few test adjustments.

---

## Proposal 3 — Clock playback on host time

### What changes

**Wire format** (small additive bump):

- `delta` and `snapshot` already carry `t: tickCount++`. Promote `t` to
  a host-monotonic ms timestamp: `t = performance.now()` at broadcast.
  Keep it a number — guests that pre-date this read it as opaque
  ticks; that's a no-op for them. New guests interpret it as ms.
- Add a `clockSync` field on the snapshot (full-snapshot only) so the
  guest can compute `hostOffset = hostT - localT` once per snapshot.
  Alternatively, just track the smoothed delta between `hostT` and
  `localT` over a rolling window of deltas.

**Mirror**:

- `ingestPlayer` / `ingestEntity`: stamp `currAt = msg.t + hostOffset`
  instead of `nowMs()`. Same for `prevAt`. Now the mirror's timeline
  is anchored to host-time.
- `interpolatePlayer` / `interpolateEntity` continue to read
  `renderTime = nowMs() - INTERP_DELAY_MS`. Lerp math is unchanged —
  but `currAt` is no longer jittered by network delay, so velocity is
  constant.

**Offset estimation**:

- Simple: on each `delta`, compute `instantaneous_offset = nowMs() -
  msg.t`. Exponential moving average: `hostOffset = α * instantaneous
  + (1-α) * hostOffset`, with α = 0.05.
- More robust: take the *minimum* instantaneous offset over the last N
  deltas. Minimum tracks the lowest-latency path and ignores outliers
  caused by queueing delay. This is the standard NTP-style estimator.

### Why this matters even after #1 + #2

Proposals 1 and 2 widen the jitter tolerance window. Proposal 3
removes the jitter from the sample timestamps themselves. The two
classes of fix are independent:

- Without #3, a 60 ms-late delta still arrives at `nowMs() + 60`, so
  the lerp span between previous and current samples is 60 ms longer
  than it should be → the lerp runs slower than the actual host
  motion → cumulative drift between bursts.
- With #3, that same delta arrives at `msg.t + hostOffset` (= true
  host time), so the lerp span is correct and velocity is constant.

### Risks

- Clock drift between host and guest. Browsers' `performance.now()`
  drifts at <1 ms/min on modern hardware — over a 30-minute session
  that's ≤30 ms cumulative, well within the buffer.
- Offset re-estimation on reconnect: must reset on `welcome` /
  snapshot after reconnect or we'll carry the old offset across a new
  RTT.
- Tests that mock `nowMs()` and assert specific positions will need
  to also mock the host clock or the offset.

### Test plan

- New unit test in `mirrorWorld.test.js`: simulate three deltas with
  varying receive times but uniform `msg.t` spacing; assert the
  rendered position progresses at constant velocity (i.e., the lerp
  is no longer jittered by receive-time jitter).
- New unit test for the offset estimator: feed it noisy samples,
  assert the EMA converges within N samples.
- Visual: A/B on a slow connection (Chrome devtools throttling, "Slow
  3G"-ish). Without #3 the avatar should wobble; with #3 it should be
  smooth-and-late.

### Estimated size

~80 lines added, ~10 changed. Two commits would be cleaner:
1. Wire format bump + offset estimator (no behavior change yet).
2. Switch `currAt` to host-time and update tests.

---

## Proposal 4 — Switch the DataChannel to unreliable + unordered

### What changes

`webrtcChannel.js:119`:

```js
attachDataChannel(pc.createDataChannel("sneakbit", { ordered: true }));
```

→

```js
attachDataChannel(pc.createDataChannel("sneakbit-game", {
  ordered: false,
  maxRetransmits: 0,
}));
```

Open a *second* DataChannel for inputs (reliable) — guests' input
intents (`moveUp`, `shoot`) we do not want to drop on a single packet
loss:

```js
const inputDc = pc.createDataChannel("sneakbit-input", {
  ordered: true,
  // Bounded retransmit so a 5-second old "moveUp" doesn't fire stale.
  maxPacketLifeTime: 200,
});
```

`webrtcTransport.js` routes by `op`: `input` → `inputDc`,
`snapshot`/`delta`/`event` → game DC.

### Why this matters

Today, on any packet loss the game DC head-of-line-blocks:

```
host sends D1, D2, D3, D4 at t = 0, 50, 100, 150 ms
D2 is lost on the wire
RTCDataChannel waits for the retransmit before delivering D3/D4
Guest sees: D1 at 0, nothing until retransmit (~RTT later), then D2 D3 D4 in a burst
```

The bigger `INTERP_DELAY_MS` from #2 can mask a single loss, but
*sustained* loss (1–2 %, which is normal on residential Wi-Fi)
produces visible bursty stutter. With unreliable + unordered:

- D2 lost? D3 arrives anyway and we apply it. The lost D2 is gone
  forever — fine, the delta is sparse and the next delta carries the
  current state anyway. Snapshots are idempotent by design.
- The mirror already handles out-of-order deltas correctly: `ingestPlayer`
  always merges into `prev.curr`, and `mergeEntity` is a `{...prev,
  ...incoming}` spread. So an out-of-order arrival just becomes "small
  rewind, immediately corrected" — barely visible.

### Risks

- **Snapshot loss vs delta loss.** A lost full snapshot on join/zone-
  change is more painful than a lost delta. Mitigations: (a) The
  `guest.resync` watchdog (`mirrorWorld.js:120`) already covers this —
  if no delta has landed for 1 s the guest re-requests a snapshot.
  (b) For the join/zone-change snapshot specifically we could send it
  over the reliable input channel (a "control" channel role).
- **Removal frames.** `delta.removed.entities` is the only "destructive"
  payload — if it's lost, the guest keeps rendering a dead entity until
  the next full snapshot. Acceptable in practice (zoom out a sec
  later, it's gone), and the next entity-change delta will re-fire its
  serializer for surviving siblings so we'll notice the discrepancy.
  Belt-and-braces option: pin `removed`-bearing deltas to the reliable
  channel.
- **Order-sensitive ops.** `event` frames (death/respawn/zoneChange)
  are order-sensitive and one-shot. They should stay on the reliable
  channel. → Route `op === "event"` to the input/control DC too.
- **Test environment.** `aiortc` / Node's WebRTC support in tests is
  limited; the current tests stub the channel. No regression risk in
  tests, but real-world validation needs the deploy.

### Effect on the "no jitter" bar

This is **the** change that converts "graceful degradation under loss"
from a roadmap aspiration into a real property. #1/#2/#3 make the
clean-network case pixel-smooth; #4 makes the lossy-network case
acceptable instead of cliff-edge.

### Estimated size

~30 lines (channel allocation + op routing in transport). One commit.

### Test plan

- Unit: `webrtcChannel.test.js` (if it exists — verify) gets a config
  assertion that `maxRetransmits: 0` is set on the game channel.
- Synthetic: deploy + Chrome devtools network throttling with 1 %
  packet loss enabled. Without #4, expect clearly bursty stutter on
  the host's avatar from the guest's view. With #4, expect graceful
  micro-rewinds.

---

## Proposal 5 — Drive the broadcaster from `rAF`, not `setInterval`

### What changes

`snapshotBroadcaster.js`:

- Remove `setInterval(() => broadcastDelta(net), 50)`.
- Expose a `tickBroadcaster(now)` function. Call it from `main.js`'s
  game-loop callback. Maintain a `lastBroadcastAt` accumulator; emit
  when `now - lastBroadcastAt >= BROADCAST_INTERVAL_MS`.

### Why

- `setInterval` is throttled to ≤1 Hz on backgrounded tabs (Firefox,
  Chrome). A host minimising their tab makes the entire session look
  like a 1 Hz strobe to every guest. The `rAF` callback is also
  throttled when backgrounded, but at least the game tick and the
  broadcaster stay in sync — and when the tab is foregrounded again,
  the guest's "host lagging" overlay fires correctly because deltas
  resume from one place, not two.
- The current decoupling causes a more subtle issue: the broadcaster
  may sample the host's world *mid-`updatePlayer`*. Not a race in JS's
  single-thread model — but `setInterval` callbacks can fire between
  two rAF frames, sometimes sampling a player whose `x/y` has been
  updated this frame but whose `tileX/tileY` hasn't yet (if the game
  uses two-step writes anywhere). Sampling once per rAF frame is the
  defensible choice.
- Pairs naturally with #3: the `t` stamp the host sends becomes a real
  host-frame time, with no quantization mismatch.

### Risks

- Host that's running at <20 Hz rAF (slow GPU) ends up broadcasting at
  rAF rate, not 20 Hz. That's actually correct behavior: a 15 fps host
  delivering at 15 Hz is closer to truth than padding with stale
  resends.

### Estimated size

~15 lines. One commit. Should land *before* #3 — they share a single
test refactor.

---

## Proposal 6 — Ship `_ai.step` so mobs animate correctly on the guest

### What changes

`snapshotBroadcaster.serializeEntity` (lines 294-307) currently emits
`{id, species_id, frame, hp, _open, _dead, _spawned, direction}`. Add:

```js
if (e._ai?.step) out.moving = true;
```

(Or ship a richer "step" object — `{progress, fromX, fromY, toX, toY}`
— if we want mob extrapolation parity with players. For just the
sprite-row fix, the bool is enough.)

`entities.isEntityMoving` reads `e._ai?.step`. Change to:

```js
function isEntityMoving(e, sp) {
  if (sp.entity_type === "Bullet") return !!e._spawned;
  if (e._ai?.step) return true;     // host path
  if (e.moving) return true;        // mirror path
  return false;
}
```

### Why

Currently every moving mob plays the wrong sprite row on the guest
(still-pose instead of walk-pose). Independent from positional stutter
but contributes to the perception that "the world doesn't look right."

### Sig delta

`moving` would need to be added to `sigEntity` so it goes into deltas.
Bandwidth impact: an extra 9 bytes per moving mob per state change,
i.e. once at step-start and once at step-end per mob — negligible.

### Risks

- None for the bool variant. For the rich-step variant, it's the same
  extrapolation math as #1; no new risk.

### Estimated size

~5 lines for the bool fix, ~20 if we fold it into entity extrapolation
under #1. Recommend folding: do it as part of #1.

---

## Order of operations

The symptom report + probe findings shape the priority. The actual
user-visible problems today are:

- (a) own-avatar jumps with no walk animation → **#0**
- (b) mob frame-skip → **#1** (with **#6** folded in)

The transport issue the probe surfaced — proposal **#−1** — has
shipped (2026-05-28): WebRTC now actually installs, and DC frames are
stamped with `from` so the host accepts them. So:

Everything else is either jitter-tolerance polish (#2), backgrounded-
tab edge case (#5), lossy-network defense that needs remote-relay
testing to evaluate now that the DC works (#4), or belt-and-braces
wobble removal that #0+#1+#2 likely subsume (#3).

Proposed sequencing — one commit each, each runnable and visibly
better than the previous:

0. ~~**#−1 — Fix WebRTC transport init ordering.**~~ **DONE**
   (2026-05-28). Two fixes: `ensureNet` re-installs transport on role
   change; `webrtcTransport.onMessage` stamps `from`. Guarded by
   `tests/e2e/webrtcLifts.test.mjs`.
1. ~~**#0 — Fix `predictedSelf.shouldSnap` host-ahead snap.**~~ **DONE**
   (2026-05-28). Added symmetric `MAX_AHEAD_TILES = 1` tolerance so the
   chained-step race on a fast transport (WebRTC) no longer cascades
   into a snap-loop. Guarded by `tests/e2e/predictedSelfStutter.test.mjs`
   + new shouldSnap unit tests.
2. **#1 + #6 — Entity interpolation + `moving` flag.** Fixes the
   reported mob frame-skip. ~50 lines together.
3. **Measure.** If the bar is met after (1) and (2) for typical
   sessions, stop. The proposals below address conditions we don't
   have evidence of yet.
4. **#2 — Bump `INTERP_DELAY_MS` to 150 ms.** One line. Cheap insurance
   against Wi-Fi jitter. Do this if any residual chop remains.
5. **#4 — Unreliable+unordered DataChannel.** Only if loss-driven
   stutter is observed (bursty freezes correlating with network loss).
   Requires the route-by-op refactor in `webrtcTransport.js`.
6. **#5 — rAF-driven broadcaster.** Only if backgrounded-tab strobing
   is observed in practice. Trivial, but solves an edge case.
7. **#3 — Host-time clocking.** Only if velocity wobble persists after
   #2 and #4. The doc itself frames it as "belt and braces" — defer
   until we can measure it's still needed.

Total scope estimate, *if all proposals ship*: ~210 LOC net added,
~50 changed, across seven commits. Realistically we expect to stop
after step (2) or (4).

### Why this order satisfies the "no stutter unless network is bad" bar

- After **#0**: own-avatar jump goes away. This was the most visible
  symptom reported.
- After **#1 + #6**: mobs animate continuously and use the correct
  sprite row. Second-most-visible symptom goes away.
- After **#2** (if needed): bumped buffer absorbs typical Wi-Fi
  jitter.
- After **#4** (if needed): loss-induced bursty freezes degrade to
  micro-rewinds.
- After **#3** (if needed): residual within-window velocity wobble
  cleaned up.

## What we are NOT doing

- **Bandwidth changes.** No re-addition of `x/y` to `sigPlayer`. The
  receive-cadence approach already works; spending ~2.5 KB/s for
  guaranteed sub-step samples is the wrong tradeoff while we have
  free smoothness wins on the table.
- **Server-side simulation.** Tenet #2 in `docs/server.md` —
  out of scope forever.
- **WebRTC / UDP transport.** Bigger swing, separate doc.

## Open questions for review

1. **Symptom triage.** ~~When the user sees "stutter" — is it (a) the
   host's avatar visibly jumping, (b) mobs visibly stop-and-go, (c) a
   bursty-freeze pattern that's clearly network-induced, or (d) all of
   the above?~~ **Answered (2026-05-28):** host is fine; the guest's
   *own* avatar jumps without walk animation (→ #0); mobs frame-skip
   (→ #1+#6). No bursty-freeze pattern reported, so #4 stays
   conditional on observing one.
2. **`INTERP_DELAY_MS` target.** Audit didn't change the math: 150 ms
   handles typical Wi-Fi jitter, 200 ms covers Wi-Fi-on-a-bus. Going
   above 200 ms starts to feel noticeably "lagged" on the host's
   avatar when other players try to interact with it. Recommendation:
   150 ms.
3. **Host-clock estimator.** EMA (`α = 0.05`) is simpler and good
   enough for our use; windowed-min is robust against bursty queueing
   delay but needs a ring buffer. EMA recommended unless we see
   estimator drift in practice.
4. **Reliable-channel split granularity (#4).** Three options:
   - **Two channels** — `game` (unreliable) + `control` (reliable for
     input + event + snapshot). Cleanest, most code change.
   - **One channel, dual-purpose** — leave it reliable, but set
     `maxRetransmits: 1` (one retry only). Compromise; preserves
     ordering, caps head-of-line to ~1 RTT.
   - **Promote snapshots to a control op.** Send snapshots over the
     reliable WS path, deltas over the unreliable DC. Works but
     reintroduces transport-coupled behavior.
   Recommendation: two channels. Cleanest semantics.
5. **Instrumentation.** Worth adding (a) extrapolation-distance histo
   and (b) snap-back counter to `mirrorWorld`, exposed via a dev-only
   overlay or `window.__sbDebug = {…}`. Without it we'll be A/B-ing
   by eyeball, which is unreliable for subtle wins.
6. **Player-as-entity unification.** After #1, players and entities go
   through nearly identical interp+extrapolation paths. Worth a follow-
   up refactor to share the math (`interpolateMotion(prev, curr,
   prevAt, currAt, renderTime, stepDir, stepDurationMs)`)? Reduces
   ~40 LOC of near-duplicate logic. Out of scope for the smoothness
   work; flag for cleanup pass after #1 ships.
7. ~~**WebRTC DataChannel `from` stamping.**~~ **DONE (2026-05-28)**:
   `webrtcTransport.onMessage` now stamps `msg.from = remotePlayerId`
   before re-emitting via `net.emitOp`. Shipped alongside the init-
   ordering fix.

## Appendix — Audit reference

Files reviewed end-to-end during the audit:
- `js/mirrorWorld.js`
- `js/snapshotBroadcaster.js`
- `js/predictedSelf.js`
- `js/webrtcChannel.js`
- `js/webrtcTransport.js`
- `js/net.js`
- `js/entities.js`
- `js/zoneVisibility.js`
- `js/mobs.js`
- `js/main.js` (game loop + `tickGuestFrame`)
- `js/gameLoop.js`
- `docs/server.md` (current spec)
- `host-authoritative-server.md` at `git show 0dc8116^` (original
  spec, condensed in commit `0dc8116`)

Findings not requiring action:
- WebRTC fan-out reuses a single `JSON.stringify` across DCs
  (`webrtcTransport.js:136`). Already optimal.
- `serializeEntity` is tight — no easy bytes to shave.
- `sigPlayer` deliberately omits `x/y` to save bandwidth, and the
  extrapolation fix makes that decision correct. Don't undo.
- The `guest.resync` watchdog (`mirrorWorld.js:120-126`) is a
  belt-and-braces against snapshot loss under #4. Already in place.

### Audit miss — corrected post-symptom-report

- ~~The reconciliation tolerance in `predictedSelf.shouldSnap`
  (`predictedSelf.js:100-120`) was tuned in `bd29310` and is correct;
  no review action.~~ **Wrong.** `bd29310` tuned the host-*behind*
  case (MAX_BEHIND_TILES = 3) but left host-*ahead* completely
  unguarded. Any auth message that places us at the next tile along
  our move direction triggers a snap and nulls `predicted.step`,
  destroying the walk animation. This is the dominant cause of the
  reported own-avatar jump. See proposal #0.
