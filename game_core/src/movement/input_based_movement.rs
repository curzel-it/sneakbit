use crate::{config::config, features::entity::Entity, utils::{math::ZeroComparable, rect::FRect, vector::Vector2d}, worlds::world::World};

const GRAVITY: f32 = 1.0; 
const JUMP_SPEED: f32 = -20.0; 
const TERMINAL_VELOCITY: f32 = 50.0;

impl Entity {
    pub fn move_based_on_player_input(
        &mut self, 
        world: &World, 
        time_since_last_update: f32
    ) { 
        self.time_immobilized -= time_since_last_update;
        if self.time_immobilized > 0.0 {
            return;
        }

        let input_direction = world.players[self.player_index].direction_based_on_current_keys;
        
        let is_on_ground = self.is_on_ground(world);

        let mut new_direction = self.direction;
        new_direction.x = input_direction.x;

        if input_direction.y == -1.0 && is_on_ground {
            new_direction.y = JUMP_SPEED;
        }

        if !is_on_ground {
            new_direction.y += GRAVITY * time_since_last_update;

            if new_direction.y > TERMINAL_VELOCITY {
                new_direction.y = TERMINAL_VELOCITY;
            }
        } else {
            new_direction.y = 0.0;
        }
        println!("Input direction {:#?}", input_direction);
        println!("New direction {:#?}", new_direction);

        if new_direction.is_zero() {
            self.current_speed = 0.0;
        } else {
            self.current_speed = config().base_entity_speed * self.species.base_speed;
        }

        self.direction = new_direction;
        let (next, _) = self.projected_frames_by_moving_straight(&self.direction, time_since_last_update);
        self.frame = next;
    }
}

impl Entity {
    fn is_on_ground(&self, world: &World) -> bool {
        world.area_hits(&vec![self.id], &self.feet())
    }

    fn feet(&self) -> FRect {
        self.frame.padded((1.0, 0.1, 0.0, 0.1))
    }
}