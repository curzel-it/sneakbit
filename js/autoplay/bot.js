// Autoplay orchestrator. Owns the bot ticker (a setInterval independent of
// the rAF game loop, so it keeps dismissing modals while the sim is frozen),
// the mode stack, and the wiring of every sub-feature. The computed dynamic
// import in main.js calls startBot() with a narrow { getState } context.
//
// Mode stack, highest priority first, evaluated every tick:
//   1. OverlayJanitor  — a modal is open → advance/dismiss it (sim frozen).
//   2. Survive         — hurt + monster on us → break away (botCombat).
//   3. ExecuteAction   — drive the current plan step via botNav.
//   4. Plan            — no action → pick the next objective, else travel.
//
// Scope: talks, pickups, hints, and zone travel on WALKABLE routes, with
// monster-avoidant navigation + survival. Push-puzzle objectives aren't
// walk-reachable (findPath skips them), so they're left for botPush (M2).

import { pushInputPress, clearInputHeld } from "../input.js";
import { tryInteractForSlot } from "../interact.js";
import { getValue } from "../storage.js";
import { isPlayerDead, getPlayerHp, getPlayerMaxHp } from "../playerHealth.js";
import { liveObjectives } from "./objectiveCatalog.js";
import { edgeTraversable } from "./zoneGraph.js";
import { loadBotWorld } from "./botWorld.js";
import { makeNavigator, findPath, isNavWalkable } from "./botNav.js";
import { tickJanitor } from "./botDialogue.js";
import { decideCombat, monsterHalo } from "./botCombat.js";
import { installOverlay, updateOverlay } from "./botOverlay.js";
import { logEvent, recentEvents } from "./botLog.js";

const TICK_MS = 50;

// Watchability pacing (§7) — a show, not a speedrun.
const PACING = {
  settleMs: 450,      // pause after arriving at an objective before acting
  postActionMs: 350,  // brief idle after a pickup/talk completes
  overlayMs: 500,     // overlay refresh cadence
};

// Failure containment (§5.7): per-tile walk budget (capped, so a far goal
// can't buy minutes of wandering) and a hard per-zone time budget so the
// tour always moves on even if a few objectives are stubborn (stragglers
// get retried on the next lap).
const WALK_MS_PER_TILE = 1200;
const MIN_ACTION_MS = 4000;
const MAX_ACTION_MS = 15000;
const ZONE_TIME_BUDGET_MS = 60000;

const SLOT = 1;               // bot drives player 1
const KEY_SPECIES = [2000, 2001, 2002, 2003, 2004, 2005];

export function startBot(ctx) {
  const bot = new Bot(ctx);
  bot.start();
  // Expose for CDP debugging on the stream box.
  if (typeof window !== "undefined") window.autoplay = bot;
  return bot;
}

class Bot {
  constructor(ctx) {
    this.ctx = ctx;
    this.world = null;
    this.ready = false;
    this.timer = null;
    this.nav = makeNavigator();
    this.action = null;
    this.lastZoneId = null;
    this.cameFrom = null;
    this.blockedThisZone = new Set(); // objective keys we gave up on this entry
    this.visited = new Set();
    this.waitUntil = 0;
    this.lastOverlayTs = 0;
    this.zoneEnteredTs = 0;
    this.wasDead = false;
    this.deaths = 0;
    this.avoid = null;
  }

  async start() {
    installOverlay();
    this.refreshOverlay("Loading world…");
    try {
      this.world = await loadBotWorld();
    } catch (e) {
      logEvent("info", `world load failed: ${e.message}`);
      this.refreshOverlay("World load failed");
      return;
    }
    this.ready = true;
    logEvent("info", `world ready — ${this.world.zoneCount} zones`);
    this.timer = setInterval(() => this.safeTick(), TICK_MS);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.idle();
  }

  safeTick() {
    try {
      this.tick();
    } catch (e) {
      console.error("[autoplay] tick error", e);
    }
  }

