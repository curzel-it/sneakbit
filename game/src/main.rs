#![windows_subsystem = "windows"]

mod rendering;

use std::{collections::HashMap, env, path::PathBuf};

use common_macros::hash_map;
use game_core::{config::initialize_config_paths, constants::{BIOME_NUMBER_OF_FRAMES, INITIAL_CAMERA_VIEWPORT, SPRITE_SHEET_ANIMATED_OBJECTS, SPRITE_SHEET_AVATARS, SPRITE_SHEET_BASE_ATTACK, SPRITE_SHEET_BIOME_TILES, SPRITE_SHEET_BUILDINGS, SPRITE_SHEET_CAVE_DARKNESS, SPRITE_SHEET_CONSTRUCTION_TILES, SPRITE_SHEET_DEMON_LORD_DEFEAT, SPRITE_SHEET_FARM_PLANTS, SPRITE_SHEET_HUMANOIDS_1X1, SPRITE_SHEET_HUMANOIDS_1X2, SPRITE_SHEET_HUMANOIDS_2X2, SPRITE_SHEET_HUMANOIDS_2X3, SPRITE_SHEET_INVENTORY, SPRITE_SHEET_MENU, SPRITE_SHEET_STATIC_OBJECTS, TILE_SIZE}, current_sound_effects, current_world_id, engine, engine_set_wants_fullscreen, features::sound_effects::SoundEffect, game_engine::storage::{bool_for_global_key, StorageKey}, initialize_game, is_creative_mode, is_game_running, stop_game, ui::components::Typography, update_game, update_keyboard, update_mouse, utils::vector::Vector2d, window_size_changed};
use raylib::prelude::*;
use rendering::{ui::{get_rendering_config, get_rendering_config_mut, init_rendering_config, is_rendering_config_initialized, RenderingConfig}, worlds::render_frame};
use sys_locale::get_locale;

const MAX_FPS: u32 = 60;

fn main() {
    let mut needs_window_init = true;
    let mut latest_world_id = 0;
    let mut is_fullscreen = false;
    let creative_mode = env::args().any(|arg| arg == "creative");

    initialize_config_paths(
        TILE_SIZE * 1.8,
        current_locale(),
        local_path("data"),
        local_path("data/species.json"),
        local_path("data/save.json"),
        local_path("lang")
    );
    initialize_game(creative_mode);
    
    let (mut rl, thread) = start_rl();
    
    let mut rl_audio = start_rl_audio();
    let sound_library = load_sounds(&mut rl_audio);

    rl.set_window_min_size(360, 240);
        
    if bool_for_global_key(&StorageKey::fullscreen()) {
        engine_set_wants_fullscreen();
    }

    while is_game_running() {
        let time_since_last_update = rl.get_frame_time().min(0.5);

        let wants_fullscreen = engine().wants_fullscreen;
        if wants_fullscreen != is_fullscreen {
            is_fullscreen = wants_fullscreen;
            needs_window_init = true;
            
            if wants_fullscreen {
                let monitor = get_current_monitor();
                let width = get_monitor_width(monitor);
                let height = get_monitor_height(monitor);
                rl.set_window_size(width, height);
                rl.toggle_fullscreen();
            } else {
                rl.toggle_fullscreen();
                rl.set_window_size(960, 640);
            }
            println!("Toggled fullscreen (now {})", is_fullscreen);
        }

        if needs_window_init || rl.is_window_resized() {
            needs_window_init = false;
            handle_window_size_changed(rl.get_screen_width() as f32, rl.get_screen_height() as f32);
        }
        if rl.window_should_close() && !rl.is_key_pressed(raylib::consts::KeyboardKey::KEY_ESCAPE) {
            stop_game();
        }

        handle_keyboard_updates(&mut rl, time_since_last_update);
        handle_mouse_updates(&mut rl, get_rendering_config().rendering_scale);
        update_game(time_since_last_update);

        let current_world = current_world_id(); 
        if latest_world_id != current_world {
            latest_world_id = current_world;
            load_tile_map_textures(&mut rl, &thread, current_world);
        }

        render_frame(&mut rl, &thread);  
        play_sound_effects(&sound_library);
    }
}

