use crate::{features::entity::Entity, utils::{rect::FRect, vector::Vector2d}, worlds::world::World};

impl Entity {
    pub fn move_chasing_player(&mut self, world: &World, time_since_last_update: f32) {
        let me = self.hittable_frame(); 
        let exclude = self.my_and_players_ids();

        let area = FRect::new(0.0, me.y, me.x, me.h);
        if let Some(player_index) = world.first_index_of_player_in(&area) {
            let player_position = world.players[player_index].props.frame.x;
            let area = FRect::new(player_position, me.y, me.x - player_position, me.h);

            if !world.area_hits(&exclude, &area) {
                self.direction = Vector2d::left();
                self.move_in_current_direction(world, time_since_last_update);
                return
            }
        }

        let area = FRect::new(me.max_x(), me.y, world.bounds.w - me.max_x(), me.h);
        if let Some(player_index) = world.first_index_of_player_in(&area) {
            let player_position = world.players[player_index].props.frame.x;
            let area = FRect::new(me.max_x(), me.y, player_position - me.max_x(), me.h);
            
            if !world.area_hits(&exclude, &area) {
                self.direction = Vector2d::right();
                self.move_in_current_direction(world, time_since_last_update);
                return
            }
        }

        self.move_around_free(world, time_since_last_update);
    }
}