use serde::{Deserialize, Serialize};

use crate::{features::entity::Entity, is_creative_mode, worlds::world::World};

#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize)]
pub enum MovementDirections {
    Keyboard,
    Free,
    FindHero,
    #[default]
    None,
}

impl MovementDirections {
    pub fn initial_speed(&self, speed: f32) -> f32 {
        match self {
            MovementDirections::None => 0.0,
            MovementDirections::Keyboard => 0.0,
            MovementDirections::Free => speed,
            MovementDirections::FindHero => speed,
        }
    }
}

impl Entity {
    pub fn perform_movement(&mut self, world: &World, time_since_last_update: f32) {
        if is_creative_mode() {
            return
        }
        match self.movement_directions {
            MovementDirections::None => self.move_with_new_direction(self.direction, world, time_since_last_update),
            MovementDirections::Keyboard => self.move_based_on_player_input(world, time_since_last_update),
            MovementDirections::Free => self.move_around_free(world, time_since_last_update),
            MovementDirections::FindHero =>  self.move_chasing_player(world, time_since_last_update)
        }
        self.update_sorting_key();
    }
}