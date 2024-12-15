use std::sync::Once;

use nohash_hasher::IntMap;
use game_core::{constants::TILE_SIZE, ui::{components::{BordersTextures, GridSpacing, NonColor, Spacing, Typography, View, COLOR_TEXT, COLOR_TEXT_HIGHLIGHTED, COLOR_TEXT_SHADOW, COLOR_TURN_COUNTDOWN}, layouts::{AnchorPoint, Layout}}, utils::{rect::IntRect, vector::Vector2d}};
use raylib::prelude::*;

pub struct RenderingConfig {
    pub font: Font,
    pub font_bold: Font,
    pub textures: IntMap<u32, Texture2D>,
    pub rendering_scale: f32,
    pub font_rendering_scale: f32,
    pub canvas_size: Vector2d,
    pub show_debug_info: bool,
    pub render_using_individual_tiles: bool
}

pub static INIT_RENDERING_CONFIG: Once = Once::new();
pub static mut RENDERING_CONFIG: *mut RenderingConfig = std::ptr::null_mut();

pub fn get_rendering_config() -> &'static RenderingConfig {
    unsafe {
        &*RENDERING_CONFIG
    }
}

pub fn get_rendering_config_mut() -> &'static mut RenderingConfig {
    unsafe {
        &mut *RENDERING_CONFIG
    }
}

pub fn init_rendering_config(config: RenderingConfig) {
    unsafe {
        INIT_RENDERING_CONFIG.call_once(|| {
            let boxed_config = Box::new(config);
            RENDERING_CONFIG = Box::into_raw(boxed_config);
        });
    }
}    

pub fn is_rendering_config_initialized() -> bool {
    unsafe {
        !RENDERING_CONFIG.is_null()
    }
}

impl RenderingConfig {
    fn text_color(&self, style: &Typography) -> Color {
        match style {
            Typography::Selected | Typography::PlayerHudHighlight => as_rcolor(&COLOR_TEXT_HIGHLIGHTED),
            Typography::Countdown => as_rcolor(&COLOR_TURN_COUNTDOWN),
            _ => as_rcolor(&COLOR_TEXT)
        }
    }

    fn text_shadow(&self, style: &Typography) -> Option<(f32, f32, Color)> {
        match style {
            Typography::Countdown => Some((2.0, 2.0, as_rcolor(&COLOR_TEXT_SHADOW))),
            Typography::PlayerHudText | Typography::PlayerHudSmallTitle | Typography::PlayerHudHighlight => {
                Some((1.0, 1.0, as_rcolor(&COLOR_TEXT_SHADOW)))
            },
            _ => None
        }
    }

    fn font(&self, style: &Typography) -> &Font {
        match style {
            Typography::Countdown => &self.font_bold,
            Typography::Title => &self.font_bold,
            Typography::PlayerHudSmallTitle => &self.font_bold,
            Typography::Selected | Typography::PlayerHudHighlight => &self.font_bold,
            Typography::Regular | Typography::PlayerHudText => &self.font,
            Typography::Caption => &self.font,
        }
    }

    pub fn get_texture(&self, key: u32) -> Option<&Texture2D> {
        self.textures.get(&key)
    }

    pub fn scaled_font_size(&self, style: &Typography) -> f32 {
        self.font_rendering_scale * match style {
            Typography::Countdown => 16.0,
            Typography::Title => 12.0,
            Typography::PlayerHudSmallTitle => 8.0,
            Typography::Selected | Typography::PlayerHudHighlight => 8.0,
            Typography::Regular | Typography::PlayerHudText => 8.0,
            Typography::Caption => 6.0,
        }
    }

    fn scaled_font_spacing(&self, _: &Typography) -> f32 {
        0.0 
    }

    pub fn font_lines_spacing(&self, style: &Typography) -> f32 {
        self.scaled_font_size(style) / 2.0
    }
}

