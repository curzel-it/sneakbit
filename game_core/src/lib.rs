#![allow(clippy::new_without_default, clippy::not_unsafe_ptr_arg_deref)]

use std::{collections::HashSet, ffi::{CStr, CString}, path::PathBuf, ptr};
use std::os::raw::c_char;

use config::initialize_config_paths;
use entities::known_species::{SPECIES_AR15_BULLET, SPECIES_CANNON_BULLET, SPECIES_KUNAI};
use features::{light_conditions::LightConditions, links::LinksHandler, sound_effects::SoundEffect};
use game_engine::{engine::{GameEngine, GameMode}, storage::{get_value_for_global_key, inventory_count, StorageKey}};
use menus::{menu::MenuDescriptorC, toasts::ToastDescriptorC};
use utils::{rect::{IntPoint, IntRect}, vector::Vector2d};

pub mod config;
pub mod constants;
pub mod entities;
pub mod equipment;
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
pub extern "C" fn initialize_game(mode: GameMode) {
    unsafe {
        let boxed = Box::new(GameEngine::new(mode));
        ENGINE = Box::into_raw(boxed);      
    }
    let engine = engine_mut();
    engine.start();
}

pub fn is_creative_mode() -> bool {
    matches!(&engine().game_mode, GameMode::Creative)
}

pub fn current_game_mode() -> GameMode {
    engine().game_mode
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
    player: usize,
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
    close_attack_pressed: bool,
    ranged_attack_pressed: bool,
    weapon_selection_pressed: bool,
    backspace_pressed: bool,
    current_char: u32,
    time_since_last_update: f32
) {
    engine_mut().keyboard.update(
        player,
        up_pressed, right_pressed, down_pressed, left_pressed, 
        up_down, right_down, down_down, left_down, 
        escape_pressed, menu_pressed, confirm_pressed, 
        close_attack_pressed, ranged_attack_pressed, 
        weapon_selection_pressed,
        backspace_pressed, 
        if current_char == 0 { None } else { char::from_u32(current_char) }, 
        time_since_last_update
    );
}

#[no_mangle]
pub extern "C" fn update_mouse(
    mouse_left_down: bool, 
    mouse_left_pressed: bool, 
    mouse_right_down: bool, 
    mouse_right_pressed: bool, 
    mouse_x: f32,
    mouse_y: f32,
    rendering_scale: f32
) {
    engine_mut().mouse.update(
        mouse_left_down, 
        mouse_left_pressed, 
        mouse_right_down, 
        mouse_right_pressed, 
        mouse_x, 
        mouse_y, 
        rendering_scale
    );
}

#[repr(C)]
pub struct RenderableItem {
    pub sprite_sheet_id: u32,
    pub texture_rect: IntRect,
    pub offset: Vector2d,
    pub frame: IntRect,
    pub sorting_key: u32
}

