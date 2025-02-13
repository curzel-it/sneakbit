use std::os::raw::c_char;

use serde::{Deserialize, Serialize};

use crate::{entities::{known_species::SPECIES_KUNAI_LAUNCHER, species::{species_by_id, EntityType, Species, ALL_SPECIES}}, features::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{get_value_for_global_key, has_species_in_inventory, inventory_count, set_value_for_key, StorageKey}}, lang::localizable::LocalizableText, utils::{directions::Direction, rect::FRect, strings::string_to_c_char}, worlds::world::World};

impl Entity {
    pub fn setup_equipment(&mut self) {
        self.is_equipped = is_equipped(&self.species, self.player_index);
        self.update_sprite_for_current_state();
    }

    pub fn update_equipment(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {   
        self.update_equipment_position(world);
        self.update_sprite_for_current_state();
        vec![]
    }

    fn should_be_over_hero(&self) -> bool {
        let is_being_used = self.action_cooldown_remaining > 0.0;
        if self.species.always_in_front_of_hero_when_equipped {
            true
        } else {
            match (self.direction, is_being_used) {
                (Direction::Left, false) => false,
                (Direction::Right, false) => false,
                (Direction::Down, false) => false,
                _ => true
            }
        }
    }

    pub fn update_equipment_position(&mut self, world: &World) {   
        let hero = world.players[self.player_index].props;
        self.direction = hero.direction;
        self.current_speed = hero.speed;
        self.frame.x = hero.frame.x - 1.5;
        self.frame.y = hero.frame.y - 1.0;

        let player = world.players[self.player_index].props;

        if self.should_be_over_hero() { 
            self.z_index = player.z_index + 1;
            self.sorting_key = player.sorting_key + 1;
        } else { 
            self.z_index = player.z_index - 1;
            self.sorting_key = player.sorting_key.saturating_sub(1);
        };
    }

    pub fn play_equipment_usage_animation(&mut self) {
        self.sprite.frame.y = match self.direction {
            Direction::Up => 37.0,
            Direction::Down => 45.0,
            Direction::Right => 41.0,
            Direction::Left => 49.0,
            Direction::None => 37.0,
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub enum EquipmentUsageSoundEffect {
    NoAmmo,
    SwordSlash,
    GunShot,
    LoudGunShot,
    KnifeThrown,
}

impl EquipmentUsageSoundEffect {
    pub fn as_world_state_update(&self, player: usize) -> WorldStateUpdate {
        let engine_update = match self {
            EquipmentUsageSoundEffect::NoAmmo => EngineStateUpdate::NoAmmo(player),
            EquipmentUsageSoundEffect::SwordSlash => EngineStateUpdate::SwordSlash(player),
            EquipmentUsageSoundEffect::GunShot => EngineStateUpdate::GunShot(player),
            EquipmentUsageSoundEffect::LoudGunShot => EngineStateUpdate::LoudGunShot(player),
            EquipmentUsageSoundEffect::KnifeThrown => EngineStateUpdate::KnifeThrown(player),
        };
        WorldStateUpdate::EngineUpdate(engine_update)
    }
}

pub fn is_equipped(species: &Species, player: usize) -> bool {
    if let Some(selected) = get_value_for_global_key(&equipment_key_for_species(species, player)) {
        selected == species.id
    } else {
        matches!(species.id, SPECIES_KUNAI_LAUNCHER)
    }
}

pub fn available_weapons(player: usize) -> Vec<AmmoRecap> {
    available_weapons_species_ids(player)
        .iter()
        .map(|species| {
            AmmoRecap {
                weapon_name: string_to_c_char(species.name.localized()),
                weapon_species_id: species.id,
                weapon_sprite: FRect::new(
                    if matches!(species.id, SPECIES_KUNAI_LAUNCHER) { 5.0 } else { species.sprite_frame.x }, 
                    57.0, 2.0, 2.0
                ),
                weapon_inventory_sprite: species.inventory_sprite_frame(),
                bullet_species_id: species.bullet_species_id,
                bullet_name: string_to_c_char(species_by_id(species.bullet_species_id).name.localized()),
                ammo_inventory_count: inventory_count(&species.bullet_species_id, player),
                is_melee: matches!(species.entity_type, EntityType::WeaponMelee),
                is_ranged: matches!(species.entity_type, EntityType::WeaponRanged),
                is_equipped: is_equipped(species, player),
                received_damage_reduction: species.received_damage_reduction
            }
        })
        .collect()
}

fn available_weapons_species_ids(player: usize) -> Vec<Species> {
    let mut all_ids: Vec<u32> = vec![SPECIES_KUNAI_LAUNCHER];
    let owned_ids = ALL_SPECIES
        .iter()
        .filter(|s| s.associated_weapon.is_some())
        .filter(|s| has_species_in_inventory(&s.id, player))
        .filter_map(|s| s.associated_weapon);

    all_ids.extend(owned_ids);
    all_ids.iter().map(|species_id| species_by_id(*species_id)).collect()
}

pub fn set_equipped(species: &Species, player: usize) {
    set_value_for_key(&equipment_key_for_species(species, player), species.id)
}

fn equipment_key_for_species(species: &Species, player: usize) -> String {
    match species.entity_type {
        EntityType::WeaponRanged => StorageKey::currently_equipped_ranged_weapon(player),
        EntityType::WeaponMelee => StorageKey::currently_equipped_melee_weapon(player),
        _ => "".to_owned()
    }    
}

#[derive(Debug)]
#[repr(C)]
pub struct AmmoRecap {
    pub weapon_name: *const c_char,
    pub weapon_species_id: u32,
    pub weapon_sprite: FRect,
    pub weapon_inventory_sprite: FRect,
    pub bullet_species_id: u32,
    pub bullet_name: *const c_char,
    pub ammo_inventory_count: u32,
    pub is_melee: bool,
    pub is_ranged: bool,
    pub is_equipped: bool,
    pub received_damage_reduction: f32
}