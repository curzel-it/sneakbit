#![windows_subsystem = "windows"]

mod rendering;

use std::{collections::HashMap, env, path::PathBuf};

use common_macros::hash_map;
use game_core::{config::initialize_config_paths, constants::{BIOME_NUMBER_OF_FRAMES, INITIAL_CAMERA_VIEWPORT, SPRITE_SHEET_ANIMATED_OBJECTS, SPRITE_SHEET_BIOME_TILES, SPRITE_SHEET_BUILDINGS, SPRITE_SHEET_CAVE_DARKNESS, SPRITE_SHEET_CONSTRUCTION_TILES, SPRITE_SHEET_DEMON_LORD_DEFEAT, SPRITE_SHEET_HUMANOIDS_1X1, SPRITE_SHEET_HUMANOIDS_1X2, SPRITE_SHEET_HUMANOIDS_2X2, SPRITE_SHEET_INVENTORY, SPRITE_SHEET_MENU, SPRITE_SHEET_STATIC_OBJECTS, SPRITE_SHEET_TENTACLES, SPRITE_SHEET_WEAPONS, TILE_SIZE}, current_sound_effects, current_soundtrack_string, current_world_id, engine, engine_set_wants_fullscreen, features::{links::LinksHandler, sound_effects::{are_sound_effects_enabled, is_music_enabled, SoundEffect}}, game_engine::storage::{bool_for_global_key, StorageKey}, initialize_game, is_creative_mode, is_game_running, lang::localizable::LANG_EN, set_links_handler, stop_game, ui::components::Typography, update_game, update_keyboard, update_mouse, utils::vector::Vector2d, window_size_changed};
use nohash_hasher::IntMap;
use raylib::prelude::*;
use rendering::{ui::{get_rendering_config, get_rendering_config_mut, init_rendering_config, is_rendering_config_initialized, RenderingConfig}, worlds::render_frame};
use sys_locale::get_locale;

struct GameContext {
    rl: RaylibHandle,
    rl_thread: RaylibThread,
    needs_window_init: bool,
    latest_world: u32,
    is_fullscreen: bool,
    total_run_time: f32,
    using_controller: bool
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
        using_controller: false
    };

    initialize_game(creative_mode);    
    set_links_handler(Box::new(MyLinkHandler {}));
        
    if bool_for_global_key(&StorageKey::fullscreen()) {
        engine_set_wants_fullscreen();
    }

    while is_game_running() {
        let time_since_last_update = context.rl.get_frame_time().min(0.5);
        context.total_run_time += time_since_last_update;

        handle_fullscreen_changed(&mut context);
        handle_window_size_changed(&mut context);
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

struct SoundContext<'a> {
    music_was_enabled: bool,
    sound_library: HashMap<AppSound, Sound<'a>>
}