pub fn render_layout(layout: &Layout, d: &mut RaylibDrawHandle) {
    let config = get_rendering_config();

    if layout.background_color.3 > 0 {
        d.draw_rectangle(
            -100, 
            -100, 
            config.canvas_size.x as i32 + 200, 
            config.canvas_size.y as i32 + 200,
            as_rcolor(&layout.background_color)
        );
    }

    for (anchor, view) in &layout.children {
        let position = calculate_position(layout, anchor, view, config);
        render_view(view, d, config, &position); 
    }
}

fn calculate_position(layout: &Layout, anchor: &AnchorPoint, view: &View, config: &RenderingConfig) -> Vector2d {
    let size = calculate_size(view, config);

    let (x, y) = match anchor {
        AnchorPoint::Center => (
            (layout.frame.x as f32 + layout.frame.w as f32 - size.x) / 2.0, 
            (layout.frame.y as f32 + layout.frame.h as f32 - size.y) / 2.0
        ), 
        AnchorPoint::TopLeft => (0.0, 0.0), 
        AnchorPoint::TopRight => (
            layout.frame.x as f32 + layout.frame.w as f32 - size.x, 
            0.0
        ),
        AnchorPoint::BottomCenter => (
            layout.frame.x as f32 + layout.frame.w as f32 / 2.0 - size.x / 2.0, 
            layout.frame.y as f32 + layout.frame.h as f32 - size.y
        ),
        AnchorPoint::BottomLeft => (
            0.0, 
            layout.frame.y as f32 + layout.frame.h as f32 - size.y
        ),
        AnchorPoint::BottomRight => (
            layout.frame.x as f32 + layout.frame.w as f32 - size.x, 
            layout.frame.y as f32 + layout.frame.h as f32 - size.y
        ),
    };
    Vector2d::new(x, y)
}

fn spacing_value(spacing: &Spacing, config: &RenderingConfig) -> f32 {
    match spacing {
        Spacing::TextLine(style) => {
            config.rendering_scale * config.font_lines_spacing(style)
        },
        _ => config.rendering_scale * spacing.unscaled_value()
    }        
}

fn vector_as_rv(vector: &Vector2d) -> raylib::math::Vector2 {
    raylib::math::Vector2::new(vector.x, vector.y)
} 

fn vector_as_rv_offset(vector: &Vector2d, dx: f32, dy: f32) -> raylib::math::Vector2 {
    raylib::math::Vector2::new(vector.x + dx, vector.y + dy)
} 

fn accounts_for_stack_size(view: &View) -> bool {
    !matches!(view, View::FixedPosition { position: _, children: _})
}

fn as_rcolor(color: &NonColor) -> Color {
    Color::new(color.0, color.1, color.2, color.3)
}

fn render_view(
    view: &View, 
    d: &mut RaylibDrawHandle, 
    config: &RenderingConfig, 
    position:  &Vector2d
) {
    match view {
        View::ZStack { spacing, background_color, children } => {
            let color = as_rcolor(background_color);
            render_zstack(view, d, config, position, children, spacing, color);
        }
        View::VStack { spacing, children } => {
            render_vstack(d, config, position, children, spacing);
        }
        View::HStack { spacing, children } => {
            render_hstack(d, config, position, children, spacing);
        }
        View::Text { style, text } => {
            render_text(d, config, position, style, text);
        }
        View::Texture { key, source_rect, size } => {
            render_texture(d, config, key, source_rect, position, size);
        }
        View::Spacing { size: _ } => {
            // Not visible
        }
        View::VGrid { columns, spacing, children } => {
            render_vgrid(d, config, position, columns, spacing, children);
        }
        View::FullScreenBackdrop { children } => {
            render_fullscreen_backdrop(view, d, config, position, children)
        }
        View::FixedPosition { position, children } => {
            render_fixed_position(view, d, config, position, children)
        }
        View::TexturedBorder { borders, children } => {
            render_textured_borders(view, d, config, borders, position, children)
        }
    }
}

