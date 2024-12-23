use serde::{Deserialize, Serialize};

use crate::{currently_active_players, features::entity::Entity, utils::{directions::Direction, rect::IntRect}, worlds::world::World};

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
                self.update_direction_for_current_keys(new_direction);
            }
            MovementDirections::Free => self.move_around_free(world),
            MovementDirections::FindHero => self.search_for_hero(world),
        }
    }

    fn move_around_free(&mut self, world: &World) {
        if self.offset.x != 0.0 || self.offset.y != 0.0 {
            return;
        }
        if self.is_obstacle_in_direction(world, self.direction) {
            self.pick_next_direction(world);
        }
    }

    fn search_for_hero(&mut self, world: &World) {
        if self.offset.x != 0.0 || self.offset.y != 0.0 {
            return;
        }
        if let Some(target) = self.is_any_active_vulnerable_player_in_line_of_sight(world) {
            self.change_direction_towards_target(&target);
        } else if self.is_obstacle_in_direction(world, self.direction) {
            self.pick_next_direction(world);
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

    pub fn is_any_active_vulnerable_player_in_line_of_sight(&self, world: &World) -> Option<IntRect> {
        for &player_index in currently_active_players().iter() {
            let player = &world.players[player_index];

            if player.props.is_invulnerable {
                continue;
            }
            let hero = player.props.hittable_frame;
            let npc = self.hittable_frame(); 
            
            let npc_x_range = npc.x..(npc.x + npc.w);
            let npc_y_range = npc.y..(npc.y + npc.h);

            let hero_x_range = hero.x..(hero.x + hero.w);
            let hero_y_range = hero.y..(hero.y + hero.h);

            if ranges_overlap(&npc_x_range, &hero_x_range) {
                let x_min = npc_x_range.start.max(hero_x_range.start);
                let x_max = npc_x_range.end.min(hero_x_range.end);

                let min_y = npc.y.min(hero.y);
                let max_y = (npc.y + npc.h - 1).max(hero.y + hero.h - 1);

                let mut obstructed = false;
                for x in x_min..x_max {
                    for y in (min_y + 1)..max_y {
                        if world.hits(x, y) {
                            obstructed = true;
                            break;
                        }
                    }
                    if obstructed {
                        break;
                    }
                }

                if !obstructed {
                    return Some(hero);
                }
            }

            if ranges_overlap(&npc_y_range, &hero_y_range) {
                let y_min = npc_y_range.start.max(hero_y_range.start);
                let y_max = npc_y_range.end.min(hero_y_range.end);

                let min_x = npc.x.min(hero.x);
                let max_x = (npc.x + npc.w - 1).max(hero.x + hero.w - 1);

                let mut obstructed = false;
                for y in y_min..y_max {
                    for x in (min_x + 1)..max_x {
                        if world.hits(x, y) {
                            obstructed = true;
                            break;
                        }
                    }
                    if obstructed {
                        break;
                    }
                }

                if !obstructed {
                    return Some(hero);
                }
            }
        }
        None
    }

    fn change_direction_towards_target(&mut self, target: &IntRect) {
        let npc = self.hittable_frame();

        let npc_center_x = npc.x + npc.w / 2;
        let npc_center_y = npc.y + npc.h / 2;
        let target_center_x = target.x + target.w / 2;
        let target_center_y = target.y + target.h / 2;

        if target_center_x > npc_center_x {
            self.direction = Direction::Right;
        } else if target_center_x < npc_center_x {
            self.direction = Direction::Left;
        }

        if target_center_y > npc_center_y {
            self.direction = Direction::Down;
        } else if target_center_y < npc_center_y {
            self.direction = Direction::Up;
        }
    }

    fn is_obstacle_in_direction(&self, world: &World, direction: Direction) -> bool {
        let (dx, dy) = direction.as_col_row_offset();
        let new_x = self.frame.x + dx;
        let new_y = self.frame.y + dy;

        for check_x in new_x..(new_x + self.frame.w) {
            for check_y in new_y..(new_y + self.frame.h) {
                if world.hits_or_out_of_bounds(check_x, check_y) {
                    return true;
                }
            }
        }
        false
    }
}

fn ranges_overlap(r1: &std::ops::Range<i32>, r2: &std::ops::Range<i32>) -> bool {
    r1.start < r2.end && r2.start < r1.end
}