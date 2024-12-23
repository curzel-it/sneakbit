use crate::{constants::{PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TILE_SIZE}, current_game_mode, entities::{known_species::SPECIES_HERO, species::{make_entity_by_species, species_by_id, ALL_EQUIPMENT_IDS}}, multiplayer::modes::GameMode, number_of_players, utils::directions::Direction};
use super::{world::World, world_type::WorldType};

impl World {
    pub fn setup(
        &mut self,
        source: u32,
        hero_direction: &Direction,
        original_x: i32,
        original_y: i32,
        direction: Direction,
    ) {
        self.idsmap.reserve(1000);
        self.visible_entities.reserve(1000);

        self.remove_players();
        self.remove_all_equipment();
        self.remove_dying_entities();
        self.update_visible_entities(&self.bounds.clone());
        self.update_tiles_hitmap();
        self.update_hitmaps();
        self.setup_entities();
        self.spawn_players(source, hero_direction, original_x, original_y, direction);
        self.spawn_equipment();
        self.fix_players_hp();
    }

    fn fix_players_hp(&mut self) {
        let hp = current_game_mode().player_hp();
        let mut entities = self.entities.borrow_mut();
        
        for index in self.player_entity_indeces() {
            entities[index].hp = hp;
        }
    }

    fn setup_entities(&mut self) {
        self.entities.borrow_mut().iter_mut().for_each(|e| e.setup());
    }

    fn spawn_players(&mut self, source: u32, hero_direction: &Direction, original_x: i32, original_y: i32, direction: Direction) {
        match current_game_mode() {
            GameMode::Creative | GameMode::RealTimeCoOp => {
                self.spawn_hero_at_last_known_location(source, hero_direction, original_x, original_y, direction);
                self.spawn_coop_players_around_hero();
            }
            GameMode::TurnBasedPvp => {
                self.spawn_players_at_map_corners();
            }
        }
    }

    fn find_spawn_position_from_corner(&self, corner: Corner) -> Option<(i32, i32)> {
        let max_distance = (self.bounds.w.max(self.bounds.h)) as i32;

        for distance in 0..=max_distance {
            let positions = match corner {
                Corner::TopLeft => self.generate_positions(self.bounds.x, self.bounds.y, distance, 1, 1),
                Corner::TopRight => self.generate_positions(self.bounds.x + self.bounds.w - 1, self.bounds.y, distance, -1, 1),
                Corner::BottomLeft => self.generate_positions(self.bounds.x, self.bounds.y + self.bounds.h - 1, distance, 1, -1),
                Corner::BottomRight => self.generate_positions(self.bounds.x + self.bounds.w - 1, self.bounds.y + self.bounds.h - 1, distance, -1, -1),
            };

            for (x, y) in positions {
                if !self.hits(x, y) {
                    return Some((x, y));
                }
            }
        }

        None
    }

    fn generate_positions(&self, start_x: i32, start_y: i32, distance: i32, x_step: i32, y_step: i32) -> Vec<(i32, i32)> {
        let mut positions = Vec::new();

        for dx in 0..=distance {
            let dy = distance - dx;

            let x = start_x + dx * x_step;
            let y = start_y + dy * y_step;

            if x >= self.bounds.x && x < self.bounds.x + self.bounds.w && y >= self.bounds.y && y < self.bounds.y + self.bounds.h {
                positions.push((x, y));
            }

            if dy != 0 {
                let x = start_x + dx * x_step;
                let y = start_y - dy * y_step;

                if x >= self.bounds.x && x < self.bounds.x + self.bounds.w && y >= self.bounds.y && y < self.bounds.y + self.bounds.h {
                    positions.push((x, y));
                }
            }
        }

        positions
    }

