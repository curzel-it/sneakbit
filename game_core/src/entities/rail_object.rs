use crate::{features::{entity::Entity, state_updates::WorldStateUpdate}, maps::construction_tiles::Construction, utils::directions::Direction, worlds::world::World};


impl Entity {
    pub fn setup_rail(&mut self) {
        // ...
    }

    pub fn update_rail(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        let is_on_rails = is_rail(world, self.frame.x, self.frame.y);
        let offset_is_zero = self.frame.origin().is_close_to_int();
        
        self.is_rigid = is_on_rails;

        if is_on_rails {
            if offset_is_zero {
                self.direction = self.select_next_rail(world);
            }
            if !matches!(self.direction, Direction::Unknown) {
                self.reset_speed();
                self.move_linearly(world, time_since_last_update);
            }
        } else {
            self.update_pushable(world, time_since_last_update);
        }
        vec![]
    }

    fn select_next_rail(&self, world: &World) -> Direction {
        let x = self.frame.x;
        let y = self.frame.y;

        for direction in self.directions_to_check() {
            let (dx, dy) = direction.as_col_row_offset();

            if is_rail(world, x + dx, y + dy) {
                return direction;
            }
        }
        Direction::Unknown
    }

    fn directions_to_check(&self) -> Vec<Direction> {
        match self.direction {
            Direction::Up => vec![Direction::Right, Direction::Up, Direction::Left, Direction::Down],
            Direction::Right => vec![Direction::Down, Direction::Right, Direction::Up, Direction::Left],
            Direction::Down => vec![Direction::Left, Direction::Down, Direction::Right, Direction::Up],
            Direction::Left => vec![Direction::Up, Direction::Left, Direction::Down, Direction::Right],
            _ => vec![]
        }
    }
}

fn is_rail(world: &World, x: f32, y: f32) -> bool {
    matches!(world.construction_at(x, y), Construction::Rail)
}