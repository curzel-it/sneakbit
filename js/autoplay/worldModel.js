// Per-zone analysis model: the engine's runtime zone (via the real
// buildZone) plus tile-keyed precomputed structures so search loops never
// scan zone.entities per tile probe — every per-tile question downstream
// is a Set lookup. Tile keys are "x,y" strings, matching pathfinding.js.
//
// Blocking mirrors zone.js::isEntityBlocked exactly:
//   walkable(tile) = !terrain collision AND !entity blocked
//   - an unlocked destination-teleporter tile un-blocks entities on it
//   - a locked teleporter tile affirmatively blocks
//   - rigid entities (and pushables regardless of is_rigid) block their
//     hittable feet rect while visible
//   - Gates / InverseGates block when closed; open state is derived from
//     lock overrides + pressure-plate flags (see gateIsOpen)

import { buildZone } from "../zone.js";
import { getSpecies } from "../species.js";
import {
  canonicaliseLock,
  isColoredLock,
  loadLockOverride,
  LOCK_NONE,
  LOCK_PERMANENT,
} from "../locks.js";
import { shouldBeVisible, entityHittableFrame } from "../entityVisibility.js";
import { isExplosive } from "../explosives.js";

const TELEPORTER_SPECIES_ID = 1019;

// Entity types removable at runtime (item_collected.<id>): auto-pickups
// (pickups.js AUTO_PICKUP_TYPES), hints, and NPCs (after_dialogue
// behaviors mark them collected). Their blocking is re-evaluated against
// live flags instead of being baked into the static set.
const REMOVABLE_TYPES = new Set(["Bundle", "PickableObject", "Bullet", "Hint", "Npc"]);

// Interact reach (interact.js::findFacingEntity): the tile in front is
// always probed; each further tile only if the previous one is statically
// non-walkable (talk over a counter, not across open floor).
const MAX_TALK_REACH = 3;

const DIRS = [
  { name: "up",    dx: 0,  dy: -1 },
  { name: "down",  dx: 0,  dy: 1 },
  { name: "left",  dx: -1, dy: 0 },
  { name: "right", dx: 1,  dy: 0 },
];

export function tileKey(x, y) {
  return `${x},${y}`;
}

export function buildZoneModel(raw) {
  const zone = buildZone(raw);
  const model = {
    id: zone.id,
    rows: zone.rows,
    cols: zone.cols,
    zone,
    raw,
    staticBlocked: new Set(),
    enterableTeleporterTiles: new Set(),
    lockedTeleporterTiles: new Set(),
    rigidStaticTiles: new Set(),
    destructibleTiles: new Set(),
    conditionalRigid: [],
    teleporters: [],
    gates: [],
    plates: [],
    pushables: [],
    pickups: [],
    hints: [],
    talkables: [],
    monsters: [],
    cutscenes: [],
    _passableCache: new Map(),
  };

  for (let y = 0; y < zone.rows; y++) {
    for (let x = 0; x < zone.cols; x++) {
      if (zone.collision[y][x]) model.staticBlocked.add(tileKey(x, y));
    }
  }

  for (const e of zone.entities) {
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    classifyEntity(model, e, sp);
  }

  for (const c of raw.cutscenes ?? []) {
    const pos = c.trigger_position;
    if (!Array.isArray(pos) || pos.length < 2) continue;
    model.cutscenes.push({
      key: c.key,
      triggerTile: { x: pos[0] | 0, y: pos[1] | 0 },
      // Entities spawned when the cutscene finishes (usually the dialogue
      // that carries the story beat) — raw JSON shape, not yet cloned.
      onEnd: c.on_end ?? [],
    });
  }

  return model;
}

