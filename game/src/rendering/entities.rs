use game_core::{constants::TILE_SIZE, get_renderables_vec, utils::{rect::FRect, vector::Vector2d}, RenderableItem};
use raylib::prelude::*;

use super::ui::{get_rendering_config, CameraDirection};

pub fn render_entities(d: &mut RaylibDrawHandle, camera_viewport: &FRect) {
    let config = get_rendering_config();
    let scale = config.rendering_scale;
    let draw_entity_ids = config.show_advanced_debug_info;
    let is3d = true;
    
    for item in &get_renderables_vec() {
        render_entity(
            d, scale, item, is3d,
            camera_viewport,
            &config.direction, 
            draw_entity_ids
        );
    }
}

fn render_entity(
    d: &mut RaylibDrawHandle, 
    scale: f32,
    item: &RenderableItem, 
    is3d: bool,
    camera_viewport: &FRect,
    camera_direction: &CameraDirection,
    draw_entity_ids: bool
) {
    let sprite_key = item.sprite_sheet_id;
    
    if let Some(texture) = get_rendering_config().get_texture(sprite_key) {
        let source = item.texture_rect;
        let source_rect = frect_to_texture_source_rect(&source);

        let dest_rect = if is3d {
            frect_to_dest_rect_with_camera_direction(
                &item.frame,
                camera_viewport, 
                camera_direction,
                scale
            )
        } else {
            frect_to_dest_rect(
                &item.frame,
                camera_viewport, 
                scale
            )
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

fn frect_to_texture_source_rect(source: &FRect) -> Rectangle {
    Rectangle {
        x: source.x * TILE_SIZE, 
        y: source.y * TILE_SIZE,
        width: source.w * TILE_SIZE,
        height: source.h * TILE_SIZE,
    }
}

fn frect_to_dest_rect(frame: &FRect, camera_viewport: &FRect, scale: f32) -> Rectangle {
    let t = TILE_SIZE * scale;

    Rectangle {
        x: (frame.x - camera_viewport.x) * t,
        y: (frame.y - camera_viewport.y) * t,
        width: frame.w * t,
        height: frame.h * t,
    }
}

fn frect_to_dest_rect_with_camera_direction(
    frame: &FRect, 
    camera_viewport: &FRect, 
    camera_direction: &CameraDirection,
    scale: f32
) -> Rectangle {
    let t = TILE_SIZE * scale;
    let origin = camera_viewport.center();

    match camera_direction {
        CameraDirection::Up => {
            Rectangle {
                x: (frame.x - origin.x) * t,
                y: 500.0, // Fixed to be at the center of my screen for now
                width: frame.w * t,
                height: frame.h * t,
            }
        },
        CameraDirection::Right => {
            Rectangle {
                x: (frame.y - origin.y) * t,
                y: 500.0,
                width: frame.w * t,
                height: frame.h * t,
            }
        },
        CameraDirection::Down => {
            Rectangle {
                x: (frame.x - origin.x) * t,
                y: 500.0,
                width: frame.w * t,
                height: frame.h * t,
            }
        },
        CameraDirection::Left => {
            Rectangle {
                x: (frame.y - origin.y) * t,
                y: 500.0,
                width: frame.w * t,
                height: frame.h * t,
            }
        }
    }
}