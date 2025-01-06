use crate::{features::{entity::Entity, entity_props::EntityProps, state_updates::WorldStateUpdate}, utils::{math::ZeroComparable, rect::FRect, vector::Vector2d}, worlds::world::World};

impl Entity {
    pub fn update_pushable(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        self.update_pushable_with_player_props(
            &world.players[0].props, 
            world, 
            time_since_last_update
        );
        vec![]
    }

    pub fn pushable_object_hittable_frame(&self) -> FRect {
        self.frame.padded_all(0.1)
    }

    fn update_pushable_with_player_props(
        &mut self,
        player_props: &EntityProps,
        world: &World,
        time_since_last_update: f32
    ) {
        if player_props.speed <= 0.0 || player_props.direction == Vector2d::zero() {            
            self.pushable_set_still();
            return
        }

        let is_pushing = self.is_being_pushed_by_player(world, player_props, time_since_last_update);
        
        if !is_pushing {
            self.pushable_set_still();
            return
        }

        let d = player_props.direction;
        let exclude = self.my_and_players_ids();
        let (next, next_collidable) = self.projected_frames_by_moving_straight(&d, time_since_last_update);

        if world.area_hits(&exclude, &next_collidable) {
            self.pushable_set_still();
            return
        }
        self.frame = next;
        self.direction = d;
        self.current_speed = player_props.speed;
    }

    fn is_being_pushed_by_player(&self, world: &World, player: &EntityProps, time_since_last_update: f32) -> bool {
        let player_center = player.hittable_frame.center();

        if !self.frame.scaled_from_center(3.0).contains_or_touches(&player_center) {
            return false;
        }

        if self.frame.contains_or_touches(&player_center) {
            let exclude = self.my_and_players_ids();
            let (_, next_collidable) = self.projected_frames_by_moving_straight(
                &player.direction.opposite(), 
                time_since_last_update
            );

            if world.area_hits(&exclude, &next_collidable) {
                return true
            }
        }

        if player.direction.is_zero() {
            return false
        }
        let opposite = player.direction.opposite();
        self.frame.offset(opposite.x, opposite.y).contains_or_touches(&player_center)
    }

    fn pushable_set_still(&mut self) {
        self.current_speed = 0.0;
        self.direction = Vector2d::zero();
    }
}