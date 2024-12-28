#![allow(clippy::new_without_default, clippy::not_unsafe_ptr_arg_deref)]

use std::{collections::HashSet, path::PathBuf, ptr};
use std::os::raw::c_char;

use config::initialize_config_paths;
use entities::known_species::SPECIES_KUNAI_LAUNCHER;
use entities::species::species_by_id;
use equipment::basics::{available_weapons, set_equipped, AmmoRecap};
use features::fast_travel::{available_fast_travel_destinations_from_current_world, FastTravelDestination};
use features::messages::{CDisplayableMessage, DisplayableMessage, DisplayableMessageCRepr};
use features::{light_conditions::LightConditions, sound_effects::SoundEffect, state_updates::WorldStateUpdate, toasts::ToastCRepr};
use features::{engine::GameEngine, storage::{get_value_for_global_key, inventory_count, StorageKey}};
use input::{keyboard_events_provider::KeyboardEventsProvider, mouse_events_provider::MouseEventsProvider};
use features::toasts::{Toast, CToast};
use maps::biome_tiles::BiomeTile;
use maps::construction_tiles::ConstructionTile;
use multiplayer::turns_use_case::{CMatchResult, MatchResult};
use multiplayer::{modes::GameMode, turns::GameTurn};
use utils::{rect::FRect, strings::{c_char_ptr_to_string, string_to_c_char}, vector::Vector2d};

pub mod config;
pub mod constants;
pub mod entities;
pub mod equipment;
pub mod features;
pub mod lang;
pub mod input;
pub mod maps;
pub mod multiplayer;
pub mod prefabs;
pub mod ui;
pub mod utils;
pub mod worlds;

static mut ENGINE: *mut GameEngine = std::ptr::null_mut();

fn engine() -> &'static GameEngine {
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
pub extern "C" fn window_size_changed(width: f32, height: f32, scale: f32) {
    engine_mut().window_size_changed(width, height, scale)
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
    pub texture_rect: FRect,
    pub frame: FRect,
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
        c_char_ptr_to_string(current_lang),
        to_path(levels_path),
        to_path(species_path),
        to_path(key_value_storage_path),
        to_path(localized_strings_path),
    );
}

#[no_mangle]
pub extern "C" fn current_biome_tiles_variant() -> i32 {
    engine().world.biome_tiles.current_variant()
}

#[no_mangle]
pub extern "C" fn current_world_width() -> f32 {
    engine().world.bounds.w
}

#[no_mangle]
pub extern "C" fn current_world_height() -> f32 {
    engine().world.bounds.h
}

#[no_mangle]
pub extern "C" fn camera_viewport() -> FRect {
    engine().camera_viewport
}

fn to_path(value: *const c_char) -> PathBuf {
    PathBuf::from(c_char_ptr_to_string(value))
}

#[no_mangle]
pub extern "C" fn current_world_id() -> u32 {
    engine().world.id
}

#[no_mangle]
pub extern "C" fn ammo_in_inventory_for_weapon(weapon_species_id: u32, player: usize) -> u32 {
    let bulled_species_id = species_by_id(weapon_species_id).bullet_species_id;
    inventory_count(&bulled_species_id, player)
}

#[no_mangle]
pub extern "C" fn player_current_hp(player: usize) -> f32 {
    engine().world.players[player].props.hp
}

pub fn cached_players_positions() -> Vec<Vector2d> {
    engine().world.players
        .iter()
        .map(|p| p.props.hittable_frame.origin())
        .collect()
}

pub fn cached_player_position(player: usize) -> Vector2d {
    engine().world.players[player].props.hittable_frame.origin()
}

#[no_mangle]
pub extern "C" fn melee_equipped_weapon_id(player: usize) -> u32 {
    get_value_for_global_key(&StorageKey::currently_equipped_melee_weapon(player)).unwrap_or(0)
}

#[no_mangle]
pub extern "C" fn ranged_equipped_weapon_id(player: usize) -> u32 {
    let key = &StorageKey::currently_equipped_ranged_weapon(player);
    get_value_for_global_key(key).unwrap_or(SPECIES_KUNAI_LAUNCHER)
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
pub extern "C" fn start_new_game() {
    engine_mut().start_new_game();    
}

pub fn wants_fullscreen() -> bool {
    engine().wants_fullscreen
}

pub fn set_wants_fullscreen(enabled: bool) {
    engine_mut().wants_fullscreen = enabled;
}

pub fn save_game() {
    engine().save();
}

pub fn current_sound_effects() -> HashSet<SoundEffect> {
    engine().sound_effects.current_sound_effects.clone()
}

pub fn current_world_biome_tiles() -> &'static Vec<Vec<BiomeTile>> {
    &engine().world.biome_tiles.tiles
}

pub fn current_world_construction_tiles() -> &'static Vec<Vec<ConstructionTile>> {
    &engine().world.construction_tiles.tiles
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

pub fn is_any_hero_on_a_slippery_surface() -> bool {
    engine().world.is_any_hero_on_a_slippery_surface()
}

pub fn is_player_by_index_on_slippery_surface(index: usize) -> bool {
    engine().world.is_player_by_index_on_slippery_surface(index)
}

pub fn number_of_players() -> usize {
    engine().number_of_players
}

pub fn indeces_of_dead_players() -> &'static Vec<usize> {
    &engine().dead_players
}

pub fn update_number_of_players(count: usize) {
    engine_mut().update_number_of_players(count)
}

pub fn currently_active_players() -> Vec<usize> {
    let engine = engine();
    match engine.turn {
        GameTurn::RealTime => {
            (0..engine.number_of_players)
                .filter(|index| !engine.dead_players.contains(index))
                .collect()
        },
        GameTurn::Player(turn_info) => vec![turn_info.player_index],
        GameTurn::PlayerPrep(_) => vec![]
    }
}

