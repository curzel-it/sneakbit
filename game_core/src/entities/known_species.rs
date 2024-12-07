use crate::entities::species::EntityType;

use super::species::species_by_id;

pub const SPECIES_HERO: u32 = 1001;
pub const SPECIES_NPC_SHOP_CLERK: u32 = 3008;
pub const SPECIES_STAIRS_UP: u32 = 1010;
pub const SPECIES_STAIRS_DOWN: u32 = 1011;
pub const SPECIES_SEAT_GREEN: u32 = 1013;
pub const SPECIES_TABLE: u32 = 1016;
pub const SPECIES_KEY_YELLOW: u32 = 2000;
pub const SPECIES_KEY_RED: u32 = 2001;
pub const SPECIES_KEY_GREEN: u32 = 2002;
pub const SPECIES_KEY_BLUE: u32 = 2003;
pub const SPECIES_KEY_SILVER: u32 = 2004;
pub const SPECIES_KUNAI_BUNDLE: u32 = 7001;
pub const SPECIES_TELEPORTER: u32 = 1019;
pub const SPECIES_ZOMBIE: u32 = 4002;
pub const SPECIES_GHOST: u32 = 4003;
pub const SPECIES_MONSTER: u32 = 4004;
pub const SPECIES_SMALL_MONSTER: u32 = 1148;
pub const SPECIES_MR_MUGS: u32 = 1131;
pub const SPECIES_FOOTSTEPS: u32 = 1136;

pub const SPECIES_KUNAI: u32 = 7000;
pub const SPECIES_KUNAI_LAUNCHER: u32 = 1160;

pub const SPECIES_SWORD: u32 = 1158;
pub const SPECIES_SWORD_ITEM: u32 = 1163;
pub const SPECIES_SWORD_SLASH: u32 = 1161;

pub const SPECIES_CLAYMORE: u32 = 1159;
pub const SPECIES_CLAYMORE_ITEM: u32 = 1164;
pub const SPECIES_CLAYMORE_SLASH: u32 = 1166;

pub const SPECIES_AR15: u32 = 1154;
pub const SPECIES_AR15_ITEM: u32 = 1162;

pub const SPECIES_BARREL_PURPLE: u32 = 1038;
pub const SPECIES_BARREL_GREEN: u32 = 1039;
pub const SPECIES_BARREL_BROWN: u32 = 1073;
pub const SPECIES_BARREL_WOOD: u32 = 1074;

pub fn is_enemy(species_id: u32) -> bool {
    species_by_id(species_id).melee_attacks_hero
}

pub fn is_explosive(species_id: u32) -> bool {
    matches!(species_id, SPECIES_BARREL_PURPLE | SPECIES_BARREL_GREEN | SPECIES_BARREL_BROWN | SPECIES_BARREL_WOOD)
}

pub fn is_pickable(species_id: u32) -> bool {
    matches!(species_by_id(species_id).entity_type, EntityType::PickableObject)
}

pub fn is_ammo(species_id: u32) -> bool {
    matches!(species_id, SPECIES_KUNAI | SPECIES_KUNAI_BUNDLE)
}

pub fn is_key(species_id: u32) -> bool {
    matches!(species_id, SPECIES_KEY_BLUE | SPECIES_KEY_GREEN | SPECIES_KEY_RED | SPECIES_KEY_SILVER | SPECIES_KEY_YELLOW)
}

pub fn is_monster(species_id: u32) -> bool {
    matches!(species_id, SPECIES_MONSTER | SPECIES_SMALL_MONSTER)
}