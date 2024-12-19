use crate::features::engine::GameEngine;

use super::{components::{NonColor, WithAlpha, COLOR_DEATH_SCREEN_BACKGROUND, COLOR_LOADING_SCREEN_BACKGROUND, COLOR_TRANSPARENT}, layouts::{AnchorPoint, Layout}};

impl GameEngine {
    pub fn hud_ui(&self, width: i32, height: i32) -> Layout {
        Layout::new(
            width, 
            height, 
            self.hud_background_color(),
            vec![
                (AnchorPoint::TopRight, self.toast.regular_toast_ui()),
                (AnchorPoint::TopLeft, self.toast.hint_toast_ui()),
                (AnchorPoint::Center, self.death_screen.ui()),
                (AnchorPoint::Center, self.loading_screen.ui())
            ]
        )
    }
    
    fn hud_background_color(&self) -> NonColor {
        let progress = self.loading_screen.progress();
        if progress > 0.0 && progress < 1.0 {
            let alpha = if progress <= 0.5 { progress * 3.0 } else { 1.0 - (progress - 0.5) * 2.0 };
            return COLOR_LOADING_SCREEN_BACKGROUND.with_alpha(alpha)
        }
        if self.death_screen.is_open {
            return COLOR_DEATH_SCREEN_BACKGROUND
        }
        COLOR_TRANSPARENT
    }
}