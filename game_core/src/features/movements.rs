use serde::{Deserialize, Serialize};

use crate::{currently_active_players, features::entity::Entity, utils::{directions::Direction, rect::FRect}, worlds::world::World};

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
                self.move_around_free(world, time_since_last_update)
            },
            MovementDirections::FindHero =>  {
                self.search_for_hero(world, time_since_last_update)
            },
        }
    }

    fn move_around_free(&mut self, world: &World, time_since_last_update: f32) {
        self.pick_next_direction(world, time_since_last_update);
    }

    pub fn search_for_hero(&mut self, world: &World, time_since_last_update: f32) {
        if let Some(player) = self.first_active_vulnerable_player_in_line_of_sight(world) {
            self.direction = Direction::between_points_with_current(
                &self.frame.center(), 
                &player.center(), 
                self.direction
            ).simplified();
            self.move_straight(world, time_since_last_update);
        } else {
            self.pick_next_direction(world, time_since_last_update);
        }
    }

    pub fn first_active_vulnerable_player_in_line_of_sight(&self, world: &World) -> Option<FRect> {
        let me = self.hittable_frame(); 
        let exclude = self.my_and_players_ids();

        let vision_x = self.frame.w * 2.0;
        let vision_y = self.frame.h * 2.0;

        for &player_index in currently_active_players().iter() {
            let player = &world.players[player_index].props;
            let player_frame = player.hittable_frame;            

            let min_x = me.x.min(player_frame.x);
            let max_x = me.max_x().max(player_frame.max_x());
            let min_y = me.y.min(player_frame.y);
            let max_y = me.max_y().max(player_frame.max_y());
            let distance_x = max_x - min_x;
            let distance_y = max_y - min_y;

            if distance_x < vision_x || distance_y < vision_y {
                let vision_rect = FRect::new(min_x, min_y, distance_x, distance_y);

                if !world.area_hits(&exclude, &vision_rect) {
                    return Some(player.hittable_frame);
                }
            }
        }
        None
    }

    fn pick_next_direction(&mut self, world: &World, time_since_last_update: f32) {   
        let exclude = self.my_and_players_ids();

        for direction in &self.next_direction_options() {
            let (next, next_collidable) = self.projected_frames_by_moving_straight(direction, time_since_last_update);

            if !world.area_hits(&exclude, &next_collidable) {
                self.frame = next;
                self.direction = direction.clone();
                return
            }
        }
        self.frame = self.frame.with_closest_int_origin();
    }
}