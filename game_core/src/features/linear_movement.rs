use crate::{config::config, constants::TILE_SIZE, game_engine::{entity::Entity, world::World}, utils::{directions::Direction, rect::IntRect, vector::Vector2d}};

impl Entity {
    pub fn move_linearly(&mut self, world: &World, time_since_last_update: f32) { 
        let frame = self.frame;

        if self.current_speed == 0.0 || matches!(self.direction, Direction::Unknown) {
            return
        }
        if would_exit_bounds(&frame, &self.direction, &world.bounds) {
            return
        }
        if self.is_rigid {
            if would_collide(&frame, &self.direction, &world) {
                if self.is_player() && world.frame_is_slippery_surface(&self.hittable_frame()) {
                    self.current_speed = 0.0;
                }
                return
            }
            if !can_step_over_hero(self) && would_collide_with_hero(&frame, &self.direction, world) {
                return
            }
        }
        
        let updated_offset = updated_offset(&self.offset, &self.direction, self.current_speed, time_since_last_update);    
        let tiles_x_f = updated_offset.x / TILE_SIZE;
        let tiles_y_f = updated_offset.y / TILE_SIZE;
        let tiles_x = if updated_offset.x > 0.0 { tiles_x_f.floor() } else { tiles_x_f.ceil() };
        let tiles_y = if updated_offset.y > 0.0 { tiles_y_f.floor() } else { tiles_y_f.ceil() };
        let tiles_x_i = tiles_x as i32;
        let tiles_y_i = tiles_y as i32;
        
        self.frame = frame.offset(tiles_x_i, tiles_y_i);

        if tiles_x != 0.0 || tiles_y != 0.0 {
            self.offset = Vector2d::zero();
            self.update_sorting_key();
        } else {
            self.offset = Vector2d::new(
                updated_offset.x - tiles_x * TILE_SIZE,
                updated_offset.y - tiles_y * TILE_SIZE
            );
        }
    }
}

fn can_step_over_hero(entity: &Entity) -> bool {
    entity.is_player() || entity.melee_attacks_hero()
}

fn updated_offset(offset: &Vector2d, direction: &Direction, speed: f32, time_since_last_update: f32) -> Vector2d {
    direction.as_vector()
        .scaled(speed)
        .scaled(time_since_last_update)
        .scaled(config().base_entity_speed) + *offset
}

fn would_exit_bounds(frame: &IntRect, direction: &Direction, bounds: &IntRect) -> bool {
    match direction {
        Direction::Up => frame.y <= bounds.y,
        Direction::Right => (frame.x + frame.w) >= (bounds.x + bounds.w),
        Direction::Down => (frame.y + frame.h) >= (bounds.y + bounds.h),
        Direction::Left => frame.x <= bounds.x,
        Direction::Unknown => false,
        Direction::Still => false,
    }
}

pub fn would_collide(frame: &IntRect, direction: &Direction, world: &World) -> bool {
    let (col_offset, row_offset) = direction.as_col_row_offset();
    let base_y = frame.y + frame.h - 1;
    let base_x = frame.x;
    let x = base_x + col_offset;
    let y = base_y + row_offset;
    world.hits(x, y)
}

pub fn would_over_weight(frame: &IntRect, direction: &Direction, world: &World) -> bool {
    let (col_offset, row_offset) = direction.as_col_row_offset();
    let base_y = frame.y + frame.h - 1;
    let base_x = frame.x;
    let x = base_x + col_offset;
    let y = base_y + row_offset;
    world.has_weight(x, y)
}

pub fn would_collide_with_hero(frame: &IntRect, direction: &Direction, world: &World) -> bool {
    let (col_offset, row_offset) = direction.as_col_row_offset();
    let y = frame.y + frame.h - 1 + row_offset;
    let x = frame.x + col_offset;
    let hero = world.players[0].props.hittable_frame;
    hero.x == x && hero.y == y 
}