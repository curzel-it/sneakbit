use serde::{Deserialize, Serialize};

use super::{rect::FRect, vector::Vector2d};

#[derive(Default, Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    Up = 0,
    UpRight,
    Right,
    DownRight,
    Down,
    DownLeft,
    Left,
    UpLeft,
    #[default]
    Unknown,
    Still,
}

impl Direction {
    pub fn as_vector(&self) -> Vector2d {
        let (col, row) = self.as_offset();
        Vector2d::new(col, row)
    }

    pub fn between_rects(source: &FRect, other: &FRect) -> Self {
        Self::between_points(
            &source.center(), 
            &other.center(), 
            Direction::Unknown
        )
    }

    pub fn between_points(origin: &Vector2d, destination: &Vector2d, default: Direction) -> Direction {
        if origin.y > destination.y && origin.x < destination.x { return Direction::UpRight }
        if origin.y > destination.y && origin.x > destination.x { return Direction::UpLeft }
        if origin.y < destination.y && origin.x < destination.x { return Direction::DownRight }
        if origin.y < destination.y && origin.x > destination.x { return Direction::DownLeft }
        if origin.y > destination.y { return Direction::Up }
        if origin.x < destination.x { return Direction::Right }
        if origin.y < destination.y { return Direction::Down }
        if origin.x > destination.x { return Direction::Left }
        default
    }

    pub fn as_offset(&self) -> (f32, f32) {
        match self {
            Direction::Still => (0.0, 0.0),
            Direction::Up => (0.0, -1.0),
            Direction::UpRight => (0.707, -0.707),
            Direction::Right => (1.0, 0.0),
            Direction::DownRight => (0.707, 0.707),
            Direction::Down => (0.0, 1.0),
            Direction::DownLeft => (-0.707, 0.707),
            Direction::Left => (-1.0, 0.0),
            Direction::UpLeft => (-0.707, -0.707),
            Direction::Unknown => (0.0, 0.0),
        }  
    }

    pub fn from_data(up: bool, right: bool, down: bool, left: bool) -> Self {
        match (up, right, down, left) {
            (false, false , false, false) => Direction::Still,
            (true, false , false, false) => Direction::Up,
            (true, true , false, false) => Direction::UpRight,
            (false, true , false, false) => Direction::Right,
            (false, true , true, false) => Direction::DownRight,
            (false, false , true, false) => Direction::Down,
            (false, false , true, true) => Direction::DownLeft,
            (false, false , false, true) => Direction::Left,
            (true, false , false, true) => Direction::UpLeft,
            _ => Direction::Unknown,
        }
    }

    pub fn opposite(&self) -> Direction {
        match self {
            Direction::Still => Direction::Still,
            Direction::Up => Direction::Down,
            Direction::UpRight => Direction::DownLeft,
            Direction::Right => Direction::Left,
            Direction::DownRight => Direction::UpLeft,
            Direction::Down => Direction::Up,
            Direction::DownLeft => Direction::UpRight,
            Direction::Left => Direction::Right,
            Direction::UpLeft => Direction::DownRight,
            Direction::Unknown => Direction::Unknown,
        }
    }

    pub fn turn_right(&self) -> Direction {
        match self {
            Direction::Still => Direction::Still,
            Direction::Up => Direction::UpRight,
            Direction::UpRight => Direction::Right,
            Direction::Right => Direction::DownRight,
            Direction::DownRight => Direction::Down,
            Direction::Down => Direction::DownLeft,
            Direction::DownLeft => Direction::Left,
            Direction::Left => Direction::UpLeft,
            Direction::UpLeft => Direction::Up,
            Direction::Unknown => Direction::Unknown,
        }
    }

    pub fn turn_left(&self) -> Direction {
        match self {
            Direction::Still => Direction::Still,
            Direction::Up => Direction::UpLeft,
            Direction::UpRight => Direction::Up,
            Direction::Right => Direction::UpRight,
            Direction::DownRight => Direction::Right,
            Direction::Down => Direction::DownRight,
            Direction::DownLeft => Direction::Down,
            Direction::Left => Direction::DownLeft,
            Direction::UpLeft => Direction::Left,
            Direction::Unknown => Direction::Unknown,
        }
    }
}