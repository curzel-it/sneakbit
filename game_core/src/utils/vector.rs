use std::ops::{Add, Sub, Mul, Div};
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

    pub const fn up() -> Self {
        Self::new(0.0, -1.0)
    }

    pub const fn up_right() -> Self {
        Self::new(0.7, -0.7)
    }

    pub const fn right() -> Self {
        Self::new(1.0, 0.0)
    }

    pub const fn down_right() -> Self {
        Self::new(0.7, 0.7)
    }

    pub const fn down() -> Self {
        Self::new(0.0, 1.0)
    }

    pub const fn down_left() -> Self {
        Self::new(-0.7, 0.7)
    }

    pub const fn left() -> Self {
        Self::new(-1.0, 0.0)
    }

    pub const fn up_left() -> Self {
        Self::new(-0.7, -0.7)
    }

    pub const fn zero() -> Self {
        Self::new(0.0, 0.0)
    }

    pub fn components(&self) -> Vec<Self> {
        vec![Self::new(self.x, 0.0), Self::new(0.0, self.y)]
    }

    pub fn from_indices(x: usize, y: usize) -> Self {
        Self::new(x as f32, y as f32)
    }

    pub fn from_data(up: bool, right: bool, down: bool, left: bool) -> Option<Self> {
        match (up, right, down, left) {
            (true, false, false, false) => Some(Self::up()),
            (true, true, false, false) => Some(Self::up_right()),
            (false, true, false, false) => Some(Self::right()),
            (false, true, true, false) => Some(Self::down_right()),
            (false, false, true, false) => Some(Self::down()),
            (false, false, true, true) => Some(Self::down_left()),
            (false, false, false, true) => Some(Self::left()),
            (true, false, false, true) => Some(Self::up_left()),
            (false, false, false, false) => Some(Self::zero()),
            _ => None
        }
    }

    pub fn is_left(&self) -> bool {
        self.x < 0.0 
    }

    pub fn is_right(&self) -> bool {
        self.x > 0.0 
    }

    pub fn is_up(&self) -> bool {
        self.y < 0.0 
    }

    pub fn is_down(&self) -> bool {
        self.y > 0.0 
    }

    pub fn scaled(&self, value: f32) -> Self {
        Self::new(self.x * value, self.y * value)
    }
    
    pub fn dumb_distance_to(&self, other: &Vector2d) -> f32 {
        (self.x - other.x).abs() + (self.y - other.y).abs()
    }

    pub fn distance_to(&self, other: &Vector2d) -> f32 {
        ((self.x - other.x).powi(2) + (self.y - other.y).powi(2)).sqrt()
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

    /// Returns the opposite vector (-x, -y)
    pub fn opposite(&self) -> Self {
        Self::new(-self.x, -self.y)
    }

    /// Rotates the vector by the given angle in degrees clockwise.
    pub fn rotate_right(&self, angle_degrees: f32) -> Self {
        let angle_radians = angle_degrees.to_radians();
        let cos_theta = angle_radians.cos();
        let sin_theta = angle_radians.sin();
        Self::new(
            self.x * cos_theta + self.y * sin_theta,
            -self.x * sin_theta + self.y * cos_theta,
        )
    }

    /// Rotates the vector by the given angle in degrees counter-clockwise.
    pub fn rotate_left(&self, angle_degrees: f32) -> Self {
        let angle_radians = angle_degrees.to_radians();
        let cos_theta = angle_radians.cos();
        let sin_theta = angle_radians.sin();
        Self::new(
            self.x * cos_theta - self.y * sin_theta,
            self.x * sin_theta + self.y * cos_theta,
        )
    }

    /// Normalizes the vector to have a magnitude of 1.
    pub fn normalize(&self) -> Self {
        let magnitude = self.magnitude();
        if magnitude.is_zero() {
            Self::zero()
        } else {
            Self::new(self.x / magnitude, self.y / magnitude)
        }
    }

    /// Returns the magnitude (length) of the vector.
    pub fn magnitude(&self) -> f32 {
        (self.x.powi(2) + self.y.powi(2)).sqrt()
    }

    /// Determines the direction vector from `origin` to `destination`.
    pub fn direction_to(origin: &Self, destination: &Self) -> Self {
        (*destination - *origin).normalize()
    }

    /// Checks if the vector is close to another vector within a given tolerance.
    pub fn is_close_to(&self, other: &Self, tolerance: f32) -> bool {
        (self.x - other.x).abs() < tolerance && (self.y - other.y).abs() < tolerance
    }

    /// Checks if the vector is close to integer coordinates within a given tolerance.
    pub fn is_close_to_int(&self, tolerance: f32) -> bool {
        (self.x - self.x.round()).abs() < tolerance && (self.y - self.y.round()).abs() < tolerance
    }

    /// Checks if the vector is close to tile boundaries within a given tolerance.
    pub fn is_close_to_tile(&self, tolerance: f32) -> bool {
        let x = self.x.abs();
        let y = self.y.abs();
        (x - x.floor()) < tolerance && (y - y.floor()) < tolerance
    }

    /// Constructs a vector based on directional flags.
    /// Similar to `Direction::from_data(up, right, down, left)`.
    pub fn from_direction_flags(up: bool, right: bool, down: bool, left: bool) -> Self {
        let mut x = 0.0;
        let mut y = 0.0;

        if up {
            y -= 1.0;
        }
        if right {
            x += 1.0;
        }
        if down {
            y += 1.0;
        }
        if left {
            x -= 1.0;
        }

        Self::new(x, y).normalize()
    }
}

impl ZeroComparable for Vector2d {
    fn is_zero(&self) -> bool {
        self.x.is_zero() && self.y.is_zero()
    }

    fn is_close_to_int(&self) -> bool {
        self.is_close_to_int(1e-5)
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

impl Sub for Vector2d {
    type Output = Self;

    fn sub(self, other: Self) -> Self {
        Self {
            x: self.x - other.x,
            y: self.y - other.y,
        }
    }
}

impl Mul<f32> for Vector2d {
    type Output = Self;

    fn mul(self, scalar: f32) -> Self {
        Self::new(self.x * scalar, self.y * scalar)
    }
}

impl Div<f32> for Vector2d {
    type Output = Self;

    fn div(self, scalar: f32) -> Self {
        Self::new(self.x / scalar, self.y / scalar)
    }
}
