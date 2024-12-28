use std::{f32::EPSILON, ops::Add};

use serde::{Deserialize, Serialize};

#[derive(Copy, Clone, Debug, Default, Serialize, Deserialize)]
#[repr(C)]
pub struct Vector2d {
    pub x: f32,
    pub y: f32,
}

impl PartialEq for Vector2d {
    fn eq(&self, other: &Self) -> bool {
        (self.x - other.x).abs() < EPSILON && (self.y - other.y).abs() < EPSILON
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

    pub fn is_close_to_int(&self) -> bool {
        (self.x - self.x.floor()).abs() < EPSILON && (self.y - self.y.floor()).abs() < EPSILON
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

    pub fn is_zero(&self) -> bool {
        self.x.abs() < EPSILON && self.y.abs() < EPSILON
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