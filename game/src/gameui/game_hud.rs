use game_core::{cached_player_position, current_camera_viewport, current_game_mode, current_world_id, is_turn_based_game_mode, number_of_players, player_current_hp, text, time_left_for_current_turn, ui::{components::{empty_view, NonColor, Spacing, Typography, View, WithAlpha, COLOR_DEATH_SCREEN_BACKGROUND, COLOR_DEBUG_INFO_BACKGROUND, COLOR_LOADING_SCREEN_BACKGROUND, COLOR_TRANSPARENT}, layouts::{AnchorPoint, Layout}}, vstack, zstack};

use crate::GameContext;

pub fn update_game_hud(context: &mut GameContext) {
    context.basic_info_hud.update();
}

pub fn hud_ui(context: &GameContext, width: i32, height: i32, show_debug_info: bool, fps: u32) -> Layout {
    let is_dead = context.is_dead();
    let game_mode = &current_game_mode();

    Layout::new(
        width, 
        height, 
        hud_background_color(context),
        vec![
            (AnchorPoint::TopLeft, context.basic_info_hud.ui(is_dead, game_mode)),
            (AnchorPoint::BottomCenter, context.menu.ui(current_camera_viewport())),
            (AnchorPoint::BottomCenter, context.messages.ui()),
            (AnchorPoint::BottomCenter, context.weapons_selection.ui()),
            (AnchorPoint::TopRight, context.toast.regular_toast_ui()),
            (AnchorPoint::TopLeft, context.toast.hint_toast_ui()),
            (AnchorPoint::BottomLeft, debug_info(show_debug_info, fps)),
            (AnchorPoint::BottomRight, turn_time_left_ui()),
            (AnchorPoint::Center, context.death_screen.ui()),
            (AnchorPoint::Center, context.loading_screen.ui())
        ]
    )
}
    
fn hud_background_color(context: &GameContext) -> NonColor {
    let progress = context.loading_screen.progress();
    if progress > 0.0 && progress < 1.0 {
        let alpha = if progress <= 0.5 { progress * 3.0 } else { 1.0 - (progress - 0.5) * 2.0 };
        return COLOR_LOADING_SCREEN_BACKGROUND.with_alpha(alpha)
    }
    if context.death_screen.is_open() {
        return COLOR_DEATH_SCREEN_BACKGROUND
    }
    COLOR_TRANSPARENT
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
            text!(Typography::Regular, format!("Hp: {:0.1}", hp))
        )
    )
}

fn turn_time_left_ui() -> View {
    if number_of_players() != 1 && is_turn_based_game_mode() {        
        let time_left = time_left_for_current_turn();
        let text = format!("{:0.1}\"", time_left);

        zstack!(
            Spacing::MD,
            COLOR_TRANSPARENT,
            text!(Typography::Countdown, text)
        )
    } else {
        empty_view()
    }     
}