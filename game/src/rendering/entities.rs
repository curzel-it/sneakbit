use game_core::{constants::TILE_SIZE, get_renderables_vec, utils::rect::FRect, RenderableItem};
use raylib::prelude::*;

use super::ui::get_rendering_config;

pub fn render_entities(d: &mut RaylibDrawHandle, camera_viewport: &FRect) {
    let config = get_rendering_config();
    let scale = config.rendering_scale;
    let draw_entity_ids = config.show_advanced_debug_info;
    
    for item in &get_renderables_vec() {
        render_entity(d, scale, item, camera_viewport, draw_entity_ids);
    }
}

fn render_entity(
    d: &mut RaylibDrawHandle, 
    scale: f32,
    item: &RenderableItem, 
    camera_viewport: &FRect,
    draw_entity_ids: bool
) {
    let sprite_key = item.sprite_sheet_id;
    let tile_scale = TILE_SIZE * scale;
    
    if let Some(texture) = get_rendering_config().get_texture(sprite_key) {
        let source = item.texture_rect;
        let source_rect = Rectangle {
            x: source.x * TILE_SIZE, 
            y: source.y * TILE_SIZE,
            width: source.w * TILE_SIZE,
            height: source.h * TILE_SIZE,
        };

        let frame = item.frame;
        let dest_rect = Rectangle {
            x: (frame.x - camera_viewport.x) * tile_scale,
            y: (frame.y - camera_viewport.y) * tile_scale,
            width: frame.w * tile_scale,
            height: frame.h * tile_scale,
        };

        d.draw_texture_pro(
            texture,
            source_rect,
            dest_rect,
            Vector2::zero(), 
            0.0,
            Color::WHITE,
        );

        if draw_entity_ids {
            let x = dest_rect.x as i32 - 8;
            let y = dest_rect.y as i32 + 2;
            d.draw_text(&format!("{}", item.id), x - 1, y - 1, 10, Color::BLACK);
            d.draw_text(&format!("{}", item.id), x + 1, y + 1, 10, Color::BLACK);
            d.draw_text(&format!("{}", item.id), x, y, 10, Color::WHITE);
        }
    }
}