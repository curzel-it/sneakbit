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
        } else if self.is_obstacle_in_direction(world, self.direction) {
            self.pick_next_direction(world);
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
            
            if world.first_entity_id_by_area(&exclude, &ray).is_none() {
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
        let d = direction.as_vector().scaled(0.2);
        let next = self.hittable_frame().offset(d.x, d.y);
        world.first_entity_id_by_area(&vec![self.id], &next).is_some()
    }
}