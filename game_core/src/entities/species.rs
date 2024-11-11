use serde::{Deserialize, Serialize};
use lazy_static::lazy_static;
use std::fs::File;
use std::io::Read;
use crate::config::config;
use crate::constants::{HERO_ENTITY_ID, NO_PARENT, SPRITE_SHEET_BIOME_TILES, UNLIMITED_LIFESPAN};
use crate::features::animated_sprite::AnimatedSprite;
use crate::features::directions::MovementDirections;
use crate::game_engine::entity::Entity;
use crate::game_engine::locks::LockType;
use crate::lang::localizable::LocalizableText;
use crate::utils::directions::Direction;
use crate::utils::ids::get_next_id;
use crate::utils::rect::IntRect;
use crate::utils::vector::Vector2d;

pub type SpeciesId = u32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Species {
    pub id: SpeciesId,
    pub name: String,
    pub entity_type: EntityType,
    pub z_index: i32,
    pub base_speed: f32,
    pub is_rigid: bool,
    pub inventory_texture_offset: (i32, i32),
    pub sprite_frame: IntRect,
    pub sprite_sheet_id: u32,
    pub sprite_number_of_frames: i32,
    
    #[serde(default)]
    pub movement_directions: MovementDirections,
    
    #[serde(default)]
    pub lock_type: LockType,

    #[serde(default)]
    pub is_consumable: bool,

    #[serde(default)]
    pub melee_attacks_hero: bool,

    #[serde(default)]
    pub bundle_contents: Vec<u32>,

    #[serde(default)]
    pub is_invulnerable: bool,
}

#[derive(Debug, Copy, Clone, Hash, PartialEq, Eq, Serialize, Deserialize)]
pub enum EntityType {
    Hero,
    Building,   
    Npc, 
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
    Hint
}

impl Species {
    pub fn localized_name(&self) -> String {
        self.name.localized()
    }
}

impl Species {
    pub fn make_entity(&self) -> Entity {
        let sprite = self.make_sprite(false);
        let original_sprite_frame = sprite.frame; 
        let initial_speed = if self.movement_directions.moves_by_default() { self.base_speed } else { 0.0 };
        
        Entity {
            id: self.next_entity_id(),
            frame: self.sprite_frame,  
            latest_movement: (0, 0),
            species_id: self.id,  
            entity_type: self.entity_type,
            offset: Vector2d::zero(),
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
            contents: None,
            remaining_lifespan: UNLIMITED_LIFESPAN,
            shooting_cooldown_remaining: 0.0,
            parent_id: NO_PARENT,
            is_dying: false,
            melee_attacks_hero: self.melee_attacks_hero,
            speed_multiplier: 1.0,
            is_invulnerable: false,
            demands_attention: false,
            is_consumable: self.is_consumable,
            movement_directions: self.movement_directions,
            display_conditions: vec![],
            vanishes_after_dialogue: false,
        }
    }

    pub fn reload_props(&self, entity: &mut Entity) {
        let sprite = self.make_sprite(false);        
        entity.frame.w = sprite.frame.w;  
        entity.frame.h = sprite.frame.h;  
        entity.offset = Vector2d::zero();
        entity.original_sprite_frame = sprite.frame;
        entity.entity_type = self.entity_type;
        entity.is_rigid = self.is_rigid;
        entity.sprite = sprite;
        entity.name = self.name.localized();
        entity.shooting_cooldown_remaining = 0.0;
        entity.melee_attacks_hero = self.melee_attacks_hero;
        entity.speed_multiplier = 1.0;
        entity.is_consumable = self.is_consumable;
        entity.is_invulnerable = self.is_invulnerable;
        entity.movement_directions = self.movement_directions;
    }

    pub fn inventory_sprite_frame(&self) -> IntRect {
        IntRect::new(self.inventory_texture_offset.1, self.inventory_texture_offset.0, 1, 1)
    }

    fn make_sprite(&self, _: bool) -> AnimatedSprite {
        AnimatedSprite::new(
            self.sprite_sheet_id,
            self.sprite_frame,
            self.sprite_number_of_frames
        )
    }

    fn next_entity_id(&self) -> u32 {
        match self.entity_type {
            EntityType::Hero => HERO_ENTITY_ID,
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

pub const SPECIES_NONE: Species = Species {
    id: 0,
    name: String::new(),
    entity_type: EntityType::Npc,
    z_index: 1000,
    base_speed: 0.0,
    is_rigid: false,
    inventory_texture_offset: (0, 0),
    sprite_frame: IntRect::new(0, 0, 0, 0),
    sprite_sheet_id: SPRITE_SHEET_BIOME_TILES,
    sprite_number_of_frames: 1,
    lock_type: LockType::None,
    melee_attacks_hero: false,
    is_consumable: false,
    bundle_contents: vec![],
    is_invulnerable: false,
    movement_directions: MovementDirections::None
};

pub fn species_by_id(species_id: u32) -> Species {
    ALL_SPECIES.iter().find(|s| s.id == species_id).cloned().unwrap_or(SPECIES_NONE)
}

pub fn make_entity_by_species(species_id: u32) -> Entity {
    species_by_id(species_id).make_entity()
}