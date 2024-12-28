use serde::{Deserialize, Serialize};

use super::{rect::FRect, vector::Vector2d};

#[derive(Default, Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    Up = 0,
    Down,
    Right,
    Left,
    #[default]
    Unknown,
    Still,
}

impl Direction {
    pub fn as_vector(&self) -> Vector2d {
        let (col, row) = self.as_col_row_offset();
        Vector2d::new(col as f32, row as f32)
    }

    pub fn as_col_row_offset(&self) -> (f32, f32) {
        match self {
            Direction::Still => (0.0, 0.0),
            Direction::Up => (0.0, -1.0),
            Direction::Right => (1.0, 0.0),
            Direction::Down => (0.0, 1.0),
            Direction::Left => (-1.0, 0.0),
            Direction::Unknown => (0.0, 0.0),
        }  
    }

    pub fn from_data(up: bool, right: bool, down: bool, left: bool) -> Self {
        match (up, right, down, left) {
            (false, false , false, false) => Direction::Still,
            (false, false , false, true) => Direction::Left,
            (false, false , true, false) => Direction::Down,
            (false, true , false, false) => Direction::Right,
            (true, false , false, false) => Direction::Up,
            _ => Direction::Unknown,
        }
    }

    pub fn opposite(&self) -> Direction {
        match self {
            Direction::Still => Direction::Still,
            Direction::Up => Direction::Down,
            Direction::Right => Direction::Left,
            Direction::Down => Direction::Up,
            Direction::Left => Direction::Right,
            Direction::Unknown => Direction::Unknown,
        }
    }

    pub fn turn_right(&self) -> Direction {
        match self {
            Direction::Still => Direction::Still,
            Direction::Up => Direction::Right,
            Direction::Right => Direction::Down,
            Direction::Down => Direction::Left,
            Direction::Left => Direction::Up,
            Direction::Unknown => Direction::Unknown,
        }
    }

    pub fn turn_left(&self) -> Direction {
        match self {
            Direction::Still => Direction::Still,
            Direction::Up => Direction::Left,
            Direction::Right => Direction::Up,
            Direction::Down => Direction::Left,
            Direction::Left => Direction::Down,
            Direction::Unknown => Direction::Unknown,
        }
    }
}

pub fn direction_between_rects(source: &FRect, other: &FRect) -> Direction {
    if source.x > other.x { return Direction::Left }
    if source.x < other.x { return Direction::Right }
    if source.y > other.y { return Direction::Up }
    if source.y < other.y { return Direction::Down }
    Direction::Unknown
}