function classifyEntity(model, e, sp) {
  const type = sp.entity_type;

  if (type === "Teleporter" || e.species_id === TELEPORTER_SPECIES_ID) {
    const tiles = frameTiles(e.frame);
    const lock = canonicaliseLock(e.lock_type);
    const t = {
      entityId: e.id ?? null,
      tiles,
      frame: e.frame,
      dest: e.destination ?? null, // already normalized to .zone by buildZone
      lock,
    };
    model.teleporters.push(t);
    const keys = tiles.map((p) => tileKey(p.x, p.y));
    if (lock !== LOCK_NONE) {
      for (const k of keys) model.lockedTeleporterTiles.add(k);
    } else if (e.destination) {
      for (const k of keys) model.enterableTeleporterTiles.add(k);
    }
    return;
  }

  if (type === "Gate" || type === "InverseGate") {
    model.gates.push({
      entityId: e.id ?? null,
      kind: type,
      dataLock: canonicaliseLock(e.lock_type),
      tiles: frameTiles(e.frame).map((p) => tileKey(p.x, p.y)),
    });
    return;
  }

  if (type === "PressurePlate") {
    const color = canonicaliseLock(e.lock_type);
    if (isColoredLock(color)) {
      model.plates.push({
        color,
        frame: e.frame,
        tiles: frameTiles(e.frame).map((p) => tileKey(p.x, p.y)),
      });
    }
    return;
  }

  if (type === "PushableObject") {
    model.pushables.push({
      entityId: e.id ?? null,
      start: { x: e.frame.x | 0, y: e.frame.y | 0 },
    });
    return;
  }

  if (type === "Hint") {
    model.hints.push({
      entityId: e.id ?? null,
      entity: e,
      consumable: !!e.is_consumable,
      tiles: frameTiles(e.frame),
    });
    return;
  }

  if (type === "Bundle" || type === "PickableObject" || (type === "Bullet" && !e._spawned)) {
    model.pickups.push({
      entityId: e.id ?? null,
      speciesId: e.species_id,
      entity: e,
      tiles: frameTiles(e.frame),
    });
  } else if (type === "CloseCombatMonster") {
    model.monsters.push({
      entityId: e.id ?? null,
      speciesId: e.species_id,
      tile: { x: e.frame.x | 0, y: (e.frame.y + e.frame.h - 1) | 0 },
      generated: !!e._generated,
    });
  }

  if ((e.dialogues ?? []).length > 0 && type !== "Hint") {
    model.talkables.push({
      entityId: e.id ?? null,
      entity: e,
      talkTiles: talkTilesFor(model, e),
    });
  }

  // Blocking contribution, mirroring isEntityBlocked's filter chain.
  if (!sp.is_rigid && type !== "PushableObject") return;
  if (type === "PushableObject") return; // dynamic — handled via ctx
  const hit = entityHittableFrame(e, sp);
  if (!hit) return;
  const tiles = rectTiles(hit, model.cols, model.rows).map((p) => tileKey(p.x, p.y));
  if (tiles.length === 0) return;
  // Explosive barrels block like any rigid prop (kept in the rigid sets so
  // blockedTiles stays engine-exact), but they die to bullets/melee
  // (combat.js) — the solver treats them as smashable obstacles.
  if (isExplosive(e.species_id)) for (const k of tiles) model.destructibleTiles.add(k);
  const conditional = (e.display_conditions?.length ?? 0) > 0
    || (e.id != null && REMOVABLE_TYPES.has(type));
  if (conditional) {
    model.conditionalRigid.push({ entity: e, tiles });
  } else {
    for (const k of tiles) model.rigidStaticTiles.add(k);
  }
}

// The current lock of a gate: a spent-key override beats the data lock.
export function gateLock(gate) {
  if (gate.entityId != null) {
    const override = loadLockOverride(gate.entityId);
    if (override != null) return override;
  }
  return gate.dataLock;
}

// Open/closed per puzzles.js::updateGates + gateUnlock.js::tryUnlockGate:
// a lock-None Gate opens on contact, a colored Gate opens while its plate
// is down, Permanent never opens. InverseGate: open while the plate is up
// (which makes lock-None inverse gates permanently open).
export function gateIsOpen(gate, plateDown) {
  const lock = gateLock(gate);
  if (lock === LOCK_PERMANENT) return false;
  if (gate.kind === "Gate") {
    return lock === LOCK_NONE || !!plateDown(lock);
  }
  return lock === LOCK_NONE || !plateDown(lock);
}

