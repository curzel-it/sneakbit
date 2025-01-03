use game_core::{constants::{PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID, TILE_SIZE}, get_renderables_vec, utils::{rect::FRect, vector::Vector2d}, RenderableItem};
use raylib::prelude::*;

use super::ui::{get_rendering_config, CameraDirection};

pub fn render_entities(d: &mut RaylibDrawHandle, camera_viewport: &FRect) {
    let config = get_rendering_config();
    let scale = config.rendering_scale;
    let draw_entity_ids = config.show_advanced_debug_info;
    
    for item in &get_renderables_vec() {
        render_entity(
            d, scale, item, 
            config.is3d,
            camera_viewport,
            &config.direction, 
            config.canvas_size.y,
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
    canvas_height: f32,
    draw_entity_ids: bool
) {
    let sprite_key = item.sprite_sheet_id;
    
    if let Some(texture) = get_rendering_config().get_texture(sprite_key) {
        let source = item.texture_rect;
        let source_rect = frect_to_texture_source_rect(&source);

        let dest_rect = if is3d {
            frect_to_dest_rect_with_camera_direction(
                item.id,
                &item.frame,
                camera_viewport, 
                camera_direction,
                canvas_height,
                scale
            )
        } else {
            Some(frect_to_dest_rect(
                &item.frame,
                camera_viewport, 
                scale
            ))
        };

        if let Some(dest_rect) = dest_rect {
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
    id: u32,
    frame: &FRect, 
    camera_viewport: &FRect, 
    camera_direction: &CameraDirection,
    canvas_height: f32,
    scale: f32
) -> Option<Rectangle> {
    if !is_visible_in_3d(id, frame, camera_viewport, camera_direction) {
        return None
    }

    let t = TILE_SIZE * scale;
    let origin = camera_viewport.center();
    let distance = origin.distance_to(&frame.center());
    
    let scale = calculate_scale(distance);
    let y = calculate_y(distance, canvas_height);

    let rect = match camera_direction {
        CameraDirection::Up => {
            FRect {
                x: (frame.x - origin.x + camera_viewport.w / 2.0) * t,
                y,
                w: frame.w * t,
                h: frame.h * t,
            }
        },
        CameraDirection::Right => {
            FRect {
                x: (frame.y - origin.y + camera_viewport.w / 2.0) * t,
                y,
                w: frame.w * t,
                h: frame.h * t,
            }
        },
        CameraDirection::Down => {
            FRect {
                x: (camera_viewport.w / 2.0 - (frame.x - origin.x)) * t,
                y,
                w: frame.w * t,
                h: frame.h * t,
            }
        },
        CameraDirection::Left => {
            FRect {
                x: (camera_viewport.w / 2.0 - (frame.y - origin.y)) * t,
                y,
                w: frame.w * t,
                h: frame.h * t,
            }
        },        
    }.scaled_from_center(scale);

    Some(Rectangle { x: rect.x, y: rect.y, width: rect.w, height: rect.h })
}

fn is_visible_in_3d(
    id: u32,
    frame: &FRect, 
    camera_viewport: &FRect, 
    camera_direction: &CameraDirection
) -> bool {
    let origin = camera_viewport.center();

    if matches!(id, PLAYER1_ENTITY_ID | PLAYER2_ENTITY_ID | PLAYER3_ENTITY_ID | PLAYER4_ENTITY_ID) {
        return false
    }

    match camera_direction {
        CameraDirection::Up => frame.y < origin.y,
        CameraDirection::Right => frame.x > origin.x,
        CameraDirection::Down => frame.y > origin.y,
        CameraDirection::Left => frame.x < origin.x
    }
}

fn calculate_scale(distance: f32) -> f32 {
    const DISTANCE_1: f32 = 1.0;
    const SCALE_1: f32 = 4.0;
    const DISTANCE_8: f32 = 8.0;
    const SCALE_8: f32 = 1.0;
    
    let slope = (SCALE_8 - SCALE_1) / (DISTANCE_8 - DISTANCE_1);
    let intercept = SCALE_1 - slope * DISTANCE_1; 
    let scale = slope * distance + intercept;
    
    scale.clamp(SCALE_8, SCALE_1)
}

fn calculate_y(distance: f32, canvas_height: f32) -> f32 {
    const DISTANCE_1: f32 = 1.0;
    const Y_1_RATIO: f32 = 1.0 / 2.0;
    const DISTANCE_8: f32 = 8.0;
    const Y_8_RATIO: f32 = 1.0 / 3.0;
    
    let y1 = Y_1_RATIO * canvas_height;
    let y8 = Y_8_RATIO * canvas_height;
    
    let slope = (y8 - y1) / (DISTANCE_8 - DISTANCE_1); 
    let intercept = y1 - slope * DISTANCE_1;
    let y = slope * distance + intercept;
    
    y.clamp(y8, y1)
}
