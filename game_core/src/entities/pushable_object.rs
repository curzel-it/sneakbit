use crate::{features::{entity::Entity, entity_props::EntityProps, state_updates::WorldStateUpdate}, utils::{directions::Direction, rect::FRect}, worlds::world::World};

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
        if player_props.speed <= 0.0 || matches!(player_props.direction, Direction::None) {            
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
        
        match player.direction {
            Direction::Up => self.frame.offset_y(0.6).contains_or_touches(&player_center),
            Direction::UpRight => self.frame.offset(-0.6, 0.6).contains_or_touches(&player_center),
            Direction::Right => self.frame.offset_x(-0.6).contains_or_touches(&player_center),
            Direction::DownRight => self.frame.offset(-0.6, -0.6).contains_or_touches(&player_center),
            Direction::Down => self.frame.offset_y(-0.6).contains_or_touches(&player_center),
            Direction::DownLeft => self.frame.offset(0.6, -0.6).contains_or_touches(&player_center),
            Direction::Left => self.frame.offset_x(0.6).contains_or_touches(&player_center),
            Direction::UpLeft => self.frame.offset(0.6, 0.6).contains_or_touches(&player_center),
            Direction::Vector(dx, dy) => {
                self.frame.offset(-dx, -dy).contains_or_touches(&player_center)
            },
            Direction::None => false
        }
    }

    fn pushable_set_still(&mut self) {
        self.current_speed = 0.0;
        self.direction = Direction::None;
    }
}