use crate::{features::{entity::Entity, entity_props::EntityProps, state_updates::WorldStateUpdate}, worlds::world::World};

impl Entity {
    pub fn update_pushable(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        self.update_pushable_with_player_props(
            &world.players[0].props, 
            world, 
            time_since_last_update
        );

        vec![]
    }

    fn update_pushable_with_player_props(&mut self, props: &EntityProps, world: &World, time_since_last_update: f32){  
        let player = props.hittable_frame;
        let player_direction = props.direction;       

        if player.is_around_and_pointed_at(&self.frame, &player_direction) && props.speed > 0.0 {
            self.direction = player_direction;
            self.current_speed = 1.2 * world.players[0].props.speed;
            self.move_linearly(world, time_since_last_update);
        } else {
            self.current_speed = 0.0;
        }
    }
}

