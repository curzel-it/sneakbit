use serde::{Deserialize, Serialize};

use crate::{constants::UNLIMITED_LIFESPAN, dialogues::models::{Dialogue, EntityDialogues}, entities::species::{species_by_id, EntityType}, features::{animated_sprite::AnimatedSprite, destination::Destination, directions::MovementDirections}, lang::localizable::LocalizableText, utils::{directions::Direction, rect::IntRect, vector::Vector2d}};

use super::{locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::get_value_for_key, world::World};

#[derive(Debug, Copy, Clone)]
pub struct EntityProps {
    pub direction: Direction,
    pub frame: IntRect,
    pub offset: Vector2d,
    pub speed: f32,
    pub hittable_frame: IntRect,
    pub is_invulnerable: bool,
}

impl Default for EntityProps {
    fn default() -> Self {
        Self { 
            direction: Default::default(), 
            frame: IntRect::square_from_origin(1), 
            offset: Vector2d::zero(),
            speed: 0.0,
            hittable_frame: IntRect::square_from_origin(1),
            is_invulnerable: false,
        }
    }
}

pub type EntityId = u32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: EntityId,
    pub frame: IntRect,  
    pub name: String,  
    pub species_id: u32,  
    pub entity_type: EntityType,  
    pub offset: Vector2d,
    pub direction: Direction,
    pub current_speed: f32,
    pub is_rigid: bool,
    pub z_index: i32,
    pub sprite: AnimatedSprite,
    pub dialogues: EntityDialogues,
    pub time_immobilized: f32,
    pub destination: Option<Destination>,
    pub lock_type: LockType,
    pub original_sprite_frame: IntRect,

    #[serde(default)]
    pub movement_directions: MovementDirections,

    #[serde(default)]
    pub is_consumable: bool,
    
    #[serde(default="one")]
    pub speed_multiplier: f32,

    #[serde(default)]
    pub melee_attacks_hero: bool,
    
    #[serde(default)]
    pub is_dying: bool,

    #[serde(default)]
    pub latest_movement: (i32, i32),  

    #[serde(default)]
    pub contents: Option<String>,  

    #[serde(default="unlimited_lifespan")]
    pub remaining_lifespan: f32,  

    #[serde(default)]
    pub shooting_cooldown_remaining: f32,  

    #[serde(default)]
    pub parent_id: u32,  

    #[serde(default)]
    pub is_invulnerable: bool,

    #[serde(default)]
    pub demands_attention: bool,
}

fn unlimited_lifespan() -> f32 {
    UNLIMITED_LIFESPAN
}

fn one() -> f32 {
    1.0
}

impl Entity {
    pub fn update(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {      
        let mut updates = match self.entity_type {
            EntityType::Hero => self.update_hero(world, time_since_last_update),
            EntityType::Npc => self.update_npc(world, time_since_last_update),
            EntityType::Building => self.update_building(world, time_since_last_update),
            EntityType::StaticObject => self.update_static(world, time_since_last_update),
            EntityType::PickableObject | EntityType::Bundle => self.update_pickable_object(world, time_since_last_update),
            EntityType::Teleporter => self.update_teleporter(world, time_since_last_update),
            EntityType::PushableObject => self.update_pushable(world, time_since_last_update),
            EntityType::Gate => self.update_gate(world, time_since_last_update),
            EntityType::InverseGate => self.update_inverse_gate(world, time_since_last_update),
            EntityType::PressurePlate => self.update_pressure_plate(world, time_since_last_update),
            EntityType::Bullet => self.update_bullet(world, time_since_last_update),
            EntityType::RailObject => self.update_rail(world, time_since_last_update),
            EntityType::Hint => self.update_hint(world, time_since_last_update),
        };        
        self.sprite.update(time_since_last_update); 
        let mut more_updates = self.check_remaining_lifespan(time_since_last_update);
        updates.append(&mut more_updates);
        updates
    }

    pub fn setup(&mut self, creative_mode: bool) {      
        species_by_id(self.species_id).reload_props(self);
        
        match self.entity_type {
            EntityType::Hero => self.setup_hero(creative_mode),
            EntityType::Npc => self.setup_npc(),
            EntityType::Building => self.setup_generic(creative_mode),
            EntityType::StaticObject => self.setup_generic(creative_mode),
            EntityType::PickableObject | EntityType::Bundle => self.setup_generic(creative_mode),
            EntityType::Teleporter => self.setup_teleporter(creative_mode),
            EntityType::PushableObject => self.setup_generic(creative_mode),
            EntityType::Gate => self.setup_gate(creative_mode),
            EntityType::InverseGate => self.setup_inverse_gate(creative_mode),
            EntityType::PressurePlate => self.setup_pressure_plate(),
            EntityType::Bullet => self.setup_bullet(),
            EntityType::RailObject => self.setup_rail(),
            EntityType::Hint => self.setup_hint(creative_mode),
        }
    }

    pub fn sprite_sheet(&self) -> u32 {
        self.sprite.sheet_id
    }

    pub fn texture_source_rect(&self) -> IntRect {
        self.sprite.texture_source_rect()
    }

    pub fn immobilize_for_seconds(&mut self, seconds: f32) {
        self.time_immobilized = seconds;
    }

    pub fn reset_speed(&mut self) {        
        self.current_speed = self.speed_multiplier * species_by_id(self.species_id).base_speed;
    }    
    
    pub fn next_dialogue(&self, world: &World) -> Option<Dialogue> {
        for option in &self.dialogues {
            let value = if option.key.contains("pressure_plate_down") {
                let lock_name = option.key.replace("pressure_plate_down_", "");
                let lock_type = LockType::from_string(&lock_name);
                
                if world.is_pressure_plate_down(&lock_type) {
                    Some(1)
                } else {
                    Some(0)
                }
            } else {
                get_value_for_key(&option.key)
            };
            
            if value == Some(option.expected_value) || (option.expected_value == 0 && value.is_none()) {
                return Some(option.clone())
            }
        }
        None
    }

    pub fn props(&self) -> EntityProps {
        let x_offset = (self.sprite.frame.w - 1) / 2;
        let y_offset = if self.sprite.frame.h > 1 { 1 } else { 0 };
        let height = if self.sprite.frame.h > 1 { self.sprite.frame.h - 1 } else { self.sprite.frame.h };

        EntityProps {
            frame: self.frame,
            direction: self.direction,
            offset: self.offset,
            speed: self.current_speed,
            is_invulnerable: self.is_invulnerable,
            hittable_frame: IntRect {
                x: self.frame.x + x_offset,
                y: self.frame.y + y_offset,
                w: self.sprite.frame.w,
                h: height,
            },
        }            
    }

    pub fn is_at_the_edge_of_the_world(&self, bounds: &IntRect) -> bool {
        if self.frame.x <= bounds.x { return true }
        if self.frame.y <= bounds.y { return true }
        if self.frame.x + self.frame.w >= bounds.x + bounds.w { return true }
        if self.frame.y + self.frame.h >= bounds.y + bounds.h { return true }
        false
    }
}

impl Entity {
    fn setup_generic(&mut self, creative_mode: bool) {
        if creative_mode {
            self.is_rigid = false
        }
    }

    fn update_static(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {  
        if world.is_hero_around_and_on_collision_with(&self.frame) {
            if let Some(contents) = self.contents.clone() {
                return vec![
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::DisplayLongText(
                            contents.localized()
                        )
                    )
                ];   
            }
        }
        vec![]
    }
}