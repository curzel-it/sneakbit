// Explosive props (barrels). Mirrors Rust is_explosive(): species
// SPECIES_BARREL_{PURPLE,GREEN,BROWN,WOOD} can be destroyed by bullets
// and play SoundEffect::SmallExplosion on death instead of the generic
// non-monster death sound.
//
// The Rust source ships no actual AoE damage — the visual + audio
// feedback is what makes the barrel feel explosive — so this module
// only exports the species-id check; the death sound switch lives in
// combat.js where the kill is detected.

const EXPLOSIVE_IDS = new Set([1038, 1039, 1073, 1074]);

export function isExplosive(speciesId) {
  return EXPLOSIVE_IDS.has(speciesId);
}
