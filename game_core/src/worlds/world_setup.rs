use crate::{constants::{BUILD_NUMBER, PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID}, entities::{known_species::{SPECIES_CLAYMORE, SPECIES_HERO, SPECIES_KUNAI, SPECIES_KUNAI_LAUNCHER, SPECIES_MR_MUGS}, species::{make_entity_by_species, species_by_id}}, features::dialogues::{AfterDialogueBehavior, Dialogue}, game_engine::{storage::{get_value_for_global_key, set_value_for_key, StorageKey}, world::{World, WorldType}}, number_of_players, utils::directions::Direction};

impl World {
    pub fn setup(&mut self, source: u32, hero_direction: &Direction, original_x: i32, original_y: i32, direction: Direction) {
        self.idsmap.reserve(1000);
        self.visible_entities.reserve(1000);

        self.remove_players();
        self.remove_all_equipment();
        self.remove_dying_entities();
        self.update_visible_entities(&self.bounds.clone());
        self.update_tiles_hitmap();
        self.update_hitmaps();
        self.setup_entities();
        self.spawn_hero(source, hero_direction, original_x, original_y, direction);
        self.spawn_other_players();
        self.spawn_equipment();
        self.spawn_changelog_man_if_needed();
    }    

    fn setup_entities(&mut self) {
        self.entities.borrow_mut().iter_mut().for_each(|e| e.setup());
    }

    fn spawn_changelog_man_if_needed(&mut self) {
        if is_first_visit_after_update() && self.allows_for_changelog_display() {
            set_update_handled();
            clear_previous_changelog_dialogues();

            let hero = self.players[0].props;
            let mut mugs = species_by_id(SPECIES_MR_MUGS).make_entity();
            mugs.direction = Direction::Down;
            mugs.demands_attention = true;
            mugs.frame = hero.frame
                .offset_by(hero.direction.as_col_row_offset())
                .offset_by(hero.direction.as_col_row_offset());
            mugs.dialogues = vec![Dialogue::new("changelog", "always", 0, Some(SPECIES_KUNAI))];
            mugs.after_dialogue = AfterDialogueBehavior::FlyAwayEast;
            self.add_entity(mugs);
        }
    }

    fn spawn_hero(&mut self, source: u32, hero_direction: &Direction, original_x: i32, original_y: i32, direction: Direction) {
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
                    break
                }
            }
        }   

        println!("Spawning hero at {}, {}", entity.frame.x, entity.frame.y); 
        entity.immobilize_for_seconds(0.2);
        self.players[0].props = entity.props();
        self.insert_entity(entity, 0);
    }

    fn hero_entity_ids(&self) -> Vec<u32> {
        match number_of_players() {
            1 => vec![PLAYER1_ENTITY_ID],
            2 => vec![PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID],
            3 => vec![PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID],
            4 => vec![PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID],
            _ => vec![PLAYER1_ENTITY_ID]
        }
    }

    fn spawn_other_players(&mut self) {
        for (index, &id) in self.hero_entity_ids().iter().enumerate().skip(1) {
            let mut entity = make_entity_by_species(SPECIES_HERO);
            entity.frame = self.players[0].props.frame;
            entity.direction = self.players[0].props.direction;
            entity.id = id;
            entity.immobilize_for_seconds(0.2);
            self.insert_entity(entity, index);
        }
    }

    fn spawn_equipment(&mut self) {
        for id in self.hero_entity_ids() {
            let mut kunai_launcher = species_by_id(SPECIES_KUNAI_LAUNCHER).make_entity();
            kunai_launcher.parent_id = id;
            kunai_launcher.frame.x = self.players[0].props.frame.x;
            kunai_launcher.frame.y = self.players[0].props.frame.y;
            self.add_entity(kunai_launcher);

            let mut claymore = species_by_id(SPECIES_CLAYMORE).make_entity();
            claymore.parent_id = id;
            claymore.frame.x = self.players[0].props.frame.x;
            claymore.frame.y = self.players[0].props.frame.y;
            self.add_entity(claymore);
        }
    }

    fn likely_direction_for_hero(&self, x: i32, y: i32, current_direction: &Direction) -> Vec<Direction> {
        if matches!(self.world_type, WorldType::HouseInterior) {
            return if y < 4 {
                vec![Direction::Down]
            } else {
                vec![Direction::Up]
            }
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
            },
            WorldType::Exterior => {
                options.extend(horizontal);
                options.extend(vertical);
            },
            WorldType::HouseInterior => {
                options.extend(vertical);
                options.extend(horizontal);
            },
        }

        options
    }

    fn remove_dying_entities(&mut self) {
        let dying_ids: Vec<u32> = self.entities.borrow().iter()
            .filter_map(|e| { if e.is_dying { Some(e.id) } else { None } })
            .collect();

        dying_ids.into_iter().for_each(|id| self.remove_entity_by_id(id));
    }

    fn has_space_for_hero_in_direction(&self, x: i32, y: i32, direction: &Direction) -> bool {
        let (ox, oy) = direction.as_col_row_offset();
        
        let y_fix = match direction {
            Direction::Up => 0,
            Direction::Down => 1,
            _ => 0
        };

        for i in 0..3 {
            let nx = x + i * ox;
            let ny = y + i * oy + y_fix;
    
            if ny == y && nx == x || ny == y+1 && nx == x {
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
            return (68, 23)
        }
        if original_x == 0 && original_y == 0 {            
            if let Some(teleporter_position) = self.find_teleporter_for_destination(source) {
                return (teleporter_position.x, teleporter_position.y)
            } else if let Some(teleporter_position) = self.find_any_teleporter() {
                return (teleporter_position.x, teleporter_position.y)
            } else {
                let x = self.bounds.w / 2;
                let mut y = self.bounds.h / 2;

                while y < self.bounds.h - 1 && self.hits(x, y) {
                    y += 1
                }
                return (x, y)
            }
        }
        let actual_x = original_x.min(self.bounds.x + self.bounds.w - 1).max(self.bounds.x - 1);
        let actual_y = original_y.min(self.bounds.y + self.bounds.h - 1).max(self.bounds.y - 1);
        (actual_x, actual_y)
    }

    fn allows_for_changelog_display(&self) -> bool {
        !matches!(self.id, 1000 | 1001) && matches!(self.world_type, WorldType::Exterior)
    }
}
    
fn is_first_visit_after_update() -> bool {
    if let Some(last_build) = get_value_for_global_key(&StorageKey::build_number()) {
        last_build != BUILD_NUMBER
    } else {
        true
    }    
}

fn set_update_handled() {
    set_value_for_key(&StorageKey::build_number(), BUILD_NUMBER);
}

fn clear_previous_changelog_dialogues() {
    set_value_for_key("dialogue.answer.changelog", 0);
    set_value_for_key("dialogue.answer.changelog.mobile", 0);
    set_value_for_key("dialogue.reward.changelog", 0);
    set_value_for_key("dialogue.reward.changelog.mobile", 0);
}
