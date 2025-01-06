use crate::utils::{rect::FRect, vector::Vector2d};
use super::entity::Entity;

#[derive(Debug, Copy, Clone)]
pub struct EntityProps {
    pub id: u32,
    pub direction: Vector2d,
    pub frame: FRect,
    pub z_index: i32,
    pub sorting_key: u32,
    pub speed: f32,
    pub hittable_frame: FRect,
    pub is_invulnerable: bool,
    pub hp: f32,
}

impl Default for EntityProps {
    fn default() -> Self {
        Self { 
            id: 0,
            direction: Default::default(), 
            frame: FRect::square_from_origin(1.0), 
            speed: 0.0,
            hittable_frame: FRect::square_from_origin(1.0),
            is_invulnerable: false,
            hp: 0.0,
            z_index: 0,
            sorting_key: 0
        }
    }
}

impl Entity {
    pub fn props(&self) -> EntityProps {
        EntityProps {
            id: self.id,
            frame: self.frame,
            direction: self.direction,
            speed: self.current_speed,
            is_invulnerable: self.is_invulnerable,            
            hittable_frame: self.hittable_frame(),
            hp: self.hp,
            z_index: self.z_index,
            sorting_key: self.sorting_key
        }            
    }
}