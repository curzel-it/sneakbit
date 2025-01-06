use crate::{features::entity::Entity, utils::{math::ZeroComparable, rect::FRect, vector::Vector2d}, worlds::world::World};

const GRAVITY: f32 = 3.0; 
const JUMP_SPEED: f32 = -2.0; 
const TERMINAL_VELOCITY: f32 = 9.8;

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

        if is_on_ground {
            if input_direction.y == -1.0 || input_direction.y == -0.7 {
                new_direction.y = JUMP_SPEED;
            } else {
                new_direction.y = 0.0;
            }
        } else {
            new_direction.y += GRAVITY * time_since_last_update;

            if new_direction.y > TERMINAL_VELOCITY {
                new_direction.y = TERMINAL_VELOCITY;
            }
        } 

        if new_direction.is_zero() {
            self.current_speed = 0.0;
        } else {
            self.current_speed = self.species.base_speed;
        }

        self.direction = new_direction;

        let dy = Vector2d::new(0.0, self.direction.y);
        let (ny, ncy) = self.projected_frames_by_moving_straight(&dy, time_since_last_update);
        if !world.area_hits(&vec![self.id], &ncy) {
            self.frame.y = ny.y;
        } else {
            self.direction.y = 0.0;
        }

        let dx = Vector2d::new(self.direction.x, 0.0);
        let (nx, ncx) = self.projected_frames_by_moving_straight(&dx, time_since_last_update);
        if !world.area_hits(&vec![self.id], &ncx) {
            self.frame.x = nx.x;
        } else {
            self.direction.x = 0.0;
        }
    }
}

impl Entity {
    fn is_on_ground(&self, world: &World) -> bool {
        world.area_hits(&vec![self.id], &self.feet())
    }

    fn feet(&self) -> FRect {
        self.frame.padded((self.frame.h - 0.5, 0.15, 0.1, 0.15))
    }
}