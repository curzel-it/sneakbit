use game_core::{camera_viewport, constants::{SPRITE_SHEET_CAVE_DARKNESS, TILE_SIZE}, current_world_biome_tiles, current_world_construction_tiles, hittables, is_limited_visibility, is_night, tiles_hittables};
use raylib::prelude::*;

use crate::{gameui::game_hud::hud_ui, GameContext};

use super::{entities::render_entities, tile_map::render_tile_map, tiles::render_tiles, ui::{get_rendering_config, render_layout}};

pub fn render_frame(context: &mut GameContext) {
    let config = get_rendering_config();
    let fps = context.rl.get_fps();
    let screen_width = config.canvas_size.x as i32;
    let screen_height = config.canvas_size.y as i32;
    let can_render_frame = context.can_render_frame();
    let hud = hud_ui(
        context,
        config.canvas_size.x, 
        config.canvas_size.y,
        config.show_debug_info,
        fps
    );
    
    let mut d = context.rl.begin_drawing(&context.rl_thread);
    d.clear_background(Color::BLACK);
    
    let camera_viewport = camera_viewport();

    if can_render_frame {
        render_night(&mut d, screen_width, screen_height);
        render_entities(&mut d, &camera_viewport);
        render_limited_visibility(&mut d, screen_width, screen_height);
        render_layout(&hud, &mut d);
        
        if config.show_advanced_debug_info {
            draw_hittable_overlays(&mut d);
        }
    }
}

#[allow(dead_code)]
fn draw_hittable_overlays(d: &mut RaylibDrawHandle) {
    let config = get_rendering_config();
    let camera_viewport = camera_viewport();

    hittables().iter().for_each(|hittable| {
        let frame = hittable.frame;
        let dest_rect = Rectangle {
            x: (frame.x - camera_viewport.x) * TILE_SIZE * config.rendering_scale,
            y: (frame.y - camera_viewport.y) * TILE_SIZE * config.rendering_scale,
            width: frame.w * TILE_SIZE * config.rendering_scale,
            height: frame.h * TILE_SIZE * config.rendering_scale,
        };
        d.draw_rectangle_lines_ex(dest_rect, 1.0, Color::RED.alpha(0.5));
    });

    tiles_hittables().iter().for_each(|hittable| {
        let frame = hittable.frame;
        let dest_rect = Rectangle {
            x: (frame.x - camera_viewport.x) * TILE_SIZE * config.rendering_scale,
            y: (frame.y - camera_viewport.y) * TILE_SIZE * config.rendering_scale,
            width: frame.w * TILE_SIZE * config.rendering_scale,
            height: frame.h * TILE_SIZE * config.rendering_scale,
        };
        d.draw_rectangle_lines_ex(dest_rect, 1.0, Color::BLUE.alpha(0.5));
    });
}

fn render_night(d: &mut RaylibDrawHandle, screen_width: i32, screen_height: i32) {
    if is_night() {
        d.draw_rectangle(0, 0, screen_width, screen_height, Color::BLACK.alpha(0.5));
    }
}

fn render_limited_visibility(d: &mut RaylibDrawHandle, screen_width: i32, screen_height: i32) {
    if is_limited_visibility() {
        let config = get_rendering_config();
        let rendering_scale = config.rendering_scale;
        let visible_area_size = TILE_SIZE * 9.0 * rendering_scale;
        let half_s = visible_area_size / 2.0;
        let half_tile = TILE_SIZE / 2.0;
        let half_tile_i = half_tile as i32;

        let center_x = (screen_width as f32) / 2.0;
        let center_y = (screen_height as f32) / 2.0;

        let square_left_x = (center_x - half_s) as i32;
        let square_top_y = (center_y - half_s) as i32;
        let square_right_x = (half_tile + center_x + half_s) as i32;
        let square_bottom_y = (half_tile + center_y + half_s) as i32;

        d.draw_rectangle(0, 0, screen_width, square_top_y + half_tile_i, Color::BLACK);
        d.draw_rectangle(0, square_bottom_y, screen_width, screen_height - square_bottom_y, Color::BLACK);
        d.draw_rectangle(0, square_top_y, half_tile_i + square_left_x, half_tile_i + square_bottom_y - square_top_y, Color::BLACK);
        d.draw_rectangle(square_right_x, square_top_y, screen_width - square_right_x, square_bottom_y - square_top_y, Color::BLACK);

        if let Some(texture) = config.get_texture(SPRITE_SHEET_CAVE_DARKNESS) {
            d.draw_texture_pro(
                texture,
                Rectangle::new(0.0, 0.0, 160.0, 160.0),
                Rectangle::new(
                    half_tile + center_x - half_s, 
                    half_tile + center_y - half_s, 
                    visible_area_size as f32, 
                    visible_area_size as f32
                ),
                Vector2::zero(), 
                0.0,
                Color::WHITE,
            );
        }
    }
}