    fn spawn_players_at_map_corners(&mut self) {
        let player_ids = self.player_entity_ids();
        let num_players = number_of_players();

        let corners = match num_players {
            1 => vec![Corner::TopLeft],
            2 => vec![Corner::TopLeft, Corner::TopRight],
            3 => vec![Corner::TopLeft, Corner::TopRight, Corner::BottomLeft],
            4 => vec![Corner::TopLeft, Corner::TopRight, Corner::BottomLeft, Corner::BottomRight],
            _ => vec![Corner::TopLeft],
        };

        let default_position = self.find_default_position();

        for (i, &id) in player_ids.iter().enumerate().take(num_players) {
            let corner = corners.get(i).cloned().unwrap_or(Corner::TopLeft);
            let pos = self.find_spawn_position_from_corner(corner).unwrap_or(default_position);

            let (x, y) = pos;
            let mut entity = make_entity_by_species(SPECIES_HERO);
            entity.frame.x = x;
            entity.frame.y = y - 1;
            entity.direction = Direction::Down;
            entity.id = id;
            entity.setup_hero_with_player_index(i);
            entity.immobilize_for_seconds(0.2);
            self.players[i].props = entity.props();
            self.insert_entity(entity, i);
        }
    }

    fn find_default_position(&self) -> (i32, i32) {
        let half_w = self.bounds.w / 2;
        let half_h = self.bounds.h / 2;

        for x in self.bounds.x..self.bounds.x + half_w {
            for y in self.bounds.y..self.bounds.y + half_h {
                if !self.hits(x, y) {
                    return (x, y);
                }
            }
        }

        (self.bounds.x + self.bounds.w / 2, self.bounds.y + self.bounds.h / 2)
    }

    fn spawn_hero_at_last_known_location(
        &mut self,
        source: u32,
        hero_direction: &Direction,
        original_x: i32,
        original_y: i32,
        direction: Direction,
    ) {
        let (x, y) = self.destination_x_y(source, original_x, original_y);
        let mut entity = make_entity_by_species(SPECIES_HERO);

        if !matches!(direction, Direction::Unknown | Direction::Still) {
            entity.direction = direction;
            entity.frame.x = x;
            entity.frame.y = y;
        } else {
            entity.direction = Direction::Down;
            entity.frame.x = x;
            entity.frame.y = y;

            let likely_directions = self.likely_direction_for_hero(x, y, hero_direction);

            for new_direction in &likely_directions {
                if self.has_space_for_hero_in_direction(x, y, new_direction) {
                    let (ox, oy) = new_direction.as_col_row_offset();
                    entity.frame.x = x + ox;
                    entity.frame.y = y - 1 + oy;
                    entity.direction = *new_direction;
                    break;
                }
            }
        }

        println!("Spawning hero at {}, {}", entity.frame.x, entity.frame.y);
        entity.immobilize_for_seconds(0.2);
        self.players[0].props = entity.props();
        self.insert_entity(entity, 0);
    }

    fn spawn_coop_players_around_hero(&mut self) {
        let offset = TILE_SIZE / 3.0;

        for (index, &id) in self.player_entity_ids().iter().enumerate().skip(1) {
            let mut entity = make_entity_by_species(SPECIES_HERO);
            entity.frame = self.players[0].props.frame;
            entity.direction = self.players[0].props.direction;
            entity.offset.x = if index == 1 { offset } else { 0.0 };
            entity.offset.y = if index == 2 {
                offset
            } else if index == 3 {
                -offset
            } else {
                0.0
            };
            entity.id = id;
            entity.setup_hero_with_player_index(index);
            entity.immobilize_for_seconds(0.2);
            self.players[index].props = entity.props();
            self.insert_entity(entity, index);
        }
    }

    fn spawn_equipment(&mut self) {
        for (index, &id) in self.player_entity_ids().iter().enumerate() {
            for item_id in ALL_EQUIPMENT_IDS.iter() {
                let mut item = species_by_id(*item_id).make_entity();
                item.parent_id = id;
                item.player_index = index;
                item.frame.x = self.players[index].props.frame.x;
                item.frame.y = self.players[index].props.frame.y;
                self.add_entity(item);
            }
        }
    }

