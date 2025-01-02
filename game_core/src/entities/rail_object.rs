use crate::{config::config, constants::{RAIL_CHANGE_COOLDOWN, TILE_SIZE}, features::{entity::Entity, state_updates::WorldStateUpdate}, maps::constructions::Construction, utils::{directions::Direction, rect::FRect, vector::Vector2d}, worlds::world::World};

impl Entity {
    pub fn setup_rail(&mut self) {
        // ...
    }

    pub fn update_rail(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {  
        if world.is_on_rails(&self.frame.center()) {
            self.is_rigid = true;
            self.reset_speed();
            self.move_on_rails(world, time_since_last_update);
        } else {
            self.is_rigid = false;
            self.update_pushable(world, time_since_last_update);
        }
        vec![]
    }
    
    fn move_on_rails(&mut self, world: &World, time_since_last_update: f32) { 
        let base_speed = config().base_entity_speed;

        for direction in self.directions_to_check() {
            let d = direction.as_vector();

            let next = self.frame.padded_all(0.05).offset(d.x, d.y);
            if !world.is_fully_on_rails(&next) {
                continue
            }

            let dx = d.x * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
            let dy = d.y * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
    
            if self.direction != direction {
                self.frame = self.frame.with_closest_int_origin().offset(dx, dy);
                self.direction = direction;
                self.direction_change_cooldown = RAIL_CHANGE_COOLDOWN;
            } else {
                self.frame = self.frame.offset(dx, dy);
                self.direction_change_cooldown -= time_since_last_update;
            }
            break
        }
    } 

    fn directions_to_check(&self) -> Vec<Direction> {
        let d = self.direction;

        if matches!(d, Direction::Unknown | Direction::Still) {
            vec![Direction::Up, Direction::Right, Direction::Down, Direction::Left]
        } else {
            if self.direction_change_cooldown > 0.0 {
                vec![d]
            } else {
                vec![d, d.turn_right(), d.turn_left(), d.opposite()]
            }
        }
    }

    pub fn rail_object_hittable_frame(&self) -> FRect {
        self.frame
    }
}

impl World {
    pub fn is_fully_on_rails(&self, area: &FRect) -> bool {
        self.constructions_in(area)
            .iter()
            .all(|c| matches!(c, Construction::Rail))
    }
}

impl World {
    pub fn is_on_rails(&self, point: &Vector2d) -> bool {
        matches!(self.construction_at(point.x, point.y), Construction::Rail)
    }
    pub fn is_on_rails_f(&self, x: f32, y: f32) -> bool {
        matches!(self.construction_at(x, y), Construction::Rail)
    }
}