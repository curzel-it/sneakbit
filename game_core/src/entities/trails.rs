use crate::{entities::{known_species::SPECIES_FOOTSTEPS, species::species_by_id}, features::{entity::Entity, state_updates::WorldStateUpdate}, maps::biomes::Biome, utils::directions::Direction, worlds::world::World};

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

pub fn leave_footsteps(world: &World, direction: &Direction, x: f32, y: f32) -> Vec<WorldStateUpdate> {
    let biome = world.biome_tiles.tiles[y as usize][x as usize].tile_type;
    
    if biome.supports_trails() {
        let mut footsteps = species_by_id(SPECIES_FOOTSTEPS).make_entity();
        footsteps.frame.x = x;
        footsteps.frame.y = y;
        footsteps.direction = *direction;
        footsteps.current_speed = 0.0;
        footsteps.update_trail();
        vec![WorldStateUpdate::AddEntity(Box::new(footsteps))]
    } else {
        vec![]
    }
}

impl Biome {
    fn supports_trails(&self) -> bool {
        matches!(self, Biome::Snow)
    }
}