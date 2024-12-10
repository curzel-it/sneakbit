use serde::{Deserialize, Serialize};
use lazy_static::lazy_static;
use std::fs::File;
use std::io::Read;

use crate::{config::config, constants::{PLAYER1_ENTITY_ID, NO_PARENT, SPRITE_SHEET_BIOME_TILES, UNLIMITED_LIFESPAN}, features::animated_sprite::AnimatedSprite, features::dialogues::AfterDialogueBehavior, game_engine::directions::MovementDirections, game_engine::entity::Entity, game_engine::locks::LockType, lang::localizable::LocalizableText, utils::directions::Direction, utils::ids::get_next_id, utils::rect::IntRect, utils::vector::Vector2d};

pub type SpeciesId = u32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Species {
    pub id: SpeciesId,
    pub name: String,
    pub entity_type: EntityType,
    pub base_speed: f32,
    pub is_rigid: bool,
    pub inventory_texture_offset: (i32, i32),
    pub sprite_frame: IntRect,
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
    Equipment,
    Sword,
    KunaiLauncher,
    CloseCombatMonster
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
        let initial_speed = self.movement_directions.initial_speed(self.base_speed);
        
        Entity {
            id: self.next_entity_id(),
            frame: self.sprite_frame,  
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
            player_index: 0
        }
    }

    pub fn reload_props(&self, entity: &mut Entity) {
        let sprite = self.make_sprite(false);      
        let initial_speed = self.movement_directions.initial_speed(self.base_speed);

        entity.frame.w = (sprite.frame.w as f32 * self.scale) as i32;  
        entity.frame.h = (sprite.frame.h as f32 * self.scale) as i32;  
        entity.offset = Vector2d::zero();
        entity.original_sprite_frame = sprite.frame;
        entity.entity_type = self.entity_type;
        entity.is_rigid = self.is_rigid;
        entity.sprite = sprite;
        entity.name = self.name.localized();
        entity.action_cooldown_remaining = 0.0;
        entity.speed_multiplier = 1.0;
        entity.is_consumable = self.is_consumable;
        entity.is_invulnerable = self.is_invulnerable;
        entity.z_index = self.z_index;
        entity.movement_directions = self.movement_directions;
        entity.hp = self.hp;
        entity.dps = self.dps;

        if entity.parent_id == NO_PARENT {
            entity.current_speed = initial_speed;
        }
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

pub const SPECIES_NONE: Species = Species {
    id: 0,
    name: String::new(),
    entity_type: EntityType::Npc,
    z_index: 1000,
    scale: 1.0,
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
    movement_directions: MovementDirections::None,
    hp: one_hundred(),
    dps: zero(),
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

const fn one_hundred() -> f32 {
    100.0
}