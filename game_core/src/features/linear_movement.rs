use crate::{config::config, constants::TILE_SIZE, features::entity::Entity, utils::directions::Direction, worlds::world::World};

impl Entity {
    pub fn move_linearly(&mut self, world: &World, time_since_last_update: f32) { 
        if self.current_speed == 0.0 || matches!(self.direction, Direction::Unknown) {
            return
        }
        
        let d = self.direction.as_vector();
        let base_speed = config().base_entity_speed;
        let mut dx = d.x * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let mut dy = d.y * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let next_collidable_frame = self.hittable_frame().offset(dx, dy);

        if !world.bounds.contains(&next_collidable_frame) {
            return
        }
        if self.is_rigid {
            if world.area_hits(&self.id, &next_collidable_frame) {
                let next_collidable_frame_x_only = self.hittable_frame().offset_x(dx);
                let next_collidable_frame_y_only = self.hittable_frame().offset_y(dy);

                if !world.area_hits(&self.id, &next_collidable_frame_x_only) { 
                    dy = 0.0;
                } else if !world.area_hits(&self.id, &next_collidable_frame_y_only) { 
                    dx = 0.0;
                } else if self.is_player() && world.frame_is_slippery_surface(&self.hittable_frame()) {
                    self.current_speed = 0.0;
                    return
                } else {
                    return
                }
            }
            // if !can_step_over_hero(self) && would_collide_with_hero(&frame, &self.direction, world) {
            //    println!("#{} Would step over hero, skipping", self.id);
            //    return
            // }
        }

        self.frame = self.frame.offset(dx, dy);        
    } 
}