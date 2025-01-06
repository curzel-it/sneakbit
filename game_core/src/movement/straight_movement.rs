use crate::{config::config, constants::{GRAVITY, JUMP_SPEED, PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TERMINAL_VELOCITY, TILE_SIZE}, features::entity::Entity, utils::{math::ZeroComparable, rect::FRect, vector::Vector2d}, worlds::world::World};


impl Entity {
    pub fn projected_frames_by_moving_straight(&self, direction: &Vector2d, time_since_last_update: f32) -> (FRect, FRect) {
        let base_speed = config().base_entity_speed;
        let dx = direction.x * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let dy = direction.y * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let next = self.frame.offset(dx, dy);
        let next_hittable = self.hittable_frame().offset(dx, dy);
        (next, next_hittable)
    }

    pub fn my_and_players_ids(&self) -> Vec<u32> {
        vec![
            self.id, 
            PLAYER1_ENTITY_ID, 
            PLAYER2_ENTITY_ID, 
            PLAYER3_ENTITY_ID, 
            PLAYER4_ENTITY_ID
        ]
    }

    pub fn move_in_current_direction(
        &mut self, 
        world: &World, 
        time_since_last_update: f32
    ) -> bool { 
        let d = self.direction.clone();
        self.move_with_new_direction(&d, world, time_since_last_update)
    }

    pub fn move_with_new_direction(
        &mut self, 
        input_direction: &Vector2d,
        world: &World, 
        time_since_last_update: f32
    ) -> bool { 
        self.time_immobilized -= time_since_last_update;
        if self.time_immobilized > 0.0 {
            return false;
        }

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

        self.direction = new_direction;
        if self.direction.is_zero() {
            self.current_speed = 0.0;
        } else {
            self.current_speed = self.species.base_speed;
        }

        let exclude = self.my_and_players_ids();
        let mut did_move = false;

        let dy = Vector2d::new(0.0, self.direction.y);
        let (ny, ncy) = self.projected_frames_by_moving_straight(&dy, time_since_last_update);
        if !world.area_hits(&exclude, &ncy) {
            self.frame.y = ny.y;
            did_move = true;
        } else {
            self.direction.y = 0.0;
        }

        let dx = Vector2d::new(self.direction.x, 0.0);
        let (nx, ncx) = self.projected_frames_by_moving_straight(&dx, time_since_last_update);
        if !world.area_hits(&exclude, &ncx) {
            self.frame.x = nx.x;
            did_move = true;
        } else {
            self.direction.x = 0.0;
        }

        did_move
    }
}

impl Entity {
    pub fn is_on_ground(&self, world: &World) -> bool {
        world.area_hits(&self.my_and_players_ids(), &self.feet())
    }

    fn feet(&self) -> FRect {
        self.frame.padded((self.frame.h - 0.5, 0.15, 0.1, 0.15))
    }
}