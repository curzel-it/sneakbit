#![windows_subsystem = "windows"]

mod features;
mod rendering;

use std::env;

use features::{audio::{load_sounds, play_music, play_sound_effects, update_sound_track, SoundContext}, inputs::{handle_keyboard_updates, handle_mouse_updates}, links::MyLinkHandler, paths::local_path};
use game_core::{config::initialize_config_paths, constants::TILE_SIZE, current_world_id, engine_set_wants_fullscreen, features::sound_effects::is_music_enabled, game_engine::{engine::GameMode, storage::{bool_for_global_key, StorageKey}}, initialize_game, is_game_running, lang::localizable::LANG_EN, set_links_handler, stop_game, update_game};
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
    last_pvp: bool
}

fn main() {
    initialize_config_paths(
        false,
        TILE_SIZE * 1.8,
        current_locale(),
        local_path("data"),
        local_path("data/species.json"),
        local_path("data/save.json"),
        local_path("lang")
    );

    let creative_mode = env::args().any(|arg| arg == "creative");    
    let (rl, rl_thread) = start_rl(creative_mode);    

    let mut rl_audio = start_rl_audio();    
    let mut sound_context = SoundContext {
        music_was_enabled: true,
        sound_library: load_sounds(&mut rl_audio)
    };

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
    };

    initialize_game(if creative_mode { GameMode::Creative } else { GameMode::RealTimeCoOp });    
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
        update_game(time_since_last_update);
        handle_world_changed(&mut context, &mut sound_context);
        render_frame_with_context(&mut context);  
        play_sound_effects(&sound_context);
        play_music(&mut sound_context);
    }
}

fn handle_world_changed(context: &mut GameContext, sound_context: &mut SoundContext) {
    let current_world = current_world_id(); 
    if context.latest_world != current_world {
        context.latest_world = current_world;
        load_tile_map_textures(&mut context.rl, &context.rl_thread, current_world);

        if is_music_enabled() {
            update_sound_track(sound_context);
        }
    }
}

fn handle_game_closed(context: &mut GameContext) {
    if context.rl.window_should_close() && !context.rl.is_key_pressed(raylib::consts::KeyboardKey::KEY_ESCAPE) {
        stop_game();
    }
}

fn start_rl_audio() -> Result<raylib::prelude::RaylibAudio, RaylibAudioInitError> {
    RaylibAudio::init_audio_device()
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