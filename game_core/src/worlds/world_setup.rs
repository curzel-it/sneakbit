use crate::{constants::{WORLD_ID_DEMO, WORLD_SIZE_COLUMNS, WORLD_SIZE_ROWS}, entities::{known_species::SPECIES_HERO, species::make_entity_by_species}, game_engine::world::World, utils::directions::Direction};

impl World {
    pub fn setup(&mut self, source: u32, hero_direction: &Direction, original_x: i32, original_y: i32) {
        self.update_tiles_hitmap();
        self.update_hitmaps();

        let (x, y) = self.destination_x_y(source, original_x, original_y);        
        let mut entity = make_entity_by_species(SPECIES_HERO);

        if y > 0 && !self.hitmap[(y + 1) as usize][x as usize] {
            entity.frame.x = x;
            entity.frame.y = y;
            entity.direction = *hero_direction;
        } else if y > 0 && !self.hitmap[(y + 2) as usize][x as usize] {
            entity.frame.x = x;
            entity.frame.y = y + 2;
            entity.direction = Direction::Down;
        } else if y >= 2 && !self.hitmap[(y - 2) as usize][x as usize] {
            entity.frame.x = x;
            entity.frame.y = y - 2;
            entity.direction = Direction::Up;
        } else {
            entity.frame.x = x;
            entity.frame.y = y;
            entity.direction = Direction::Down;
        }
        
        entity.immobilize_for_seconds(0.2);
        self.cached_hero_props = entity.props();
        self.add_entity(entity);
    }    

    pub fn set_creative_mode(&mut self, enabled: bool) {
        self.creative_mode = enabled;
        self.entities.borrow_mut().iter_mut().for_each(|e| e.setup(enabled));
    }

    fn destination_x_y(&self, source: u32, original_x: i32, original_y: i32) -> (i32, i32) {
        if original_x == 0 && original_y == 0 {            
            if let Some(teleporter_position) = self.find_teleporter_for_destination(source) {
                (teleporter_position.x, teleporter_position.y)
            } else if self.id == WORLD_ID_DEMO {
                (59, 41)
            } else if let Some(teleporter_position) = self.find_any_teleporter() {
                (teleporter_position.x, teleporter_position.y)
            } else {
                (WORLD_SIZE_COLUMNS as i32 / 2, WORLD_SIZE_ROWS as i32 / 2)
            }
        } else {
            println!("Using original {} {}", original_x, original_y);
            (original_x, original_y)
        }
    }
}

