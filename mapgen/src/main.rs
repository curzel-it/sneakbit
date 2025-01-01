use image::{DynamicImage, GenericImageView, ImageBuffer, RgbImage, RgbaImage, imageops::overlay};
use std::{error::Error, fs::{self, File}, io::BufWriter, path::Path, sync::mpsc::{self, Receiver, Sender}, thread};
use regex::Regex;

use game_core::{config::initialize_config_paths, constants::{BIOME_NUMBER_OF_FRAMES, TILE_SIZE}, initialize_game, lang::localizable::LANG_EN, maps::{biomes::Biome, biome_tiles::BiomeTile, constructions::Construction, construction_tiles::ConstructionTile, tiles::{SpriteTile, TileSet}}, multiplayer::modes::GameMode, worlds::world::World};

struct Job {
    world_id: u32,
    variant: i32,
    sprite_sheet_biome_tiles_path: String,
    sprite_sheet_construction_tiles_path: String,
    output_image_path: String,
}

pub fn generate_tile_map_image_from_json(
    world_id: u32,
    variant: i32,
    sprite_sheet_biome_tiles_path: &str,
    sprite_sheet_construction_tiles_path: &str,
    output_image_path: &str,
) -> Result<(), Box<dyn Error>> {
    if world_id == 1000 {
        return Ok(())
    }
    let world = World::load(world_id).unwrap();

    generate_tile_map_image(
        &world.biome_tiles,
        &world.construction_tiles,
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
    let mut composed_image: RgbaImage = ImageBuffer::from_pixel(map_width, map_height, image::Rgba([0, 0, 0, 255]));

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
            tile.setup(col, row, up, right, down, left);
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

    let rgb_image: RgbImage = DynamicImage::ImageRgba8(composed_image).to_rgb8();

    let file = File::create(output_image_path)?;
    let ref mut w = BufWriter::new(file);

    let mut encoder = png::Encoder::new(w, map_width, map_height);
    encoder.set_color(png::ColorType::Rgb);
    encoder.set_depth(png::BitDepth::Eight);
    encoder.set_compression(png::Compression::Best);
    let mut writer = encoder.write_header()?;
    let image_data = rgb_image.as_raw();
    writer.write_image_data(image_data)?;

    Ok(())
}

fn main() -> Result<(), Box<dyn Error>> {
    // Initialize configurations and game
    initialize_config_paths(
        false,
        TILE_SIZE * 1.8,
        LANG_EN.to_owned(),
        Path::new("data").to_path_buf(),
        Path::new("data/species.json").to_path_buf(),
        Path::new("data/save.json").to_path_buf(),
        Path::new("lang").to_path_buf()
    );
    initialize_game(GameMode::RealTimeCoOp);

    let data_dir = Path::new("data");
    let assets_dir = Path::new("assets");
    let re = Regex::new(r"^\d+\.json$")?;

    let mut entries: Vec<fs::DirEntry> = fs::read_dir(data_dir)?
        .filter_map(|res| res.ok())
        .collect();

    entries.sort_by_key(|entry| entry.file_name());

    // Define the number of threads
    let num_threads = 4;

    // Create channels for each thread
    let mut senders: Vec<Sender<Option<Job>>> = Vec::with_capacity(num_threads);
    let mut handles = Vec::with_capacity(num_threads);

    for i in 0..num_threads {
        let (tx, rx): (Sender<Option<Job>>, Receiver<Option<Job>>) = mpsc::channel();
        senders.push(tx);

        // Spawn a worker thread
        let handle = thread::spawn(move || {
            while let Ok(job_opt) = rx.recv() {
                match job_opt {
                    Some(job) => {
                        println!(
                            "[Thread {}] Processing world_id: {}, variant: {}",
                            i, job.world_id, job.variant
                        );
                        if let Err(e) = generate_tile_map_image_from_json(
                            job.world_id,
                            job.variant,
                            &job.sprite_sheet_biome_tiles_path,
                            &job.sprite_sheet_construction_tiles_path,
                            &job.output_image_path,
                        ) {
                            eprintln!(
                                "[Thread {}] Error generating image '{}': {}",
                                i, job.output_image_path, e
                            );
                        } else {
                            println!(
                                "[Thread {}] Tile map image saved to '{}'",
                                i, job.output_image_path
                            );
                        }
                    }
                    None => {
                        // Termination signal received
                        println!("[Thread {}] Terminating.", i);
                        break;
                    }
                }
            }
        });
        handles.push(handle);
    }

    // Prepare sprite sheet paths once
    let sprite_sheet_biome_tiles_path = assets_dir.join("tiles_biome.png").to_string_lossy().to_string();
    let sprite_sheet_construction_tiles_path = assets_dir.join("tiles_constructions.png").to_string_lossy().to_string();

    // Verify sprite sheets exist
    if !Path::new(&sprite_sheet_biome_tiles_path).exists() || !Path::new(&sprite_sheet_construction_tiles_path).exists() {
        eprintln!("!..Sprite sheets not found in 'assets' directory.");
        return Ok(());
    }

    // Assign files to threads in round-robin fashion
    for (index, entry) in entries.iter().enumerate() {
        let path = entry.path();
        println!("> Checking: {:#?}", path);
        let filename = path.file_name().unwrap().to_str().unwrap();

        if !re.is_match(filename) {
            continue;
        };

        let world_id = filename.split('.').next().unwrap_or("unknown");
        if world_id.parse::<u32>().is_err() {
            println!("!..Invalid world id: {}", world_id);
            continue;
        }

        let world_id_u32 = world_id.parse::<u32>().unwrap();
        let json_file_path = data_dir.join(filename);

        let json_metadata = fs::metadata(&json_file_path)?;
        let json_mtime = json_metadata.modified()?;

        for variant in 0..BIOME_NUMBER_OF_FRAMES {
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
                println!("...Skipping '{}'; it is already up-to-date.", output_image_filename);
                continue;
            }

            println!("...Generating image for '{}', variant {}", world_id, variant);

            // Create a Job instance
            let job = Job {
                world_id: world_id_u32,
                variant,
                sprite_sheet_biome_tiles_path: sprite_sheet_biome_tiles_path.clone(),
                sprite_sheet_construction_tiles_path: sprite_sheet_construction_tiles_path.clone(),
                output_image_path: output_image_path.to_string_lossy().to_string(),
            };

            // Assign the job to a thread in round-robin fashion
            let thread_index = index % num_threads;
            if let Some(sender) = senders.get(thread_index) {
                sender.send(Some(job)).expect("Failed to send job to thread");
            }
        }
    }

    // After all jobs are sent, send termination signals
    for sender in &senders {
        sender.send(None).expect("Failed to send termination signal");
    }

    // Wait for all threads to finish
    for handle in handles {
        handle.join().expect("Thread panicked");
    }

    Ok(())
}
