use crate::{constants::{EPSILON, PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TILE_SIZE}, current_game_mode, entities::{known_species::SPECIES_HERO, species::{make_entity_by_species, species_by_id, ALL_EQUIPMENT_IDS}}, multiplayer::modes::GameMode, number_of_players, utils::directions::Direction};
use super::{world::World, world_type::WorldType};

impl World {
    pub fn setup(
        &mut self,
        source: u32,
        hero_direction: &Direction,
        original_x: f32,
        original_y: f32,
        direction: Direction,
    ) {
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
        self.entities
            .borrow_mut()
            .iter_mut()
            .for_each(|e| e.setup());
    }

    fn spawn_players(
        &mut self,
        source: u32,
        hero_direction: &Direction,
        original_x: f32,
        original_y: f32,
        direction: Direction,
    ) {
        match current_game_mode() {
            GameMode::Creative | GameMode::RealTimeCoOp => {
                self.spawn_hero_at_last_known_location(
                    source,
                    hero_direction,
                    original_x,
                    original_y,
                    direction,
                );
                self.spawn_coop_players_around_hero();
            }
            GameMode::TurnBasedPvp => {
                self.spawn_players_at_map_corners();
            }
        }
    }

    fn find_spawn_position_from_corner(&self, corner: Corner) -> Option<(f32, f32)> {
        let max_distance = self.bounds.w.max(self.bounds.h).ceil() as u32; // Convert to integer steps

        for distance in 0..=max_distance {
            let positions = match corner {
                Corner::TopLeft => self.generate_positions(
                    self.bounds.x,
                    self.bounds.y,
                    distance as f32,
                    1.0,
                    1.0,
                ),
                Corner::TopRight => self.generate_positions(
                    self.bounds.x + self.bounds.w - 1.0,
                    self.bounds.y,
                    distance as f32,
                    -1.0,
                    1.0,
                ),
                Corner::BottomLeft => self.generate_positions(
                    self.bounds.x,
                    self.bounds.y + self.bounds.h - 1.0,
                    distance as f32,
                    1.0,
                    -1.0,
                ),
                Corner::BottomRight => self.generate_positions(
                    self.bounds.x + self.bounds.w - 1.0,
                    self.bounds.y + self.bounds.h - 1.0,
                    distance as f32,
                    -1.0,
                    -1.0,
                ),
            };

            for (x, y) in positions {
                if !self.hits(x, y) {
                    return Some((x, y));
                }
            }
        }

        None
    }

    fn generate_positions(
        &self,
        start_x: f32,
        start_y: f32,
        distance: f32,
        x_step: f32,
        y_step: f32,
    ) -> Vec<(f32, f32)> {
        let mut positions = Vec::new();
        let integer_distance = distance.ceil() as u32; // Ensure integer steps

        for dx in 0..=integer_distance {
            let dy = integer_distance - dx;

            let x = start_x + dx as f32 * x_step;
            let y = start_y + dy as f32 * y_step;

            if self.is_within_bounds(x, y) {
                positions.push((x, y));
            }

            if dy != 0 {
                let x = start_x + dx as f32 * x_step;
                let y = start_y - dy as f32 * y_step;

                if self.is_within_bounds(x, y) {
                    positions.push((x, y));
                }
            }
        }

        positions
    }

    fn is_within_bounds(&self, x: f32, y: f32) -> bool {
        x >= self.bounds.x
            && x < self.bounds.x + self.bounds.w
            && y >= self.bounds.y
            && y < self.bounds.y + self.bounds.h
    }

    fn spawn_players_at_map_corners(&mut self) {
        let player_ids = self.player_entity_ids();
        let num_players = number_of_players();

        let corners = match num_players {
            1 => vec![Corner::TopLeft],
            2 => vec![Corner::TopLeft, Corner::TopRight],
            3 => vec![Corner::TopLeft, Corner::TopRight, Corner::BottomLeft],
            4 => vec![
                Corner::TopLeft,
                Corner::TopRight,
                Corner::BottomLeft,
                Corner::BottomRight,
            ],
            _ => vec![Corner::TopLeft],
        };

        let default_position = self.find_default_position();

        for (i, &id) in player_ids.iter().enumerate().take(num_players) {
            let corner = corners.get(i).cloned().unwrap_or(Corner::TopLeft);
            let pos = self
                .find_spawn_position_from_corner(corner)
                .unwrap_or(default_position);

            let (x, y) = pos;
            let mut entity = make_entity_by_species(SPECIES_HERO);
            entity.frame.x = x;
            entity.frame.y = y - 1.0;
            entity.direction = Direction::Down;
            entity.id = id;
            entity.setup_hero_with_player_index(i);
            entity.immobilize_for_seconds(0.2);
            self.players[i].props = entity.props();
            self.insert_entity(entity, i);
        }
    }

    fn find_default_position(&self) -> (f32, f32) {
        let half_w = self.bounds.w / 2.0;
        let half_h = self.bounds.h / 2.0;

        // Convert floating-point bounds to integer steps for iteration
        let start_x = self.bounds.x.ceil() as i32;
        let end_x = (self.bounds.x + half_w).floor() as i32;
        let start_y = self.bounds.y.ceil() as i32;
        let end_y = (self.bounds.y + half_h).floor() as i32;

        for x in start_x..=end_x {
            for y in start_y..=end_y {
                let x_f32 = x as f32;
                let y_f32 = y as f32;
                if !self.hits(x_f32, y_f32) {
                    return (x_f32, y_f32);
                }
            }
        }

        (
            self.bounds.x + self.bounds.w / 2.0,
            self.bounds.y + self.bounds.h / 2.0,
        )
    }