// Merged blocked-tile Set for a simulation context:
//   ctx.plateDown(color)  -> bool
//   ctx.pushableTiles     -> Set<"x,y"> current pushable positions
// Conditional entities are re-checked through the real shouldBeVisible
// (so item_collected / display_conditions read live storage). Memoized on
// a state signature; callers must call invalidatePassableCache(model)
// after flag writes that could change visibility.
export function blockedTiles(model, ctx) {
  const sig = passableSignature(model, ctx);
  const hit = model._passableCache.get(sig);
  if (hit) return hit;

  const blocked = new Set(model.staticBlocked);
  const entityBlocked = [];
  for (const k of model.rigidStaticTiles) entityBlocked.push(k);
  for (const k of model.lockedTeleporterTiles) blocked.add(k);
  for (const c of model.conditionalRigid) {
    if (!shouldBeVisible(c.entity)) continue;
    for (const k of c.tiles) entityBlocked.push(k);
  }
  for (const g of model.gates) {
    if (gateIsOpen(g, ctx.plateDown)) continue;
    for (const k of g.tiles) entityBlocked.push(k);
  }
  if (ctx.pushableTiles) {
    for (const k of ctx.pushableTiles) entityBlocked.push(k);
  }
  for (const k of entityBlocked) {
    if (!model.enterableTeleporterTiles.has(k)) blocked.add(k);
  }
  // An enterable teleporter overrides BOTH terrain and entity collision
  // (player.js::canEnter): interior exit doors sit on otherwise-unwalkable
  // tiles yet must stay steppable.
  for (const k of model.enterableTeleporterTiles) blocked.delete(k);

  model._passableCache.set(sig, blocked);
  return blocked;
}

export function invalidatePassableCache(model) {
  model._passableCache.clear();
}

function passableSignature(model, ctx) {
  let sig = "";
  for (const g of model.gates) sig += gateIsOpen(g, ctx.plateDown) ? "o" : "c";
  for (const c of model.conditionalRigid) sig += shouldBeVisible(c.entity) ? "v" : "h";
  if (ctx.pushableTiles) sig += "|" + [...ctx.pushableTiles].sort().join(";");
  return sig;
}

// Tiles a player can stand on to open this entity's dialogue, mirroring
// interact.js::findFacingEntity: facing the entity, with every tile
// between the player and the entity statically non-walkable (reach over
// counters). Computed against static collision only — live passability of
// the standing tile is the planner's concern.
function talkTilesFor(model, e) {
  const tiles = [];
  const seen = new Set();
  const frame = e.frame;
  if (!frame) return tiles;
  for (const ft of frameTiles(frame)) {
    for (const dir of DIRS) {
      for (let step = 1; step <= MAX_TALK_REACH; step++) {
        const px = ft.x - dir.dx * step;
        const py = ft.y - dir.dy * step;
        if (px < 0 || py < 0 || px >= model.cols || py >= model.rows) break;
        // Every tile strictly between the player and the entity must be
        // statically non-walkable for the ray to keep reaching.
        let reachable = true;
        for (let j = 1; j < step; j++) {
          const ix = px + dir.dx * j;
          const iy = py + dir.dy * j;
          if (!model.staticBlocked.has(tileKey(ix, iy))) { reachable = false; break; }
        }
        if (!reachable) break;
        const k = tileKey(px, py);
        if (!seen.has(k) && !model.staticBlocked.has(k)) {
          seen.add(k);
          tiles.push({ x: px, y: py, dir: dir.name });
        }
      }
    }
  }
  return tiles;
}

function frameTiles(frame) {
  if (!frame) return [];
  const out = [];
  const x0 = frame.x | 0;
  const y0 = frame.y | 0;
  for (let dy = 0; dy < (frame.h | 0 || 1); dy++) {
    for (let dx = 0; dx < (frame.w | 0 || 1); dx++) {
      out.push({ x: x0 + dx, y: y0 + dy });
    }
  }
  return out;
}

// Integer tiles overlapped by a fractional rect (hittable feet boxes).
function rectTiles(rect, cols, rows) {
  const out = [];
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(cols - 1, Math.ceil(rect.x + rect.w) - 1);
  const y1 = Math.min(rows - 1, Math.ceil(rect.y + rect.h) - 1);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      // Zero-area overlap (rect edge exactly on the tile border) doesn't block.
      if (rect.x + rect.w <= x || rect.x >= x + 1) continue;
      if (rect.y + rect.h <= y || rect.y >= y + 1) continue;
      out.push({ x, y });
    }
  }
  return out;
}