pub fn get_renderables_vec() -> Vec<RenderableItem> {
    let world = &engine().world;
    let visible_entity_ids = &world.visible_entities;
    let all_entities = world.entities.borrow();    

    let mut renderables: Vec<RenderableItem> = visible_entity_ids
        .iter()
        .map(|(index, _)| &all_entities[*index])
        .filter(|e| !e.is_equipment() || e.is_equipped)
        .map(|e| {
            RenderableItem {
                sprite_sheet_id: e.sprite_sheet(),
                texture_rect: e.texture_source_rect(),
                offset: e.offset,
                frame: e.frame,
                sorting_key: e.sorting_key
            }
        })
        .collect();

    renderables.sort_by_key(|e| e.sorting_key);

    renderables.extend(
        world.cutscenes.iter().map(|c| c.renderable_item())
    );

    renderables
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
    is_mobile: bool,
    base_entity_speed: f32,
    current_lang: *const c_char,
    levels_path: *const c_char,
    species_path: *const c_char,
    key_value_storage_path: *const c_char,
    localized_strings_path: *const c_char,
) {
    initialize_config_paths(
        is_mobile,
        base_entity_speed,
        to_string(current_lang),
        to_path(levels_path),
        to_path(species_path),
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

fn to_string(value: *const c_char) -> String {
    if value.is_null() {
        return String::new();
    }

    unsafe {
        CStr::from_ptr(value)
            .to_str()
            .unwrap_or_default()
            .to_owned()
    }
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

    if engine.long_text_display.is_open {
        return engine.long_text_display.descriptor_c()
    }
    if engine.confirmation_dialog.is_open() {
        return engine.confirmation_dialog.menu.descriptor_c()
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
pub extern "C" fn number_of_kunai_in_inventory(player: usize) -> i32 {
    inventory_count(&SPECIES_KUNAI, player) as i32
}

#[no_mangle]
pub extern "C" fn number_of_rem223_in_inventory(player: usize) -> i32 {
    inventory_count(&SPECIES_AR15_BULLET, player) as i32
}

#[no_mangle]
pub extern "C" fn number_of_cannonball_in_inventory(player: usize) -> i32 {
    inventory_count(&SPECIES_CANNON_BULLET, player) as i32
}

#[no_mangle]
pub extern "C" fn player_current_hp(player: usize) -> f32 {
    engine().world.players[player].props.hp
}

pub fn cached_players_positions() -> Vec<IntPoint> {
    engine().world.players
        .iter()
        .map(|p| p.props.hittable_frame.origin())
        .collect()
}

#[no_mangle]
pub extern "C" fn is_melee_equipped(player: usize) -> bool {
    get_value_for_global_key(&StorageKey::currently_equipped_melee_weapon(player)).unwrap_or(0) != 0
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
    if is_creative_mode() { return false }
    let world = &engine().world;
    matches!(world.light_conditions, LightConditions::CantSeeShit)
}

#[no_mangle]
pub extern "C" fn is_interaction_available() -> bool {
    engine().world.entities.borrow().iter().any(|e| e.is_in_interaction_range)
}

#[no_mangle]
pub extern "C" fn start_new_game() {
    engine_mut().start_new_game();    
}

pub fn engine_set_wants_fullscreen() {
    engine_mut().wants_fullscreen = true;
}

pub fn current_sound_effects() -> HashSet<SoundEffect> {
    engine().sound_effects.current_sound_effects.clone()
}

#[no_mangle]
pub extern "C" fn get_current_sound_effects(length: *mut usize) -> *mut SoundEffect {
    let items: Vec<SoundEffect> = current_sound_effects().into_iter().collect();
    let len = items.len();
    
    unsafe {
        ptr::write(length, len);
    }

    let ptr = items.as_ptr() as *mut SoundEffect;
    std::mem::forget(items);
    ptr
}

#[no_mangle]
pub extern "C" fn free_sound_effects(ptr: *mut SoundEffect, length: usize) {
    if !ptr.is_null() {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, length, length);
        }
    }
}

pub fn current_soundtrack_string() -> Option<String> {
    engine().world.soundtrack.clone()
}

#[no_mangle]
pub extern "C" fn current_soundtrack() -> *const c_char {
    string_to_c_char(current_soundtrack_string().unwrap_or_default())
}

pub fn set_links_handler(handler: Box<dyn LinksHandler>) {
    engine_mut().links_handler = handler;
}

pub fn is_any_hero_on_a_slippery_surface() -> bool {
    engine().world.is_any_hero_on_a_slippery_surface()
}

pub fn is_player_by_index_on_slippery_surface(index: usize) -> bool {
    engine().world.is_player_by_index_on_slippery_surface(index)
}

pub fn number_of_players() -> usize {
    engine().number_of_players
}

pub fn update_number_of_players(count: usize) {
    engine_mut().update_number_of_players(count)
}

pub fn toggle_pvp() {
    let next = match current_game_mode() {
        GameMode::RealTimeCoOp => GameMode::TurnBasedPvp,
        GameMode::Creative => GameMode::Creative,
        GameMode::TurnBasedPvp => GameMode::RealTimeCoOp,
    };
    engine_mut().update_game_mode(next);
}