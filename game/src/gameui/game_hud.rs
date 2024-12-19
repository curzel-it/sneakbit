use game_core::{cached_player_position, current_world_id, player_current_hp, text, ui::{components::{empty_view, Spacing, Typography, View, COLOR_DEBUG_INFO_BACKGROUND, COLOR_TRANSPARENT}, layouts::{AnchorPoint, Layout}}, vstack, zstack};

use crate::GameContext;

pub fn hud_ui(context: &GameContext, width: i32, height: i32, show_debug_info: bool, fps: u32) -> Layout {
    Layout::new(
        width, 
        height, 
        COLOR_TRANSPARENT, // self.hud_background_color(),
        vec![
            (AnchorPoint::BottomCenter, context.long_text_display.ui()),
            (AnchorPoint::BottomLeft, debug_info(show_debug_info, fps)),
            (AnchorPoint::BottomCenter, context.weapons_selection.ui()),
        ]
    )
}
    
fn debug_info(show_debug_info: bool, fps: u32) -> View {
    if !show_debug_info {
        return empty_view();
    }
    let hero = cached_player_position(0);
    let hp = player_current_hp(0);
    let world_id = current_world_id();
    
    zstack!(
        Spacing::MD,
        COLOR_DEBUG_INFO_BACKGROUND,
        vstack!(
            Spacing::MD,
            text!(Typography::Regular, format!("Fps: {}", fps)),
            text!(Typography::Regular, format!("x {} y {}", hero.x, hero.y)),
            text!(Typography::Regular, format!("World Id: {}", world_id)),
            text!(Typography::Regular, format!("Hp: {:0.1}%", hp))
        )
    )
}