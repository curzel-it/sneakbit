use crate::utils::rect::FRect;

pub const BUILD_NUMBER: u32 = 71;

// Default Props
pub const INITIAL_CAMERA_VIEWPORT: FRect = FRect::new(0.0, 0.0, 60.0, 40.0);
pub const UNLIMITED_LIFESPAN: f32 = -420.0;
pub const NO_PARENT: u32 = 0;
pub const PRESSURE_PLATE_SWITCH_COOLDOWN: f32 = 0.3;
pub const HERO_RECOVERY_PS: f32 = 1.0;
pub const MAX_PLAYERS: usize = 4;
pub const TURN_DURATION: f32 = 10.0;
pub const TURN_DURATION_AFTER_ENEMY_PLAYER_DAMAGE: f32 = 2.0;
pub const TURN_PREP_DURATION: f32 = 3.0;
pub const DIRECTION_CHANGE_COOLDOWN: f32 = 0.1;
pub const RAIL_CHANGE_COOLDOWN: f32 = 0.2;

// Input
pub const KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS_FIRST: f32 = 0.4;
pub const KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS: f32 = 0.1;

// Known entities
pub const PLAYER1_INDEX: usize = 0;
pub const PLAYER1_ENTITY_ID: u32 = 420;
pub const PLAYER2_INDEX: usize = 1;
pub const PLAYER2_ENTITY_ID: u32 = 421;
pub const PLAYER3_INDEX: usize = 2;
pub const PLAYER3_ENTITY_ID: u32 = 422;
pub const PLAYER4_INDEX: usize = 3;
pub const PLAYER4_ENTITY_ID: u32 = 423;

// Known locations
pub const WORLD_ID_NONE: u32 = 1000;

// Animations
pub const ANIMATIONS_FPS: f32 = 10.0;
pub const WORLD_TRANSITION_TIME: f32 = 0.3;
pub const MENU_CLOSE_TIME: f32 = 0.2;
pub const MENU_OPEN_TIME: f32 = 0.1;
pub const Z_INDEX_OVERLAY: i32 = 99;
pub const Z_INDEX_UNDERLAY: i32 = -1;

// Prefabs
pub const HOUSE_INTERIOR_ROWS: usize = 6;
pub const HOUSE_INTERIOR_COLUMNS: usize = 10;

// Tiles
pub const TILE_VARIATIONS_FPS: f32 = 0.75;
pub const TILE_SIZE: f32 = 16.0;
pub const BIOME_NUMBER_OF_FRAMES: i32 = 4;
pub const STEP_COMMITMENT_THRESHOLD: f32 = TILE_SIZE / 4.0;

// Sprite Sheets
pub const SPRITE_SHEET_BLANK: u32 = 1000;
pub const SPRITE_SHEET_INVENTORY: u32 = 1001;
pub const SPRITE_SHEET_BIOME_TILES: u32 = 1002;
pub const SPRITE_SHEET_CONSTRUCTION_TILES: u32 = 1003;
pub const SPRITE_SHEET_BUILDINGS: u32 = 1004;
pub const SPRITE_SHEET_HUMANOIDS_1X2: u32 = 1009;
pub const SPRITE_SHEET_STATIC_OBJECTS: u32 = 1010;
pub const SPRITE_SHEET_MENU: u32 = 1011;
pub const SPRITE_SHEET_ANIMATED_OBJECTS: u32 = 1012;
pub const SPRITE_SHEET_HUMANOIDS_1X1: u32 = 1014;
pub const SPRITE_SHEET_HUMANOIDS_2X2: u32 = 1016;
pub const SPRITE_SHEET_CAVE_DARKNESS: u32 = 1019;
pub const SPRITE_SHEET_DEMON_LORD_DEFEAT: u32 = 1020;
pub const SPRITE_SHEET_TENTACLES: u32 = 1021;
pub const SPRITE_SHEET_WEAPONS: u32 = 1022;
pub const SPRITE_SHEET_MONSTERS: u32 = 1023;
pub const SPRITE_SHEET_HEROES: u32 = 1024;