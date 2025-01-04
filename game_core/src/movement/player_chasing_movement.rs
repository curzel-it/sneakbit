
use crate::{currently_active_players, features::entity::Entity, utils::{directions::Direction, rect::FRect}, worlds::world::World};

impl Entity {
    pub fn move_chasing_player(&mut self, world: &World, time_since_last_update: f32) {
        if let Some(player) = self.first_active_vulnerable_player_in_line_of_sight(world) {
            self.direction = Direction::between_points_with_current(
                &self.frame.center(), 
                &player.center(), 
                self.direction
            );
            self.move_straight(world, time_since_last_update);
        } else {
            self.move_around_free(world, time_since_last_update);
        }
    }
    
    pub fn first_active_vulnerable_player_in_line_of_sight(&self, world: &World) -> Option<FRect> {
        let me = self.hittable_frame(); 
        let exclude = self.my_and_players_ids();

        let vision_x = self.frame.w * 4.0;
        let vision_y = self.frame.h * 4.0;

        for &player_index in currently_active_players().iter() {
            let player = &world.players[player_index].props;
            let player_frame = player.hittable_frame;            

            let min_x = me.x.min(player_frame.x);
            let max_x = me.max_x().max(player_frame.max_x());
            let min_y = me.y.min(player_frame.y);
            let max_y = me.max_y().max(player_frame.max_y());
            let distance_x = max_x - min_x;
            let distance_y = max_y - min_y;

            if distance_x < vision_x || distance_y < vision_y {
                let vision_rect = FRect::new(min_x, min_y, distance_x, distance_y);

                if !world.area_hits(&exclude, &vision_rect) {
                    return Some(player.hittable_frame);
                }
            }
        }
        None
    }
}