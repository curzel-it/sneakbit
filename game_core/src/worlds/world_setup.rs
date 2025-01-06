use crate::{constants::{PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TILE_SIZE}, current_game_mode, entities::{known_species::SPECIES_HERO, species::{make_entity_by_species, species_by_id, ALL_EQUIPMENT_IDS}}, multiplayer::modes::GameMode, number_of_players, utils::{math::ZeroComparable, rect::FRect, vector::Vector2d}};
use super::world::World;

impl World {
    pub fn setup(
        &mut self,
        source: u32,
        hero_direction: &Vector2d,
        original_x: f32,
        original_y: f32,
        direction: Vector2d,
    ) {
        self.remove_players();
        self.remove_all_equipment();
        self.remove_dying_entities();

        unsafe {
            self.update_hitmaps(&self.bounds.clone());
        }
        
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
        hero_direction: &Vector2d,
        original_x: f32,
        original_y: f32,
        direction: Vector2d,
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

    fn spawn_players_at_map_corners(&mut self) {
        let player_ids = self.player_entity_ids();
        let num_players = number_of_players();

        let half_width = self.bounds.w / 2.0;
        let half_height = self.bounds.h / 2.0;

        let quarters = vec![
            Corner::TopLeft,
            Corner::TopRight,
            Corner::BottomLeft,
            Corner::BottomRight,
        ];

        for (i, &player_id) in player_ids.iter().take(num_players).enumerate() {
            if let Some(corner) = quarters.get(i) {
                let (start_x, start_y, end_x, end_y) = match corner {
                    Corner::TopLeft => (0.0, 0.0, half_width, half_height),
                    Corner::TopRight => (self.bounds.w - 2.0, 0.0, half_width, half_height),
                    Corner::BottomLeft => (0.0, self.bounds.h - 2.0, half_width, half_height),
                    Corner::BottomRight => (self.bounds.w - 2.0, self.bounds.h - 2.0, half_width, half_height),
                };

                let (x, y) = self.spawn_position_from_point(start_x, start_y, end_x, end_y);

                let mut entity = make_entity_by_species(SPECIES_HERO);
                entity.frame.x = x;
                entity.frame.y = y;
                entity.direction = Vector2d::zero(); 
                entity.id = player_id;
                entity.setup_hero_with_player_index(i);
                entity.immobilize_for_seconds(0.2);

                self.players[i].props = entity.props();
                self.insert_entity(entity, i);
            }
        }
    }

    fn spawn_position_from_point(&self, start_x: f32, start_y: f32, end_x: f32, end_y: f32) -> (f32, f32) {
        let dx = if end_x > start_x { 1.0 } else { -1.0 };
        let x_steps = (start_x.max(end_x) - start_x.min(end_x)).floor() as usize;

        let dy = if end_y > start_y { 1.0 } else { -1.0 };
        let y_steps = (start_y.max(end_y) - start_y.min(end_y)).floor() as usize;

        for xi in 0..x_steps {
            let x = start_x + (xi as f32) * dx;

            for yi in 0..y_steps {
                let y = start_y + (yi as f32) * dy;
                let area = FRect::new(x, y, 2.0, 2.0);

                if !self.area_hits(&vec![], &area) {
                    return (x, y)
                }
            }
        }
        return (0.0, 0.0)
    }

    fn spawn_hero_at_last_known_location(
        &mut self,
        source: u32,
        hero_direction: &Vector2d,
        original_x: f32,
        original_y: f32,
        direction: Vector2d,
    ) {
        let (x, y) = self.destination_x_y(source, original_x, original_y);
        self.spawn_point = (x, y);
        let mut entity = make_entity_by_species(SPECIES_HERO);

        entity.direction = if direction.is_zero() { hero_direction.clone() } else { direction };
        entity.frame.x = x;
        entity.frame.y = y;

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

    fn destination_x_y(&self, source: u32, original_x: f32, original_y: f32) -> (f32, f32) {
        if original_x.is_zero() && original_y.is_zero() {
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
