use lazy_static::lazy_static;
use serde::{Deserialize, Serialize};
use std::{fs::File, io::Read};
use crate::{config::config, constants::{NO_PARENT, PLAYER1_ENTITY_ID, SPRITE_SHEET_BIOME_TILES, UNLIMITED_LIFESPAN}, equipment::basics::EquipmentUsageSoundEffect, features::{animated_sprite::AnimatedSprite, dialogues::AfterDialogueBehavior}, features::{movements::MovementDirections, entity::Entity, locks::LockType}, lang::localizable::LocalizableText, utils::{directions::Direction, ids::get_next_id, rect::FRect}};

pub type SpeciesId = u32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Species {
    pub id: SpeciesId,
    pub name: String,
    pub entity_type: EntityType,
    pub base_speed: f32,
    pub is_rigid: bool,
    pub inventory_texture_offset: (f32, f32),
    pub sprite_frame: FRect,
    pub sprite_sheet_id: u32,
    pub sprite_number_of_frames: i32,
    
    #[serde(default="zero_i32")]
    pub z_index: i32,

    #[serde(default)]
    pub movement_directions: MovementDirections,
    
    #[serde(default)]
    pub lock_type: LockType,

    #[serde(default="one")]
    pub scale: f32,

    #[serde(default)]
    pub is_consumable: bool,

    #[serde(default)]
    pub melee_attacks_hero: bool,

    #[serde(default)]
    pub bundle_contents: Vec<u32>,

    #[serde(default)]
    pub is_invulnerable: bool,

    #[serde(default="one_hundred")]
    pub hp: f32,

    #[serde(default="zero")]
    pub dps: f32,

    #[serde(default="zero_u32")]
    pub bullet_species_id: u32,

    #[serde(default="one")]
    pub bullet_lifespan: f32,

    #[serde(default="zero")]
    pub cooldown_after_use: f32,

    #[serde(default)]
    pub equipment_usage_sound_effect: Option<EquipmentUsageSoundEffect>,

    #[serde(default)]
    pub associated_weapon: Option<u32>,

    #[serde(default)]
    pub supports_bullet_boomerang: bool,

    #[serde(default)]
    pub supports_bullet_catching: bool,

    #[serde(default="zero")]
    pub received_damage_reduction: f32,

    #[serde(default="one")]
    pub ranged_dps_multiplier: f32,

    #[serde(default="one")]
    pub melee_dps_multiplier: f32,    

    #[serde(default)]
    pub always_in_front_of_hero_when_equipped: bool,
}

#[derive(Default, Debug, Copy, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntityType {
    Hero,
    Building,   
    Npc, 
    #[default]
    StaticObject,
    PickableObject,
    Teleporter,
    PushableObject,
    Gate,
    InverseGate,
    PressurePlate,
    Bullet,
    Bundle,
    RailObject,
    Hint,
    Trail,
    WeaponMelee,
    WeaponRanged,
    CloseCombatMonster,
    FastTravelLink,
    PvpArenaLink
}

impl Default for Species {
    fn default() -> Self {
        SPECIES_NONE
    }
}

impl Species {
    pub fn localized_name(&self) -> String {
        self.name.localized()
    }
}

impl Species {
    pub fn make_entity(&self) -> Entity {
        let sprite = self.make_sprite();
        let original_sprite_frame = sprite.frame; 
        let initial_speed = self.movement_directions.initial_speed(self.base_speed);
        
        Entity {
            id: self.next_entity_id(),
            frame: self.sprite_frame,  
            species_id: self.id,  
            entity_type: self.entity_type,
            direction: Direction::Down,
            current_speed: initial_speed,
            is_rigid: self.is_rigid,
            z_index: self.z_index,
            sprite,
            dialogues: vec![],
            time_immobilized: 0.0,
            name: self.name.localized(),
            destination: None,
            lock_type: self.lock_type,
            original_sprite_frame,
            remaining_lifespan: UNLIMITED_LIFESPAN,
            action_cooldown_remaining: 0.0,
            parent_id: NO_PARENT,
            is_dying: false,
            speed_multiplier: 1.0,
            is_invulnerable: false,
            demands_attention: false,
            is_consumable: self.is_consumable,
            movement_directions: self.movement_directions,
            display_conditions: vec![],
            after_dialogue: AfterDialogueBehavior::Nothing,
            is_in_interaction_range: false,
            is_equipped: false,
            hp: self.hp,
            dps: self.dps,
            sorting_key: 0,
            player_index: 0,
            species: self.clone(),
            reset_offset_on_next_direction_change: false
        }
    }

