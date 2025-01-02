use crate::{config::config, constants::{PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TILE_SIZE}, features::entity::Entity, utils::{directions::Direction, rect::FRect}, worlds::world::World};

use super::movement_directions::MovementDirections;

impl Entity {
    pub fn projected_frames_by_moving_straight(&self, direction: &Direction, time_since_last_update: f32) -> (FRect, FRect) {
        let base_speed = config().base_entity_speed;
        let d = direction.as_vector();
        let dx = d.x * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let dy = d.y * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let next = self.frame.offset(dx, dy);
        let next_hittable = self.hittable_frame().offset(dx, dy);
        (next, next_hittable)
    }

    pub fn next_direction_options(&self) -> Vec<Direction> {
        vec![
            self.direction,
            self.direction.turn_right(),
            self.direction.turn_left(),
            self.direction.opposite(),
        ]
    }

    pub fn my_and_players_ids(&self) -> Vec<u32> {
        vec![
            self.id, 
            PLAYER1_ENTITY_ID, 
            PLAYER2_ENTITY_ID, 
            PLAYER3_ENTITY_ID, 
            PLAYER4_ENTITY_ID
        ]
    }

    pub fn move_straight(&mut self, world: &World, time_since_last_update: f32) { 
        if self.current_speed == 0.0 || matches!(self.direction, Direction::Unknown | Direction::Still) {
            return
        }
        let (next, next_collidable) = self.projected_frames_by_moving_straight(&self.direction, time_since_last_update);

        if !world.bounds.contains(&next_collidable) {
            return
        }

        if matches!(self.movement_directions, MovementDirections::Keyboard) {
            if world.area_hits(&self.my_and_players_ids(), &next_collidable) {
                if world.frame_is_slippery_surface(&self.hittable_frame()) {
                    self.current_speed = 0.0;
                }
                return
            }
        }

        self.frame = next;
        self.update_sorting_key();
    } 
}