fn start_rl() -> (RaylibHandle, RaylibThread) {    
    let width = (TILE_SIZE * INITIAL_CAMERA_VIEWPORT.w as f32) as i32;
    let height = (TILE_SIZE * INITIAL_CAMERA_VIEWPORT.h as f32) as i32;

    let (mut rl, thread) = raylib::init()
        .size(width, height)
        .resizable()
        .title("SneakBit")
        .vsync()
        .build();        
    
    let font = rl.load_font(&thread, "fonts/PixelOperator/PixelOperator8.ttf").unwrap();
    let font_bold = rl.load_font(&thread, "fonts/PixelOperator/PixelOperator8-Bold.ttf").unwrap();                     
    
    rl.set_target_fps(MAX_FPS);

    let textures: HashMap<u32, Texture2D> = load_textures(&mut rl, &thread);
    init_rendering_config(RenderingConfig {
        font,
        font_bold,
        textures,
        rendering_scale: 2.0,
        font_rendering_scale: 2.0,
        canvas_size: Vector2d::new(1.0, 1.0),
        show_debug_info: is_debug_build()
    });

    (rl, thread)
}

fn start_rl_audio() -> Result<raylib::prelude::RaylibAudio, RaylibAudioInitError> {
    RaylibAudio::init_audio_device()
}

fn handle_window_size_changed(width: f32, height: f32) {
    if !is_rendering_config_initialized() {
        return
    }
    println!("Window size changed to {}x{}", width, height);
    let (scale, font_scale) = rendering_scale_for_screen_width(width);
    
    println!("Updated rendering scale to {}", scale);
    println!("Updated font scale to {}", scale);
    
    let config = get_rendering_config_mut();
    config.rendering_scale = scale;
    config.font_rendering_scale = font_scale;
    config.canvas_size.x = width;
    config.canvas_size.y = height;

    let font_size = config.scaled_font_size(&Typography::Regular);
    let line_spacing = config.font_lines_spacing(&Typography::Regular);
    window_size_changed(width, height, scale, font_size, line_spacing);
}

fn load_textures(rl: &mut RaylibHandle, thread: &RaylibThread) -> HashMap<u32, Texture2D> {    
    let mut textures: HashMap<u32, Texture2D> = hash_map!();
    textures.insert(SPRITE_SHEET_INVENTORY, texture(rl, thread, "inventory").unwrap());
    textures.insert(SPRITE_SHEET_BIOME_TILES, texture(rl, thread, "tiles_biome").unwrap());
    textures.insert(SPRITE_SHEET_CONSTRUCTION_TILES, texture(rl, thread, "tiles_constructions").unwrap());
    textures.insert(SPRITE_SHEET_BUILDINGS, texture(rl, thread, "buildings").unwrap());
    textures.insert(SPRITE_SHEET_BASE_ATTACK, texture(rl, thread, "baseattack").unwrap());
    textures.insert(SPRITE_SHEET_STATIC_OBJECTS, texture(rl, thread, "static_objects").unwrap());
    textures.insert(SPRITE_SHEET_MENU, texture(rl, thread, "menu").unwrap());        
    textures.insert(SPRITE_SHEET_ANIMATED_OBJECTS, texture(rl, thread, "animated_objects").unwrap());     
    textures.insert(SPRITE_SHEET_HUMANOIDS_1X1, texture(rl, thread, "humanoids_1x1").unwrap());      
    textures.insert(SPRITE_SHEET_HUMANOIDS_1X2, texture(rl, thread, "humanoids_1x2").unwrap());
    textures.insert(SPRITE_SHEET_HUMANOIDS_2X2, texture(rl, thread, "humanoids_2x2").unwrap());
    textures.insert(SPRITE_SHEET_HUMANOIDS_2X3, texture(rl, thread, "humanoids_2x3").unwrap());
    textures.insert(SPRITE_SHEET_AVATARS, texture(rl, thread, "avatars").unwrap());     
    textures.insert(SPRITE_SHEET_FARM_PLANTS, texture(rl, thread, "farm_plants").unwrap());    
    textures.insert(SPRITE_SHEET_DEMON_LORD_DEFEAT, texture(rl, thread, "demon_lord_defeat").unwrap());         
    textures.insert(SPRITE_SHEET_CAVE_DARKNESS, texture(rl, thread, "cave_darkness").unwrap()); 
    textures        
}

fn load_tile_map_textures(rl: &mut RaylibHandle, thread: &RaylibThread, world_id: u32) {
    let config = get_rendering_config_mut();
    
    (0..BIOME_NUMBER_OF_FRAMES).for_each(|variant| {
        let key = world_id * 10 + variant as u32;
        let filename = format!("{}-{}", world_id, variant);
        
        if let Some(texture) = texture(rl, thread, &filename) {
            config.textures.insert(key, texture);
        }
    });    
}