fn render_textured_borders(
    view: &View,
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    borders: &BordersTextures,
    position: &Vector2d,
    children: &[View]
) {
    let content_size = calculate_zstack_size(config, children, &Spacing::Zero);
    let base_texture_size = calculate_texture_size(config, &Vector2d::new(1.0, 1.0)).x;
    let size_one = Vector2d::new(1.0, 1.0);

    let top_left = Vector2d { 
        x: position.x - base_texture_size / 2.0, 
        y: position.y - base_texture_size / 2.0, 
    };
    let top_right = Vector2d { 
        x: position.x + content_size.x - base_texture_size / 2.0, 
        y: position.y - base_texture_size / 2.0, 
    };
    let bottom_right = Vector2d { 
        x: position.x + content_size.x - base_texture_size / 2.0,
        y: position.y + content_size.y - base_texture_size / 2.0,
    };
    let bottom_left = Vector2d { 
        x: position.x - base_texture_size / 2.0, 
        y: position.y + content_size.y - base_texture_size / 2.0,
    };
    let side_top = Vector2d { 
        x: position.x + base_texture_size / 2.0, 
        y: position.y - base_texture_size / 2.0, 
    };
    let side_right = Vector2d { 
        x: position.x + content_size.x - base_texture_size / 2.0, 
        y: position.y + base_texture_size / 2.0, 
    };
    let side_bottom = Vector2d { 
        x: position.x + base_texture_size / 2.0, 
        y: position.y + content_size.y - base_texture_size / 2.0, 
    };
    let side_left = Vector2d { 
        x: position.x - base_texture_size / 2.0, 
        y: position.y + base_texture_size / 2.0, 
    };
    let side_horizontal_size = Vector2d { 
        x: (content_size.x / config.rendering_scale) / TILE_SIZE - 1.0, 
        y: 1.0
    };
    let side_vertical_size = Vector2d { 
        x: 1.0, 
        y: (content_size.y / config.rendering_scale) / TILE_SIZE - 1.0, 
    };

    render_zstack(view, d, config, position, children, &Spacing::Zero, Color::RED.alpha(0.0));        
    render_texture(d, config, &borders.corner_top_left.key, &borders.corner_top_left.source_rect, &top_left, &size_one);
    render_texture(d, config, &borders.corner_top_right.key, &borders.corner_top_right.source_rect, &top_right, &size_one);
    render_texture(d, config, &borders.corner_bottom_right.key, &borders.corner_bottom_right.source_rect, &bottom_right, &size_one);
    render_texture(d, config, &borders.corner_bottom_left.key, &borders.corner_bottom_left.source_rect, &bottom_left, &size_one);        
    render_texture(d, config, &borders.side_top.key, &borders.side_top.source_rect, &side_top, &side_horizontal_size);
    render_texture(d, config, &borders.side_right.key, &borders.side_right.source_rect, &side_right, &side_vertical_size);
    render_texture(d, config, &borders.side_bottom.key, &borders.side_bottom.source_rect, &side_bottom, &side_horizontal_size);
    render_texture(d, config, &borders.side_left.key, &borders.side_left.source_rect, &side_left, &side_vertical_size);
}

fn render_zstack(
    view: &View,
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    position: &Vector2d,
    children: &[View],
    spacing: &Spacing,
    background_color: Color,
) {
    let space = spacing_value(spacing, config);
    let size = calculate_size(view, config);
    let child_position = Vector2d::new(position.x + space, position.y + space);

    d.draw_rectangle_v(
        vector_as_rv(position), 
        vector_as_rv(&size), 
        background_color
    );

    for child in children {
        render_view(child, d, config, &child_position);
    }
}

fn render_vstack(
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    position: &Vector2d,
    children: &[View],
    spacing: &Spacing,
) {
    let space = spacing_value(spacing, config);
    let mut child_position = *position;

    for child in children {
        render_view(child, d, config, &child_position);
        if accounts_for_stack_size(child) { 
            child_position.y += calculate_size(child, config).y + space;
        }
    }
}

fn render_hstack(
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    position: &Vector2d,
    children: &[View],
    spacing: &Spacing,
) {
    let space = spacing_value(spacing, config);
    let mut child_position = *position;

    for child in children {
        render_view(child, d, config, &child_position);
        if accounts_for_stack_size(child) { 
            child_position.x += calculate_size(child, config).x + space;
        }
    }
}

