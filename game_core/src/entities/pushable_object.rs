use crate::{features::{entity::Entity, entity_props::EntityProps, state_updates::WorldStateUpdate}, utils::{directions::Direction, math::ZeroComparable, rect::FRect, vector::Vector2d}, worlds::world::World};

impl Entity {
    pub fn update_pushable(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        self.update_pushable_with_player_props(
            &world.players[0].props, 
            world, 
            time_since_last_update
        );
        vec![]
    }

    fn update_pushable_with_player_props(
        &mut self,
        player_props: &EntityProps,
        world: &World,
        time_since_last_update: f32
    ) {
        if player_props.speed <= 0.0 || matches!(player_props.direction, Direction::Unknown | Direction::Still) {
            self.pushable_set_still();
            return
        }

        let is_pushing = self.is_being_pushed_by_player(player_props);

        if !is_pushing {
            self.pushable_set_still();
            return
        }

        if self.is_obstacle_in_direction(world, player_props.direction) {
            self.pushable_set_still();
            return
        }

        self.current_speed = player_props.speed;
        self.direction = player_props.direction;
        self.move_linearly(world, time_since_last_update);
    }

    fn is_being_pushed_by_player(&self, player: &EntityProps) -> bool {
        let player_center = player.hittable_frame.center();

        let is_on_top = self.frame.offset_y(-0.6).contains_or_touches(&player_center);
        let is_on_right = self.frame.offset_x(0.6).contains_or_touches(&player_center);
        let is_on_bottom = self.frame.offset_y(0.6).contains_or_touches(&player_center);
        let is_on_left = self.frame.offset_x(-0.6).contains_or_touches(&player_center);

        match player.direction {
            Direction::Up => is_on_bottom,
            Direction::Right => is_on_left,
            Direction::Down => is_on_top,
            Direction::Left => is_on_right,
            Direction::Unknown | Direction::Still => false,
        }
    }

    fn pushable_set_still(&mut self) {
        self.current_speed = 0.0;
        self.direction = Direction::Still;
    }
}