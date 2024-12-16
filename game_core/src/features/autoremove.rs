use crate::{constants::UNLIMITED_LIFESPAN, features::{entity::Entity, state_updates::WorldStateUpdate}};


impl Entity {
    pub fn check_remaining_lifespan(&mut self, time_since_last_update: f32) -> Vec<WorldStateUpdate> { 
        if self.remaining_lifespan == UNLIMITED_LIFESPAN {
            return vec![]
        }

        self.remaining_lifespan -= time_since_last_update;

        if self.remaining_lifespan < 0.0 {
            vec![WorldStateUpdate::RemoveEntity(self.id)]
        } else {
            vec![]
        }
    }
}