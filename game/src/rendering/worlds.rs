use game_core::{camera_viewport, camera_viewport_offset, can_render_frame, constants::{SPRITE_SHEET_CAVE_DARKNESS, TILE_SIZE}, engine, is_limited_visibility, is_night};
use raylib::prelude::*;

use crate::{gameui::game_hud::hud_ui, GameContext};

use super::{entities::render_entities, tile_map::render_tile_map, tiles::render_tiles, ui::{get_rendering_config, render_layout}};

pub fn render_frame(context: &mut GameContext) {
    let engine = engine();
    let world = &engine.world;

    let config = get_rendering_config();
    let fps = context.rl.get_fps();
    let screen_width = config.canvas_size.x as i32;
    let screen_height = config.canvas_size.y as i32;

    let hud = hud_ui(
        context,
        config.canvas_size.x as i32, 
        config.canvas_size.y as i32,
        config.show_debug_info,
        fps
    );
    
    let mut d = context.rl.begin_drawing(&context.rl_thread);
    d.clear_background(Color::BLACK);
    
    if can_render_frame() {
        let camera_viewport = camera_viewport();
        let camera_viewport_offset = camera_viewport_offset();

        if config.render_using_individual_tiles {
            render_tiles(
                &mut d, 
                &camera_viewport, 
                &camera_viewport_offset,
                &world.biome_tiles.tiles,
                &world.constructions_tiles.tiles
            );
        } else {
            let success = render_tile_map(
                &mut d, 
                &camera_viewport, 
                &camera_viewport_offset
            );
            if !success {
                render_tiles(
                    &mut d, 
                    &camera_viewport, 
                    &camera_viewport_offset,
                    &world.biome_tiles.tiles,
                    &world.constructions_tiles.tiles
                );
            }
        }
        render_night(&mut d, screen_width, screen_height);
        render_entities(&mut d, &camera_viewport, &camera_viewport_offset);
        render_limited_visibility(&mut d, screen_width, screen_height);
    }

    let legacy_hud = engine.hud_ui(
        config.canvas_size.x as i32, 
        config.canvas_size.y as i32
    );
    render_layout(&legacy_hud, &mut d);

    render_layout(&hud, &mut d);
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