  tick() {
    const now = Date.now();

    // 1. OverlayJanitor — sim is frozen behind any modal; release movement
    // so we don't resume a stale held key when it closes, and let the
    // janitor advance it.
    if (tickJanitor(now)) {
      this.idle();
      return;
    }

    const state = this.ctx.getState();
    if (!this.ready || !state || !state.player || !state.zone) return;

    // Death watcher: the game-over overlay is dismissed by the janitor above
    // (Continue → respawn at the zone's spawn point); when we come back alive,
    // drop the stale action so we replan from wherever we respawned.
    const dead = isPlayerDead(0);
    if (dead && !this.wasDead) { logEvent("death", `died in zone ${state.zone.id}`); this.deaths++; }
    if (!dead && this.wasDead) { this.action = null; this.idle(); }
    this.wasDead = dead;
    if (dead) { this.idle(); return; }

    // Commit a zone change (travel arrival, or a cutscene relocation).
    if (state.zone.id !== this.lastZoneId) this.onZoneChange(state);

    if (now < this.waitUntil) { this.idle(); return; }

    // 2. Survive — an imminent monster while we're hurt preempts everything
    // (break away to regen). Otherwise navigation routes AROUND monsters via
    // the avoid halo below, so healthy travel just flows past them.
    const intent = decideCombat(state);
    if (intent) {
      if (intent.flee) this.step(state.player, intent.flee);
      else this.idle();
      this.maybeRefreshOverlay(state, now);
      return;
    }
    // Monster-avoid halo for this tick's pathing (used on nav recompute).
    this.avoid = monsterHalo(state.zone, state.player);

    // 3. ExecuteAction.
    if (this.action) {
      this.executeAction(state, now);
      this.maybeRefreshOverlay(state, now);
      return;
    }

    // 4. Plan.
    this.action = this.planNext(state, now);
    this.maybeRefreshOverlay(state, now);
  }

  onZoneChange(state) {
    this.cameFrom = this.lastZoneId;
    this.lastZoneId = state.zone.id;
    this.visited.add(state.zone.id);
    this.blockedThisZone = new Set();
    this.action = null;
    this.idle();
    this.zoneEnteredTs = Date.now();
    logEvent("travel", `entered zone ${state.zone.id}`);
  }

  // --- planning ------------------------------------------------------------

  planNext(state, now) {
    const model = this.world.modelFor(state.zone.id);
    // Hard per-zone time cap: tour onward even with stragglers left (a later
    // lap retries them) so the stream never wedges farming one zone.
    const overBudget = now - this.zoneEnteredTs > ZONE_TIME_BUDGET_MS;
    if (model && !overBudget) {
      const objAction = this.pickObjective(state, model, now);
      if (objAction) return objAction;
    }
    return this.planTravel(state, now);
  }

  // Nearest walk-reachable objective in the current zone, skipping ones we
  // already gave up on this entry and anything that needs a solve (those
  // aren't walk-reachable, so findPath returns null and they're skipped —
  // that's the push-puzzle / combat filter for M1).
  pickObjective(state, model, now) {
    let best = null;
    let bestLen = Infinity;
    for (const o of liveObjectives(model)) {
      const key = objectiveKey(o);
      if (this.blockedThisZone.has(key)) continue;
      // The player must be able to STAND on the goal tile (a pickup on, or a
      // talk tile in front of, a tile that's blocked live is unobtainable on
      // foot) — restrict goals to live-walkable tiles. This also filters out
      // push-puzzle / gated objectives whose tiles aren't walkable yet (M1).
      const goalTiles = (o.tiles || []).filter((t) => isNavWalkable(state.zone, t.x, t.y));
      if (goalTiles.length === 0) continue;
      const goalSet = new Set(goalTiles.map((t) => `${t.x},${t.y}`));
      const path = findPath(state.zone, { x: state.player.tileX, y: state.player.tileY }, goalSet);
      if (!path) continue;
      if (path.length < bestLen) { bestLen = path.length; best = { o, goalTiles, path }; }
    }
    if (!best) return null;
    const o = best.o;
    this.nav.setGoal(best.goalTiles);
    logEvent("objective", `${o.kind} ${describeObjective(o)} in ${state.zone.id}`);
    return {
      type: o.kind,
      objective: o,
      key: objectiveKey(o),
      phase: "nav",
      deadline: now + Math.min(MAX_ACTION_MS, Math.max(MIN_ACTION_MS, best.path.length * WALK_MS_PER_TILE)),
    };
  }

