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

        if oy > dy && ox < dx { return Direction::UpRight }
        if oy < dy && ox < dx { return Direction::DownRight }
        if oy < dy && ox > dx { return Direction::DownLeft }
        if oy > dy && ox > dx { return Direction::UpLeft }

        if oy > dy { return Direction::Up }
        if ox < dx { return Direction::Right }
        if oy < dy { return Direction::Down }
        if ox > dx { return Direction::Left }
        
        default
    }
    
    pub fn between_points_with_current(origin: &Vector2d, destination: &Vector2d, current: Direction) -> Self {
        Self::between_points(origin, destination, current)
    }

    pub fn components(&self) -> Vec<Self> {
        match self {
            Direction::Up => vec![Direction::Up],
            Direction::UpRight => vec![Direction::Up, Direction::Right],
            Direction::Right => vec![Direction::Right],
            Direction::DownRight => vec![Direction::Down, Direction::Right],
            Direction::Down => vec![Direction::Down],
            Direction::DownLeft => vec![Direction::Down, Direction::Left],
            Direction::Left => vec![Direction::Left],
            Direction::UpLeft => vec![Direction::Up, Direction::Left],
            Direction::None => vec![]
        }
    }

    pub fn as_offset(&self) -> (f32, f32) {
        match self {
            Direction::Up => (0.0, -1.0),
            Direction::UpRight => (0.7, -0.7),
            Direction::Right => (1.0, 0.0),
            Direction::DownRight => (0.7, 0.7),
            Direction::Down => (0.0, 1.0),
            Direction::DownLeft => (-0.7, 0.7),
            Direction::Left => (-1.0, 0.0),
            Direction::UpLeft => (-0.7, -0.7),
            Direction::None => (0.0, 0.0),
        }  
    }

    pub fn from_data(up: bool, right: bool, down: bool, left: bool) -> Option<Self> {
        match (up, right, down, left) {
            (false, false , false, false) => Some(Direction::None),
            (true, false , false, false) => Some(Direction::Up),
            (true, true , false, false) => Some(Direction::UpRight),
            (false, true , false, false) => Some(Direction::Right),
            (false, true , true, false) => Some(Direction::DownRight),
            (false, false , true, false) => Some(Direction::Down),
            (false, false , true, true) => Some(Direction::DownLeft),
            (false, false , false, true) => Some(Direction::Left),
            (true, false , false, true) => Some(Direction::UpLeft),
            _ => None,
        }
    }

    pub fn opposite(&self) -> Direction {
        match self {
            Direction::Up => Direction::Down,
            Direction::UpRight => Direction::DownLeft,
            Direction::Right => Direction::Left,
            Direction::DownRight => Direction::UpLeft,
            Direction::Down => Direction::Up,
            Direction::DownLeft => Direction::UpRight,
            Direction::Left => Direction::Right,
            Direction::UpLeft => Direction::DownRight,
            Direction::None => Direction::None,
        }
    }

    pub fn turn_right(&self) -> Direction {
        match self {
            Direction::Up => Direction::UpRight,
            Direction::UpRight => Direction::Right,
            Direction::Right => Direction::DownRight,
            Direction::DownRight => Direction::Down,
            Direction::Down => Direction::DownLeft,
            Direction::DownLeft => Direction::Left,
            Direction::Left => Direction::UpLeft,
            Direction::UpLeft => Direction::Up,
            Direction::None => Direction::None,
        }
    }

    pub fn turn_left(&self) -> Direction {
        match self {
            Direction::Up => Direction::UpLeft,
            Direction::UpRight => Direction::Up,
            Direction::Right => Direction::UpRight,
            Direction::DownRight => Direction::Right,
            Direction::Down => Direction::DownRight,
            Direction::DownLeft => Direction::Down,
            Direction::Left => Direction::DownLeft,
            Direction::UpLeft => Direction::Left,
            Direction::None => Direction::None,
        }
    }
}