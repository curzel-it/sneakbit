use serde::{ser::SerializeStruct, Deserialize, Serialize, Serializer, de::Deserializer};
use crate::{features::hitmaps::Hittable, utils::rect::FRect};
use super::{constructions::Construction, tiles::{SpriteTile, TileSet}};

#[derive(Debug, Default, Clone, Copy)]
#[repr(C)]
pub struct ConstructionTile {
    pub tile_type: Construction,
    pub tile_up_type: Construction,
    pub tile_right_type: Construction,
    pub tile_down_type: Construction,
    pub tile_left_type: Construction,
    pub texture_source_rect: FRect,
    pub hittable: Hittable
}

impl SpriteTile for ConstructionTile {
    fn texture_source_rect(&self, _: i32) -> FRect {
        self.texture_source_rect
    }
}

impl ConstructionTile {
    #[allow(clippy::match_like_matches_macro)]
    pub fn is_obstacle(&self) -> bool {
        match self.tile_type {
            Construction::Nothing => false,
            Construction::TallGrass => false,
            Construction::Box => false,
            Construction::Rail => false,
            Construction::Bridge => false,
            Construction::Darkness15 => false,
            Construction::Darkness30 => false,
            Construction::Darkness45 => false,
            _ => true
        }
    }

    pub fn is_bridge(&self) -> bool {
        matches!(self.tile_type, Construction::Bridge)
    }

    pub fn setup(
        &mut self, 
        x: usize, y: usize,
        up: Construction, right: Construction, bottom: Construction, left: Construction
    ) {
        self.tile_up_type = up;
        self.tile_right_type = right;
        self.tile_down_type = bottom;
        self.tile_left_type = left;        
        self.setup_textures();    
        self.setup_hittable(x, y);
    }

    fn setup_hittable(&mut self, x: usize, y: usize) {
        self.hittable = Hittable {
            frame: self.hittable_frame(x, y),
            has_weight: false,
            entity_id: 0, 
            species_id: 0,
            is_rigid: self.is_obstacle(),
        }
    }

    fn setup_textures(&mut self) {
        let same_up = self.tile_up_type == self.tile_type;
        let same_right = self.tile_right_type == self.tile_type;
        let same_down = self.tile_down_type == self.tile_type;
        let same_left = self.tile_left_type == self.tile_type;

        let x = self.tile_type.texture_offset_x();
        let y = match (same_up, same_right, same_down, same_left) {
            (false, true, false, true) => 0,
            (false, false, false, false) => 1,
            (false, false, false, true) => 2,
            (false, true, false, false) => 3,
            (true, false, true, false) => 4,
            (true, false, false, false) => 5,
            (false, false, true, false) => 6,
            (true, true, false, false) => 7,
            (true, false, false, true) => 8,
            (false, true, true, false) => 9,
            (false, false, true, true) => 10,
            (true, true, true, false) => 11,
            (true, false, true, true) => 12,
            (true, true, false, true) => 13,
            (false, true, true, true) => 14,
            (true, true, true, true) => 15,
        };
        self.texture_source_rect.x = x as f32;
        self.texture_source_rect.y = y as f32;
    }

    pub fn hittable_frame(&self, x: usize, y: usize) -> FRect {
        let geometry_texture_index = self.texture_source_rect.y.floor() as i32;

        let padding = if self.tile_type.is_slope() {
            self.slope_hittable_frame_padding()
        } else {
            self.hittable_frame_padding_for_texture(geometry_texture_index)
        };

        FRect::new(x as f32, y as f32, 1.0, 1.0).padded(padding)
    }

    fn slope_hittable_frame_padding(&self) -> (f32, f32, f32, f32) {
        let ptx = if !self.tile_up_type.is_slope() { 0.3 } else { 0.0 };
        let prx = if !self.tile_right_type.is_slope() { 0.3 } else { 0.0 };
        let pbx = if !self.tile_down_type.is_slope() { 0.3 } else { 0.0 };
        let plx = if !self.tile_left_type.is_slope() { 0.3 } else { 0.0 };

        match self.tile_type {
            Construction::SlopeGreenTopLeft | Construction::SlopeRockTopLeft | Construction::SlopeSandTopLeft | Construction::SlopeDarkRockTopLeft => {
                (0.4, 0.0, 0.0, 0.4)
            },
            Construction::SlopeGreenTopRight | Construction::SlopeRockTopRight | Construction::SlopeSandTopRight | Construction::SlopeDarkRockTopRight => {
                (0.4, 0.4, 0.0, 0.0)
            },
            Construction::SlopeGreenBottomRight | Construction::SlopeRockBottomRight | Construction::SlopeSandBottomRight | Construction::SlopeDarkRockBottomRight => {
                (0.0, 0.4, 0.4, 0.0)
            },
            Construction::SlopeGreenBottomLeft | Construction::SlopeRockBottomLeft | Construction::SlopeSandBottomLeft | Construction::SlopeDarkRockBottomLeft => {
                (0.0, 0.0, 0.4, 0.4)
            },
            Construction::SlopeGreenBottom | Construction::SlopeRockBottom | Construction::SlopeSandBottom | Construction::SlopeDarkRockBottom => {
                (0.4, prx, 0.25, plx)
            },
            Construction::SlopeGreenTop | Construction::SlopeRockTop | Construction::SlopeSandTop | Construction::SlopeDarkRockTop => {
                (0.25, prx, 0.4, plx)
            },
            Construction::SlopeGreenLeft | Construction::SlopeRockLeft | Construction::SlopeSandLeft | Construction::SlopeDarkRockLeft => {
                (ptx, 0.4, pbx, 0.25)
            },
            Construction::SlopeGreenRight | Construction::SlopeRockRight | Construction::SlopeSandRight | Construction::SlopeDarkRockRight => {
                (ptx, 0.25, pbx, 0.4)
            },
            _ => self.hittable_frame_padding_for_texture(1)
        }
    }

