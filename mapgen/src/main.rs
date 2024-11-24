use image::{GenericImageView, ImageBuffer, RgbaImage};
use image::imageops::overlay;
use std::path::Path;
use std::fs;
use regex::Regex;
use std::error::Error;

use game_core::game_engine::world::World;
use game_core::maps::tiles::{TileSet, SpriteTile};
use game_core::maps::biome_tiles::{Biome, BiomeTile};
use game_core::maps::constructions_tiles::{Construction, ConstructionTile};
use game_core::constants::TILE_SIZE;

pub fn generate_tile_map_image_from_json(
    world_id: u32,
    variant: i32,
    sprite_sheet_biome_tiles_path: &str,
    sprite_sheet_construction_tiles_path: &str,
    output_image_path: &str,
) -> Result<(), Box<dyn Error>> {
    let world = World::load(world_id).unwrap();

    generate_tile_map_image(
        &world.biome_tiles,
        &world.constructions_tiles,
        variant,
        sprite_sheet_biome_tiles_path,
        sprite_sheet_construction_tiles_path,
        output_image_path,
    )
}

pub fn generate_tile_map_image(
    biome_tiles: &TileSet<BiomeTile>,
    construction_tiles: &TileSet<ConstructionTile>,
    variant: i32,
    sprite_sheet_biome_tiles_path: &str,
    sprite_sheet_construction_tiles_path: &str,
    output_image_path: &str,
) -> Result<(), Box<dyn Error>> {
    let tile_size = TILE_SIZE;

    let sprite_sheet_biome = image::open(sprite_sheet_biome_tiles_path)?.to_rgba8();
    let sprite_sheet_construction = image::open(sprite_sheet_construction_tiles_path)?.to_rgba8();

    let world_height = biome_tiles.tiles.len();
    let world_width = if world_height > 0 { biome_tiles.tiles[0].len() } else { 0 };

    let map_width = ((world_width as f32) * tile_size) as u32;
    let map_height = ((world_height as f32) * tile_size) as u32;
    let mut composed_image: RgbaImage = ImageBuffer::new(map_width, map_height);

    let mut biome_tiles_copy = biome_tiles.tiles.clone(); 
    for row in 0..world_height {
        for col in 0..world_width {
            let up = if row > 0 { biome_tiles_copy[row - 1][col].tile_type } else { Biome::Nothing };
            let right = if col < world_width - 1 { biome_tiles_copy[row][col + 1].tile_type } else { Biome::Nothing };
            let down = if row < world_height - 1 { biome_tiles_copy[row + 1][col].tile_type } else { Biome::Nothing };
            let left = if col > 0 { biome_tiles_copy[row][col -1].tile_type } else { Biome::Nothing };
            let tile = &mut biome_tiles_copy[row][col];
            tile.setup_neighbors(up, right, down, left);
        }
    }

    let mut construction_tiles_copy = construction_tiles.tiles.clone(); 
    for row in 0..world_height {
        for col in 0..world_width {
            let up = if row > 0 { construction_tiles_copy[row - 1][col].tile_type } else { Construction::Nothing };
            let right = if col < world_width - 1 { construction_tiles_copy[row][col + 1].tile_type } else { Construction::Nothing };
            let down = if row < world_height - 1 { construction_tiles_copy[row + 1][col].tile_type } else { Construction::Nothing };
            let left = if col > 0 { construction_tiles_copy[row][col -1].tile_type } else { Construction::Nothing };
            let tile = &mut construction_tiles_copy[row][col];
            tile.setup_neighbors(up, right, down, left);
        }
    }

    for row in 0..world_height {
        for col in 0..world_width {
            let biome_tile = &biome_tiles_copy[row][col];
            if biome_tile.tile_type != Biome::Nothing {
                let source = biome_tile.texture_source_rect(variant).scaled(tile_size);
                let dest_x = (col as f32) * tile_size;
                let dest_y = (row as f32) * tile_size;
                let sub_image = sprite_sheet_biome.view(source.x as u32, source.y as u32, source.w as u32, source.h as u32).to_image();
                overlay(&mut composed_image, &sub_image, dest_x as i64, dest_y as i64);
            }
        }
    }

    for row in 0..world_height {
        for col in 0..world_width {
            let construction_tile = &construction_tiles_copy[row][col];
            if construction_tile.tile_type != Construction::Nothing {
                let source = construction_tile.texture_source_rect(0).scaled(tile_size);
                let dest_x = (col as f32) * tile_size;
                let dest_y = (row as f32) * tile_size;
                let sub_image = sprite_sheet_construction.view(source.x as u32, source.y as u32, source.w as u32, source.h as u32).to_image();
                overlay(&mut composed_image, &sub_image, dest_x as i64, dest_y as i64);
            }
        }
    }

    composed_image.save(output_image_path)?;
    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    let data_dir = Path::new("data");
    let assets_dir = Path::new("assets");
    let re = Regex::new(r"^\d+\.json$")?;

    for entry in fs::read_dir(data_dir)? {
        let entry = entry?;
        let path = entry.path();
        let filename = path.file_name().unwrap().to_str().unwrap();

        if !re.is_match(filename) {
            continue;
        }

        let world_id = filename.split('.').next().unwrap_or("unknown");
        let json_file_path = data_dir.join(filename);

        let json_metadata = fs::metadata(&json_file_path)?;
        let json_mtime = json_metadata.modified()?;

        for variant in 0..4 {
            let output_image_filename = format!("{}-{}.png", world_id, variant);
            let output_image_path = assets_dir.join(&output_image_filename);

            let regenerate = if output_image_path.exists() {
                let image_metadata = fs::metadata(&output_image_path)?;
                let image_mtime = image_metadata.modified()?;
                image_mtime < json_mtime
            } else {
                true
            };

            if !regenerate {
                println!("Skipping '{}'; it is already up-to-date.", output_image_filename);
                continue;
            }

            println!("Generating image for '{}', variant {}", world_id, variant);

            let sprite_sheet_biome_tiles_path = assets_dir.join("tiles_biome.png");
            let sprite_sheet_construction_tiles_path = assets_dir.join("tiles_constructions.png");

            if !sprite_sheet_biome_tiles_path.exists() || !sprite_sheet_construction_tiles_path.exists() {
                eprintln!("Sprite sheets not found in 'assets' directory.");
                continue;
            }

            if let Err(e) = generate_tile_map_image_from_json(
                world_id.parse::<u32>().unwrap(),
                variant,
                &sprite_sheet_biome_tiles_path.to_string_lossy(),
                &sprite_sheet_construction_tiles_path.to_string_lossy(),
                &output_image_path.to_string_lossy(),
            ) {
                eprintln!("Error generating image '{}': {}", output_image_filename, e);
            } else {
                println!("Tile map image saved to '{}'", output_image_filename);
            }
        }
    }
    Ok(())
}
