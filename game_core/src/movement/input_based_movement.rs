use crate::{features::entity::Entity, worlds::world::World};

impl Entity {
    pub fn move_based_on_player_input(
        &mut self, 
        world: &World, 
        time_since_last_update: f32
    ) { 
        let input_direction = world.players[self.player_index].direction_based_on_current_keys;
        self.move_with_new_direction(&input_direction, world, time_since_last_update);
    }
}