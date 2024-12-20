use crate::utils::{directions::Direction, rect::IntRect, vector::Vector2d};
use super::entity::Entity;

#[derive(Debug, Copy, Clone)]
pub struct EntityProps {
    pub id: u32,
    pub direction: Direction,
    pub frame: IntRect,
    pub offset: Vector2d,
    pub speed: f32,
    pub hittable_frame: IntRect,
    pub is_invulnerable: bool,
    pub hp: f32,
}

impl Default for EntityProps {
    fn default() -> Self {
        Self { 
            id: 0,
            direction: Default::default(), 
            frame: IntRect::square_from_origin(1), 
            offset: Vector2d::zero(),
            speed: 0.0,
            hittable_frame: IntRect::square_from_origin(1),
            is_invulnerable: false,
            hp: 0.0
        }
    }
}

impl Entity {
    pub fn props(&self) -> EntityProps {
        EntityProps {
            id: self.id,
            frame: self.frame,
            direction: self.direction,
            offset: self.offset,
            speed: self.current_speed,
            is_invulnerable: self.is_invulnerable,            
            hittable_frame: self.hittable_frame(),
            hp: self.hp
        }            
    }
}