  // Leave the current zone through the nearest walk-reachable teleporter,
  // preferring an unvisited destination and avoiding an immediate backtrack
  // through the door we just came in. One hop at a time — we replan on
  // arrival, so the tour explores the whole connected graph and (with the
  // per-zone budget) never wedges. Endless: when every reachable exit leads
  // somewhere already visited, we still take the nearest non-backtrack one.
  planTravel(state, now) {
    const fromZone = state.zone.id;
    const scored = [];
    for (const e of this.world.graph.edges) {
      if (e.from !== fromZone || !edgeTraversable(e)) continue;
      if (this.blockedThisZone.has(`edge:${e.teleporterEntityId}`)) continue;
      const goalTiles = e.tiles.map((t) => ({ x: t.x, y: t.y }));
      const path = nearestPath(state.zone, state.player, goalTiles);
      if (!path) { this.blockedThisZone.add(`edge:${e.teleporterEntityId}`); continue; }
      scored.push({
        edge: e,
        goalTiles,
        len: path.length,
        unvisited: this.visited.has(e.to) ? 0 : 1,
        backtrack: e.to === this.cameFrom ? 1 : 0,
      });
    }
    if (scored.length === 0) return null;
    // unvisited first, then non-backtrack, then shortest on foot.
    scored.sort((a, b) =>
      (b.unvisited - a.unvisited) || (a.backtrack - b.backtrack) || (a.len - b.len));
    const pick = scored[0];
    this.nav.setGoal(pick.goalTiles);
    logEvent("travel", `heading ${fromZone} → ${pick.edge.to} (${pick.len} tiles)`);
    return {
      type: "travel",
      targetZone: pick.edge.to,
      fromZone,
      phase: "nav",
      deadline: now + Math.min(180000, Math.max(MIN_ACTION_MS, pick.len * WALK_MS_PER_TILE * 2)),
    };
  }

  // --- execution -----------------------------------------------------------

  executeAction(state, now) {
    if (now > this.action.deadline) {
      logEvent("replan", `deadline blown on ${this.action.type} in ${state.zone.id}`);
      this.failAction();
      return;
    }
    if (this.action.type === "travel") return this.runTravel(state, now);
    if (this.action.type === "talk") return this.runTalk(state, now);
    return this.runReach(state, now); // pickup / hint / cutscene
  }

  // Walk-and-done: pickups, hints and cutscenes complete the moment we reach
  // the tile (the engine's checkPickup / tickCutscenes fire on the step).
  runReach(state, now) {
    if (!objectiveLive(this.world.modelFor(state.zone.id), this.action.objective)) {
      this.completeAction(state, now);
      return;
    }
    const r = this.nav.tick(state.player, state.zone, this.avoid);
    if (r.status === "blocked") { this.failAction(); return; }
    if (r.status === "arrived") {
      // Arrived but flag not yet cleared — give the sim a couple ticks, then
      // give up (whitelisted-unreachable, or a model/engine mismatch).
      this.idle();
      if (!this.action.settleAt) this.action.settleAt = now + PACING.settleMs;
      else if (now > this.action.settleAt) {
        if (objectiveLive(this.world.modelFor(state.zone.id), this.action.objective)) {
          logEvent("replan", `${this.action.type} did not register in ${state.zone.id}`);
          this.failAction();
        } else this.completeAction(state, now);
      }
      return;
    }
    this.step(state.player, r.dir);
  }

  runTalk(state, now) {
    const model = this.world.modelFor(state.zone.id);
    if (!objectiveLive(model, this.action.objective)) { this.completeAction(state, now); return; }
    if (this.action.phase === "nav") {
      const r = this.nav.tick(state.player, state.zone, this.avoid);
      if (r.status === "blocked") { this.failAction(); return; }
      if (r.status === "arrived") {
        this.action.phase = "face";
        this.action.faceDir = faceDirAt(this.action.objective, state.player);
        this.idle();
        return;
      }
      this.step(state.player, r.dir);
      return;
    }
    if (this.action.phase === "face") {
      const dir = this.action.faceDir;
      // Rotate to face the NPC (tap toward a blocked NPC tile only turns us).
      if (dir && state.player.direction !== dir) { this.step(state.player, dir); return; }
      this.idle();
      tryInteractForSlot(SLOT);
      // The interact either opened a dialogue (janitor takes over next tick)
      // or there was nothing facing us. Either way, re-evaluate after a beat.
      this.action.phase = "settle";
      this.action.settleAt = now + PACING.settleMs;
      return;
    }
    // settle: after the dialogue closed, is the talk exhausted?
    if (now < this.action.settleAt) return;
    if (objectiveLive(model, this.action.objective)) {
      // More lines remain (a multi-dialogue NPC) — face and interact again.
      this.action.phase = "face";
    } else {
      this.completeAction(state, now);
    }
  }

  runTravel(state, now) {
    if (state.zone.id !== this.action.fromZone) {
      // Zone flipped (onZoneChange handles the rest); nothing to do here.
      return;
    }
    const r = this.nav.tick(state.player, state.zone, this.avoid);
    if (r.status === "blocked") { this.failAction(); return; }
    if (r.status === "arrived") {
      // Standing on the teleporter tile. The step onto it should already have
      // fired maybeTeleport (travelTo is async — the zone flips a few frames
      // later). If it doesn't flip within a short grace window the tile wasn't
      // a live trigger, so block this exit and try another.
      this.idle();
      if (!this.action.arrivedAt) this.action.arrivedAt = now;
      else if (now - this.action.arrivedAt > 3000) {
        logEvent("replan", `teleporter ${this.action.fromZone}→${this.action.targetZone} did not fire`);
        this.failAction({ edge: true });
      }
      return;
    }
    this.action.arrivedAt = 0;
    this.step(state.player, r.dir);
  }

