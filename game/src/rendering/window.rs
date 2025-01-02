use std::env;

use game_core::{constants::{INITIAL_CAMERA_VIEWPORT, TILE_SIZE}, current_game_mode, features::storage::{bool_for_global_key, StorageKey}, is_creative_mode, number_of_players, set_wants_fullscreen, ui::components::Typography, utils::{directions::Direction, vector::Vector2d}, wants_fullscreen, window_size_changed};
use raylib::prelude::*;

use crate::{features::font_helpers::{bold_font_path, latin_characters, regular_font_path}, rendering::ui::{get_rendering_config_mut, is_rendering_config_initialized}, GameContext};

use super::{textures::load_textures, ui::{init_rendering_config, RenderingConfig}};

pub fn start_rl(creative_mode: bool) -> GameContext {    
    let debug = cfg!(debug_assertions);
    let width = (TILE_SIZE * INITIAL_CAMERA_VIEWPORT.w) as i32;
    let height = (TILE_SIZE * INITIAL_CAMERA_VIEWPORT.h) as i32;

    let (mut rl, rl_thread) = if debug { 
        raylib::init()
            .size(width, height)
            .resizable()
            .title("SneakBit (Debug)")
            .build()
    } else { 
        raylib::init()
            .size(width, height)
            .resizable()
            .title("SneakBit")
            .vsync()
            .build()
    };        
    
    let characters = latin_characters();    
    let font = rl.load_font_ex(&rl_thread, &regular_font_path(), 8, Some(&characters)).unwrap();
    let font_bold = rl.load_font_ex(&rl_thread, &bold_font_path(), 8, Some(&characters)).unwrap();
    
    update_target_refresh_rate(&mut rl, debug);
    rl.set_window_min_size(360, 240);

    init_rendering_config(RenderingConfig {
        font,
        font_bold,
        textures: load_textures(&mut rl, &rl_thread),
        rendering_scale: 2.0,
        font_rendering_scale: 2.0,
        canvas_size: Vector2d::new(1.0, 1.0),
        show_debug_info: debug,
        show_advanced_debug_info: env::args().any(|arg| arg == "debug"),
        render_using_individual_tiles: creative_mode,
        direction: Direction::Unknown,
    });

    GameContext::new(rl, rl_thread, debug)
}

pub fn handle_window_updates(context: &mut GameContext) {
    handle_fullscreen_changed(context);
    handle_window_size_changed(context);
}

fn handle_fullscreen_changed(context: &mut GameContext) {
    let wants_fullscreen = wants_fullscreen();
    if wants_fullscreen != context.is_fullscreen {
        context.is_fullscreen = wants_fullscreen;
        context.needs_window_init = true;
        set_fullscreen(&mut context.rl, wants_fullscreen);
        println!("Toggled fullscreen (now {})", context.is_fullscreen);
    }
}

fn set_fullscreen(rl: &mut RaylibHandle, wants_fullscreen: bool) {
    if wants_fullscreen {
        let monitor = get_current_monitor();
        let width = get_monitor_width(monitor);
        let height = get_monitor_height(monitor);
        rl.set_window_size(width, height);
        rl.toggle_fullscreen();
        rl.disable_cursor();
    } else {
        rl.toggle_fullscreen();
        rl.set_window_size(960, 640);
        rl.enable_cursor();
    }
}

fn update_target_refresh_rate(rl: &mut RaylibHandle, debug: bool) {
    if !debug {
        let monitor = get_current_monitor();
        let monitor_refresh_rate = get_monitor_refresh_rate(monitor);
        rl.set_target_fps(monitor_refresh_rate as u32);
        println!("Updated target fps to {}", monitor_refresh_rate);
    }
}

fn handle_window_size_changed(context: &mut GameContext) {
    let current_is_pvp = current_game_mode().allows_pvp();
    let current_number_of_players = number_of_players();
    let pvp_changed = context.last_pvp != current_is_pvp;
    let number_of_players_changed = context.last_number_of_players != current_number_of_players;
    let requires_update = pvp_changed || number_of_players_changed || context.needs_window_init || context.rl.is_window_resized();

    if !is_rendering_config_initialized() {
        return
    }
    if !requires_update {
        return 
    }
    context.needs_window_init = false;
    context.last_number_of_players = current_number_of_players;
    context.last_pvp = current_is_pvp;

    let window_scale = context.rl.get_window_scale_dpi().x;
    let real_width = unsafe { raylib::ffi::GetRenderWidth() } as f32;
    let real_height = unsafe { raylib::ffi::GetRenderHeight() } as f32;

    let width = real_width / window_scale;
    let height = real_height / window_scale;
    let font_scale = font_scale_for_window_width(width);
    let scale = rendering_scale_for_screen_width(width);

    println!("Context changed: Window {}x{} @ {}; Players: {}; Pvp: {}", width, height, window_scale, context.last_number_of_players, context.last_pvp);    
    println!("Updated rendering scale to {}", scale);
    println!("Updated font scale to {}", scale);
    
    let config = get_rendering_config_mut();
    config.rendering_scale = scale;
    config.font_rendering_scale = font_scale;

    if context.rl.is_window_fullscreen() {
        config.canvas_size.x = real_width;
        config.canvas_size.y = real_height;
    } else {
        config.canvas_size.x = width;
        config.canvas_size.y = height;
    }
    
    let font_size = config.scaled_font_size(&Typography::Regular);
    let line_spacing = config.font_lines_spacing(&Typography::Regular);    
    let max_line_length = (width / font_size).floor() as usize;
    let visible_line_count = (0.4 * height / (line_spacing + font_size)).floor() as usize;

    context.messages.max_line_length = max_line_length;
    context.messages.visible_line_count = visible_line_count;
    context.menu.messages.max_line_length = max_line_length;
    context.menu.messages.visible_line_count = visible_line_count;
    
    window_size_changed(width, height, scale);
    update_target_refresh_rate(&mut context.rl, context.debug);
}

fn rendering_scale_for_screen_width(width: f32) -> f32 {
    if is_creative_mode() {
        2.0
    } else if width < 500.0 {
        1.0
    } else if width < 1400.0 {
        2.0
    } else if width < 2000.0 {
        3.0
    } else {
        4.0
    }
}

fn font_scale_for_window_width(width: f32) -> f32 {
    if width < 500.0 {
        1.0
    } else if width < 1400.0 {
        2.0
    } else if width < 2000.0 {
        3.0
    } else {
        4.0
    }
}

pub fn load_last_fullscreen_settings() {
    let was_fullscreen = bool_for_global_key(&StorageKey::fullscreen());
    set_wants_fullscreen(was_fullscreen);
}