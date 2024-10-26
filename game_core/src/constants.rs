use crate::utils::rect::IntRect;

// Fps
pub const ANIMATIONS_FPS: f32 = 10.0;

// Default Props
pub const INITIAL_CAMERA_VIEWPORT: IntRect = IntRect::new(0, 0, 60, 40);
pub const WORLD_SIZE_ROWS: usize = 80;
pub const WORLD_SIZE_COLUMNS: usize = 120;
pub const UNLIMITED_LIFESPAN: f32 = -420.0;
pub const NO_PARENT: u32 = 0;
pub const HERO_KUNAI_COOLDOWN: f32 = 0.1;

// Input
pub const KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS_FIRST: f32 = 0.4;
pub const KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS: f32 = 0.1;

// Known entities
pub const HERO_ENTITY_ID: u32 = 420;

// Known locations
pub const WORLD_ID_NONE: u32 = 1000;
pub const WORLD_ID_DEMO: u32 = 1001;

// Animations
pub const WORLD_TRANSITION_TIME: f32 = 0.3;
pub const MENU_CLOSE_TIME: f32 = 0.2;
pub const MENU_OPEN_TIME: f32 = 0.1;

// Prefabs
pub const HOUSE_INTERIOR_ROWS: usize = 6;
pub const HOUSE_INTERIOR_COLUMNS: usize = 10;

// Tiles
pub const TILE_VARIATIONS_FPS: f32 = 1.0;
pub const TILE_SIZE: f32 = 16.0;
pub const BIOME_NUMBER_OF_FRAMES: i32 = 4;
pub const STEP_COMMITMENT_THRESHOLD: f32 = TILE_SIZE / 16.0;

// Sprite Sheets
pub const SPRITE_SHEET_BLANK: u32 = 1000;
pub const SPRITE_SHEET_INVENTORY: u32 = 1001;
pub const SPRITE_SHEET_BIOME_TILES: u32 = 1002;
pub const SPRITE_SHEET_CONSTRUCTION_TILES: u32 = 1003;
pub const SPRITE_SHEET_BUILDINGS: u32 = 1004;
pub const SPRITE_SHEET_BASE_ATTACK: u32 = 1005;
pub const SPRITE_SHEET_HUMANOIDS_1X2: u32 = 1009;
pub const SPRITE_SHEET_STATIC_OBJECTS: u32 = 1010;
pub const SPRITE_SHEET_MENU: u32 = 1011;
pub const SPRITE_SHEET_ANIMATED_OBJECTS: u32 = 1012;
pub const SPRITE_SHEET_HUMANOIDS_1X1: u32 = 1014;
pub const SPRITE_SHEET_AVATARS: u32 = 1015;
pub const SPRITE_SHEET_HUMANOIDS_2X2: u32 = 1016;
pub const SPRITE_SHEET_FARM_PLANTS: u32 = 1017;
pub const SPRITE_SHEET_HUMANOIDS_2X3: u32 = 1018;