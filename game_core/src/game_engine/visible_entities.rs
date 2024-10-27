use std::collections::HashSet;

use crate::{constants::HERO_ENTITY_ID, utils::rect::IntRect};

use super::world::World;

impl World {
    pub fn compute_visible_entities(&self, viewport: &IntRect) -> HashSet<(usize, u32)> {
        let min_row = (viewport.y - 1).max(0);
        let max_row = (viewport.y + viewport.h + 1).min(self.bounds.y + self.bounds.h);
        let min_col = (viewport.x - 1).max(0);
        let max_col = (viewport.x + viewport.w + 1).min(self.bounds.x + self.bounds.w);

        self.entities.borrow().iter()
            .enumerate()
            .filter_map(|(index, e)| {
                let id = e.id;
                let frame = e.frame;
                let max_y = frame.y + frame.h;
                let max_x = frame.x + frame.w;
                let is_inside_viewport = max_y >= min_row && frame.y <= max_row && max_x >= min_col && frame.x <= max_col;

                if id == HERO_ENTITY_ID || is_inside_viewport {
                    Some((index, id))
                } else {
                    None
                }
            })
            .collect()
    }
}