    fn hittable_frame_padding_for_texture(&self, geometry_texture_index: i32) -> (f32, f32, f32, f32) {
        match geometry_texture_index {
            0 => (0.2, 0.0, 0.0, 0.0), // top side
            1 => (0.15, 0.15, 0.15, 0.15), // single
            2 => (0.2, 0.2, 0.0, 0.0), // top right corner
            3 => (0.2, 0.0, 0.0, 0.2), // top left corner
            4 => (0.0, 0.2, 0.0, 0.2), // middle pillar, no sides
            5 => (0.0, 0.2, 0.2, 0.2), // bottom pillar
            6 => (0.2, 0.2, 0.0, 0.2), // top pillar
            7 => (0.0, 0.0, 0.2, 0.2), // bottom left corner
            8 => (0.0, 0.2, 0.2, 0.0), // bottom right corner
            9 => (0.2, 0.0, 0.0, 0.2), // top left corner
            10 => (0.2, 0.2, 0.0, 0.0), // top right corner
            11 => (0.0, 0.0, 0.0, 0.2), // left side
            12 => (0.0, 0.2, 0.0, 0.0), // right side
            13 => (0.0, 0.0, 0.2, 0.0), // bottom side
            14 => (0.2, 0.0, 0.0, 0.0), // top side
            15 => (0.0, 0.0, 0.0, 0.0), // center cross
            _ => (0.15, 0.15, 0.15, 0.15)
        }
    }
}

impl Construction {
    fn texture_offset_x(&self) -> i32 {
        *self as i32
    }
}

impl TileSet<ConstructionTile> {
    pub fn update_tile(&mut self, row: usize, col: usize, new_biome: Construction) {
        if row >= self.tiles.len() || col >= self.tiles[row].len() { return }

        self.tiles[row][col].tile_type = new_biome;
        self.tiles[row][col].setup_textures();

        if row > 0 {
            self.tiles[row-1][col].tile_down_type = new_biome;
            self.tiles[row-1][col].setup_textures();
        }
        if row < self.tiles.len() - 1 {
            self.tiles[row+1][col].tile_up_type = new_biome;
            self.tiles[row+1][col].setup_textures();
        }
        if col > 0 {
            self.tiles[row][col-1].tile_right_type = new_biome;
            self.tiles[row][col-1].setup_textures();
        }
        if col < self.tiles[0].len() - 1 {
            self.tiles[row][col+1].tile_left_type = new_biome;
            self.tiles[row][col+1].setup_textures();
        }
    }
}

impl ConstructionTile {
    pub fn from_data(data: char) -> Self {
        let mut tile = Self { 
            tile_type: Construction::from_char(data), 
            tile_up_type: Construction::Nothing,
            tile_right_type: Construction::Nothing, 
            tile_down_type: Construction::Nothing, 
            tile_left_type: Construction::Nothing, 
            texture_source_rect: FRect::square_from_origin(1.0),
            hittable: Hittable::default()
        };
        tile.setup_textures();
        tile
    }
}

impl Construction {
    fn is_slope(&self) -> bool {
        match self {
            Construction::SlopeGreenTopLeft => true,
            Construction::SlopeGreenTopRight => true,
            Construction::SlopeGreenBottomRight => true,
            Construction::SlopeGreenBottomLeft => true,
            Construction::SlopeGreenBottom => true,
            Construction::SlopeGreenTop => true,
            Construction::SlopeGreenLeft => true,
            Construction::SlopeGreenRight => true,
            Construction::SlopeRockTopLeft => true,
            Construction::SlopeRockTopRight => true,
            Construction::SlopeRockBottomRight => true,
            Construction::SlopeRockBottomLeft => true,
            Construction::SlopeRockBottom => true,
            Construction::SlopeRockTop => true,
            Construction::SlopeRockLeft => true,
            Construction::SlopeRockRight => true,
            Construction::SlopeSandTopLeft => true,
            Construction::SlopeSandTopRight => true,
            Construction::SlopeSandBottomRight => true,
            Construction::SlopeSandBottomLeft => true,
            Construction::SlopeSandBottom => true,
            Construction::SlopeSandTop => true,
            Construction::SlopeSandLeft => true,
            Construction::SlopeSandRight => true,
            Construction::SlopeDarkRockTopLeft => true,
            Construction::SlopeDarkRockTopRight => true,
            Construction::SlopeDarkRockBottomRight => true,
            Construction::SlopeDarkRockBottomLeft => true,
            Construction::SlopeDarkRockBottom => true,
            Construction::SlopeDarkRockTop => true,
            Construction::SlopeDarkRockLeft => true,
            Construction::SlopeDarkRockRight => true,
            _ => false
        }
    }
}

