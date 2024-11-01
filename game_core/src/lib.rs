use std::{cmp::Ordering, ffi::{c_char, CStr, CString}, path::PathBuf, ptr};

use config::initialize_config_paths;
use entities::known_species::SPECIES_KUNAI;
use features::light_conditions::LightConditions;
use game_engine::{engine::GameEngine, entity::Entity, inventory::inventory_items_count_for_species};
use maps::biome_tiles::BiomeTile;
use menus::{menu::MenuDescriptorC, toasts::ToastDescriptorC};
use utils::{rect::IntRect, vector::Vector2d};

pub mod config;
pub mod constants;
pub mod dialogues;
pub mod entities;
pub mod features;
pub mod game_engine;
pub mod lang;
pub mod maps;
pub mod menus;
pub mod prefabs;
pub mod ui;
pub mod utils;
pub mod worlds;

static mut ENGINE: *mut GameEngine = std::ptr::null_mut();

pub fn engine() -> &'static GameEngine {
    unsafe {
        &*ENGINE
    }
}

fn engine_mut() -> &'static mut GameEngine {
    unsafe {
        &mut *ENGINE
    }
}

#[no_mangle]
pub extern "C" fn initialize_game(creative_mode: bool) {
    unsafe {
        let boxed = Box::new(GameEngine::new());
        ENGINE = Box::into_raw(boxed);      
    }
    let engine = engine_mut();
    engine.set_creative_mode(creative_mode);
    engine.start();
}

#[no_mangle]
pub extern "C" fn is_creative_mode() -> bool {
    engine().creative_mode
}

#[no_mangle]
pub extern "C" fn is_game_running() -> bool {
    engine().is_running
}

#[no_mangle]
pub extern "C" fn stop_game() {
    engine_mut().is_running = false
}

#[no_mangle]
pub extern "C" fn window_size_changed(width: f32, height: f32, scale: f32, font_size: f32, line_spacing: f32) {
    engine_mut().window_size_changed(width, height, scale, font_size, line_spacing)
}

#[no_mangle]
pub extern "C" fn update_game(time_since_last_update: f32) {
    engine_mut().update(time_since_last_update)
}

#[no_mangle]
pub extern "C" fn update_keyboard(
    up_pressed: bool,
    right_pressed: bool,
    down_pressed: bool,
    left_pressed: bool,
    up_down: bool,
    right_down: bool,
    down_down: bool,
    left_down: bool,
    escape_pressed: bool,
    menu_pressed: bool,
    confirm_pressed: bool,
    attack_pressed: bool,
    backspace_pressed: bool,
    current_char: u32,
    time_since_last_update: f32
) {
    engine_mut().keyboard.update(
        up_pressed, right_pressed, down_pressed, left_pressed, 
        up_down, right_down, down_down, left_down, 
        escape_pressed, menu_pressed, confirm_pressed, attack_pressed, backspace_pressed, 
        if current_char == 0 { None } else { char::from_u32(current_char) }, 
        time_since_last_update
    );
}

#[no_mangle]
pub extern "C" fn update_mouse(
    mouse_left_down: bool, 
    mouse_left_pressed: bool, 
    mouse_right_pressed: bool, 
    mouse_x: f32,
    mouse_y: f32,
    rendering_scale: f32
) {
    engine_mut().mouse.update(
        mouse_left_down, 
        mouse_left_pressed, mouse_right_pressed, 
        mouse_x, mouse_y, 
        rendering_scale
    );
}

#[repr(C)]
pub struct RenderableItem {
    pub sprite_sheet_id: u32,
    pub texture_rect: IntRect,
    pub offset: Vector2d,
    pub frame: IntRect
}

pub fn get_renderables_vec() -> Vec<RenderableItem> {
    let world = &engine().world;
    let visible_entities = &world.visible_entities;
    let entities_map = world.entities.borrow();    

    let mut entities: Vec<&Entity> = visible_entities.iter()
        .map(|(index, _)| &entities_map[*index])
        .collect();

    entities.sort_by(|entity_a, entity_b| {
        let a = entity_a;
        let b = entity_b;

        let ay = a.frame.y + if a.frame.h > 1 { 1 } else { 0 };
        let by = b.frame.y + if b.frame.h > 1 { 1 } else { 0 };

        if a.z_index < b.z_index && a.z_index < 0 { return Ordering::Less; }
        if a.z_index > b.z_index && b.z_index < 0 { return Ordering::Greater; }
        if ay < by { return Ordering::Less; }
        if ay > by { return Ordering::Greater; }
        if a.z_index < b.z_index { return Ordering::Less; }
        if a.z_index > b.z_index { return Ordering::Greater; }
        if a.frame.x < b.frame.x { return Ordering::Less; }
        if a.frame.x > b.frame.x { return Ordering::Greater; }
        Ordering::Equal
    });

    entities.iter()
        .map(|e| {
            RenderableItem {
                sprite_sheet_id: e.sprite_sheet(),
                texture_rect: e.texture_source_rect(),
                offset: e.offset,
                frame: e.frame
            }
        })
        .collect()
}

