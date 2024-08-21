use raylib::math::Rectangle;

pub const FPS: u32 = 60;
pub const TILE_VARIATIONS_FPS: f32 = 1.0;
pub const ANIMATIONS_FPS: f32 = 10.0;
pub const BASE_ENTITY_SPEED: f32 = 30.0;
pub const FONT: &str = "/Users/curzel/dev/tower-defense/fonts/PixelOperator/PixelOperator8.ttf";
pub const FONT_BOLD: &str = "/Users/curzel/dev/tower-defense/fonts/PixelOperator/PixelOperator8-Bold.ttf";
pub const ASSETS_PATH: &str = "/Users/curzel/dev/tower-defense/assets";
pub const NO_PARENT: u32 = 0;
pub const INFINITE_LIFESPAN: f32 = -420.0;
pub const INITIAL_CAMERA_VIEWPORT: Rectangle = Rectangle::new(0.0, 0.0, 1000.0, 750.0);
pub const TILE_SIZE: f32 = 16.0;
pub const TILE_SIZE_HALF: f32 = TILE_SIZE / 2.0;
pub const TILE_TEXTURE_SIZE: f32 = 16.0;
pub const TILE_VARIATIONS_COUNT: u32 = 4;
pub const COLLISION_THRESHOLD: f32 = TILE_SIZE / 3.0;
pub const HERO_ENTITY_ID: u32 = 69;
pub const INFINITE_STOCK: i32 = -420;
pub const PADDING_ZERO: f32 = 8.0;
pub const PADDING_SM: f32 = 8.0;
pub const PADDING_MD: f32 = 16.0;
pub const PADDING_LG: f32 = 24.0;

// Test Stuff
pub const RECT_ORIGIN_SQUARE_100: Rectangle = Rectangle::new(0.0, 0.0, 100.0, 100.0);
