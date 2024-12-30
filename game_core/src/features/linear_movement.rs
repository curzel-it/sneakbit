use crate::{config::config, constants::{PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TILE_SIZE}, entities::known_species::is_monster, features::entity::Entity, utils::{directions::Direction, math::ZeroComparable}, worlds::world::World};

use super::movements::MovementDirections;

impl Entity {
    pub fn move_linearly(&mut self, world: &World, time_since_last_update: f32) { 
        if self.current_speed == 0.0 || matches!(self.direction, Direction::Unknown | Direction::Still) {
            return
        }
        
        let d = self.direction.as_vector();
        let base_speed = config().base_entity_speed;
        let mut dx = d.x * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let mut dy = d.y * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;

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
                let next_collidable_frame_x_only = self.hittable_frame().offset_x(dx);
                let next_collidable_frame_y_only = self.hittable_frame().offset_y(dy);

                if !world.area_hits(&exclude, &next_collidable_frame_x_only) { 
                    dy = 0.0;
                } else if !world.area_hits(&exclude, &next_collidable_frame_y_only) { 
                    dx = 0.0;
                } else if self.is_player() && world.frame_is_slippery_surface(&self.hittable_frame()) {
                    self.current_speed = 0.0;
                    return
                } else {
                    return
                }
            }
        }

        self.frame = self.frame.offset(dx, dy);      
        
        if !self.is_equipment() {  
            self.update_sorting_key();
        }
    } 
}