#[no_mangle]
pub extern "C" fn get_renderables(length: *mut usize) -> *mut RenderableItem {
    let items = get_renderables_vec();
    let len = items.len();
    
    unsafe {
        ptr::write(length, len);
    }

    let ptr = items.as_ptr() as *mut RenderableItem;
    std::mem::forget(items);
    ptr
}

#[no_mangle]
pub extern "C" fn free_renderables(ptr: *mut RenderableItem, length: usize) {
    if !ptr.is_null() {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, length, length);
        }
    }
}

#[no_mangle]
pub extern "C" fn initialize_config(
    base_entity_speed: f32,
    current_lang: *const c_char,
    levels_path: *const c_char,
    species_path: *const c_char,
    inventory_path: *const c_char,
    key_value_storage_path: *const c_char,
    localized_strings_path: *const c_char,
) {
    initialize_config_paths(
        base_entity_speed,
        to_string(current_lang),
        to_path(levels_path),
        to_path(species_path),
        to_path(inventory_path),
        to_path(key_value_storage_path),
        to_path(localized_strings_path),
    );
}

#[no_mangle]
pub extern "C" fn can_render_frame() -> bool {
    let engine = engine();
    !engine.loading_screen.is_in_progress() || engine.loading_screen.progress() > 0.4
}

#[no_mangle]
pub extern "C" fn current_biome_tiles_variant() -> i32 {
    engine().world.biome_tiles.current_variant()
}

#[no_mangle]
pub extern "C" fn current_world_width() -> i32 {
    engine().world.bounds.w
}

#[no_mangle]
pub extern "C" fn current_world_height() -> i32 {
    engine().world.bounds.h
}

#[no_mangle]
pub extern "C" fn camera_viewport() -> IntRect {
    engine().camera_viewport
}

#[no_mangle]
pub extern "C" fn camera_viewport_offset() -> Vector2d {
    engine().camera_viewport_offset
}

#[no_mangle]
pub extern "C" fn current_world_default_tile() -> BiomeTile {
    engine().world.default_tile()
}

fn to_string(value: *const c_char) -> String {
    unsafe { CStr::from_ptr(value) }.to_str().unwrap().to_owned()
}

fn to_path(value: *const c_char) -> PathBuf {
    PathBuf::from(to_string(value))
}

#[no_mangle]
pub extern "C" fn current_world_id() -> u32 {
    engine().world.id
}

#[no_mangle]
pub extern "C" fn current_toast() -> ToastDescriptorC {
    engine().toast.descriptor_c()
}

#[no_mangle]
pub extern "C" fn current_menu() -> MenuDescriptorC {
    let engine = engine();

    if engine.dialogue_menu.is_open() {
        let mut descriptor = engine.dialogue_menu.menu.descriptor_c();
        free_c_char_ptr(descriptor.text);
        descriptor.text = string_to_c_char(engine.dialogue_menu.text.clone());
        return descriptor
    }
    if engine.long_text_display.is_open {
        let mut descriptor = MenuDescriptorC::empty();
        descriptor.is_visible = true;
        descriptor.text = string_to_c_char(engine.long_text_display.text.clone());
        return descriptor
    }
    if engine.confirmation_dialog.is_open() {
        return engine.confirmation_dialog.menu.descriptor_c()
    }
    if engine.entity_options_menu.is_open() {
        return engine.entity_options_menu.menu.descriptor_c()
    }
    if engine.menu.is_open() {
        return engine.menu.menu.descriptor_c()
    }
    MenuDescriptorC::empty()
}


pub fn string_to_c_char(s: String) -> *const c_char {
    let c_string = CString::new(s).expect("Failed to convert String to CString");
    let raw_ptr = c_string.into_raw();
    raw_ptr as *const c_char
}

#[no_mangle]
pub extern "C" fn free_c_char_ptr(ptr: *const c_char) {
    unsafe {
        if ptr.is_null() {
            return;
        }
        _ = CString::from_raw(ptr as *mut c_char);
    }
}

#[no_mangle]
pub extern "C" fn current_loading_screen_progress() -> f32 {
    engine().loading_screen.progress()
}

#[no_mangle]
pub extern "C" fn shows_death_screen() -> bool {
    engine().death_screen.is_open
}

#[no_mangle]
pub extern "C" fn select_current_menu_option_at_index(index: u32) {
    engine_mut().select_current_menu_option_at_index(index as usize)
}

#[no_mangle]
pub extern "C" fn number_of_kunai_in_inventory() -> i32 {
    inventory_items_count_for_species(SPECIES_KUNAI) as i32
}

#[no_mangle]
pub extern "C" fn is_day() -> bool {
    matches!(engine().world.light_conditions, LightConditions::Day)
}

#[no_mangle]
pub extern "C" fn is_night() -> bool {
    matches!(engine().world.light_conditions, LightConditions::Night)
}

#[no_mangle]
pub extern "C" fn is_limited_visibility() -> bool {
    let world = &engine().world;
    if world.creative_mode { return false }
    matches!(world.light_conditions, LightConditions::CantSeeShit)
}