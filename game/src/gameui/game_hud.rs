use game_core::{cached_player_position, current_camera_viewport, current_world_id, is_turn_based_game_mode, number_of_players, player_current_hp, text, time_left_for_current_turn, ui::{components::{empty_view, Spacing, Typography, View, COLOR_DEBUG_INFO_BACKGROUND, COLOR_TRANSPARENT}, layouts::{AnchorPoint, Layout}}, vstack, zstack};

use crate::GameContext;

pub fn hud_ui(context: &GameContext, width: i32, height: i32, show_debug_info: bool, fps: u32) -> Layout {
    Layout::new(
        width, 
        height, 
        COLOR_TRANSPARENT, // self.hud_background_color(),
        vec![
            (AnchorPoint::BottomCenter, context.menu.ui(current_camera_viewport())),
            (AnchorPoint::BottomCenter, context.long_text_display.ui()),
            (AnchorPoint::BottomCenter, context.weapons_selection.ui()),
            (AnchorPoint::BottomLeft, debug_info(show_debug_info, fps)),
            (AnchorPoint::BottomRight, turn_time_left_ui()),
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
/*
fn basic_info_hud_ui(engine: &GameEngine) -> View {
    self.basic_info_hud.ui(
        &engine.turn, 
        self.number_of_players, 
        &engine.dead_players
    )
}

fn hud_background_color(engine: &GameEngine) -> NonColor {
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

fn debug_info(engine: &GameEngine, show_debug_info: bool, fps: u32) -> View {
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
} */