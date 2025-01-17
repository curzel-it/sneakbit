use serde::{Deserialize, Serialize};

use super::{directions::Direction, math::ZeroComparable, vector::Vector2d};

#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize)]
#[repr(C)]
pub struct FRect {
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

impl PartialEq for FRect {
    fn eq(&self, other: &Self) -> bool {
        (self.x - other.x).is_zero() && 
        (self.y - other.y).is_zero() && 
        (self.w - other.w).is_zero() && 
        (self.h - other.h).is_zero()
    }
}

impl FRect {
    pub const fn new(x: f32, y: f32, w: f32, h: f32) -> Self {
        FRect { x, y, w, h }
    }

    pub fn from_origin(w: f32, h: f32) -> Self {
        Self::new(0.0, 0.0, w, h)
    }

    pub fn square_from_origin(size: f32) -> Self {
        Self::from_origin(size, size)
    }

    pub fn padded(&self, padding: (f32, f32, f32, f32)) -> Self {
        let (top, right, bottom, left) = padding;
        
        Self::new(
            self.x + left, 
            self.y + top, 
            self.w - left - right, 
            self.h - top - bottom
        )
    }

    pub fn padded_all(&self, padding: f32) -> Self {
        self.padded((padding, padding, padding, padding))
    }

    pub fn center(&self) -> Vector2d {
        Vector2d::new(
            self.x as f32 + self.w as f32 / 2.0, 
            self.y as f32 + self.h as f32 / 2.0
        )
    }

    pub fn origin(&self) -> Vector2d {
        Vector2d::new(self.x, self.y)
    }

    pub fn center_in(&mut self, other: &FRect) {
        self.center_at(&other.center())
    }

    pub fn center_at(&mut self, point: &Vector2d) {
        self.x = point.x - self.w / 2.0;
        self.y = point.y - self.h / 2.0;
    }

    pub fn centered_at(&self, point: &Vector2d) -> Self {
        let x = point.x - self.w / 2.0;
        let y = point.y - self.h / 2.0;
        Self::new(x, y, self.w, self.h)
    }

    pub fn offset(&self, dx: f32, dy: f32) -> Self {
        Self::new(self.x + dx, self.y + dy, self.w, self.h)
    }

    pub fn offset_by(&self, delta: (f32, f32)) -> Self {
        self.offset(delta.0, delta.1)
    }

    pub fn offset_x(&self, dx: f32) -> Self {
        self.offset(dx, 0.0)
    }

    pub fn offset_y(&self, dy: f32) -> Self {
        self.offset(0.0, dy)
    }

    pub fn with_h(&self, h: f32) -> Self {
        Self::new(self.x, self.y, self.w, h)
    }

    pub fn size(&self) -> Vector2d {
        Vector2d::new(self.w as f32, self.h as f32)
    }

    pub fn is_around_and_pointed_at(&self, other: &FRect, direction: &Direction) -> bool {
        // Step 1: Check if the rectangles overlap or touch
        if !self.overlaps_or_touches(other) {
            return false;
        }
    
        // Step 2: Calculate the centers of both rectangles
        let self_center = self.center();
        let other_center = other.center();
    
        // Step 3: Determine relative positions
        let is_above = self_center.y > other_center.y;
        let is_below = self_center.y < other_center.y;
        let is_left = self_center.x < other_center.x;
        let is_right = self_center.x > other_center.x;
    
        // Step 4: Match on the provided direction and verify alignment
        match direction {
            Direction::Up => {
                is_above
            },
            Direction::Down => {
                is_below
            },
            Direction::Left => {
                is_left
            },
            Direction::Right => {
                is_right
            },
            // Handle other directions as not matching
            Direction::None => {
                false
            }
        }
    }
        
    pub fn overlaps_or_touches(&self, other: &FRect) -> bool {        
        self.x <= other.x + other.w &&
        self.x + self.w >= other.x &&
        self.y <= other.y + other.h &&
        self.y + self.h >= other.y
    }
    
    pub fn contains_or_touches(&self, point: &Vector2d) -> bool {
        self.x <= point.x && point.x <= self.x + self.w && self.y <= point.y && point.y <= self.y + self.h
    }

    pub fn contains(&self, other: &FRect) -> bool {
        self.x <= other.x && self.max_x() >= other.max_x() && self.y <= other.y && self.max_y() >= other.max_y()
    }
    
    pub fn scaled(&self, scalar: f32) -> FRect {
        FRect::new(
            self.x * scalar,
            self.y * scalar,
            self.w * scalar,
            self.h * scalar
        )
    }
    
    pub fn scaled_from_center(&self, scalar: f32) -> FRect {
        let w = self.w * scalar;
        let h = self.h * scalar;
        let center = self.center();

        FRect::new(
            center.x - self.w / 2.0,
            center.y - self.h / 2.0,
            w, h
        )
    }

    pub fn with_closest_int_origin(&self) -> Self {
        Self::new(self.x.round(), self.y.round(), self.w, self.h)
    }

    pub fn with_closest_int_origin_x(&self) -> Self {
        Self::new(self.x.round(), self.y, self.w, self.h)
    }

    pub fn with_closest_int_origin_y(&self) -> Self {
        Self::new(self.x, self.y.round(), self.w, self.h)
    }
    
    pub fn max_x(&self) -> f32 {
        self.x + self.w
    }
    
    pub fn max_y(&self) -> f32 {
        self.y + self.h
    }

    pub fn intersects_line(&self, x1: f32, y1: f32, x2: f32, y2: f32) -> bool {
        let p1 = Vector2d::new(x1, y1);
        let p2 = Vector2d::new(x2, y2);

        if self.contains_or_touches(&p1) && self.contains_or_touches(&p2) {
            return true;
        }

        let edges = [
            ((self.x, self.y), (self.x + self.w, self.y)),
            ((self.x + self.w, self.y), (self.x + self.w, self.y + self.h)), 
            ((self.x + self.w, self.y + self.h), (self.x, self.y + self.h)), 
            ((self.x, self.y + self.h), (self.x, self.y)),
        ];

        for &((ex1, ey1), (ex2, ey2)) in &edges {
            if lines_intersect(x1, y1, x2, y2, ex1, ey1, ex2, ey2) {
                return true;
            }
        }

        false
    }
}

fn lines_intersect(x1: f32, y1: f32, x2: f32, y2: f32, x3: f32, y3: f32, x4: f32, y4: f32) -> bool {
    let denom = (y4 - y3) * (x2 - x1) - (x4 - x3) * (y2 - y1);
    if denom == 0.0 {
        return false;
    }

    let ua = ((x4 - x3) * (y1 - y3) - (y4 - y3) * (x1 - x3)) / denom;
    let ub = ((x2 - x1) * (y1 - y3) - (y2 - y1) * (x1 - x3)) / denom;

    ua >= 0.0 && ua <= 1.0 && ub >= 0.0 && ub <= 1.0
}