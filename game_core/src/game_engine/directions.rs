use serde::{Deserialize, Serialize};

use crate::{game_engine::{entity::Entity, world::World}, utils::directions::Direction};

#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize)]
pub enum MovementDirections {
    Keyboard,
    Free,
    FindHero,
    #[default]
    None
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
            MovementDirections::None => {},
            MovementDirections::Keyboard => self.update_direction_for_current_keys(world.direction_based_on_current_keys),
            MovementDirections::Free => self.move_around_free(world),
            MovementDirections::FindHero => self.search_for_hero(world),
        }
    }

    fn move_around_free(&mut self, world: &World) {
        if self.offset.x != 0.0 || self.offset.y != 0.0 {
            return
        }
        if self.is_obstacle_in_direction(&world, self.direction) {
            self.pick_next_direction(&world);
        }
    }

    fn search_for_hero(&mut self, world: &World) {
        if self.offset.x != 0.0 || self.offset.y != 0.0 {
            return
        }
        if self.is_hero_in_line_of_sight(world) {
            self.change_direction_towards_hero(world);
        } else if self.is_obstacle_in_direction(&world, self.direction) {
            self.pick_next_direction(&world);
        }
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

    fn is_hero_in_line_of_sight(&self, world: &World) -> bool {
        let hero = &world.cached_hero_props.hittable_frame;        
        let npc = &self.frame;
        let npc_y = self.frame.y + if self.frame.h > 1 { 1 } else { 0 };

        if npc.x == hero.x {
            let min_y = npc_y.min(hero.y);
            let max_y = npc_y.max(hero.y);
            for y in (min_y + 1)..max_y {
                if world.hits_i32(npc.x, y) {
                    return false;
                }
            }
            true
        } else if npc_y == hero.y {
            let min_x = npc.x.min(hero.x);
            let max_x = npc.x.max(hero.x);
            for x in (min_x + 1)..max_x {
                if world.hits_i32(x, npc.y) {
                    return false;
                }
            }
            true
        } else {
            false
        }
    }

    fn change_direction_towards_hero(&mut self, world: &World) {
        let hero = &world.cached_hero_props.hittable_frame;
        let npc = &self.frame;
        let npc_y = self.frame.y + if self.frame.h > 1 { 1 } else { 0 };

        if hero.x == npc.x {
            if hero.y < npc_y {
                self.direction = Direction::Up;
            } else {
                self.direction = Direction::Down
            }
        } else if hero.y == npc_y {
            if hero.x > npc.x {
                self.direction = Direction::Right;
            } else {
                self.direction = Direction::Left
            }
        }
    }

    fn is_obstacle_in_direction(&self, world: &World, direction: Direction) -> bool {
        let (next_dx, next_dy) = direction.as_col_row_offset();
        let next_x = self.frame.x + next_dx + if next_dx > 0 { self.frame.w - 1 } else { 0 };
        let next_y = self.frame.y + next_dy + if self.frame.h > 1 { 1 } else { 0 };
        world.hits_or_out_of_bounds_i32(next_x, next_y)
    }
}