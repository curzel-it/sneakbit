use serde::{Deserialize, Serialize};

use super::{directions::Direction, vector::Vector2d};

#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[repr(C)]
pub struct IntRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

impl IntRect {
    pub const fn new(x: i32, y: i32, w: i32, h: i32) -> Self {
        IntRect { x, y, w, h }
    }

    pub fn from_origin(w: i32, h: i32) -> Self {
        Self::new(0, 0, w, h)
    }

    pub fn square_from_origin(size: i32) -> Self {
        Self::from_origin(size, size)
    }

    pub fn center(&self) -> Vector2d {
        Vector2d::new(
            self.x as f32 + self.w as f32 / 2.0, 
            self.y as f32 + self.h as f32 / 2.0
        )
    }

    pub fn center_in(&mut self, other: &IntRect) {
        self.center_at(&other.center())
    }

    pub fn center_at(&mut self, point: &Vector2d) {
        self.x = (point.x - (self.w as f32 / 2.0)).floor() as i32;
        self.y = (point.y - (self.h as f32 / 2.0)).floor() as i32;
    }

    pub fn offset(&self, dx: i32, dy: i32) -> Self {
        Self::new(self.x + dx, self.y + dy, self.w, self.h)
    }

    pub fn offset_x(&self, dx: i32) -> Self {
        self.offset(dx, 0)
    }

    pub fn offset_y(&self, dy: i32) -> Self {
        self.offset(0, dy)
    }

    pub fn with_h(&self, h: i32) -> Self {
        Self::new(self.x, self.y, self.w, h)
    }

    pub fn size(&self) -> Vector2d {
        Vector2d::new(self.w as f32, self.h as f32)
    }

    pub fn is_around_and_pointed_at(&self, other: &IntRect, direction: &Direction) -> bool {
        if self.x == other.x && self.y == other.y {
            return true
        }

        let is_just_above_other = self.y == other.y || self.y == other.y.saturating_sub(1);

        match direction {
            Direction::Up => self.y == other.y + other.h && self.x >= other.x && self.x < other.x + other.w,
            Direction::Right => self.x == other.x.saturating_sub(1) && self.y > other.y && self.y < other.y + other.h,
            Direction::Down => is_just_above_other && self.x >= other.x && self.x < other.x + other.w,
            Direction::Left => self.x == other.x + other.w && self.y > other.y && self.y < other.y + other.h,
            Direction::Unknown => false,
            Direction::Still => false,
        }
    }
    
    pub fn contains_or_touches_tile(&self, x: i32, y: i32) -> bool {
        let max_x = self.x + self.w;
        let max_y = self.y + self.h;
        self.x <= x && x < max_x && self.y <= y && y < max_y
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_rect() {
        let rect = IntRect::new(10, 20, 30, 40);
        assert_eq!(rect.x, 10);
        assert_eq!(rect.y, 20);
        assert_eq!(rect.w, 30);
        assert_eq!(rect.h, 40);
    }

    #[test]
    fn test_center_in() {
        let mut rect = IntRect::new(0, 0, 10, 10);
        let outer_rect = IntRect::new(10, 10, 20, 20);
        rect.center_in(&outer_rect);
        assert_eq!(rect.x, 15);
        assert_eq!(rect.y, 15);
    }
}
