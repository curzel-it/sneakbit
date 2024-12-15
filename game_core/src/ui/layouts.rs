use crate::utils::rect::IntRect;

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
    pub frame: IntRect,
    pub background_color: NonColor,
    pub children: Vec<(AnchorPoint, View)>,
}

impl Layout {
    pub fn new(
        w: i32, 
        h: i32, 
        background_color: NonColor, 
        children: Vec<(AnchorPoint, View)>
    ) -> Self {
        Self { 
            background_color,
            frame: IntRect::new(0, 0, w, h), 
            children 
        }
    }
}