use crate::{features::entity::Entity, utils::vector::Vector2d, worlds::world::World};

impl Entity {
    pub fn move_around_free(&mut self, world: &World, time_since_last_update: f32) {
        let sign = self.direction.x.signum();
        let did_move = self.move_in_current_direction(world, time_since_last_update);
        if !did_move {
            self.direction = Vector2d::new(sign * -1.0, self.direction.y);
        }
    }
}