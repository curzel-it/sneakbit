use crate::{features::engine::GameEngine, multiplayer::turns::GameTurn, text, ui::components::{Spacing, Typography, COLOR_DEBUG_INFO_BACKGROUND}, vstack, zstack};

use super::{components::{empty_view, NonColor, View, WithAlpha, COLOR_DEATH_SCREEN_BACKGROUND, COLOR_LOADING_SCREEN_BACKGROUND, COLOR_TRANSPARENT}, layouts::{AnchorPoint, Layout}};

impl GameEngine {
    pub fn hud_ui(&self, width: i32, height: i32, show_debug_info: bool, fps: u32) -> Layout {
        Layout::new(
            width, 
            height, 
            self.hud_background_color(),
            vec![
                (AnchorPoint::TopLeft, self.basic_info_hud_ui()),
                (AnchorPoint::BottomCenter, self.menu.ui(&self.camera_viewport)),
                (AnchorPoint::BottomCenter, self.confirmation_dialog.ui()),
                (AnchorPoint::BottomCenter, self.long_text_display.ui()),
                (AnchorPoint::BottomCenter, self.weapons_selection.ui()),
                (AnchorPoint::TopRight, self.toast.regular_toast_ui()),
                (AnchorPoint::TopLeft, self.toast.hint_toast_ui()),
                (AnchorPoint::BottomLeft, self.debug_info(show_debug_info, fps)),
                (AnchorPoint::BottomRight, self.turn_time_left_ui()),
                (AnchorPoint::Center, self.death_screen.ui()),
                (AnchorPoint::Center, self.loading_screen.ui())
            ]
        )
    }

    fn turn_time_left_ui(&self) -> View {
        if self.number_of_players == 1 {
            return empty_view()
        }
        match self.turn {
            GameTurn::RealTime => empty_view(),
            GameTurn::Player(_, time_left) => {
                let text = format!("{:0.1}\"", time_left);
                zstack!(
                    Spacing::MD,
                    COLOR_TRANSPARENT,
                    text!(Typography::Countdown, text)
                )                
            },
        }        
    }

    fn basic_info_hud_ui(&self) -> View {
        self.basic_info_hud.ui(
            &self.turn, 
            self.number_of_players, 
            &self.dead_players
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

    fn debug_info(&self, show_debug_info: bool, fps: u32) -> View {
        if show_debug_info {
            let hero = self.world.players[0].props;
            zstack!(
                Spacing::MD,
                COLOR_DEBUG_INFO_BACKGROUND,
                vstack!(
                    Spacing::MD,
                    text!(Typography::Regular, format!("Fps: {}", fps)),
                    text!(Typography::Regular, format!("x {} y {}", hero.hittable_frame.x, hero.hittable_frame.y)),
                    text!(Typography::Regular, format!("World Id: {}", self.world.id)),
                    text!(Typography::Regular, format!("Hp: {:0.1}%", hero.hp))
                )
            )
        } else {
            empty_view()
        }
    }
}