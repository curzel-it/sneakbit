use crate::{entities::{known_species::SPECIES_FOOTSTEPS, species::species_by_id}, features::{entity::Entity, state_updates::WorldStateUpdate}, maps::biomes::Biome, utils::vector::Vector2d, worlds::world::World};

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

pub fn leave_footsteps(world: &World, direction: &Vector2d, x: f32, y: f32) -> Vec<WorldStateUpdate> {
    vec![]
}

impl Biome {
    fn supports_trails(&self) -> bool {
        matches!(self, Biome::Snow)
    }
}