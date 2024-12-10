use crate::utils::rect::IntRect;

pub const BUILD_NUMBER: u32 = 34;

// Fps
pub const ANIMATIONS_FPS: f32 = 10.0;

// Default Props
pub const INITIAL_CAMERA_VIEWPORT: IntRect = IntRect::new(0, 0, 60, 40);
pub const UNLIMITED_LIFESPAN: f32 = -420.0;
pub const NO_PARENT: u32 = 0;
pub const PRESSURE_PLATE_SWITCH_COOLDOWN: f32 = 0.3;
pub const HERO_RECOVERY_PS: f32 = 1.0;

// Weapons
pub const KUNAI_LIFESPAN: f32 = 1.2;
pub const KUNAI_LAUNCHER_COOLDOWN: f32 = 0.15;
pub const SWORD_SLASH_LIFESPAN: f32 = 0.25;
pub const SWORD_SLASH_COOLDOWN: f32 = 0.2;
pub const CLAYMORE_SLASH_LIFESPAN: f32 = 0.3;
pub const CLAYMORE_SLASH_COOLDOWN: f32 = 0.35;

// Input
pub const KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS_FIRST: f32 = 0.4;
pub const KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS: f32 = 0.1;

// Known entities
pub const PLAYER1_ENTITY_ID: u32 = 420;
pub const PLAYER2_ENTITY_ID: u32 = 421;
pub const PLAYER3_ENTITY_ID: u32 = 422;
pub const PLAYER4_ENTITY_ID: u32 = 423;

// Known locations
pub const WORLD_ID_NONE: u32 = 1000;

// Animations
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
pub const SPRITE_SHEET_AVATARS: u32 = 1015;
pub const SPRITE_SHEET_HUMANOIDS_2X2: u32 = 1016;
pub const SPRITE_SHEET_FARM_PLANTS: u32 = 1017;
pub const SPRITE_SHEET_HUMANOIDS_2X3: u32 = 1018;
pub const SPRITE_SHEET_CAVE_DARKNESS: u32 = 1019;
pub const SPRITE_SHEET_DEMON_LORD_DEFEAT: u32 = 1020;
pub const SPRITE_SHEET_TENTACLES: u32 = 1021;
pub const SPRITE_SHEET_WEAPONS: u32 = 1022;