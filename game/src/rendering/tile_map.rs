use game_core::{constants::TILE_SIZE, current_biome_tiles_variant, current_world_id, utils::rect::FRect};
use raylib::prelude::*;

use super::ui::get_rendering_config;

pub fn render_tile_map(d: &mut RaylibDrawHandle, camera_viewport: &FRect) -> bool {
    let config = get_rendering_config();
    
    if let Some(tile_map_image) = config.get_texture(current_map_key()) {
        let scale = config.rendering_scale;
        let tile_size = TILE_SIZE * scale;

        let scaled_map_width = tile_map_image.width() as f32 * scale;
        let scaled_map_height = tile_map_image.height() as f32 * scale;

        let offset_x = -camera_viewport.x as f32 * tile_size;
        let offset_y = -camera_viewport.y as f32 * tile_size;

        let dest_rect = Rectangle {
            x: offset_x,
            y: offset_y,
            width: scaled_map_width,
            height: scaled_map_height,
        };

        let source_rect = Rectangle {
            x: 0.0,
            y: 0.0,
            width: tile_map_image.width() as f32,
            height: tile_map_image.height() as f32,
        };

        d.draw_texture_pro(
            tile_map_image,
            source_rect,
            dest_rect,
            Vector2::zero(),
            0.0,
            Color::WHITE,
        );
        true
    } else {
        false
    }
}

pub fn current_map_key() -> u32 {
    let variant = current_biome_tiles_variant() as u32;
    let id = current_world_id();
    id * 10 + variant
}