fn render_text(
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    position: &Vector2d,
    style: &Typography,
    text: &str,
) { 
    if !text.contains("\n") {
        let font = config.font(style);
        let font_size = config.scaled_font_size(style);
        let font_spacing = config.scaled_font_spacing(style);
        let color = config.text_color(style);

        if let Some((dx, dy, shadow_color)) = config.text_shadow(style) {
            d.draw_text_ex(font, text, vector_as_rv_offset(position, dx, dy), font_size, font_spacing, shadow_color);
        }        
        d.draw_text_ex(font, text, vector_as_rv(position), font_size, font_spacing, color);
    } else {
        let stack = multiline_text_to_vstack(style, text);
        render_view(&stack, d, config, position);
    }
}

fn multiline_text_to_vstack(style: &Typography, text: &str) -> View {
    let texts: Vec<View> = text
        .lines()
        .map(|line| line.trim())
        .filter(|line| !line.is_empty())
        .map(|line_text| 
            View::Text { 
                style: *style, 
                text: line_text.to_string() 
            }
        )
        .collect();

    View::VStack { 
        spacing: Spacing::TextLine(*style), 
        children: texts 
    }
}

fn render_texture(
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    key: &u32,
    source: &IntRect,
    position: &Vector2d,
    size:  &Vector2d
) {
    if let Some(texture) = config.get_texture(*key) {           
        let source_rect = Rectangle::new(
            TILE_SIZE * source.x as f32, 
            TILE_SIZE * source.y as f32, 
            TILE_SIZE * source.w as f32,
            TILE_SIZE * source.h as f32
        );
        let dest_rect = Rectangle::new(
            position.x, 
            position.y, 
            config.rendering_scale * TILE_SIZE * size.x, 
            config.rendering_scale * TILE_SIZE * size.y
        );
        d.draw_texture_pro(
            texture,
            source_rect, 
            dest_rect,
            Vector2::zero(), 
            0.0,
            Color::WHITE,
        ); 
    }
}

fn render_vgrid(
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    position: &Vector2d,
    columns: &usize,
    spacing: &GridSpacing,
    children: &[View],
) {
    let row_space: f32 = spacing_value(&spacing.between_rows, config);
    let mut row_position: Vector2d = *position;        
    let rows = children.chunks(*columns);

    for row in rows {
        render_hstack(d, config, &row_position, row, &spacing.between_columns);
        let row_size = calculate_hstack_size(config, row, &spacing.between_columns);
        row_position.y += row_size.y + row_space;
    }
}

fn render_fullscreen_backdrop(
    view: &View,
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    position: &Vector2d,
    children: &[View],
) {
    d.draw_rectangle_v(
        Vector2::zero(), 
        vector_as_rv(&config.canvas_size), 
        Color::BLACK.alpha(0.4)
    );
    render_zstack(
        view, 
        d,
        config,
        position,
        children,
        &Spacing::Zero,
        Color::BLACK.alpha(0.0)
    );
}

fn render_fixed_position(
    view: &View,
    d: &mut RaylibDrawHandle,
    config: &RenderingConfig,
    position: &Vector2d,
    children: &[View],
) {
    render_zstack(
        view, 
        d, 
        config, 
        &position.scaled(config.rendering_scale), 
        children, 
        &Spacing::Zero, 
        Color::BLACK.alpha(0.0)
    );
}

fn calculate_size(view: &View, config: &RenderingConfig) -> Vector2d {
    match view {
        View::ZStack { spacing, background_color: _, children } => {
            calculate_zstack_size(config, children, spacing)
        }
        View::VStack { spacing, children } => {
            calculate_vstack_size(config, children, spacing)
        }
        View::HStack { spacing, children } => {
            calculate_hstack_size(config, children, spacing)
        }
        View::Text { style, text } => {
            calculate_text_size(config, style, text)
        }
        View::Texture { key: _, source_rect: _, size } => {
            calculate_texture_size(config, size)
        }
        View::Spacing { size } => {
            calculate_spacing_size(view, config, size)
        }
        View::VGrid { columns, spacing, children } => {
            calculate_vgrid_size(config, columns, spacing, children)
        }
        View::FullScreenBackdrop { children } => {
            calculate_fullscreen_backdrop_size(config, children)                
        }
        View::FixedPosition { position: _, children } => {
            calculate_fixed_position_size(config, children)                
        }
        View::TexturedBorder { borders: _, children } => {
            calculate_textured_border_size(config, children)                
        }
    }
}

