use std::ops::Add;

use serde::{Deserialize, Serialize};

use super::math::ZeroComparable;

#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize)]
#[repr(C)]
pub struct Vector2d {
    pub x: f32,
    pub y: f32,
}

impl PartialEq for Vector2d {
    fn eq(&self, other: &Self) -> bool {
        (self.x - other.x).is_zero() && (self.y - other.y).is_zero()
    }
}

impl Eq for Vector2d {}

impl Vector2d {
    pub const fn new(x: f32, y: f32) -> Self {
        Self { x, y }
    }

    pub const fn zero() -> Self {
        Self::new(0.0, 0.0)
    }

    pub fn from_angle(radians: f32) -> Self {
        Self::new(radians.cos(), radians.sin())
    }

    pub fn from_indeces(x: usize, y: usize) -> Self {
        Self::new(x as f32, y as f32)
    }

    pub fn scaled(&self, value: f32) -> Self {
        Self::new(self.x * value, self.y * value)
    }
    
    pub fn dumb_distance_to(&self, other: &Vector2d) -> f32 {
        (self.x - other.x).abs() + (self.y - other.y).abs()
    }

    pub fn offset(&self, x: f32, y: f32) -> Self {
        Self::new(self.x + x, self.y + y)
    }

    pub fn offset_x(&self, x: f32) -> Self {
        self.offset(x, 0.0)
    }

    pub fn offset_y(&self, y: f32) -> Self {
        self.offset(0.0, y)
    }

    pub fn values(&self) -> (f32, f32) {
        (self.x, self.y)
    }
}

impl ZeroComparable for Vector2d {
    fn is_zero(&self) -> bool {
        self.x.is_zero() && self.y.is_zero()
    }

    fn is_close_to_int(&self) -> bool {
        self.x.is_close_to_int() && self.y.is_close_to_int()
    }
}

impl Vector2d {    
    pub fn angle(&self) -> f32 {
        self.y.atan2(self.x)
    }

    pub fn rotated(&self, radians: f32) -> Self {
        let cos_theta = radians.cos();
        let sin_theta = radians.sin();
        Self::new(
            self.x * cos_theta - self.y * sin_theta,
            self.x * sin_theta + self.y * cos_theta,
        )
    }
}

impl Add for Vector2d {
    type Output = Self;

    fn add(self, other: Self) -> Self {
        Self {
            x: self.x + other.x,
            y: self.y + other.y,
        }
    }
}