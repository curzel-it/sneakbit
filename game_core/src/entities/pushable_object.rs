use crate::{features::{entity::{Entity, EntityProps}, linear_movement::{would_collide, would_over_weight}, state_updates::WorldStateUpdate}, utils::directions::Direction, worlds::world::World};

impl Entity {
    pub fn update_pushable(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        for player in &world.players {
            let updates = self.update_pushable_with_player_props(
                &player.props, 
                world, 
                time_since_last_update
            );
            if !updates.is_empty() {
                return updates
            }
        }

        vec![]
    }

    fn update_pushable_with_player_props(&mut self, player_props: &EntityProps, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        let player = player_props.hittable_frame;
        let player_direction = player_props.direction;       
        let player_offset = player_props.offset;        
        let non_zero_offset = player_offset.x != 0.0 || player_offset.y != 0.0;
        
        if non_zero_offset {
            let is_around = match player_direction {
                Direction::Up => player.y == self.frame.y + self.frame.h && player.x >= self.frame.x && player.x < self.frame.x + self.frame.w,
                Direction::Right => player.x == self.frame.x - 1 && player.y >= self.frame.y && player.y < self.frame.y + self.frame.h,
                Direction::Down => player.y == self.frame.y && player.x >= self.frame.x && player.x < self.frame.x + self.frame.w,
                Direction::Left => player.x == self.frame.x + self.frame.w && player.y >= self.frame.y && player.y < self.frame.y + self.frame.h,
                Direction::Unknown => false,
                Direction::Still => false,
            };
            if is_around {
                let hits = would_collide(&self.frame, &player_direction, world);
                let weights = would_over_weight(&self.frame, &player_direction, world);
                
                if hits {
                    return vec![]
                } else if weights {
                    return vec![WorldStateUpdate::StopHeroMovement]
                } else {
                    self.direction = player_direction;
                    self.current_speed = 1.2 * world.players[0].props.speed;
                    self.move_linearly(world, time_since_last_update);
                }
            }
        }

        vec![]
    }
}

