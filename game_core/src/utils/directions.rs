use serde::{Deserialize, Serialize};

use super::{rect::FRect, vector::Vector2d};

#[derive(Default, Debug, Copy, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum Direction {
    Up = 0,
    Right,
    Down,
    Left,
    #[default]
    None
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
            Direction::None
        )
    }
    
    pub fn between_points(origin: &Vector2d, destination: &Vector2d, default: Direction) -> Direction {
        let ox = origin.x.round();
        let oy = origin.y.round();
        let dx = destination.x.round();
        let dy = destination.y.round();

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
            Direction::None => Direction::None
        }
    }
    
    pub fn is_valid_between(&self, origin: &Vector2d, destination: &Vector2d) -> bool {
        let expected_direction = Self::between_points(origin, destination, Direction::None);
        match self {
            Direction::Up => matches!(expected_direction, Direction::Up),
            Direction::Down => matches!(expected_direction, Direction::Down),
            Direction::Left => matches!(expected_direction, Direction::Left),
            Direction::Right => matches!(expected_direction, Direction::Right),
            Direction::None => expected_direction == Direction::None,
        }
    }

    pub fn as_offset(&self) -> (f32, f32) {
        match self {
            Direction::Up => (0.0, -1.0),
            Direction::Right => (1.0, 0.0),
            Direction::Down => (0.0, 1.0),
            Direction::Left => (-1.0, 0.0),
            Direction::None => (0.0, 0.0),
        }  
    }

    pub fn from_data(up: bool, right: bool, down: bool, left: bool) -> Option<Self> {
        match (up, right, down, left) {
            (false, false , false, false) => Some(Direction::None),
            (true, false , false, false) => Some(Direction::Up),
            (false, true , false, false) => Some(Direction::Right),
            (false, false , true, false) => Some(Direction::Down),
            (false, false , false, true) => Some(Direction::Left),
            _ => None,
        }
    }

    pub fn opposite(&self) -> Direction {
        match self {
            Direction::Up => Direction::Down,
            Direction::Right => Direction::Left,
            Direction::Down => Direction::Up,
            Direction::Left => Direction::Right,
            Direction::None => Direction::None,
        }
    }

    pub fn turn_right(&self) -> Direction {
        match self {
            Direction::Up => Direction::Right,
            Direction::Right => Direction::Down,
            Direction::Down => Direction::Left,
            Direction::Left => Direction::Up,
            Direction::None => Direction::None,
        }
    }

    pub fn turn_left(&self) -> Direction {
        match self {
            Direction::Up => Direction::Left,
            Direction::Right => Direction::Up,
            Direction::Down => Direction::Right,
            Direction::Left => Direction::Down,
            Direction::None => Direction::None,
        }
    }
}