impl Serialize for TileSet<ConstructionTile> {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error> where S: Serializer {
        let mut state = serializer.serialize_struct("TileSet", 2)?;
        let serialized_tiles: Vec<String> = self.tiles.iter().map(|row| {
            row.iter().map(|tile| {
                tile.tile_type.to_char()
            }).collect()
        }).collect();

        state.serialize_field("tiles", &serialized_tiles)?;
        state.serialize_field("sheet_id", &self.sheet_id)?;
        state.end()
    }
}

impl<'de> Deserialize<'de> for TileSet<ConstructionTile> {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error> where D: Deserializer<'de> {
        #[derive(Deserialize)]
        struct TileSetData {
            tiles: Vec<String>,
            sheet_id: u32,
        }

        let data = TileSetData::deserialize(deserializer)?;

        let mut tiles: Vec<Vec<ConstructionTile>> = data.tiles.into_iter().map(|tile_row| {
            tile_row.chars().map(|tile_char| {
                ConstructionTile::from_data(tile_char)
            }).collect()
        }).collect();

        let rows = tiles.len();
        let columns = if rows > 0 { tiles[0].len() } else { 0 };

        for row in 0..rows {
            for col in 0..columns {
                let up = if row > 0 { tiles[row-1][col].tile_type } else { Construction::Nothing };
                let right = if col < columns - 1 { tiles[row][col+1].tile_type } else { Construction::Nothing };
                let down = if row < rows - 1 { tiles[row+1][col].tile_type } else { Construction::Nothing };
                let left = if col > 0 { tiles[row][col-1].tile_type } else { Construction::Nothing };

                tiles[row][col].setup(col, row, up, right, down, left)
            }
        }

        Ok(TileSet::with_tiles(data.sheet_id, tiles))
    }
}

impl Construction {
    pub fn stops_bullets(&self) -> bool {
        match self {
            Construction::Nothing => false,
            Construction::WoodenFence => false,
            Construction::MetalFence => true,
            Construction::DarkRock => true,
            Construction::LightWall => true,
            Construction::Counter => false,
            Construction::Library => true,
            Construction::TallGrass => false,
            Construction::Forest => true,
            Construction::Bamboo => false,
            Construction::Box => true,
            Construction::Rail => false,
            Construction::StoneWall => true,
            Construction::IndicatorArrow => false,
            Construction::Bridge => false,
            Construction::Broadleaf => true,
            Construction::StoneBox => true,
            Construction::SpoiledTree => false,
            Construction::WineTree => false,
            Construction::SolarPanel => false,
            Construction::Pipe => false,
            Construction::BroadleafPurple => true,
            Construction::WoodenWall => true,
            Construction::SnowPile => false,
            Construction::SnowyForest => true,
            Construction::Darkness15 => false,
            Construction::Darkness30 => false,
            Construction::Darkness45 => false,
            Construction::SlopeGreenTopLeft => true,
            Construction::SlopeGreenTopRight => true,
            Construction::SlopeGreenBottomRight => true,
            Construction::SlopeGreenBottomLeft => true,
            Construction::SlopeGreenBottom => true,
            Construction::SlopeGreenTop => true,
            Construction::SlopeGreenLeft => true,
            Construction::SlopeGreenRight => true,
            Construction::SlopeRockTopLeft => true,
            Construction::SlopeRockTopRight => true,
            Construction::SlopeRockBottomRight => true,
            Construction::SlopeRockBottomLeft => true,
            Construction::SlopeRockBottom => true,
            Construction::SlopeRockTop => true,
            Construction::SlopeRockLeft => true,
            Construction::SlopeRockRight => true,
            Construction::SlopeSandTopLeft => true,
            Construction::SlopeSandTopRight => true,
            Construction::SlopeSandBottomRight => true,
            Construction::SlopeSandBottomLeft => true,
            Construction::SlopeSandBottom => true,
            Construction::SlopeSandTop => true,
            Construction::SlopeSandLeft => true,
            Construction::SlopeSandRight => true,
            Construction::SlopeDarkRockTopLeft => true,
            Construction::SlopeDarkRockTopRight => true,
            Construction::SlopeDarkRockBottomRight => true,
            Construction::SlopeDarkRockBottomLeft => true,
            Construction::SlopeDarkRockBottom => true,
            Construction::SlopeDarkRockTop => true,
            Construction::SlopeDarkRockLeft => true,
            Construction::SlopeDarkRockRight => true,
        }
    }
}