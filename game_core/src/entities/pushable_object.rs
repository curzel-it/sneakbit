use crate::{features::{entity::Entity, entity_props::EntityProps, state_updates::WorldStateUpdate}, worlds::world::World};

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
        
        if !player.origin().is_close_to_int() {
            if player.is_around_and_pointed_at(&self.frame, &player_direction) && player_props.speed > 0.0 {
                self.direction = player_direction;
                self.current_speed = 1.2 * world.players[0].props.speed;
                self.move_linearly(world, time_since_last_update);
            } else {
                self.current_speed = 0.0;
            }
        }

        vec![]
    }
}

