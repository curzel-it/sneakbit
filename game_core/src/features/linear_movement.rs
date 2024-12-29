use crate::{config::config, constants::{PLAYER1_ENTITY_ID, TILE_SIZE}, features::entity::Entity, utils::{directions::Direction, rect::FRect}, worlds::world::World};

impl Entity {
    pub fn move_linearly(&mut self, world: &World, time_since_last_update: f32) { 
        if self.current_speed == 0.0 || matches!(self.direction, Direction::Unknown) {
            return
        }
        
        let d = self.direction.as_vector();
        let base_speed = config().base_entity_speed;
        let dx = d.x * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let dy = d.y * self.current_speed * base_speed * time_since_last_update / TILE_SIZE;
        let next_collidable_frame = self.hittable_frame().offset(dx, dy);

        if !world.bounds.contains(&next_collidable_frame) {
            return
        }
        if self.is_rigid {
            if world.area_hits(&self.id, &next_collidable_frame) {
                if self.is_player() && world.frame_is_slippery_surface(&self.hittable_frame()) {
                    self.current_speed = 0.0;
                }
                return
            }
            // if !can_step_over_hero(self) && would_collide_with_hero(&frame, &self.direction, world) {
            //    println!("#{} Would step over hero, skipping", self.id);
            //    return
            // }
        }

        self.frame = self.frame.offset(dx, dy);        
    } 
}

pub fn would_collide(frame: &FRect, direction: &Direction, world: &World) -> bool {
    let (col_offset, row_offset) = direction.as_col_row_offset();
    let base_y = frame.y + frame.h - 1.0;
    let base_x = frame.x;
    let x = base_x + col_offset;
    let y = base_y + row_offset;
    world.hits(x, y)
}

pub fn would_over_weight(frame: &FRect, direction: &Direction, world: &World) -> bool {
    let (col_offset, row_offset) = direction.as_col_row_offset();
    let base_y = frame.y + frame.h - 1.0;
    let base_x = frame.x;
    let x = base_x + col_offset;
    let y = base_y + row_offset;
    world.has_weight(x, y)
}

pub fn would_collide_with_hero(frame: &FRect, direction: &Direction, world: &World) -> bool {
    let (col_offset, row_offset) = direction.as_col_row_offset();
    let y = frame.y + frame.h - 1.0 + row_offset;
    let x = frame.x + col_offset;
    let hero = world.players[0].props.hittable_frame;
    hero.x == x && hero.y == y 
}