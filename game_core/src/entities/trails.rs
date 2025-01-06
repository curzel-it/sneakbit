use crate::{features::{entity::Entity, state_updates::WorldStateUpdate}, utils::vector::Vector2d, worlds::world::World};

impl Entity {
    pub fn update_trail(&mut self) -> Vec<WorldStateUpdate> {  
        self.update_sprite_for_direction_speed(self.direction, 0.0);

        if (self.sprite.frame.x - self.sprite.original_frame.x) >= 13.9 {
            vec![WorldStateUpdate::RemoveEntity(self.id)]
        } else {
            vec![]
        }
    }
}

pub fn leave_footsteps(_: &World, _: &Vector2d, _: f32, _: f32) -> Vec<WorldStateUpdate> {
    vec![]
}