use crate::utils::{rect::IntRect, vector::Vector2d};

pub type NonColor = (u8, u8, u8, u8);

pub const COLOR_TRANSPARENT: NonColor = (0, 0, 0, 0);
pub const COLOR_BLACK: NonColor = (0, 0, 0, 255);
pub const COLOR_BLACK_50: NonColor = (0, 0, 0, 128);
pub const COLOR_BLACK_70: NonColor = (0, 0, 0, 178);
pub const COLOR_YELLOW: NonColor = (255, 255, 0, 255);
pub const COLOR_RED_60: NonColor = (255, 0, 0, 153);

#[derive(Copy, Clone, Debug)]
pub enum Typography {
    Title,
    Regular,
    Selected,
    Caption,
}

pub enum Spacing {
    Zero,
    XS, 
    SM, 
    MD,
    LG,
    XL,
    Custom(f32),
    TextLine(Typography),
}

pub struct GridSpacing {
    pub between_columns: Spacing,
    pub between_rows: Spacing,
}

pub enum View {
    ZStack { spacing: Spacing, background_color: NonColor, children: Vec<View> },
    VStack { spacing: Spacing, children: Vec<View> },
    HStack { spacing: Spacing, children: Vec<View> },
    Text { style: Typography, text: String },
    Texture { key: u32, source_rect: IntRect, size: Vector2d },
    Spacing { size: Spacing },
    VGrid { columns: usize, spacing: GridSpacing, children: Vec<View> },
    FullScreenBackdrop { children: Vec<View> },
    FixedPosition { position: Vector2d, children: Vec<View> },
    TexturedBorder { borders: BordersTextures, children: Vec<View> },
}

pub struct TextureInfo {
    pub key: u32,
    pub source_rect: IntRect
}

pub struct BordersTextures {
    pub corner_top_left: TextureInfo,
    pub corner_top_right: TextureInfo,
    pub corner_bottom_right: TextureInfo,
    pub corner_bottom_left: TextureInfo,
    pub side_top: TextureInfo,
    pub side_right: TextureInfo,
    pub side_bottom: TextureInfo,
    pub side_left: TextureInfo,
}

#[macro_export]
macro_rules! zstack {
    ($spacing:expr, $background_color:expr, $( $child:expr ),*) => {
        $crate::ui::components::View::ZStack {
            spacing: $spacing,
            background_color: $background_color,
            children: vec![$($child),*],
        }
    };
}

#[macro_export]
macro_rules! vstack {
    ($spacing:expr, $( $child:expr ),*) => {
        $crate::ui::components::View::VStack {
            spacing: $spacing,
            children: vec![$($child),*],
        }
    };
}

#[macro_export]
macro_rules! hstack {
    ($spacing:expr, $( $child:expr ),*) => {
        $crate::ui::components::View::HStack {
            spacing: $spacing,
            children: vec![$($child),*],
        }
    };
}

#[macro_export]
macro_rules! text {
    ($style:expr, $text:expr) => {
        $crate::ui::components::View::Text {
            style: $style,
            text: $text,
        }
    };
}

#[macro_export]
macro_rules! texture {
    ($key:expr, $source_rect:expr, $size:expr) => {
        $crate::ui::components::View::Texture {
            key: $key,
            source_rect: $source_rect,
            size: $size,
        }
    };
}

#[macro_export]
macro_rules! spacing {
    ($size:expr) => {
        $crate::ui::components::View::Spacing {
            size: $size,
        }
    };
}

#[macro_export]
macro_rules! vgrid {
    ($columns:expr, $spacing:expr, $( $child:expr ),*) => {
        $crate::ui::components::View::VGrid {
            columns: $columns,
            spacing: $spacing,
            children: vec![$($child),*],
        }
    };
}

pub fn padding(padding: Spacing, content: View) -> View {
    zstack!(padding, COLOR_TRANSPARENT, content)
}

pub fn with_backdrop(content: View) -> View {
    View::FullScreenBackdrop { children: vec![content] }
}

pub fn with_fixed_position(position: Vector2d, content: View) -> View {
    View::FixedPosition { position, children: vec![content] }
}

pub fn with_textured_border(borders: BordersTextures, content: View) -> View {
    View::TexturedBorder { borders, children: vec![content] }
}

pub fn empty_view() -> View {
    with_fixed_position(Vector2d::zero(), spacing!(Spacing::Zero))
}

impl GridSpacing {
    pub fn new(between_rows: Spacing, between_columns: Spacing) -> Self {
        Self {
            between_rows,
            between_columns, 
        }
    }

    pub fn sm() -> Self {
        Self::new(Spacing::SM, Spacing::SM)
    }
}

impl Spacing {
    pub fn unscaled_value(&self) -> f32 {
        match self {
            Spacing::Zero => 0.0,
            Spacing::XS => 2.0,
            Spacing::SM => 4.0,
            Spacing::MD => 8.0,
            Spacing::LG => 12.0,
            Spacing::XL => 20.0,
            Spacing::Custom(value) => *value,
            Spacing::TextLine(_) => 4.0,
        }
    }
}

#[repr(C)]
pub struct NonColorC {
    pub red: u8,
    pub green: u8,
    pub blue: u8,
    pub alpha: u8,
}

impl NonColorC {
    pub fn new(values: &NonColor) -> Self {
        Self {
            red: values.0,
            green: values.1,
            blue: values.2,
            alpha: values.3,
        }
    }
}