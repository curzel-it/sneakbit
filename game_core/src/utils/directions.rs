use serde::{Deserialize, Serialize};

use super::{rect::FRect, vector::Vector2d};

#[derive(Default, Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    Up = 0,
    Right,
    Down,
    Left,
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
        let ox = (origin.x * 10.0).floor();
        let oy = (origin.y * 10.0).floor();
        let dx = (destination.x * 10.0).floor();
        let dy = (destination.y * 10.0).floor();

        if oy > dy { return Direction::Up }
        if ox < dx { return Direction::Right }
        if oy < dy { return Direction::Down }
        if ox > dx { return Direction::Left }
        default
    }
    
    pub fn between_points_with_current(origin: &Vector2d, destination: &Vector2d, current: Direction) -> Direction {
        if current.is_valid_between(origin, destination) {
            return current
        }
        Self::between_points(origin, destination, current)
    }

    pub fn simplified(&self) -> Self {
        match self {
            Direction::Up => Direction::Up,
            Direction::Right => Direction::Right,
            Direction::Down => Direction::Down,
            Direction::Left => Direction::Left,
            Direction::Unknown => Direction::Unknown,
            Direction::Still => Direction::Still,
        }
    }
    
    pub fn is_valid_between(&self, origin: &Vector2d, destination: &Vector2d) -> bool {
        let expected_direction = Self::between_points(origin, destination, Direction::Unknown);
        match self {
            Direction::Up => matches!(expected_direction, Direction::Up),
            Direction::Down => matches!(expected_direction, Direction::Down),
            Direction::Left => matches!(expected_direction, Direction::Left),
            Direction::Right => matches!(expected_direction, Direction::Right),
            Direction::Still => expected_direction == Direction::Still,
            Direction::Unknown => expected_direction == Direction::Unknown,
        }
    }

    pub fn as_offset(&self) -> (f32, f32) {
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
            (true, false , false, false) => Direction::Up,
            (false, true , false, false) => Direction::Right,
            (false, false , true, false) => Direction::Down,
            (false, false , false, true) => Direction::Left,
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
            Direction::Down => Direction::Right,
            Direction::Left => Direction::Down,
            Direction::Unknown => Direction::Unknown,
        }
    }
}