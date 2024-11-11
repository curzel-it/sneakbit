use crate::{entities::{known_species::SPECIES_HERO, species::make_entity_by_species}, game_engine::world::World, utils::directions::Direction};

impl World {
    pub fn setup(&mut self, source: u32, hero_direction: &Direction, original_x: i32, original_y: i32, direction: Direction) {
        self.remove_hero();
        self.visible_entities = self.compute_visible_entities(&self.bounds);
        self.update_tiles_hitmap();
        self.update_hitmaps();

        let (x, y) = self.destination_x_y(source, original_x, original_y);       
        println!("Spawning hero at {}, {}", x, y); 
        let mut entity = make_entity_by_species(SPECIES_HERO);
        
        entity.frame.x = x;
        entity.frame.y = y;

        if !matches!(direction, Direction::Unknown | Direction::Still) {
            entity.direction = direction;
        } else {
            entity.direction = Direction::Down;

            for new_direction in &self.likely_direction_for_hero(x, y, hero_direction) {
                if self.has_space_for_hero_in_direction(x, y, new_direction) {
                    let (ox, oy) = new_direction.as_col_row_offset();
                    entity.frame.x = x + ox;
                    entity.frame.y = y - 1 + oy;
                    entity.direction = *new_direction;
                    break
                }
            }
        }   
        entity.immobilize_for_seconds(0.2);
        self.cached_hero_props = entity.props();
        self.add_entity(entity);
    }    

    pub fn set_creative_mode(&mut self, enabled: bool) {
        self.creative_mode = enabled;
        self.entities.borrow_mut().iter_mut().for_each(|e| e.setup(enabled));
    }

    fn likely_direction_for_hero(&self, x: i32, y: i32, current_direction: &Direction) -> Vec<Direction> {
        let mut options: Vec<Direction> = vec![];


        let going_horizontally = matches!(current_direction, Direction::Left | Direction::Right);
        let going_left = matches!(current_direction, Direction::Left);
        let horizontal = if going_left || (!going_horizontally && x > self.bounds.w / 2) {
            vec![Direction::Left, Direction::Right]
        } else {
            vec![Direction::Right, Direction::Left]
        };

        let going_vertically = matches!(current_direction, Direction::Left | Direction::Right);
        let going_up = matches!(current_direction, Direction::Up);
        let vertical = if going_up || (!going_vertically && y > self.bounds.h / 2) {
            vec![Direction::Up, Direction::Down]
        } else {
            vec![Direction::Down, Direction::Up]
        };

        if self.is_interior {
            options.extend(vertical);
            options.extend(horizontal);
        } else {
            options.extend(horizontal);
            options.extend(vertical);
        }

        options
    }

    fn has_space_for_hero_in_direction(&self, x: i32, y: i32, direction: &Direction) -> bool {
        let (ox, oy) = direction.as_col_row_offset();
        let x = x + ox;
        let y = y + 1 + oy;
        let x2 = x + ox;
        let y2 = y + oy;
        let x3 = x2 + ox;
        let y3 = y2+ oy;

        if y >= 0 && y <= (self.hitmap.len() - 1) as i32 {
            if x >= 0 && x <= (self.hitmap[0].len() - 1) as i32 {
                if y2 >= 0 && y2 <= (self.hitmap.len() - 1) as i32 {
                    if x2 >= 0 && x2 <= (self.hitmap[0].len() - 1) as i32 {
                        if y3 >= 0 && y3 <= (self.hitmap.len() - 1) as i32 {
                            if x3 >= 0 && x3 <= (self.hitmap[0].len() - 1) as i32 {
                                return !self.hitmap[y as usize][x as usize] && !self.hitmap[y2 as usize][x2 as usize] && !self.hitmap[y3 as usize][x3 as usize]
                            }
                        }
                    }
                }
            }
        }
        false
    }

    fn destination_x_y(&self, source: u32, original_x: i32, original_y: i32) -> (i32, i32) {
        if original_x == 0 && original_y == 0 {            
            if let Some(teleporter_position) = self.find_teleporter_for_destination(source) {
                (teleporter_position.x, teleporter_position.y)
            } else if let Some(teleporter_position) = self.find_any_teleporter() {
                (teleporter_position.x, teleporter_position.y)
            } else {
                let x = self.bounds.w / 2;
                let mut y = self.bounds.h / 2;

                while y < self.bounds.h - 1 && self.hitmap[y as usize][x as usize] {
                    y += 1
                }
                return (x, y)
            }
        } else {
            let actual_x = original_x.min(self.bounds.x + self.bounds.w - 1).max(self.bounds.x - 1);
            let actual_y = original_y.min(self.bounds.y + self.bounds.h - 1).max(self.bounds.y - 1);
            (actual_x, actual_y)
        }
    }
}