    fn spawn_hero_at_last_known_location(
        &mut self,
        source: u32,
        hero_direction: &Direction,
        original_x: f32,
        original_y: f32,
        direction: Direction,
    ) {
        let (x, y) = self.destination_x_y(source, original_x, original_y);
        self.spawn_point = (x, y);
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
                    let (ox, oy) = new_direction.as_offset();
                    entity.frame.x = x + ox;
                    entity.frame.y = y - 1.0 + oy;
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
            entity.frame = self.players[0].props.frame
            .offset_x(if index == 1 { offset } else { 0.0 })
            .offset_y(if index == 2 { offset } else if index == 3 { -offset } else { 0.0 });
            entity.direction = self.players[0].props.direction;
            entity.id = id;
            entity.setup_hero_with_player_index(index);
            entity.immobilize_for_seconds(0.2);
            self.players[index].props = entity.props();
            self.insert_entity(entity, index);
        }
    }

    fn spawn_equipment(&mut self) {
        for (index, &id) in self.player_entity_ids().iter().enumerate() {
            for &item_id in ALL_EQUIPMENT_IDS.iter() {
                let mut item = species_by_id(item_id).make_entity();
                item.parent_id = id;
                item.player_index = index;
                item.frame.x = self.players[index].props.frame.x;
                item.frame.y = self.players[index].props.frame.y;
                self.add_entity(item);
            }
        }
    }

    fn likely_direction_for_hero(
        &self,
        x: f32,
        y: f32,
        current_direction: &Direction,
    ) -> Vec<Direction> {
        if matches!(self.world_type, WorldType::HouseInterior) {
            return if y < 4.0 {
                vec![Direction::Down]
            } else {
                vec![Direction::Up]
            };
        }

        let mut options: Vec<Direction> = vec![];

        let going_horizontally = matches!(current_direction, Direction::Left | Direction::Right);
        let going_left = matches!(current_direction, Direction::Left);
        let horizontal = if going_left || (!going_horizontally && x > self.bounds.w / 2.0) {
            vec![Direction::Left, Direction::Right]
        } else {
            vec![Direction::Right, Direction::Left]
        };

        let going_vertically = matches!(current_direction, Direction::Up | Direction::Down);
        let going_up = matches!(current_direction, Direction::Up);
        let vertical = if going_up || (!going_vertically && y > self.bounds.h / 2.0) {
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

        for id in dying_ids {
            self.remove_entity_by_id(id);
        }
    }

    fn has_space_for_hero_in_direction(
        &self,
        x: f32,
        y: f32,
        direction: &Direction,
    ) -> bool {
        let (ox, oy) = direction.as_offset();

        let y_fix = match direction {
            Direction::Up => 0.0,
            Direction::Down => 1.0,
            _ => 0.0,
        };

        for i in 0..3 {
            let nx = x + i as f32 * ox;
            let ny = y + i as f32 * oy + y_fix;

            if (ny == y || ny == y + 1.0) && nx == x {
                continue;
            }
            if self.hits(nx, ny) {
                return false;
            }
        }
        true
    }

    fn destination_x_y(&self, source: u32, original_x: f32, original_y: f32) -> (f32, f32) {
        if self.id == 1001 && (source == 0 || source == 1000) {
            return (68.0, 23.0);
        }
        if original_x.abs() < EPSILON && original_y.abs() < EPSILON {
            if let Some(teleporter_position) = self.find_teleporter_for_destination(source) {
                return (teleporter_position.x, teleporter_position.y);
            } else if let Some(teleporter_position) = self.find_any_teleporter() {
                return (teleporter_position.x, teleporter_position.y);
            } else {
                let x = self.bounds.w / 2.0;
                let mut y = self.bounds.h / 2.0;

                while y < self.bounds.h - 1.0 && self.hits(x, y) {
                    y += 1.0;
                }
                return (x, y);
            }
        }
        let actual_x = original_x.min(self.bounds.x + self.bounds.w - 1.0).max(self.bounds.x - 1.0);
        let actual_y = original_y.min(self.bounds.y + self.bounds.h - 1.0).max(self.bounds.y - 1.0);
        (actual_x, actual_y)
    }

    fn remove_players(&mut self) {
        for &player_id in &[
            PLAYER1_ENTITY_ID,
            PLAYER2_ENTITY_ID,
            PLAYER3_ENTITY_ID,
            PLAYER4_ENTITY_ID,
        ] {
            if let Some(index) = self.index_for_entity(player_id) {
                self.remove_entity_at_index(index);
            }
        }
    }

    fn remove_all_equipment(&mut self) {
        let equipment_ids: Vec<u32> = self
            .entities
            .borrow()
            .iter()
            .filter_map(|e| if e.is_equipment() { Some(e.id) } else { None })
            .collect();

        for id in equipment_ids {
            self.remove_entity_by_id(id);
        }
    }
}

#[derive(Clone)]
enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}
