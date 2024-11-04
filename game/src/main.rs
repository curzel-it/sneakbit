mod rendering;

use std::{collections::HashMap, env, path::PathBuf};

use common_macros::hash_map;
use game_core::{config::initialize_config_paths, constants::{INITIAL_CAMERA_VIEWPORT, SPRITE_SHEET_ANIMATED_OBJECTS, SPRITE_SHEET_AVATARS, SPRITE_SHEET_BASE_ATTACK, SPRITE_SHEET_BIOME_TILES, SPRITE_SHEET_BUILDINGS, SPRITE_SHEET_CAVE_DARKNESS, SPRITE_SHEET_CONSTRUCTION_TILES, SPRITE_SHEET_FARM_PLANTS, SPRITE_SHEET_HUMANOIDS_1X1, SPRITE_SHEET_HUMANOIDS_1X2, SPRITE_SHEET_HUMANOIDS_2X2, SPRITE_SHEET_HUMANOIDS_2X3, SPRITE_SHEET_INVENTORY, SPRITE_SHEET_MENU, SPRITE_SHEET_STATIC_OBJECTS, TILE_SIZE}, initialize_game, is_creative_mode, is_game_running, stop_game, ui::components::Typography, update_game, update_keyboard, update_mouse, utils::vector::Vector2d, window_size_changed};
use raylib::{ffi::{KeyboardKey, MouseButton}, texture::Texture2D, window::{get_current_monitor, get_monitor_refresh_rate}, RaylibHandle, RaylibThread};
use rendering::{ui::{get_rendering_config, get_rendering_config_mut, init_rendering_config, is_rendering_config_initialized, RenderingConfig}, worlds::render_frame};
use sys_locale::get_locale;

fn main() {
    let mut needs_window_init = true;
    let creative_mode = env::args().any(|arg| arg == "creative");

    initialize_config_paths(
        TILE_SIZE * 2.5,
        current_locale(),
        local_path("data"),
        local_path("data/species.json"),
        local_path("data/inventory.json"),
        local_path("data/save.json"),
        local_path("lang")
    );
    initialize_game(creative_mode);
    
    let (mut rl, thread) = start_rl();
    rl.set_window_min_size(360, 240);
        
    while is_game_running() {
        let time_since_last_update = rl.get_frame_time().min(0.5);

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
        render_frame(&mut rl, &thread);  
    }
}

fn start_rl() -> (RaylibHandle, RaylibThread) {    
    let width = (TILE_SIZE * INITIAL_CAMERA_VIEWPORT.w as f32) as i32;
    let height = (TILE_SIZE * INITIAL_CAMERA_VIEWPORT.h as f32) as i32;

    let (mut rl, thread) = raylib::init()
        .size(width, height)
        .resizable()
        .title("SneakBit")
        .build();        
    
    let font = rl.load_font(&thread, "fonts/PixelOperator/PixelOperator8.ttf").unwrap();
    let font_bold = rl.load_font(&thread, "fonts/PixelOperator/PixelOperator8-Bold.ttf").unwrap();                     
    
    // rl.set_target_fps(best_fps());

    let textures: HashMap<u32, Texture2D> = load_textures(&mut rl, &thread);
    init_rendering_config(RenderingConfig {
        font,
        font_bold,
        textures,
        rendering_scale: 2.0,
        font_rendering_scale: 2.0,
        canvas_size: Vector2d::new(1.0, 1.0)
    });

    (rl, thread)
}

fn best_fps() -> u32 {
    let monitor = get_current_monitor();
    let monitor_fps = get_monitor_refresh_rate(monitor);
    monitor_fps.max(30).min(240) as u32
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
    textures.insert(SPRITE_SHEET_CAVE_DARKNESS, texture(rl, thread, "cave_darkness").unwrap());         
    textures
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
        rl.is_mouse_button_pressed(MouseButton::MOUSE_BUTTON_RIGHT), 
        rl.get_mouse_position().x,
        rl.get_mouse_position().y, 
        rendering_scale
    );
}

fn handle_keyboard_updates(rl: &mut RaylibHandle, time_since_last_update: f32) {
    update_keyboard(
        rl.is_key_pressed(KeyboardKey::KEY_W) || rl.is_key_pressed(KeyboardKey::KEY_UP), 
        rl.is_key_pressed(KeyboardKey::KEY_D) || rl.is_key_pressed(KeyboardKey::KEY_RIGHT), 
        rl.is_key_pressed(KeyboardKey::KEY_S) || rl.is_key_pressed(KeyboardKey::KEY_DOWN), 
        rl.is_key_pressed(KeyboardKey::KEY_A) || rl.is_key_pressed(KeyboardKey::KEY_LEFT), 
        rl.is_key_down(KeyboardKey::KEY_W) || rl.is_key_down(KeyboardKey::KEY_UP), 
        rl.is_key_down(KeyboardKey::KEY_D) || rl.is_key_down(KeyboardKey::KEY_RIGHT), 
        rl.is_key_down(KeyboardKey::KEY_S) || rl.is_key_down(KeyboardKey::KEY_DOWN), 
        rl.is_key_down(KeyboardKey::KEY_A) || rl.is_key_down(KeyboardKey::KEY_LEFT), 
        rl.is_key_pressed(KeyboardKey::KEY_ESCAPE), 
        rl.is_key_pressed(KeyboardKey::KEY_ENTER), 
        rl.is_key_pressed(KeyboardKey::KEY_E) || rl.is_key_pressed(KeyboardKey::KEY_K) || rl.is_key_pressed(KeyboardKey::KEY_SPACE), 
        rl.is_key_pressed(KeyboardKey::KEY_F) || rl.is_key_pressed(KeyboardKey::KEY_J) || rl.is_key_pressed(KeyboardKey::KEY_Q), 
        rl.is_key_pressed(KeyboardKey::KEY_BACKSPACE), 
        get_char_pressed(rl),
        time_since_last_update
    );
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
        return (1.0, 2.0)
    }
    if width < 500.0 {
        (1.0, 1.0)
    } else if width < 1400.0 {
        (2.0, 2.0)
    } else {
        let scale = (width / 1000.0).ceil();
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