fn texture(rl: &mut RaylibHandle, thread: &RaylibThread, name: &str) -> Option<Texture2D> {
    let mut path = root_path();
    path.push("assets");
    path.push(format!("{}.png", name));

    let filename = path.as_os_str().to_str().unwrap();
    let result = rl.load_texture(thread, filename);
    
    match result {
        Ok(texture) => Some(texture),
        Err(err) => {
            eprintln!("Failed to load texture at {}: {:#?}", filename, err);
            None
        }
    }
}

fn handle_mouse_updates(rl: &mut RaylibHandle, rendering_scale: f32) {
    update_mouse(
        rl.is_mouse_button_down(MouseButton::MOUSE_BUTTON_LEFT), 
        rl.is_mouse_button_pressed(MouseButton::MOUSE_BUTTON_LEFT), 
        rl.is_mouse_button_down(MouseButton::MOUSE_BUTTON_RIGHT), 
        rl.is_mouse_button_pressed(MouseButton::MOUSE_BUTTON_RIGHT), 
        rl.get_mouse_position().x,
        rl.get_mouse_position().y, 
        rendering_scale
    );
}

fn handle_keyboard_updates(rl: &mut RaylibHandle, time_since_last_update: f32) {
    let (joystick_up, joystick_right, joystick_down, joystick_left) = current_joystick_directions(rl);
    let previous_keyboard_state = &engine().keyboard;

    update_keyboard(
        rl.is_key_pressed(KeyboardKey::KEY_W) || rl.is_key_pressed(KeyboardKey::KEY_UP) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || (!previous_keyboard_state.direction_up.is_down && joystick_up), 
        rl.is_key_pressed(KeyboardKey::KEY_D) || rl.is_key_pressed(KeyboardKey::KEY_RIGHT) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || (!previous_keyboard_state.direction_right.is_down && joystick_right), 
        rl.is_key_pressed(KeyboardKey::KEY_S) || rl.is_key_pressed(KeyboardKey::KEY_DOWN) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || (!previous_keyboard_state.direction_down.is_down && joystick_down), 
        rl.is_key_pressed(KeyboardKey::KEY_A) || rl.is_key_pressed(KeyboardKey::KEY_LEFT) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || (!previous_keyboard_state.direction_left.is_down && joystick_left), 
        rl.is_key_down(KeyboardKey::KEY_W) || rl.is_key_down(KeyboardKey::KEY_UP) || rl.is_gamepad_button_down(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || joystick_up, 
        rl.is_key_down(KeyboardKey::KEY_D) || rl.is_key_down(KeyboardKey::KEY_RIGHT) || rl.is_gamepad_button_down(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || joystick_right, 
        rl.is_key_down(KeyboardKey::KEY_S) || rl.is_key_down(KeyboardKey::KEY_DOWN) || rl.is_gamepad_button_down(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || joystick_down, 
        rl.is_key_down(KeyboardKey::KEY_A) || rl.is_key_down(KeyboardKey::KEY_LEFT) || rl.is_gamepad_button_down(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || joystick_left, 
        rl.is_key_pressed(KeyboardKey::KEY_ESCAPE) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_MIDDLE_RIGHT), 
        rl.is_key_pressed(KeyboardKey::KEY_ENTER) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_MIDDLE_LEFT), 
        rl.is_key_pressed(KeyboardKey::KEY_E) || rl.is_key_pressed(KeyboardKey::KEY_K) || rl.is_key_pressed(KeyboardKey::KEY_SPACE) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_RIGHT), 
        rl.is_key_pressed(KeyboardKey::KEY_F) || rl.is_key_pressed(KeyboardKey::KEY_J) || rl.is_key_pressed(KeyboardKey::KEY_Q) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_DOWN), 
        rl.is_key_pressed(KeyboardKey::KEY_BACKSPACE), 
        get_char_pressed(rl),
        time_since_last_update
    );
}

fn current_joystick_directions(rl: &RaylibHandle) -> (bool, bool, bool, bool) {
    let left_x = rl.get_gamepad_axis_movement(0, GamepadAxis::GAMEPAD_AXIS_LEFT_X);
    let left_y = rl.get_gamepad_axis_movement(0, GamepadAxis::GAMEPAD_AXIS_LEFT_Y);
    
    let threshold = 0.5;
    
    let (joystick_up, joystick_down) = if left_y.abs() >= left_x.abs() {
        if left_y < -threshold {
            (true, false)
        } else if left_y > threshold {
            (false, true)
        } else {
            (false, false)
        }
    } else {
        (false, false)
    };
    
    let (joystick_right, joystick_left) = if left_y.abs() < left_x.abs() {
        if left_x > threshold {
            (true, false)
        } else if left_x < -threshold {
            (false, true)
        } else {
            (false, false)
        }
    } else {
        (false, false)
    };

    (joystick_up, joystick_right, joystick_down, joystick_left)
}

