
use crate::{features::entity::Entity, worlds::world::World};

impl Entity {
    pub fn move_around_free(&mut self, world: &World, time_since_last_update: f32) {
        let exclude = self.my_and_players_ids();

        for direction in &self.next_direction_options() {
            let (next, next_collidable) = self.projected_frames_by_moving_straight(direction, time_since_last_update);

            if !world.area_hits(&exclude, &next_collidable) {
                self.frame = next;
                self.direction = direction.clone();
                return
            }
        }
        self.unstuck(world)
    }

    fn unstuck(&mut self, world: &World) {
        let exclude = self.my_and_players_ids();

        let offsets = vec![
            (1.0, 0.0),
            (-1.0, 0.0),
            (0.0, 1.0),
            (0.0, -1.0),
            (1.0, 1.0),
            (-1.0, 1.0),
            (1.0, -1.0),
            (-1.0, -1.0)
        ];
        
        let initial = self.hittable_frame();

        for (dx, dy) in offsets {
            let next = initial.offset(dx, dy);
            if !world.area_hits(&exclude, &next) {
                self.frame = self.frame.offset(dx, dy);
                return 
            }
        }
    }
}