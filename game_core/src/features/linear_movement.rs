use crate::{config::config, constants::{PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TILE_SIZE}, entities::known_species::is_monster, features::entity::Entity, utils::{directions::Direction, math::ZeroComparable}, worlds::world::World};

use super::movements::MovementDirections;

impl Entity {
    pub fn move_linearly(&mut self, world: &World, time_since_last_update: f32) { 
        if self.current_speed == 0.0 || matches!(self.direction, Direction::Unknown | Direction::Still) {
            return
        }
        
        let d = self.direction.as_vector();
        let base_speed = config().base_entity_speed;
        let dx = d.x * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let dy = d.y * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;

        if dx.is_zero() && dy.is_zero() {
            return
        }

        let next_collidable_frame = self.hittable_frame().offset(dx, dy);

        if !world.bounds.contains(&next_collidable_frame) {
            return
        }

        let exclude = if is_monster(self.species_id) { 
            vec![self.id, PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID]
        } else {
            vec![self.id] 
        };
        
        if matches!(self.movement_directions, MovementDirections::Keyboard) {
            if world.area_hits(&exclude, &next_collidable_frame) {
                if world.frame_is_slippery_surface(&self.hittable_frame()) {
                    self.current_speed = 0.0;
                }
                return
            }
        }

        self.frame = self.frame.offset(dx, dy);      
        
        if !self.is_equipment() {  
            self.update_sorting_key();
        }
    } 
}