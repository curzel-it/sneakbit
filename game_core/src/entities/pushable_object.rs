use crate::{features::{entity::Entity, entity_props::EntityProps, state_updates::WorldStateUpdate}, utils::directions::Direction, worlds::world::World};

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

        let is_pushing = self.is_being_pushed_by_player(world, player_props);
        
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

    fn is_being_pushed_by_player(&self, world: &World, player: &EntityProps) -> bool {
        let player_center = player.hittable_frame.center();

        if !self.frame.scaled_from_center(3.0).contains_or_touches(&player_center) {
            return false;
        }

        if self.frame.contains_or_touches(&player_center) {
            if self.is_obstacle_in_direction(world, player.direction.opposite()) {
                return true
            }
        }
        
        match player.direction {
            Direction::Up => self.frame.offset_y(0.6).contains_or_touches(&player_center),
            Direction::Right => self.frame.offset_x(-0.6).contains_or_touches(&player_center),
            Direction::Down => self.frame.offset_y(-0.6).contains_or_touches(&player_center),
            Direction::Left => self.frame.offset_x(0.6).contains_or_touches(&player_center),
            Direction::Unknown | Direction::Still => false
        }
    }

    fn pushable_set_still(&mut self) {
        self.current_speed = 0.0;
        self.direction = Direction::Still;
    }
}