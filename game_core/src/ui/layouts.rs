use crate::utils::rect::FRect;

use super::components::{NonColor, View};

#[derive(Debug, PartialEq, Eq, Hash)]
pub enum AnchorPoint {
    Center,
    TopLeft,
    TopRight,
    BottomCenter,
    BottomLeft,
    BottomRight
}

pub struct Layout {
    pub frame: FRect,
    pub background_color: NonColor,
    pub children: Vec<(AnchorPoint, View)>,
}

impl Layout {
    pub fn new(
        w: f32, 
        h: f32, 
        background_color: NonColor, 
        children: Vec<(AnchorPoint, View)>
    ) -> Self {
        Self { 
            background_color,
            frame: FRect::new(0.0, 0.0, w, h), 
            children 
        }
    }
}