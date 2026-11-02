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

export function tickMonsterFusion(zone) {
  if (!zone?.entities) return;
  // Only fuse monsters that are currently on screen. Two off-screen
  // monsters merging would tier up unchecked while the player can't
  // see — matches Rust's visibility-gated hitmap behavior.
  const entities = zone.visibleEntities ?? zone.entities;
  const removalSource = zone.entities;
  for (let i = entities.length - 1; i >= 0; i--) {
    const self = entities[i];
    if (!isMonsterSpecies(self.species_id)) continue;
    if (self._dying) continue;
    const nextId = nextSpeciesId(self.species_id);
    if (nextId == null) continue;

    const partner = findCompatiblePartner(entities, i, self);
    if (!partner) continue;

    promoteSpecies(self, nextId);
    const removeAt = removalSource.indexOf(partner);
    if (removeAt >= 0) removalSource.splice(removeAt, 1);
    return;
  }
}

function findCompatiblePartner(entities, selfIdx, self) {
  const selfFrame = self.frame;
  if (!selfFrame) return null;
  for (let j = 0; j < entities.length; j++) {
    if (j === selfIdx) continue;
    const other = entities[j];
    if (!isMonsterSpecies(other.species_id)) continue;
    if (other._dying) continue;
    if (other.species_id > self.species_id) continue;
    const oid = other.id ?? j;
    const sid = self.id ?? selfIdx;
    if (oid > sid) continue;
    if (!framesOverlap(selfFrame, other.frame)) continue;
    return other;
  }
  return null;
}

// Monsters move freely, so brushing past each other isn't a fusion: they
// fuse when at least half of the smaller frame lies inside the other.
const FUSION_OVERLAP = 0.5;

function framesOverlap(a, b) {
  if (!a || !b) return false;
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return false;
  return w * h >= FUSION_OVERLAP * Math.min(a.w * a.h, b.w * b.h);
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
