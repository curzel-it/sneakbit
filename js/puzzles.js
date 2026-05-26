// Pressure plates, gates and inverse gates.
//
// Each tick:
//   - A pressure plate is "down" if the player stands on it OR any
//     pushable's footprint overlaps it. The down-state writes the storage
//     flag `pressure_plate_down_<color>=1` so dialogue conditions and
//     gates can react. The plate's sprite shifts one tile to the right.
//   - A gate is open (passable, sprite +1) when its matching plate is
//     down. An inverse gate is open when the plate is up. The _open flag
//     is consulted by zone.isEntityBlocked.
//
// Each zone snapshots its own pressure-plate state into the storage
// keys, mirroring the Rust core. Across-zone persistence is intentional
// so a puzzle's solution can gate access in a *different* zone.

import { getSpecies } from "./species.js";
import {
  canonicaliseLock,
  isPressurePlateDown,
  setPressurePlateDown,
  LOCK_NONE,
  LOCK_PERMANENT,
  loadLockOverride,
} from "./locks.js";
import { isPushable } from "./pushables.js";

export function setupPuzzles(zone) {
  if (!zone?.entities) return;
  for (const e of zone.entities) {
    if (e.id != null) {
      const override = loadLockOverride(e.id);
      if (override) e.lock_type = override;
    }
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    if (sp.entity_type === "Gate" || sp.entity_type === "InverseGate") {
      // Closed by default → keep sprite at origin column.
      e._open = false;
      e._frameOffsetX = 0;
    } else if (sp.entity_type === "PressurePlate") {
      const lock = canonicaliseLock(e.lock_type);
      const down = isPressurePlateDown(lock);
      e._frameOffsetX = down ? 1 : 0;
    }
  }
}

export function tickPuzzles(zone, player) {
  if (!zone?.entities) return;
  // Snapshot which colored plates are currently down before reading
  // gates — gates are decided from the post-tick plate state.
  updatePlates(zone, player);
  updateGates(zone);
}

function updatePlates(zone, player) {
  for (const e of zone.entities) {
    const sp = getSpecies(e.species_id);
    if (sp?.entity_type !== "PressurePlate") continue;
    const lock = canonicaliseLock(e.lock_type);
    if (lock === LOCK_NONE || lock === LOCK_PERMANENT) continue;
    const f = e.frame; if (!f) continue;
    const down = playerOnFrame(player, f) || pushableOnFrame(zone, f);
    const wasDown = isPressurePlateDown(lock);
    if (down !== wasDown) setPressurePlateDown(lock, down);
    e._frameOffsetX = down ? 1 : 0;
  }
}

function updateGates(zone) {
  for (const e of zone.entities) {
    const sp = getSpecies(e.species_id);
    if (sp?.entity_type !== "Gate" && sp?.entity_type !== "InverseGate") continue;
    const lock = canonicaliseLock(e.lock_type);
    if (lock === LOCK_PERMANENT) {
      e._open = false;
      e._frameOffsetX = 0;
      continue;
    }
    const plateDown = isPressurePlateDown(lock);
    const open = sp.entity_type === "Gate" ? plateDown : !plateDown;
    e._open = open;
    e._frameOffsetX = open ? 1 : 0;
  }
}

function playerOnFrame(player, f) {
  if (!player) return false;
  // Use the rendered float position so plates fire mid-step too — feels
  // less stiff than waiting for the snap.
  const cx = player.x + 0.5;
  const cy = player.y + 0.5;
  return cx >= f.x && cx < f.x + f.w && cy >= f.y && cy < f.y + f.h;
}

function pushableOnFrame(zone, f) {
  for (const e of zone.entities) {
    if (!isPushable(e)) continue;
    const ef = e.frame; if (!ef) continue;
    if (ef.x + ef.w <= f.x || ef.x >= f.x + f.w) continue;
    if (ef.y + ef.h <= f.y || ef.y >= f.y + f.h) continue;
    return true;
  }
  return false;
}