fn get_char_pressed(rl: &mut RaylibHandle) -> u32 {
    let character = rl.get_char_pressed();
    if let Some(character) = character { 
        character as u32
    } else {
        0
    }
}

fn rendering_scale_for_screen_width(width: f32) -> (f32, f32) {
    if is_creative_mode() {
        return (2.0, 2.0)
    }
    if width < 500.0 {
        (1.0, 1.0)
    } else if width < 1400.0 {
        (2.0, 2.0)
    } else {
        let scale = (width / 950.0).ceil();
        (scale, scale)
    }
}

fn local_path(filename: &str) -> PathBuf {
    let mut path = root_path();
    path.push(filename);
    path
}

fn root_path() -> PathBuf {
    let cargo_manifest_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let exe_path = env::current_exe().unwrap_or(cargo_manifest_path);
    let exe_str = exe_path.to_str().unwrap();
    let base = exe_str
        .replace("target/debug/game", "game")
        .replace("target/release/game", "game")
        .replace("target\\debug\\game", "game")
        .replace("target\\release\\game", "game");

    let mut path = PathBuf::from(base);
    path.push("..");
    path
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
        "en".to_string()
    }
}

fn is_debug_build() -> bool {
    cfg!(debug_assertions)
}

fn play_sound_effects(sound_library: &HashMap<SoundEffect, Sound>) {
    current_sound_effects().iter().for_each(|sound_effect| {
        if let Some(sound) = sound_library.get(sound_effect) {
            sound.play();
        }
    })
}

fn load_sounds(rl: &mut Result<raylib::prelude::RaylibAudio, RaylibAudioInitError>) -> HashMap<SoundEffect, Sound> {
    if let Ok(rl) = rl {
        vec![
            (SoundEffect::DeathOfNonMonster, "sfx_deathscream_android7.wav"),
            (SoundEffect::DeathOfMonster, "sfx_deathscream_human11.wav"),
            (SoundEffect::SmallExplosion, "sfx_exp_short_hard8.wav"),
            (SoundEffect::WorldChange, "sfx_movement_dooropen1.wav"),
            (SoundEffect::StepTaken, "sfx_movement_footsteps1a.wav"),
            (SoundEffect::BulletFired, "sfx_movement_jump12_landing.wav"),
            (SoundEffect::BulletBounced, "sfx_movement_jump20.wav"),
            (SoundEffect::HintReceived, "sfx_sound_neutral5.wav"),
            (SoundEffect::KeyCollected, "sfx_sounds_fanfare3.wav"),
            (SoundEffect::Interaction, "sfx_sounds_interaction9.wav"),
            (SoundEffect::AmmoCollected, "sfx_sounds_interaction22.wav"),
            (SoundEffect::GameOver, "sfx_sounds_negative1.wav"),
            (SoundEffect::PlayerResurrected, "sfx_sounds_powerup1.wav"), 
            (SoundEffect::NoAmmo, "sfx_wpn_noammo3.wav"),
        ]
        .into_iter()
        .filter_map(|(effect, filename)| {
            if let Some(path) = audio_path_for_filename(filename).as_os_str().to_str() {
                if let Ok(mut sound) = rl.new_sound(path) {
                    sound.set_volume(volume_for_sound_effect(&effect));
                    return Some((effect, sound))
                }
            }
            None
        })
        .collect()
    } else {
        hash_map!()
    }
}

fn volume_for_sound_effect(sound_effect: &SoundEffect) -> f32 {
    match sound_effect {
        SoundEffect::StepTaken => 0.1,
        SoundEffect::Interaction => 0.2,
        SoundEffect::BulletFired => 0.3,
        SoundEffect::BulletBounced => 0.2,
        SoundEffect::WorldChange => 0.7,
        SoundEffect::AmmoCollected => 0.6,
        _ => 0.8
    }
}

fn audio_path_for_filename(filename: &str) -> PathBuf {
    let mut path = root_path();
    path.push("audio");
    path.push(filename);
    path
}