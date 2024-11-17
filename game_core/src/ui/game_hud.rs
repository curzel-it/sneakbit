use crate::game_engine::engine::GameEngine;

use super::{components::{NonColor, COLOR_BLACK_70, COLOR_TRANSPARENT}, layouts::{AnchorPoint, Layout}};

impl GameEngine {
    pub fn hud_ui(&self, width: i32, height: i32) -> Layout {
        Layout::new(
            width, 
            height, 
            self.hud_background_color(),
            vec![
                (AnchorPoint::TopRight, self.inventory_status.ui()),
                (AnchorPoint::BottomCenter, self.menu.ui(&self.camera_viewport)),
                (AnchorPoint::BottomCenter, self.entity_options_menu.ui()),
                (AnchorPoint::BottomCenter, self.confirmation_dialog.ui()),
                (AnchorPoint::BottomCenter, self.long_text_display.ui()),
                (AnchorPoint::TopRight, self.toast.regular_toast_ui()),
                (AnchorPoint::TopLeft, self.toast.important_toast_ui()),
                (AnchorPoint::Center, self.death_screen.ui()),
                (AnchorPoint::Center, self.loading_screen.ui())
            ]
        )
    }
    
    fn hud_background_color(&self) -> NonColor {
        let progress = self.loading_screen.progress();
        if progress > 0.0 && progress < 1.0 {
            let alpha = if progress <= 0.5 { progress * 3.0 } else { 1.0 - (progress - 0.5) * 2.0 };
            let alpha_int = (alpha * 255.0) as u8;
            return (0, 0, 0, alpha_int)
        }
        if self.death_screen.is_open {
            return COLOR_BLACK_70
        }
        COLOR_TRANSPARENT
    }
}