fn render_frame_with_context(context: &mut GameContext) {
    render_frame(&mut context.rl, &context.rl_thread);
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

fn handle_fullscreen_changed(context: &mut GameContext) {
    let wants_fullscreen = engine().wants_fullscreen;
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

fn stop_music(context: &mut SoundContext) {
    let sounds: Vec<AppSound> = context.sound_library.keys().cloned().collect();

    sounds.iter().for_each(|key| {
        if matches!(key, AppSound::Track(_)) {
            if let Some(sound) = context.sound_library.get_mut(key) {
                if sound.is_playing() {
                    sound.stop();
                }
            }
        }
    });
}

fn update_sound_track(context: &mut SoundContext) {
    if let Some(track_name) = current_soundtrack_string() {
        if !track_name.is_empty() {
            
            let key = &AppSound::Track(track_name);
            
            if let Some(sound) = context.sound_library.get(key) {
                if !sound.is_playing() {
                    let _ = sound;
                    stop_music(context);
                }
            }            
            if let Some(sound) = context.sound_library.get(key) {
                if !sound.is_playing() {
                    sound.play();
                }
            }
        }
    }
}

fn update_target_refresh_rate(rl: &mut RaylibHandle) {
    let monitor = get_current_monitor();
    let monitor_refresh_rate = get_monitor_refresh_rate(monitor);
    rl.set_target_fps(monitor_refresh_rate as u32);
    println!("Updated target fps to {}", monitor_refresh_rate);
}

fn start_rl(creative_mode: bool) -> (RaylibHandle, RaylibThread) {    
    let width = (TILE_SIZE * INITIAL_CAMERA_VIEWPORT.w as f32) as i32;
    let height = (TILE_SIZE * INITIAL_CAMERA_VIEWPORT.h as f32) as i32;

    let (mut rl, thread) = raylib::init()
        .size(width, height)
        .resizable()
        .title("SneakBit")
        .vsync()
        .build();        
    
    let font = rl.load_font(&thread, &regular_font_path()).unwrap();
    let font_bold = rl.load_font(&thread, &bold_font_path()).unwrap();                     
    
    update_target_refresh_rate(&mut rl);
    rl.set_window_min_size(360, 240);

    init_rendering_config(RenderingConfig {
        font,
        font_bold,
        textures: load_textures(&mut rl, &thread),
        rendering_scale: 2.0,
        font_rendering_scale: 2.0,
        canvas_size: Vector2d::new(1.0, 1.0),
        show_debug_info: is_debug_build(),
        render_using_individual_tiles: creative_mode
    });

    (rl, thread)
}

fn start_rl_audio() -> Result<raylib::prelude::RaylibAudio, RaylibAudioInitError> {
    RaylibAudio::init_audio_device()
}

fn handle_window_size_changed(context: &mut GameContext) {
    if context.needs_window_init || context.rl.is_window_resized() {
        context.needs_window_init = false;

        if !is_rendering_config_initialized() {
            return
        }
        let window_scale = context.rl.get_window_scale_dpi().x;
        let real_width = context.rl.get_render_width() as f32;
        let real_height = context.rl.get_render_height() as f32;
        let width = real_width / window_scale;
        let height = real_height / window_scale;

        println!("Window size changed to {}x{} @ {}", width, height, window_scale);
        let (scale, font_scale) = rendering_scale_for_screen_width(width);
        
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
        window_size_changed(width, height, scale, font_size, line_spacing);

        update_target_refresh_rate(&mut context.rl);
    }
}

fn load_textures(rl: &mut RaylibHandle, thread: &RaylibThread) -> IntMap<u32, Texture2D> {    
    let mut textures: IntMap<u32, Texture2D> = IntMap::default();
    textures.insert(SPRITE_SHEET_INVENTORY, texture(rl, thread, "inventory").unwrap());
    textures.insert(SPRITE_SHEET_BIOME_TILES, texture(rl, thread, "tiles_biome").unwrap());
    textures.insert(SPRITE_SHEET_CONSTRUCTION_TILES, texture(rl, thread, "tiles_constructions").unwrap());
    textures.insert(SPRITE_SHEET_BUILDINGS, texture(rl, thread, "buildings").unwrap());
    textures.insert(SPRITE_SHEET_STATIC_OBJECTS, texture(rl, thread, "static_objects").unwrap());
    textures.insert(SPRITE_SHEET_MENU, texture(rl, thread, "menu").unwrap());        
    textures.insert(SPRITE_SHEET_ANIMATED_OBJECTS, texture(rl, thread, "animated_objects").unwrap());     
    textures.insert(SPRITE_SHEET_HUMANOIDS_1X1, texture(rl, thread, "humanoids_1x1").unwrap());      
    textures.insert(SPRITE_SHEET_HUMANOIDS_1X2, texture(rl, thread, "humanoids_1x2").unwrap());
    textures.insert(SPRITE_SHEET_HUMANOIDS_2X2, texture(rl, thread, "humanoids_2x2").unwrap());
    textures.insert(SPRITE_SHEET_DEMON_LORD_DEFEAT, texture(rl, thread, "demon_lord_defeat").unwrap());         
    textures.insert(SPRITE_SHEET_CAVE_DARKNESS, texture(rl, thread, "cave_darkness").unwrap());       
    textures.insert(SPRITE_SHEET_TENTACLES, texture(rl, thread, "tentacles").unwrap()); 
    textures.insert(SPRITE_SHEET_WEAPONS, texture(rl, thread, "weapons").unwrap()); 
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

fn handle_keyboard_updates(context: &mut GameContext, time_since_last_update: f32) {
    let current_char = get_char_pressed(&mut context.rl);

    let rl = &context.rl;
    let (joystick_up, joystick_right, joystick_down, joystick_left) = current_joystick_directions(rl);
    let previous_keyboard_state = &engine().keyboard;

    let has_controller_now = rl.is_gamepad_available(0);
    let controller_availability_changed = context.total_run_time > 0.5 && (context.using_controller != has_controller_now);  
    let lost_focus = !rl.is_window_focused();
    let should_pause = controller_availability_changed || lost_focus;

    update_keyboard(
        0,
        rl.is_key_pressed(KeyboardKey::KEY_W) || rl.is_key_pressed(KeyboardKey::KEY_UP) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || (!previous_keyboard_state.is_direction_up_down(0) && joystick_up), 
        rl.is_key_pressed(KeyboardKey::KEY_D) || rl.is_key_pressed(KeyboardKey::KEY_RIGHT) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || (!previous_keyboard_state.is_direction_right_down(0) && joystick_right), 
        rl.is_key_pressed(KeyboardKey::KEY_S) || rl.is_key_pressed(KeyboardKey::KEY_DOWN) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || (!previous_keyboard_state.is_direction_down_down(0) && joystick_down), 
        rl.is_key_pressed(KeyboardKey::KEY_A) || rl.is_key_pressed(KeyboardKey::KEY_LEFT) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || (!previous_keyboard_state.is_direction_left_down(0) && joystick_left), 
        rl.is_key_down(KeyboardKey::KEY_W) || rl.is_key_down(KeyboardKey::KEY_UP) || rl.is_gamepad_button_down(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || joystick_up, 
        rl.is_key_down(KeyboardKey::KEY_D) || rl.is_key_down(KeyboardKey::KEY_RIGHT) || rl.is_gamepad_button_down(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || joystick_right, 
        rl.is_key_down(KeyboardKey::KEY_S) || rl.is_key_down(KeyboardKey::KEY_DOWN) || rl.is_gamepad_button_down(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || joystick_down, 
        rl.is_key_down(KeyboardKey::KEY_A) || rl.is_key_down(KeyboardKey::KEY_LEFT) || rl.is_gamepad_button_down(0, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || joystick_left, 
        rl.is_key_pressed(KeyboardKey::KEY_ESCAPE) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_MIDDLE_RIGHT), 
        should_pause || rl.is_key_pressed(KeyboardKey::KEY_X) || rl.is_key_pressed(KeyboardKey::KEY_ENTER) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_MIDDLE_LEFT), 
        rl.is_key_pressed(KeyboardKey::KEY_E) || rl.is_key_pressed(KeyboardKey::KEY_K) || rl.is_key_pressed(KeyboardKey::KEY_SPACE) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_RIGHT), 
        rl.is_key_pressed(KeyboardKey::KEY_R) || rl.is_key_pressed(KeyboardKey::KEY_Q) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_LEFT), 
        rl.is_key_pressed(KeyboardKey::KEY_F) || rl.is_key_pressed(KeyboardKey::KEY_J) || rl.is_gamepad_button_pressed(0, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_DOWN), 
        rl.is_key_pressed(KeyboardKey::KEY_BACKSPACE), 
        current_char,
        time_since_last_update
    );

    update_keyboard(
        1,
        rl.is_key_pressed(KeyboardKey::KEY_HOME) || rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || (!previous_keyboard_state.is_direction_up_down(1) && joystick_up), 
        rl.is_key_pressed(KeyboardKey::KEY_PAGE_DOWN) || rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || (!previous_keyboard_state.is_direction_right_down(1) && joystick_right), 
        rl.is_key_pressed(KeyboardKey::KEY_END) || rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || (!previous_keyboard_state.is_direction_down_down(1) && joystick_down), 
        rl.is_key_pressed(KeyboardKey::KEY_DELETE) || rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || (!previous_keyboard_state.is_direction_left_down(1) && joystick_left), 
        rl.is_key_down(KeyboardKey::KEY_HOME) || rl.is_gamepad_button_down(1, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || joystick_up, 
        rl.is_key_down(KeyboardKey::KEY_PAGE_DOWN) || rl.is_gamepad_button_down(1, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || joystick_right, 
        rl.is_key_down(KeyboardKey::KEY_END) || rl.is_gamepad_button_down(1, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || joystick_down, 
        rl.is_key_down(KeyboardKey::KEY_DELETE) || rl.is_gamepad_button_down(1, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || joystick_left, 
        rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_MIDDLE_RIGHT), 
        should_pause || rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_MIDDLE_LEFT), 
        rl.is_key_pressed(KeyboardKey::KEY_INSERT) || rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_RIGHT), 
        rl.is_key_pressed(KeyboardKey::KEY_RIGHT_CONTROL) || rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_LEFT), 
        rl.is_key_pressed(KeyboardKey::KEY_RIGHT_SHIFT) || rl.is_gamepad_button_pressed(1, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_DOWN), 
        rl.is_key_pressed(KeyboardKey::KEY_BACKSPACE), 
        current_char,
        time_since_last_update
    );

    if rl.is_gamepad_available(2) {
        update_keyboard(
            2,
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || (!previous_keyboard_state.is_direction_up_down(2) && joystick_up), 
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || (!previous_keyboard_state.is_direction_right_down(2) && joystick_right), 
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || (!previous_keyboard_state.is_direction_down_down(2) && joystick_down), 
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || (!previous_keyboard_state.is_direction_left_down(2) && joystick_left), 
            rl.is_gamepad_button_down(2, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || joystick_up, 
            rl.is_gamepad_button_down(2, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || joystick_right, 
            rl.is_gamepad_button_down(2, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || joystick_down, 
            rl.is_gamepad_button_down(2, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || joystick_left, 
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_MIDDLE_RIGHT), 
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_MIDDLE_LEFT), 
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_RIGHT), 
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_LEFT), 
            rl.is_gamepad_button_pressed(2, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_DOWN), 
            false, 
            current_char,
            time_since_last_update
        );
    }

    if rl.is_gamepad_available(3) {
        update_keyboard(
            3,
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || (!previous_keyboard_state.is_direction_up_down(3) && joystick_up), 
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || (!previous_keyboard_state.is_direction_right_down(3) && joystick_right), 
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || (!previous_keyboard_state.is_direction_down_down(3) && joystick_down), 
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || (!previous_keyboard_state.is_direction_left_down(3) && joystick_left), 
            rl.is_gamepad_button_down(3, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_UP) || joystick_up, 
            rl.is_gamepad_button_down(3, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_RIGHT) || joystick_right, 
            rl.is_gamepad_button_down(3, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_DOWN) || joystick_down, 
            rl.is_gamepad_button_down(3, GamepadButton::GAMEPAD_BUTTON_LEFT_FACE_LEFT) || joystick_left, 
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_MIDDLE_RIGHT), 
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_MIDDLE_LEFT), 
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_RIGHT), 
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_LEFT), 
            rl.is_gamepad_button_pressed(3, GamepadButton::GAMEPAD_BUTTON_RIGHT_FACE_DOWN), 
            false, 
            current_char,
            time_since_last_update
        );
    }
    _ = rl;

    if controller_availability_changed {        
        if has_controller_now {
            context.rl.hide_cursor();
        } else {
            context.rl.show_cursor();
        }
    }
    context.using_controller = has_controller_now;
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
    } else if width < 500.0 {
        (1.0, 1.0)
    } else if width < 1400.0 {
        (2.0, 2.0)
    } else if width < 2000.0 {
        (3.0, 3.0)
    } else {
        (4.0, 4.0)
    }
}