  completeAction(state, now) {
    this.idle();
    this.waitUntil = now + PACING.postActionMs;
    this.action = null;
  }

  failAction(opts = {}) {
    const a = this.action;
    if (a?.key) this.blockedThisZone.add(a.key);
    // A dud teleporter: block the specific exit so the next plan picks another.
    if (a?.type === "travel" && a.targetZone != null && opts.edge) {
      for (const e of this.world.graph.edges) {
        if (e.from === a.fromZone && e.to === a.targetZone) {
          this.blockedThisZone.add(`edge:${e.teleporterEntityId}`);
        }
      }
    }
    this.idle();
    this.action = null;
  }

  // --- input ---------------------------------------------------------------

  // Tap-per-tile movement. We deliberately do NOT hold a direction: a held
  // key makes the engine chain the next step at each snap using whatever is
  // held at that frame, and the 50ms bot ticker can't re-aim fast enough, so
  // the player overshoots every turn and never converges on a long winding
  // path. Instead, while idle, queue exactly one press (press + drop held,
  // like window.coop.tap) toward the next tile; the player rotates or steps
  // one tile and stops, then we re-aim. Deterministic, overshoot-free.
  step(player, dir) {
    if (!dir) { this.idle(); return; }
    if (player.step) return; // mid-step — let the current tile land first
    pushInputPress(SLOT, dir);
    clearInputHeld(SLOT);
  }

  idle() {
    clearInputHeld(SLOT);
  }

  // --- overlay -------------------------------------------------------------

  maybeRefreshOverlay(state, now) {
    if (now - this.lastOverlayTs < PACING.overlayMs) return;
    this.lastOverlayTs = now;
    this.refreshOverlay(this.action ? describeAction(this.action) : "Choosing next move…", state);
  }

  refreshOverlay(objective, state) {
    updateOverlay({
      objective,
      zoneId: state?.zone?.id ?? null,
      keys: this.world ? this.countKeys() : null,
      zonesVisited: this.visited.size || null,
      zoneCount: this.world?.zoneCount ?? null,
      hp: state ? getPlayerHp(0) : null,
      maxHp: state ? getPlayerMaxHp(0) : null,
      deaths: this.deaths,
      recent: recentEvents(5).map((e) => `${e.kind}: ${e.detail}`),
    });
  }

  countKeys() {
    let n = 0;
    for (const model of this.world.graph.models.values()) {
      for (const p of model.pickups) {
        if (!KEY_SPECIES.includes(p.speciesId)) continue;
        if (p.entityId != null && getValue(`item_collected.${p.entityId}`) === 1) n++;
      }
    }
    return n;
  }
}

// --- pure helpers ----------------------------------------------------------

function objectiveKey(o) {
  return o.kind === "cutscene" ? `cutscene:${o.key}` : `${o.kind}:${o.entityId}`;
}

function objectiveLive(model, objective) {
  if (!model) return false;
  return liveObjectives(model).some((o) => objectiveKey(o) === objectiveKey(objective));
}

function describeObjective(o) {
  if (o.kind === "pickup") return `#${o.entityId} (sp ${o.speciesId})`;
  if (o.kind === "talk") return `npc #${o.entityId}`;
  if (o.kind === "hint") return `hint #${o.entityId}`;
  if (o.kind === "cutscene") return o.key;
  return "";
}

function describeAction(a) {
  if (a.type === "travel") return `Travelling to zone ${a.targetZone}`;
  if (a.type === "talk") return `Talking to NPC #${a.objective.entityId}`;
  if (a.type === "pickup") return `Fetching item #${a.objective.entityId}`;
  if (a.type === "hint") return `Reading a hint`;
  if (a.type === "cutscene") return `Triggering ${a.objective.key}`;
  return a.type;
}

// The facing direction for the talk tile the player is standing on.
function faceDirAt(objective, player) {
  for (const t of objective.tiles) {
    if (t.x === player.tileX && t.y === player.tileY) return t.dir ?? null;
  }
  return objective.tiles[0]?.dir ?? null;
}

// Shortest path from the player to the nearest of `tiles`, or null.
function nearestPath(zone, player, tiles) {
  const goal = new Set(tiles.map((t) => `${t.x},${t.y}`));
  return findPath(zone, { x: player.tileX, y: player.tileY }, goal);
}