fn calculate_textured_border_size(config: &RenderingConfig, children: &[View]) -> Vector2d {
    calculate_zstack_size(config, children, &Spacing::Zero)
}

fn calculate_texture_size(config: &RenderingConfig, size: &Vector2d) -> Vector2d {
    Vector2d::new(
        size.x * TILE_SIZE * config.rendering_scale, 
        size.y * TILE_SIZE * config.rendering_scale
    )
}

fn calculate_spacing_size(_: &View, config: &RenderingConfig, size: &Spacing) -> Vector2d {
    let value = spacing_value(size, config);
    Vector2d::new(value, value)
}

fn calculate_zstack_size(
    config: &RenderingConfig,
    children: &[View],
    spacing: &Spacing,
) -> Vector2d {
    let mut max_width: f32 = 0.0;
    let mut max_height: f32 = 0.0;

    for child in children {
        let size = calculate_size(child, config);
        max_width = max_width.max(size.x);
        max_height = max_height.max(size.y);
    }
    Vector2d::new(
        max_width + spacing_value(spacing, config) * 2.0, 
        max_height + spacing_value(spacing, config) * 2.0
    )
}

fn calculate_vstack_size(
    config: &RenderingConfig,
    children: &[View],
    spacing: &Spacing,
) -> Vector2d {
    let space = spacing_value(spacing, config);
    let mut total_height: f32 = 0.0;
    let mut max_width: f32 = 0.0;

    for child in children {
        let size = calculate_size(child, config);
        if accounts_for_stack_size(child) { 
            total_height += size.y + space;
            max_width = max_width.max(size.x);
        }
    }
    if !children.is_empty() {
        total_height -= space;
    }
    Vector2d::new(max_width, total_height)
}

fn calculate_hstack_size(
    config: &RenderingConfig,
    children: &[View],
    spacing: &Spacing,
) -> Vector2d {
    let space = spacing_value(spacing, config);
    let mut total_width: f32 = 0.0;
    let mut max_height: f32 = 0.0;

    for child in children {
        let size = calculate_size(child, config);
        if accounts_for_stack_size(child) { 
            total_width += size.x + space;
            max_height = max_height.max(size.y);
        }
    }
    if !children.is_empty() {
        total_width -= space;
    }
    Vector2d::new(total_width, max_height)
}

fn calculate_text_size(
    config: &RenderingConfig,
    style: &Typography,
    text: &str,
) -> Vector2d {
    if !text.contains("\n") {
        let font = config.font(style);
        let font_size = config.scaled_font_size(style);
        let font_spacing = config.scaled_font_spacing(style);
        let size = font.measure_text(text, font_size, font_spacing);
        Vector2d::new(size.x, size.y)
    } else {
        let stack = multiline_text_to_vstack(style, text);
        calculate_size(&stack, config)
    }
}

fn calculate_vgrid_size(
    config: &RenderingConfig,
    columns: &usize,
    spacing: &GridSpacing,
    children: &[View],
) -> Vector2d {
    let mut width: f32 = 0.0;
    let mut height: f32 = 0.0;

    let rows = children.chunks(*columns);
    let rows_count = rows.len();

    for row in rows {
        let row_size = calculate_hstack_size( 
            config,
            row, 
            &spacing.between_columns
        );
        width = width.max(row_size.x);
        height += row_size.y;
    }

    height += (rows_count.max(1) - 1) as f32 * spacing_value(&spacing.between_rows, config);
    Vector2d::new(width, height)
}

fn calculate_fullscreen_backdrop_size(config: &RenderingConfig, children: &[View]) -> Vector2d {
    calculate_zstack_size(config, children, &Spacing::Zero)
}

fn calculate_fixed_position_size(config: &RenderingConfig, children: &[View]) -> Vector2d {
    calculate_zstack_size(config, children, &Spacing::Zero)
}