    fn likely_direction_for_hero(&self, x: i32, y: i32, current_direction: &Direction) -> Vec<Direction> {
        if matches!(self.world_type, WorldType::HouseInterior) {
            return if y < 4 {
                vec![Direction::Down]
            } else {
                vec![Direction::Up]
            };
        }

        let mut options: Vec<Direction> = vec![];

        let going_horizontally = matches!(current_direction, Direction::Left | Direction::Right);
        let going_left = matches!(current_direction, Direction::Left);
        let horizontal = if going_left || (!going_horizontally && x > self.bounds.w / 2) {
            vec![Direction::Left, Direction::Right]
        } else {
            vec![Direction::Right, Direction::Left]
        };

        let going_vertically = matches!(current_direction, Direction::Up | Direction::Down);
        let going_up = matches!(current_direction, Direction::Up);
        let vertical = if going_up || (!going_vertically && y > self.bounds.h / 2) {
            vec![Direction::Up, Direction::Down]
        } else {
            vec![Direction::Down, Direction::Up]
        };

        match self.world_type {
            WorldType::Dungeon => {
                options.extend(vertical);
                options.extend(horizontal);
            }
            WorldType::Exterior => {
                options.extend(horizontal);
                options.extend(vertical);
            }
            WorldType::HouseInterior => {
                options.extend(vertical);
                options.extend(horizontal);
            }
        }

        options
    }

    fn remove_dying_entities(&mut self) {
        let dying_ids: Vec<u32> = self
            .entities
            .borrow()
            .iter()
            .filter_map(|e| if e.is_dying { Some(e.id) } else { None })
            .collect();

        dying_ids.into_iter().for_each(|id| self.remove_entity_by_id(id));
    }

    fn has_space_for_hero_in_direction(&self, x: i32, y: i32, direction: &Direction) -> bool {
        let (ox, oy) = direction.as_col_row_offset();

        let y_fix = match direction {
            Direction::Up => 0,
            Direction::Down => 1,
            _ => 0,
        };

        for i in 0..3 {
            let nx = x + i * ox;
            let ny = y + i * oy + y_fix;

            if (ny == y || ny == y + 1) && nx == x {
                continue;
            }
            if self.hits(nx, ny) {
                return false;
            }
        }
        true
    }

    fn destination_x_y(&self, source: u32, original_x: i32, original_y: i32) -> (i32, i32) {
        if self.id == 1001 && (source == 0 || source == 1000) {
            return (68, 23);
        }
        if original_x == 0 && original_y == 0 {
            if let Some(teleporter_position) = self.find_teleporter_for_destination(source) {
                return (teleporter_position.x, teleporter_position.y);
            } else if let Some(teleporter_position) = self.find_any_teleporter() {
                return (teleporter_position.x, teleporter_position.y);
            } else {
                let x = self.bounds.w / 2;
                let mut y = self.bounds.h / 2;

                while y < self.bounds.h - 1 && self.hits(x, y) {
                    y += 1;
                }
                return (x, y);
            }
        }
        let actual_x = original_x.min(self.bounds.x + self.bounds.w - 1).max(self.bounds.x - 1);
        let actual_y = original_y.min(self.bounds.y + self.bounds.h - 1).max(self.bounds.y - 1);
        (actual_x, actual_y)
    }

    fn remove_players(&mut self) {
        if let Some(index) = self.index_for_entity(PLAYER1_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
        if let Some(index) = self.index_for_entity(PLAYER2_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
        if let Some(index) = self.index_for_entity(PLAYER3_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
        if let Some(index) = self.index_for_entity(PLAYER4_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
    }

    fn remove_all_equipment(&mut self) {
        let equipment_ids: Vec<u32> = self
            .entities
            .borrow()
            .iter()
            .filter_map(|e| if e.is_equipment() { Some(e.id) } else { None })
            .collect();

        equipment_ids.into_iter().for_each(|id| self.remove_entity_by_id(id));
    }
}

#[derive(Clone)]
enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight
}