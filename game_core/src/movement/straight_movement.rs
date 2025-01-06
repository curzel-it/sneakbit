use crate::{config::config, constants::{PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TILE_SIZE}, features::entity::Entity, utils::{rect::FRect, vector::Vector2d}, worlds::world::World};


impl Entity {
    pub fn projected_frames_by_moving_straight(&self, direction: &Vector2d, time_since_last_update: f32) -> (FRect, FRect) {
        let base_speed = config().base_entity_speed;
        let dx = direction.x * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let dy = direction.y * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let next = self.frame.offset(dx, dy);
        let next_hittable = self.hittable_frame().offset(dx, dy);
        (next, next_hittable)
    }

    pub fn next_direction_options(&self) -> Vec<Vector2d> {
        vec![
            Vector2d::right(),
            Vector2d::left()
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
        if self.current_speed == 0.0 || self.direction == Vector2d::zero() {
            return
        }
        let (next, next_collidable) = self.projected_frames_by_moving_straight(&self.direction, time_since_last_update);

        if !world.bounds.contains(&next_collidable) {
            return
        }

        self.frame = next;
    } 
}