pub fn update_game_mode(game_mode: GameMode) {
    engine_mut().update_game_mode(game_mode);
}

pub fn current_keyboard_state() -> &'static KeyboardEventsProvider {
    &engine().keyboard
}

pub fn current_mouse_state() -> &'static MouseEventsProvider {
    &engine().mouse
}

pub fn current_camera_viewport() -> &'static FRect {
    &engine().camera_viewport
}

pub fn apply_world_state_updates(updates: Vec<WorldStateUpdate>) {
    engine_mut().apply_world_state_updates(updates)
}

pub fn is_turn_based_game_mode() -> bool {
    engine().game_mode.is_turn_based()
}

#[no_mangle]
pub extern "C" fn is_pvp() -> bool {
    engine().game_mode.allows_pvp()
}

#[no_mangle]
pub extern "C" fn is_turn_prep() -> bool {
    matches!(engine().turn, GameTurn::PlayerPrep(_))
}

pub fn time_left_for_current_turn() -> f32 {
    match engine().turn {
        multiplayer::turns::GameTurn::RealTime => 0.0,
        multiplayer::turns::GameTurn::PlayerPrep(turn_info) => turn_info.time_remaining,
        multiplayer::turns::GameTurn::Player(turn_info) => turn_info.time_remaining
    }
}

pub fn next_message() -> &'static Option<DisplayableMessage> {
    &engine().message
}

#[no_mangle]
pub extern "C" fn next_toast() -> &'static Option<Toast> {
    &engine().toast
}

pub fn match_result() -> &'static MatchResult {
    &engine().match_result
}

#[no_mangle]
pub extern "C" fn revive() {
    engine_mut().revive()
}

#[no_mangle]
pub extern "C" fn did_request_fast_travel() -> bool {
    engine().fast_travel_requested
}

#[no_mangle]
pub extern "C" fn cancel_fast_travel() {
    engine_mut().cancel_fast_travel()
}

#[no_mangle]
pub extern "C" fn handle_fast_travel(destination: FastTravelDestination) {
    engine_mut().handle_fast_travel(destination)
}

#[no_mangle]
pub extern "C" fn available_fast_travel_destinations_from_current_world_c(length: *mut usize) -> *mut FastTravelDestination {
    let items = available_fast_travel_destinations_from_current_world();
    let len = items.len();
    
    unsafe {
        ptr::write(length, len);
    }

    let ptr = items.as_ptr() as *mut FastTravelDestination;
    std::mem::forget(items);
    ptr
}

#[no_mangle]
pub extern "C" fn free_fast_travel_destinations(ptr: *mut FastTravelDestination, length: usize) {
    if !ptr.is_null() {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, length, length);
        }
    }
}

#[no_mangle]
pub extern "C" fn did_request_pvp_arena() -> bool {
    engine().pvp_arena_requested
}

#[no_mangle]
pub extern "C" fn cancel_pvp_arena_request() {
    engine_mut().cancel_pvp_arena_request()
}

#[no_mangle]
pub extern "C" fn exit_pvp_arena() {
    engine_mut().exit_pvp_arena()
}

#[no_mangle]
pub extern "C" fn handle_pvp_arena(number_of_players: usize) {
    engine_mut().handle_pvp_arena(number_of_players)
}

#[no_mangle]
pub extern "C" fn current_player_index() -> usize {
    match engine().turn {
        GameTurn::RealTime => 0,
        GameTurn::PlayerPrep(player_turn_info) => player_turn_info.player_index,
        GameTurn::Player(player_turn_info) => player_turn_info.player_index
    }
}

#[no_mangle]
pub extern "C" fn game_state() -> GameState {
    let engine = engine();
    let player = current_player_index();
    let is_interaction_available = engine.world.entities.borrow().iter().any(|e| e.is_in_interaction_range);

    GameState {
        toasts: engine.toast.c_repr(),
        messages: engine.message.c_repr(),
        is_interaction_available,
        match_result: engine.match_result.c_repr(),
        hp: player_current_hp(player),
        has_requested_fast_travel: did_request_fast_travel(),
        has_requested_pvp_arena: did_request_pvp_arena(),
        current_player_index: player,
        is_pvp: is_pvp(),
        is_turn_prep: is_turn_prep(),
        turn_time_left: time_left_for_current_turn()
    }
}

#[repr(C)]
pub struct GameState {
    pub toasts: CToast,
    pub messages: CDisplayableMessage,
    pub is_interaction_available: bool,
    pub match_result: CMatchResult,
    pub hp: f32,
    pub has_requested_fast_travel: bool,
    pub has_requested_pvp_arena: bool,
    pub current_player_index: usize,
    pub is_pvp: bool,
    pub is_turn_prep: bool,
    pub turn_time_left: f32
}

#[no_mangle]
pub extern "C" fn available_weapons_c(player: usize, count: *mut usize) -> *mut AmmoRecap {
    let items = available_weapons(player);
    let len = items.len(); 
    unsafe {
        ptr::write(count, len);
    }
    let ptr = items.as_ptr() as *mut AmmoRecap;
    std::mem::forget(items);
    ptr
}

#[no_mangle]
pub extern "C" fn free_weapons(ptr: *mut AmmoRecap, length: usize) {
    if !ptr.is_null() {
        unsafe {
            let _ = Vec::from_raw_parts(ptr, length, length);
        }
    }
}

#[no_mangle]
pub extern "C" fn set_weapon_equipped(species_id: u32, player: usize) {
    let species = species_by_id(species_id);
    set_equipped(&species, player);
}
