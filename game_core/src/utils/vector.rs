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

    pub fn from_indeces(x: usize, y: usize) -> Self {
        Self::new(x as f32, y as f32)
    }

    pub fn scaled(&self, value: f32) -> Self {
        Self::new(self.x * value, self.y * value)
    }
    
    pub fn distance_to(&self, other: &Vector2d) -> f32 {
        ((self.x - other.x).powf(2.0) + (self.y - other.y).powf(2.0)).sqrt()
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
    pub fn is_close_to_tile(&self, tolerance: f32) -> bool {
        let x = self.x.abs();
        let y = self.y.abs();
        (x - x.floor()) < tolerance && (y - y.floor()) < tolerance
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