fn local_path(filename: &str) -> PathBuf {
    let mut path = root_path();
    path.push(filename);
    path
}

fn regular_font_path() -> String {
    let mut path = local_path("fonts");
    path.push("PixelOperator");
    path.push("PixelOperator8.ttf");
    path.as_os_str().to_str().unwrap().to_owned()
}

fn bold_font_path() -> String {
    let mut path = local_path("fonts");
    path.push("PixelOperator");
    path.push("PixelOperator8-Bold.ttf");
    path.as_os_str().to_str().unwrap().to_owned()
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

    let path = PathBuf::from(base);
    let mut components = path.components();
    components.next_back();
    components.as_path().to_path_buf()
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

fn play_sound_effects(context: &SoundContext) {
    let sound_effects = current_sound_effects();
    if sound_effects.is_empty() {
        return
    }
    if !are_sound_effects_enabled() {
        return
    }
    sound_effects.iter().for_each(|effect| {
        let key = &AppSound::Effect(effect.clone());
        if let Some(sound) = context.sound_library.get(key) {
            sound.play();
        }
    })
}

fn play_music(context: &mut SoundContext) {
    if is_music_enabled() {
        context.music_was_enabled = true;
        update_sound_track(context);
    } else if context.music_was_enabled {
        context.music_was_enabled = false;
        stop_music(context);
    }
}

#[derive(Clone, PartialEq, Eq, Hash)]
enum AppSound {
    Effect(SoundEffect),
    Track(String)
}

fn load_sounds(rl: &mut Result<raylib::prelude::RaylibAudio, RaylibAudioInitError>) -> HashMap<AppSound, Sound> {
    if let Ok(rl) = rl {
        vec![
            (AppSound::Effect(SoundEffect::DeathOfNonMonster), "sfx_deathscream_android7.mp3"),
            (AppSound::Effect(SoundEffect::DeathOfMonster), "sfx_deathscream_human11.mp3"),
            (AppSound::Effect(SoundEffect::SmallExplosion), "sfx_exp_short_hard8.mp3"),
            (AppSound::Effect(SoundEffect::WorldChange), "sfx_movement_dooropen1.mp3"),
            (AppSound::Effect(SoundEffect::StepTaken), "sfx_movement_footsteps1a.mp3"),
            (AppSound::Effect(SoundEffect::BulletFired), "sfx_movement_jump12_landing.mp3"),
            (AppSound::Effect(SoundEffect::BulletBounced), "sfx_movement_jump20.mp3"),
            (AppSound::Effect(SoundEffect::HintReceived), "sfx_sound_neutral5.mp3"),
            (AppSound::Effect(SoundEffect::KeyCollected), "sfx_sounds_fanfare3.mp3"),
            (AppSound::Effect(SoundEffect::AmmoCollected), "sfx_sounds_interaction22.mp3"),
            (AppSound::Effect(SoundEffect::GameOver), "sfx_sounds_negative1.mp3"),
            (AppSound::Effect(SoundEffect::PlayerResurrected), "sfx_sounds_powerup1.mp3"), 
            (AppSound::Effect(SoundEffect::NoAmmo), "sfx_wpn_noammo3.mp3"),
            (AppSound::Effect(SoundEffect::SwordSlash), "sfx_wpn_sword2.mp3"),
            track_track_pair("pol_brave_worm_short.mp3"),
            track_track_pair("pol_cactus_land_short.mp3"),
            track_track_pair("pol_chubby_cat_short.mp3"),
            track_track_pair("pol_clouds_castle_short.mp3"),
            track_track_pair("pol_combat_plan_short.mp3"),
            track_track_pair("pol_flash_run_short.mp3"),
            track_track_pair("pol_king_of_coins_short.mp3"),
            track_track_pair("pol_magical_sun_short.mp3"),
            track_track_pair("pol_nuts_and_bolts_short.mp3"),
            track_track_pair("pol_palm_beach_short.mp3"),
            track_track_pair("pol_pyramid_sands_short.mp3"),
            track_track_pair("pol_spirits_dance_short.mp3"),
            track_track_pair("pol_the_dojo_short.mp3"),
            track_track_pair("pol_final_sacrifice_short.mp3"),
            track_track_pair("pol_code_geek_short.mp3"),

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

fn track_track_pair(filename: &str) -> (AppSound, &str) {
    (AppSound::Track(filename.to_owned()), filename)
}

fn volume_for_sound_effect(sound: &AppSound) -> f32 {
    match sound {
        AppSound::Effect(effect) => match effect {
            SoundEffect::StepTaken => 0.1,
            SoundEffect::BulletFired => 0.3,
            SoundEffect::BulletBounced => 0.2,
            SoundEffect::WorldChange => 0.7,
            SoundEffect::AmmoCollected => 0.6,
            _ => 0.8
        },
        AppSound::Track(_) => 0.3
    }
}

fn audio_path_for_filename(filename: &str) -> PathBuf {
    let mut path = root_path();
    path.push("audio");
    path.push(filename);
    path
}

struct MyLinkHandler;

impl LinksHandler for MyLinkHandler {
    fn open(&self, link: &str) {
        let _ = open::that(link);
    }
}