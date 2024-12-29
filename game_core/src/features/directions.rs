use serde::{Deserialize, Serialize};

use crate::{constants::{PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID}, currently_active_players, entities::{known_species::SPECIES_HERO, species::SpeciesId}, features::entity::Entity, utils::{directions::Direction, rect::FRect, vector::Vector2d}, worlds::world::World};

use super::{entity::EntityId, hitmaps::Hittable};

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
    pub fn update_direction(&mut self, world: &World) {
        match self.movement_directions {
            MovementDirections::None => {}
            MovementDirections::Keyboard => {
                let new_direction = world.players[self.player_index].direction_based_on_current_keys;
                if matches!(new_direction, Direction::Up | Direction::Right | Direction::Down | Direction::Left) {
                    self.direction = new_direction;
                    self.reset_speed();
                } else {
                    self.current_speed = 0.0;
                }
            },
            MovementDirections::Free => self.move_around_free(world),
            MovementDirections::FindHero => self.search_for_hero(world),
        }
    }

    fn move_around_free(&mut self, world: &World) {
        if !self.frame.origin().is_close_to_int() {
            return
        }
        if self.is_obstacle_in_direction(world, self.direction) {
            self.pick_next_direction(world);
        }
    }

    pub fn search_for_hero(&mut self, world: &World) {
        let my_position = self.frame.center();

        if let Some((player, _, _, _)) = self.first_active_vulnerable_player_in_line_of_sight(world) {
            self.direction = Direction::between_points(
                &my_position, 
                &player.center(), 
                Direction::Right
            );
            println!("Saw hero, changed direction to {:#?}", self.direction);
        } else {
            let d = self.direction.as_vector().scaled(0.2);
            let next = self.hittable_frame().offset(d.x, d.y);
            
            if world.first_entity_id_by_area(&vec![self.id], &next).is_none() {
                self.pick_next_direction(world);
            }
        }
    }

    pub fn first_active_vulnerable_player_in_line_of_sight(&self, world: &World) -> Option<Hittable> {
        let my_position = self.frame.center();
        let exclude = vec![self.id, PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID];

        for &player_index in currently_active_players().iter() {
            let player = world.players[player_index].props;
            let player_position = player.frame.center();

            let ray = FRect::new(
                my_position.x.min(player_position.x),
                my_position.y.min(player_position.y),
                (my_position.x - player_position.x).abs(),
                (my_position.y - player_position.y).abs()
            );
            
            let xxx = world.first_entity_id_by_area(&exclude, &ray);

            println!("Checking...");
            println!("  Me: {:#?}", my_position);
            println!("  Player: {:#?}", player);
            println!("  Ray: {:#?}", ray);
            println!("  Hits: {:#?}", xxx);

            if world.first_entity_id_by_area(&exclude, &ray).is_none() {
                println!("  Passed!");
                return Some((player.frame, 1, player.id, SPECIES_HERO))
            }
        }
        None
    }

    fn pick_next_direction(&mut self, world: &World) {
        let directions = [
            self.direction.turn_right(),
            self.direction.turn_left(),
            self.direction.opposite(),
        ];

        for &dir in &directions {
            if !self.is_obstacle_in_direction(world, dir) {
                self.direction = dir;
                break;
            }
        }
    }

    fn is_obstacle_in_direction(&self, world: &World, direction: Direction) -> bool {
        let (dx, dy) = direction.as_col_row_offset();
        let new_x = self.frame.x + dx as f32;
        let new_y = self.frame.y + dy as f32;

        // Assuming world.hits_or_out_of_bounds expects integer coordinates
        let new_x_int = new_x.floor() as i32;
        let new_y_int = new_y.floor() as i32;

        for check_x in new_x_int..(new_x_int + self.frame.w as i32) {
            for check_y in new_y_int..(new_y_int + self.frame.h as i32) {
                if world.hits_or_out_of_bounds(check_x as f32, check_y as f32) {
                    return true;
                }
            }
        }
        false
    }
}

// Updated ranges_overlap to work with f32 ranges
fn ranges_overlap(r1: &std::ops::Range<f32>, r2: &std::ops::Range<f32>) -> bool {
    r1.start < r2.end && r2.start < r1.end
}
