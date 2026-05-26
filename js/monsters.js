// Monster fusion: when two monsters of equal or compatible tiers overlap,
// the higher-id entity absorbs the other and tiers up. Mirrors the Rust
// core's `fuse_with_other_creeps_if_possible`. The progression is:
//   small (4003) ─┐
//                 ├→ blueberry (4005) → strawberry (4006) → gooseberry (4007)
//   monster (4004)┘
//
// Minion spawning (species 4008, "grapevine") would slot in next to this
// but Rust ships `bullet_species_id: 0` for it so the original game's
// data never actually spawns anything. Leaving the hook ready for when
// future content turns it on.

import { getSpecies } from "./species.js";

const SPECIES_MONSTER_SMALL      = 4003;
const SPECIES_MONSTER            = 4004;
const SPECIES_MONSTER_BLUEBERRY  = 4005;
const SPECIES_MONSTER_STRAWBERRY = 4006;
const SPECIES_MONSTER_GOOSEBERRY = 4007;

const MONSTER_TIERS = new Set([
  SPECIES_MONSTER_SMALL,
  SPECIES_MONSTER,
  SPECIES_MONSTER_BLUEBERRY,
  SPECIES_MONSTER_STRAWBERRY,
  SPECIES_MONSTER_GOOSEBERRY,
]);

function nextSpeciesId(id) {
  switch (id) {
    case SPECIES_MONSTER_SMALL:
    case SPECIES_MONSTER:           return SPECIES_MONSTER_BLUEBERRY;
    case SPECIES_MONSTER_BLUEBERRY: return SPECIES_MONSTER_STRAWBERRY;
    case SPECIES_MONSTER_STRAWBERRY:return SPECIES_MONSTER_GOOSEBERRY;
    default:                        return null;
  }
}

export function isMonsterSpecies(id) { return MONSTER_TIERS.has(id); }

export function tickMonsterFusion(world) {
  if (!world?.entities) return;
  const entities = world.entities;
  for (let i = entities.length - 1; i >= 0; i--) {
    const self = entities[i];
    if (!isMonsterSpecies(self.species_id)) continue;
    if (self._dying) continue;
    const nextId = nextSpeciesId(self.species_id);
    if (nextId == null) continue;

    const partnerIdx = findCompatiblePartner(entities, i, self);
    if (partnerIdx === -1) continue;

    promoteSpecies(self, nextId);
    entities.splice(partnerIdx, 1);
    // Index shift: removing partner before `i` would invalidate the iteration
    // step on the next pass, but our outer loop already iterates backward
    // and we exit as soon as we promote one monster per tick anyway.
    return;
  }
}

function findCompatiblePartner(entities, selfIdx, self) {
  const selfFrame = self.frame;
  if (!selfFrame) return -1;
  for (let j = 0; j < entities.length; j++) {
    if (j === selfIdx) continue;
    const other = entities[j];
    if (!isMonsterSpecies(other.species_id)) continue;
    if (other._dying) continue;
    // Mirrors Rust's "species_id <= self.species_id && entity_id <= self.id"
    // — we use array index as a deterministic stand-in for entity id when
    // entities don't carry one. This keeps fusion idempotent: only one
    // direction of the pair triggers, no ping-pong.
    if (other.species_id > self.species_id) continue;
    const oid = other.id ?? j;
    const sid = self.id ?? selfIdx;
    if (oid > sid) continue;
    if (!framesOverlap(selfFrame, other.frame)) continue;
    return j;
  }
  return -1;
}

function framesOverlap(a, b) {
  if (!a || !b) return false;
  if (a.x + a.w <= b.x) return false;
  if (b.x + b.w <= a.x) return false;
  if (a.y + a.h <= b.y) return false;
  if (b.y + b.h <= a.y) return false;
  return true;
}

function promoteSpecies(entity, newSpeciesId) {
  entity.species_id = newSpeciesId;
  const sp = getSpecies(newSpeciesId);
  if (!sp) return;
  // Update the footprint so a tier-up that grows the sprite still fits.
  if (entity.frame) {
    entity.frame.w = sp.width || entity.frame.w;
    entity.frame.h = sp.height || entity.frame.h;
  }
  // Reset hp to the new species' max so a freshly fused mob isn't
  // already half dead. The combat tick lazily writes `_hp` so it's
  // safe to clear it here.
  entity._hp = sp.hp;
  // Drop any in-flight step — the AI tick will pick a new one with the
  // promoted footprint.
  if (entity._ai) entity._ai.step = null;
}