    pub fn reload_props(&self, entity: &mut Entity) {
        let sprite = self.make_sprite();      
        let initial_speed = self.movement_directions.initial_speed(self.base_speed);

        entity.frame.w = sprite.frame.w * self.scale;  
        entity.frame.h = sprite.frame.h * self.scale;  
        entity.original_sprite_frame = sprite.frame;
        entity.entity_type = self.entity_type;
        entity.is_rigid = self.is_rigid;
        
        if entity.is_player() {
            entity.sprite.reset();
        } else {
            entity.sprite = sprite;
        }
        entity.name = self.name.localized();
        entity.action_cooldown_remaining = 0.0;
        entity.speed_multiplier = 1.0;
        entity.is_consumable = self.is_consumable;
        entity.is_invulnerable = self.is_invulnerable;
        entity.z_index = self.z_index;
        entity.movement_directions = self.movement_directions;
        entity.hp = self.hp;
        entity.species = self.clone();

        if entity.parent_id == NO_PARENT {
            entity.current_speed = initial_speed;
            entity.dps = self.dps;
        }
    }

    pub fn inventory_sprite_frame(&self) -> FRect {
        FRect::new(self.inventory_texture_offset.1, self.inventory_texture_offset.0, 1.0, 1.0)
    }

    fn make_sprite(&self) -> AnimatedSprite {
        AnimatedSprite::new(
            self.sprite_sheet_id,
            self.sprite_frame,
            self.sprite_number_of_frames
        )
    }

    fn next_entity_id(&self) -> u32 {
        match self.entity_type {
            EntityType::Hero => PLAYER1_ENTITY_ID,
            _ => get_next_id()
        }
    }
}

lazy_static! {
    pub static ref ALL_SPECIES: Vec<Species> = {
        println!("Parsing species from {:#?}", config().species_path.clone());
        let mut file = File::open(config().species_path.clone()).expect("Could not open species.json");
        let mut data = String::new();
        file.read_to_string(&mut data).expect("Could not read species.json");
        serde_json::from_str(&data).expect("Error parsing species.json")
    };
}

lazy_static! {
    pub static ref ALL_EQUIPMENT_IDS: Vec<u32> = {
        ALL_SPECIES.iter().filter_map(|s| {
            if matches!(s.entity_type, EntityType::WeaponMelee | EntityType::WeaponRanged) {
                Some(s.id)
            } else {
                None
            }       
        })
        .collect()
    };
}

const SPECIES_NONE: Species = Species {
    id: 0,
    name: String::new(),
    entity_type: EntityType::Npc,
    z_index: 1000,
    scale: 1.0,
    base_speed: 0.0,
    is_rigid: false,
    inventory_texture_offset: (0.0, 0.0),
    sprite_frame: FRect::new(0.0, 0.0, 0.0, 0.0),
    sprite_sheet_id: SPRITE_SHEET_BIOME_TILES,
    sprite_number_of_frames: 1,
    lock_type: LockType::None,
    melee_attacks_hero: false,
    is_consumable: false,
    bundle_contents: vec![],
    is_invulnerable: false,
    movement_directions: MovementDirections::None,
    hp: one_hundred(),
    dps: zero(),
    bullet_species_id: 0,
    bullet_lifespan: 0.0,
    cooldown_after_use: 0.0,
    equipment_usage_sound_effect: None,
    associated_weapon: None,
    supports_bullet_boomerang: false,
    supports_bullet_catching: false,
    received_damage_reduction: 0.0,
    always_in_front_of_hero_when_equipped: false,
    ranged_dps_multiplier: 1.0,
    melee_dps_multiplier: 1.0,
};

pub fn species_by_id(species_id: u32) -> Species {
    ALL_SPECIES.iter().find(|s| s.id == species_id).cloned().unwrap_or(SPECIES_NONE)
}

pub fn make_entity_by_species(species_id: u32) -> Entity {
    species_by_id(species_id).make_entity()
}

fn one() -> f32 {
    1.0
}

const fn zero() -> f32 {
    0.0
}

const fn zero_i32() -> i32 {
    0
}

const fn zero_u32() -> u32 {
    0
}

const fn one_hundred() -> f32 {
    100.0
}