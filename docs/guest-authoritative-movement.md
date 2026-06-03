# Guest-authoritative tile movement

Status: **implemented** (shipped on `main`)
Related: [online-coop.md](online-coop.md), [split-screen.md](split-screen.md)
Code anchors verified against `main` on 2026-06-03 (see [Code map](#code-map-verified-2026-06-03)).
Two design questions are settled in [Decisions](#decisions--confirms-2026-06-03); read them before starting.

## Problem

Multiplayer guests rubber-band on "missteps" at road junctions. The root cause is that the
host **re-simulates** each guest's avatar from forwarded key edges (held set + press events),
then runs the full `player.js` movement model on it. Between input edges the host *guesses* the
guest's path, and at a decision point it sometimes guesses wrong.

### The junction race (canonical repro)

Road shaped so tile 3 is a junction — up continues to 6 (a dead end), left goes 3→4→5:

```
xxxxxx
x6xxxx
x345
x2xxxx
x1xxxx
```

The guest holds `up` and walks 1→2→3. While stepping 2→3 it presses `left`.

- **Guest** (`predictedSelf`): the `left` press lands mid-step, so at the tile-3 snap
  `queuedDir = left` and it chains 3→4. Correct.
- **Host**: the `moveLeft` message arrives a few ms late. At the host's tile-3 snap `queuedDir`
  is still null, so `held = up` wins (`player.js` chain priority: `queuedDir > held`) and it
  chains 3→**6**, into the dead end. The `left` then lands during the 3→6 step.

Now the host has the guest at 6 and the guest has itself at 4 → divergence → snap-back.
**Stops and multi-key holds have the same race** (host over-steps, the redirect/stop arrives
after the snap that needed it).

### Why not "use the input timestamp"

There is no clock sync between peers: the guest stamps `t: Date.now()`, the host stamps a tick
counter (`snapshotBroadcaster`). A wall-clock timestamp can't be compared host-side.

And even *with* a synced clock (it's solvable — offset estimation over the DC), "use the timestamp"
isn't a small patch. To actually act on it the host would have to either **input-delay** (buffer
guest inputs and apply each at its mapped tick — which forces the guest's own `predictedSelf` to run
delayed too, killing instant local feel) or **rollback** (rewind the host sim to the stamped tick,
re-apply, fast-forward — and not just the guest, since its past step changes what it collided with,
so the whole world rolls back). Both are strictly more than this spec.

The cleaner observation: the tile grid is **discrete**, and the guest already runs an authoritative
copy of its own avatar (`predictedSelf`). A committed tile-step is an *already-made decision*, not a
sampled input the host must re-time — so ship decisions, not inputs, and the host stops guessing the
path between edges entirely. Let each player own its own tile path.

## Model

**Each player is authoritative for its own avatar's tile path. The host validates legality;
it no longer runs movement *decisions* for guest avatars — only step animation.**

The guest's `predictedSelf` is the source of truth for the guest's avatar. It streams
**committed tile-steps**; the host **executes** each one (reusing the existing `startStep` side
effects — pushables, gate unlock, `canEnter`) only if legal. This deletes the entire
speculation-race bug class (junctions, late stops, multi-key) and makes reconciliation exact
instead of a fuzzy tolerance.

Equal step durations keep the host's animation pipeline full, so chained guest steps stay
seamless on the host's screen; the host's view of a guest lags by ~RTT/2, same as today.

Scope: applies to **both co-op and PvP** (uniform path; host validates legality — adjacency +
`canEnter`). In PvP the guest owns its position; the host can reject illegal moves but cannot
stop pure lag-timing tricks. Accepted tradeoff.

## Wire format (guest → host) — clean break

Movement intents (`moveUp/moveDown/moveLeft/moveRight`, `holdSync`, `stopMove`) are **removed**.
Replaced by movement-state messages emitted by `predictedSelf` on each transition:

| Message | Shape | When |
|---|---|---|
| Step commit | `{ op:"move", seq, k:"step", fx, fy, tx, ty, d }` | `predicted.step` goes null→non-null. `d` = direction, `(fx,fy)` = source tile, `(tx,ty)` = target tile. |
| Face / stop | `{ op:"move", seq, k:"face", x, y, d }` | idle direction change, or step→idle (stopped). |

Action intents are unchanged except they now carry facing so the host fires the right way and
ordering vs a face update can't matter:

```
{ op:"input", seq, t, intent:"shoot"|"melee"|"interact", d }
```

This is a clean break: a single `python3 deploy.py` flips host and guest together. A stale
cached client co-oping across the deploy window breaks until reload — acceptable for opt-in
co-op with a small audience.

## Reconciliation contract (exact — the load-bearing detail)

The host ships, per guest, `lastSeq[guestId]` alongside the guest's authoritative tile in every
delta/keepalive (it already ships the tile). The guest keeps a **committed-step log**:
`{ seq, tx, ty }` per emitted step (`ty`/`tx` = the resulting tile).

Reconciliation on each incoming snapshot/delta (`predictedSelf.onAuth`):

1. Drop step-log entries with `seq <= lastSeq`.
2. Compare the host's authoritative tile to `stepLog[lastSeq].result`.
   - **Match** → in lockstep. Any current gap between predicted and authoritative is just
     unacked in-flight steps. No snap.
   - **Mismatch** → real divergence (rejection / knockback / host-driven displacement) → snap
     predicted to the authoritative tile, clear `step` + step-log; the next frames re-commit
     from currently-held keys.

`MAX_DIVERGENCE_TILES` (the old 5-tile fuzzy tolerance) and `replayUnackedInputs` are **deleted**.

### Definition of `lastSeq` (host side)

`lastSeq[guest]` = **the seq of the most recent step whose outcome is final and reflected in the
avatar's current `tileX/tileY`.** Precisely:

- **Accepted step** → advance `lastSeq` to that step's seq **at the snap** (when `tileX` becomes
  the result tile), NOT at `startStep`. Mid-step the avatar's `tileX` is still `from`; acking
  early would read as a false mismatch.
- **Rejected step** → advance `lastSeq` **immediately**, leaving `tileX` unchanged.
  *This is the load-bearing case.* A rejection with **no host displacement** (e.g. a gate the
  guest's mirror shows open but the host has closed, or a host/guest mob disagreement) must still
  snap the guest. Because `lastSeq` advances while the tile stays put, the guest sees
  host-tile ≠ `stepLog[seq].result` → snap. Without this — and with the tolerance removed — the
  guest would walk into a phantom corridor forever.
- **Queued step** (arrived while the avatar was mid-step) → do **not** advance `lastSeq` until it
  resolves (accept→snap, or reject) at the next snap.
- Store the in-flight / queued step's seq on the avatar so the snap knows which seq to ack.
- Action/face seqs share the counter but **never** touch `lastSeq` (they aren't reconciled).

`tileX/tileY` and `lastSeq` are both updated inside the same synchronous `updateGuestAvatar`
call, so the broadcaster's 50 ms interval (single-threaded JS) always reads a consistent
`(tile, seq)` pair.

## Code map (verified 2026-06-03)

The exact seams the implementation touches, so the implementer doesn't have to re-derive them.

| What | Where | Note |
|---|---|---|
| Guest predicted tick | `predictedSelf.js:151` `tickPredictedSelf` | `pollInput(1)` → `updatePlayer(predicted, …, predictionZone(zone))`. **Stays** — predicted self remains input-driven; that's why the keyboard→predict path is untouched and the e2e keydown tests keep working. |
| Predicted gate | `main.js:602` `if (!isDialogueOpen()) tickPredictedSelf(dt)` | Add the dead check here (see below). |
| Guest reconciliation | `predictedSelf.js:196` `onAuth` | Subscribed to **both** `snapshot` and `delta` (`:90–91`) with the same handler — the rewrite must branch on `msg.op === "snapshot"` for the hard reset (full baseline → reset predicted + clear step-log). Today it treats them identically. |
| Fuzzy tolerance to delete | `predictedSelf.js:51` `MAX_DIVERGENCE_TILES`, `:172` `shouldSnap`, `:247` `replayUnackedInputs` | |
| Step model (reuse) | `player.js:206` `startStep`, `:156` `advanceStep`, `:286` `updateAnimation` | `startStep` already does canEnter + pushable carry-back + gate side effects — `applyNetStep` wraps it. `updateAnimation` sets `player.moving = step != null` (the broadcaster's `moving` sig + guest rendering depend on it). |
| `canEnter` (validation) | `player.js:252` | Static-geometry checks (walls/buildings/rocks/gates) live here; mobs enter via `isEntityBlocked` (`zone.js:122`). Players are **not** in `zone.entities` (the `Hero` branch at `zone.js:140` is for static hero NPCs, not live avatars) → players don't block each other in any mode today; the spec keeps that (see [Decisions](#decisions--confirms-2026-06-03)). Every moving mob is `is_rigid:false`, so mobs don't block heroes either. |
| Host guest tick | `main.js:381–393` | `updatePlayer(state.player2 / state.players[]…)` → swap to `updateGuestAvatar` for guest slots; slot-1 host avatar keeps `updatePlayer`. |
| Host input intake | `hostGuests.js:192` `onInput` / `:205` `applyIntent` | Movement branch (`INTENT_TO_DIR`, `setNetworkHeld`/`pushPressEvent`, `holdSync`, `stopMove`) is replaced by `onMove`. Action branch (`:235`) stays. |
| Host ack bookkeeping | `hostGuests.js:198–201` | **Today advances `lastSeqOut` on every received intent, including actions.** New contract: only resolved *steps* touch `lastSeq` — delete this blanket advance and move acking into `onMove`/`updateGuestAvatar` per the contract. |
| Per-guest ack map | `hostGuests.js:39` `lastSeqOut`, `:65` `getLastSeqMap` | Broadcaster reads it; keep the shape, change *when* it advances. |
| Guest sender | `guestInputForwarder.js` | `send` (`:292`), `inputLog` (`:65`), `getInputLog`/`dropAckedInputs` (`:175/:179`), `flushOnReconnect` (`:139`). Movement send path + input-log become the step-log; action path keeps + gains `d`. |
| Reconnect trigger | `onlineBootstrap.js:221` calls `flushOnReconnect()` on `welcome` | No change at the call site — only the function body (re-emit move/face instead of held keys). |
| Wire ship | `snapshotBroadcaster.js:326` `serializePlayer` ships `x/y/tileX/tileY/direction/moving`; `:425` `sigPlayer` gates on `tileX/tileY/direction/moving` | Unchanged shape. Guest `x/y` now come from `updateGuestAvatar`'s lerp; `moving`/tile edges still drive the delta cadence exactly as for the host avatar. |
| Input injection seams | `input.js:80` `setNetworkHeld`, `:90` `pushPressEvent`, `:44` `pushInputPress` | Removable only **after** both consumers are gone — the host movement path *and* `predictedSelf.replayUnackedInputs` (which calls them on slot 1, imported at `predictedSelf.js:12`). `clearInputHeld`/`clearInputState` **stay** (used by `peer.left`/`peer.ghosted`/`blur`). |

## Changes by file

### `js/predictedSelf.js` — authoritative emitter + exact reconciliation
- Stays the local authoritative avatar (ticks every frame via `updatePlayer` against
  `predictionZone`). After each tick, detect transitions and call `forwardMove`:
  - `predicted.step` null→non-null → emit `move/step`.
  - idle direction change, or step→idle → emit `move/face`.
- Replace fuzzy reconciliation with the exact contract above. Delete `MAX_DIVERGENCE_TILES` and
  `replayUnackedInputs`. (`?debug=snap` capture buffers can stay.)
- **Branch `onAuth` on `msg.op`.** It's one handler for both `snapshot` and `delta` (`:90–91`).
  A `snapshot` is a fresh baseline (join / resync / zone change) → hard-reset predicted to auth and
  clear the step-log unconditionally. A `delta` runs the match/mismatch contract. Today both paths
  are identical; the exact contract needs them split.
- **Freeze while dead**: the predicted tick is gated only on `!isDialogueOpen()`
  (`main.js:602`), not death. `predicted` is a bare `createPlayer` with no HP, so the dead check
  reads `isPlayerDead(getPredictedSelf().index)` (same seam `hostGuests.actionRangeOk` uses) — gate
  both the tick and the emit so a dead guest neither moves nor streams steps.

### `js/guestInputForwarder.js` — single guest→host sender
- Drop the movement keyboard/gamepad send path (`pressDir`/`releaseDir`/`onKeyDown`/`onKeyUp`
  movement, `holdSync`, `setNetworkHeld` plumbing). Local motion already reaches `predictedSelf`
  via `input.js`'s slot-1 listeners (`initInput`) and `pollInput(1)` (which folds in the guest's
  gamepad); the touch joystick synthesises real Arrow key events into the same path — so none of
  this needs the forwarder.
- Keep + extend the **action** path: include `d` (read from `getPredictedSelf().direction`) on
  shoot/melee/interact.
- Keep `net`/`seq` ownership, the pending-action buffer, and reconnect flush — but reconnect now
  **re-emits the current move/face state** from `getPredictedSelf()`, not held keys.
- Replace the unacked `inputLog`/replay machinery with the **committed-step log**:
  `forwardMove(step)` assigns `seq`, sends, appends `{ seq, tx, ty }`. Expose `getStepLog()`,
  `dropAckedSteps(seq)`, `getSeq()`.

### `js/hostGuests.js` — validate / execute
- New `onMove(m)` for `op:"move"`, routed by slot.
  - **Dead-avatar guard first**: reject all moves when `isPlayerDead(avatar.index)` (mirror
    `actionRangeOk`).
  - `k:"step"`: **from-tile check** — reject if `(fx,fy)` ≠ avatar's current tile (idle) or step
    target (mid-step). After a host displacement (knockback/respawn) the guest commits from its
    stale tile for ~1 RTT; those reject until the next delta snaps it (bounded ~1-delta / 50 ms
    window). If from-tile ok and avatar idle → `applyNetStep(avatar, d, zone)`; accept iff a step
    was produced and its target == `(tx,ty)`. If avatar mid-step → stash
    `avatar.netQueuedStep = { d, tx, ty, seq }` (consumed at the snap).
  - `k:"face"`: set `avatar.direction = d` when idle; ack.
  - Reject → don't move; the unchanged tile + advanced `lastSeq` make the guest snap.
- **Validate with the host's own authoritative zone + `canEnter`** — no mob special-casing. Every
  moving mob is `is_rigid:false` (verified in `data/species.json`: all 18 FindHero/Free species),
  so mobs never block heroes in any mode. The only blockers are static (walls / buildings / rigid
  NPCs / rocks — identical on both ends, never lagged) or dynamic *state the host owns* (gate
  `_open`, pushable position). A static blocker can never disagree; a gate/pushable disagreement is
  a real divergence, resolved by the reject→snap contract. (If a rigid *moving* mob is ever added,
  host and guest must strip it identically — revisit then.)
- **No player-vs-player collision** (see [Decisions](#decisions--confirms-2026-06-03)). Players may
  share a tile, so there is no contest to arbitrate; each player's path is validated independently
  against geometry only. No arbitration code.
- `lastSeqOut[guest]` follows the contract above. **Delete the blanket advance in `onInput`
  (`:198–201`)** — today every received intent (actions included) bumps `lastSeqOut`. Under the new
  contract only a *resolved step* advances it (accept→at snap, reject→immediately). Action/face
  seqs share the counter but must not touch `lastSeq`.
- Action dispatch: set `avatar.direction = m.d` before firing.

### `js/player.js` — animation-only guest update + step executor
- `updateGuestAvatar(player, dt, zone)`: advance an active `step`'s progress, snap at completion,
  consume `netQueuedStep` via `applyNetStep`, advance `lastSeq` per the contract. **Still call
  `updateAnimation(player, dt)`** — it sets `player.moving = step != null` and the frame cycle,
  which the broadcaster's `moving`/`sigPlayer` and the host's rendering of guests depend on. No
  input poll, no rotate/hold/chain logic.
- `applyNetStep(player, dir, zone)`: wraps `startStep` (keeps pushable/gate side effects),
  returns whether a step was produced (for the accept/reject decision).
- Add `netQueuedStep` field in `createPlayer`.

### `js/main.js` — host tick
- For guest slots (`state.player2`, `state.players[]`, ~lines 382-393) call `updateGuestAvatar`
  instead of `updatePlayer`. The host's own avatar (slot 1) keeps full `updatePlayer`.
- `maybeTeleport` and the pickup scan it gates already key off each avatar's `tileX/tileY` via
  per-slot `lastTile`, so guest-triggered teleports/pickups keep working unchanged.

### `js/input.js` — remove dead seams
- Drop **only** the network movement-injection seams: `setNetworkHeld` (`:80`), `pushPressEvent`
  (`:90`), `pushInputPress` (`:44`). These go dead **only after** both consumers are removed — the
  host movement path in `hostGuests.applyIntent` *and* `predictedSelf.replayUnackedInputs` (which
  calls `pushInputPress(1,…)`/`setNetworkHeld(1,…)`/`clearInputState(1)` on the guest's own slot).
  Sequence the deletes so the module never imports a removed symbol (`predictedSelf.js:12`).
- **Keep** `clearInputHeld` (`:58`) and `clearInputState` (`:65`) — still used by `peer.left`,
  `peer.ghosted`, and `blur`. Local co-op's real-keyboard slots 2-4 are untouched.

### `js/snapshotBroadcaster.js`
- No structural change. `lastSeq` now means "last resolved step seq" (same `getLastSeqMap()`
  source). `serializePlayer`/`sigPlayer` already ship `tileX/tileY/direction/moving/x/y`; the
  guest avatar's `x/y` now come from `updateGuestAvatar`'s step lerp — same shape.

## Edge cases

- **Knockback / host displacement** — host moves the guest avatar; authoritative tile ≠
  `stepLog[lastSeq].result` → exact snap. (Today's code explicitly can't correct sub-5-tile
  knockbacks.)
- **Ice / slippery** — each slide tile is a committed step (`predictedSelf` chains via
  `handleIdleOnIce` → `startStep`), emitted + validated individually.
- **Pushables / gates** — host executes via `startStep` reuse → authority preserved.
- **No-displacement rejection** — handled by the `lastSeq`-on-reject rule (see contract).
- **Zone change** — host-gated as today; full snapshot resets mirror + predicted-self; step-log
  cleared.
- **Reconnect** — re-emit current move/face from `getPredictedSelf()`; clear step-log.
- **Dead guest** — host rejects moves; predicted-self frozen while dead. PvP respawn reposition
  is a host displacement → caught by reconcile.

## Decisions & confirms (2026-06-03)

1. **Player-vs-player collision: NONE, uniformly across every mode** (offline/online co-op, offline/
   online PvP, tower defense, …). Players may share a tile. This is already the behaviour in every
   mode today — players are never in `zone.entities`, so `canEnter` has never blocked one player on
   another — so the rule is "keep the status quo, and keep it uniform." Consequences for the spec:
   **no contested-tile arbitration** (there is no contest), and the host's slot-1 avatar and guest
   avatars stay symmetric. Chosen over adding collision because adding it would enable corridor-
   trapping a co-op partner, force a matching check onto the host avatar, and buy nothing in PvP
   (where lag-timing is already an accepted, unstoppable tradeoff). If player collision is ever
   wanted, it must land in shared movement code (`canEnter`/`startStep`) so all slots and all modes
   get it at once — never guest-only.

2. **Mob blocking: a non-issue.** All 18 moving mobs (`FindHero`/`Free`) are `is_rigid:false` in
   `data/species.json`; the only rigid moving species is the Hero itself. Mobs never block hero
   movement in any mode — heroes already walk through enemies everywhere, taking contact damage on a
   separate host-owned path. So the host validates guest steps with its plain authoritative
   `canEnter`; there is no "lagged mob disagreement" to design around, and no `predictionZone`-style
   mob-stripping needed host-side. (Forward note: if a rigid *moving* mob is ever introduced, the
   guest's `predictedSelf.predictionZone` and the host's validation must strip it identically, or it
   reintroduces a reject→snap near that mob.)

3. **Step duration is always equal across peers — creative mode is single-player only.**
   `player.js:47` `stepDuration()` halves in creative mode (`isCreativeMode()`), so unequal step
   durations would stutter the host's animation lerp. But creative mode never runs in any networked
   session (it's single-player only), so host and guest always share the base duration — there is no
   creative-state disagreement to sync. Nothing to do; noted so the `stepDuration()` branch isn't
   mistaken for a co-op desync risk.

## Verification

Unit tests (`tests/`, node built-in runner, no DOM):

1. **Junction repro** — drive `hostGuests.onMove` with committed steps up→up→left-at-3; assert
   the avatar lands at tile **4** regardless of when the left step is delivered (including
   late/interleaved). This is the 3→6 failure under today's model.
2. **No-displacement rejection** — host rejects a step (gate closed host-side) → `lastSeq`
   advances, tile unchanged → guest reconcile snaps and does NOT keep walking.
3. **Queued step** — avatar mid-step receives the next commit → consumed at snap, lands correct;
   `lastSeq` advances at snap, not receipt.
4. **Tile sharing** — two avatars commit onto the same tile → **both accepted** (no player-vs-player
   collision). Guards against the arbitration path creeping back in.
5. **Dead guard** — moves for a dead avatar are rejected.

Existing unit-test fallout (rewrite/remove with the old path):
- `tests/guestInputForwarder.test.js` — `pressDir`/`releaseDir`/`holdSync`/`stopMove`,
  `getInputLog`/`dropAckedInputs` → step-log assertions.
- `tests/hostGuests.test.js` — intent-movement (`INTENT_TO_DIR`, `setNetworkHeld`/`pushPressEvent`)
  → `onMove` accept/reject/queue assertions; the blanket-`lastSeq`-advance assumption.
- `tests/predictedSelf.test.js` — `_shouldSnapForTesting`/`MAX_DIVERGENCE`/replay → exact
  match/mismatch contract.
- `tests/inputRouting.test.js` — references the removed `input.js` injection seams; trim to the
  surviving local-coop routing.
- Sanity-check `tests/onlineCoopE2E.test.js`, `tests/coopMode.test.js` for the same removed symbols
  (they appear in a grep but may only touch action/seq plumbing — confirm, don't blindly edit).

Commands: `npm run test:unit` (fast inner loop), then `npm run test:e2e` (required — touches
`predictedSelf.js` and `snapshotBroadcaster.js`).

> **Correction to an earlier draft:** the e2e harness does **not** inject `op:"input"` movement.
> It drives the guest with real CDP keydowns (`tests/e2e/fixtures/coopSession.mjs` `dispatchKey`,
> e.g. `inputLatency.test.mjs`, `predictedSelfStutter.test.mjs`) and asserts on the resulting
> authoritative/mirror tile. Because the keyboard→`predictedSelf` path is preserved, these tests
> should keep passing with little or no change — the wire swap is internal. Run them to confirm;
> don't rewrite them to a new wire format.

Manual: two browsers (host + guest), run the exact L-junction with throttled latency → confirm no
rubber-band; PvP movement + a knockback → confirm a clean single snap.

## Rollout

Clean break, single deploy. Implement in commit-sized steps, `npm test` green at each:
1. Wire format + guest step emission (`predictedSelf` emit, `guestInputForwarder` `forwardMove` +
   step-log, action `d`).
2. Host execute/validate (`hostGuests.onMove`, `player.applyNetStep` +
   `updateGuestAvatar`, `main.js` tick swap).
3. Exact reconciliation (`predictedSelf.onAuth` rewrite, delete tolerance/replay).
4. Cleanup (`input.js` dead seams, in the order noted so no removed symbol is still imported) +
   tests (rewrite the unit fallout above; run e2e to confirm — no wire migration needed there).
