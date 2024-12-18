#![windows_subsystem = "windows"]

mod features;
mod gameui;
mod rendering;

use std::env;

use features::{audio::{play_audio, AudioManager}, inputs::{handle_keyboard_updates, handle_mouse_updates}, links::MyLinkHandler, paths::local_path};
use game_core::{config::initialize_config_paths, constants::TILE_SIZE, current_soundtrack_string, current_world_id, engine_set_wants_fullscreen, features::{sound_effects::is_music_enabled, state_updates::AppState, storage::{bool_for_global_key, StorageKey}}, initialize_game, is_game_running, lang::localizable::LANG_EN, multiplayer::modes::GameMode, set_links_handler, stop_game, update_game};
use raylib::prelude::*;
use rendering::{textures::load_tile_map_textures, ui::get_rendering_config, window::{handle_window_updates, render_frame_with_context, start_rl}};
use sys_locale::get_locale;

struct GameContext {
    rl: RaylibHandle,
    rl_thread: RaylibThread,
    needs_window_init: bool,
    latest_world: u32,
    is_fullscreen: bool,
    total_run_time: f32,
    using_controller: bool,
    last_number_of_players: usize,
    last_pvp: bool,
    audio_manager: AudioManager, 

    state: AppState
}

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
    let (rl, rl_thread) = start_rl(creative_mode);

    let audio_manager = AudioManager::new();

    let mut context = GameContext {
        rl,
        rl_thread,
        needs_window_init: true,
        latest_world: 0,
        is_fullscreen: false,
        total_run_time: 0.0,
        using_controller: false,
        last_number_of_players: 1,
        last_pvp: false,
        audio_manager,
        state: AppState::Gaming,
    };

    let initial_game_mode = if creative_mode {
        GameMode::Creative
    } else {
        GameMode::RealTimeCoOp
    };

    initialize_game(initial_game_mode);
    set_links_handler(Box::new(MyLinkHandler {}));

    if bool_for_global_key(&StorageKey::fullscreen()) {
        engine_set_wants_fullscreen();
    }

    while is_game_running() {
        let time_since_last_update = context.rl.get_frame_time().min(0.5);
        context.total_run_time += time_since_last_update;

        handle_window_updates(&mut context);
        handle_game_closed(&mut context);
        handle_keyboard_updates(&mut context, time_since_last_update);
        handle_mouse_updates(&mut context.rl, get_rendering_config().rendering_scale);
        let new_state = update_game(time_since_last_update);
        handle_world_changed(&mut context);
        render_frame_with_context(&mut context);
        play_audio(&context);

        if context.state != new_state {
            context.state = new_state
        }
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
    if context.rl.window_should_close()
        && !context.rl.is_key_pressed(raylib::consts::KeyboardKey::KEY_ESCAPE)
    {
        context.audio_manager.stop_music();
        stop_game();
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