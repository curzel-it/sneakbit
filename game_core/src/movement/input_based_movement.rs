use crate::{features::entity::Entity, utils::{directions::Direction, math::ZeroComparable}, worlds::world::World};

impl Entity {
    pub fn move_based_on_player_input(&mut self, world: &World, time_since_last_update: f32) { 
        self.time_immobilized -= time_since_last_update;
        if self.time_immobilized > 0.0 {            
            return;
        }

        self.update_direction_based_on_keyboard(world);

        if self.current_speed == 0.0 || matches!(self.direction, Direction::None) {
            return
        }

        let (next, next_collidable_frame) = self.projected_frames_by_moving_straight(&self.direction, time_since_last_update);

        if world.area_hits_or_out_of_bounds(&vec![self.id], &next_collidable_frame) {
            if world.frame_is_slippery_surface(&self.hittable_frame()) {
                self.current_speed = 0.0;
            }
            return
        }

        self.frame = next;
    }

    fn update_direction_based_on_keyboard(&mut self, world: &World) {
        if world.frame_is_slippery_surface(&self.hittable_frame()) && !self.current_speed.is_zero() {
            return
        }

        let new_direction = world.players[self.player_index].direction_based_on_current_keys;
        
        if !matches!(new_direction, Direction::None) {
            self.direction = new_direction;
            self.reset_speed();
        } else {
            self.current_speed = 0.0;
        } 
    } 
}