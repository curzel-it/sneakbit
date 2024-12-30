use serde::{Deserialize, Serialize};

use crate::{constants::{DIRECTION_CHANGE_COOLDOWN, PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID}, currently_active_players, features::entity::Entity, utils::{directions::Direction, rect::FRect}, worlds::world::World};

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
    pub fn update_direction(&mut self, world: &World, time_since_last_update: f32) {
        match self.movement_directions {
            MovementDirections::None => {}
            MovementDirections::Keyboard => {
                let new_direction = world.players[self.player_index].direction_based_on_current_keys;
                if !matches!(new_direction, Direction::Unknown | Direction::Still) {
                    self.direction = new_direction;
                    self.reset_speed();
                } else {
                    self.current_speed = 0.0;
                }
            },
            MovementDirections::Free => {
                if self.can_change_direction(time_since_last_update) {
                    self.move_around_free(world)
                }
            },
            MovementDirections::FindHero =>  {
                if self.can_change_direction(time_since_last_update) {
                    self.search_for_hero(world)
                }
            },
        }
    }

    fn can_change_direction(&mut self, time_since_last_update: f32) -> bool {
        self.direction_change_cooldown -= time_since_last_update;
        if self.direction_change_cooldown > 0.0 {
            return false
        }
        self.direction_change_cooldown = DIRECTION_CHANGE_COOLDOWN;
        return true
    }

    fn move_around_free(&mut self, world: &World) {
        self.pick_next_direction(world);
    }

    pub fn search_for_hero(&mut self, world: &World) {
        let my_position = self.frame.center();

        if let Some(frame) = self.first_active_vulnerable_player_in_line_of_sight(world) {
            self.direction = Direction::between_points_with_current(
                &my_position, 
                &frame.center(), 
                self.direction
            ).simplified();
        } else {
            self.pick_next_direction(world);
        }
    }

    pub fn first_active_vulnerable_player_in_line_of_sight(&self, world: &World) -> Option<FRect> {
        let me = self.hittable_frame(); 
        let exclude = vec![
            self.id,
            PLAYER1_ENTITY_ID,
            PLAYER2_ENTITY_ID,
            PLAYER3_ENTITY_ID,
            PLAYER4_ENTITY_ID,
        ];

        for &player_index in currently_active_players().iter() {
            let player = &world.players[player_index].props;
            let player_frame = player.hittable_frame;

            let padding = 0.0;
            let min_x = me.x.min(player_frame.x) - padding;
            let max_x = me.max_x().max(player_frame.max_x()) + padding;
            let min_y = me.y.min(player_frame.y) - padding;
            let max_y = me.max_y().max(player_frame.max_y()) + padding;

            let vision_rect = FRect::new(min_x, min_y, max_x - min_x, max_y - min_y);

            if !world.area_hits(&exclude, &vision_rect) {
                return Some(player.hittable_frame);
            }
        }
        None
    }

    fn pick_next_direction(&mut self, world: &World) {
        let directions = [
            self.direction,
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

    pub fn is_obstacle_in_direction(&self, world: &World, direction: Direction) -> bool {
        let d = direction.as_vector().scaled(0.3);
        let next = self.hittable_frame().offset(d.x, d.y);
        world.area_hits(&vec![self.id], &next)
    }
}