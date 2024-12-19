#![windows_subsystem = "windows"]

mod features;
mod gameui;
mod rendering;

use std::{env, process};

use features::{audio::play_audio, context::GameContext, death_screen::update_death_screen, inputs::{handle_keyboard_updates, handle_mouse_updates}, paths::local_path};
use game_core::{config::initialize_config_paths, constants::TILE_SIZE, current_keyboard_state, current_mouse_state, current_soundtrack_string, current_world_id, features::sound_effects::is_music_enabled, initialize_game, lang::localizable::LANG_EN, multiplayer::modes::GameMode, update_game};
use gameui::{game_hud::update_game_hud, game_menu::update_game_menu, messages::update_messages, toasts::update_toasts, weapon_selection::update_weapons_selection};
use rendering::{textures::load_tile_map_textures, ui::get_rendering_config, window::{handle_window_updates, load_last_fullscreen_settings, start_rl}, worlds::render_frame};
use sys_locale::get_locale;

fn main() {
    initialize_config_paths(
        false,
        TILE_SIZE * 1.8,
        current_locale(),
        local_path("data"),
        local_path("data/species.json"),
        local_path("data/save.json"),
        local_path("lang"),
    );

    let creative_mode = env::args().any(|arg| arg == "creative");
    let mut context = start_rl(creative_mode);

    let initial_game_mode = if creative_mode {
        GameMode::Creative
    } else {
        GameMode::RealTimeCoOp
    };

    initialize_game(initial_game_mode);
    load_last_fullscreen_settings();

    loop {
        let time_since_last_update = context.rl.get_frame_time().min(0.5);
        context.total_run_time += time_since_last_update;

        let keyboard = current_keyboard_state();
        let mouse = current_mouse_state();

        handle_window_updates(&mut context);
        handle_game_closed(&mut context);
        handle_keyboard_updates(&mut context, time_since_last_update);
        handle_mouse_updates(&mut context.rl, get_rendering_config().rendering_scale);
        update_toasts(&mut context, time_since_last_update);
        update_game_hud(&mut context);
        update_weapons_selection(&mut context, keyboard);
        update_messages(&mut context, keyboard);
        update_game_menu(&mut context, keyboard, mouse);
        update_death_screen(&mut context, keyboard);
        
        if !context.is_game_paused() {
            update_game(time_since_last_update);
            play_audio(&context);
        } 
        handle_world_changed(&mut context);
        render_frame(&mut context);
    }
}

fn handle_world_changed(context: &mut GameContext) {
    let current_world = current_world_id();
    if context.latest_world != current_world {
        context.latest_world = current_world;
        load_tile_map_textures(&mut context.rl, &context.rl_thread, current_world);

        if is_music_enabled() {
            if let Some(track_name) = current_soundtrack_string() {
                if !track_name.is_empty() {
                    context.audio_manager.play_music(track_name);
                }
            }
        }
    }
}

fn handle_game_closed(context: &mut GameContext) {
    if context.rl.window_should_close() && !context.rl.is_key_pressed(raylib::consts::KeyboardKey::KEY_ESCAPE) {
        println!("Window closed!");
        context.audio_manager.stop_music();
        process::exit(0);   
    }
}

fn current_locale() -> String {
    if let Some(locale) = get_locale() {
        let locale_underscored = locale.replace("-", "_");
        let language_part = locale_underscored
            .split('_')
            .next()
            .unwrap_or("enx");
        language_part.to_lowercase()
    } else {
        LANG_EN.to_string()
    }
}

fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}