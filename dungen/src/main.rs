use clap::Parser;
use rand::Rng;
use std::fs::File;
use std::io::Write;

use game_core::{maps::{biome_tiles::BiomeTile, construction_tiles::ConstructionTile, tiles::TileSet}, worlds::{world::World, world_type::WorldType}};

/*
Dungeon 
cargo run --package dungen worldid --pavement B --wall H --padding 0 --min-room-size 3  --max-room-size 6 --width 40 --height 80

Dark Cave
cargo run --package dungen worldid --pavement 8 --wall 3 --padding 0 --min-room-size 5  --max-room-size 12 --width 120 --height 80

Water Cave
cargo run --package dungen worldid --pavement 8 --wall 0 --padding 0 --empty 2 --min-room-size 5  --max-room-size 12 --width 120 --height 80

Icy Cave
cargo run --package dungen worldid --pavement 9 --wall P --padding 0 --empty 2 --min-room-size 5  --max-room-size 12 --width 120 --height 80

Forest
cargo run --package dungen worldid --pavement 1 --wall 8 --fill  --width 40 --height 30 --padding 20

Forest Village
cargo run --package dungen worldid --pavement 1 --wall 8 --fill --min-room-size 1  --max-room-size 2 --width 60 --height 40

Dark Forest
cargo run --package dungen worldid --pavement A --wall 8 --padding 10 --empty A --min-room-size 3 --max-room-size 8 --width 60 --height 60 

Island
cargo run --package dungen worldid --pavement 1 --empty 2 --wall 0 --padding-pavement 2 --padding-wall 0 --min-room-size 8  --max-room-size 20 --width 120 --height 80

Arcipelago
cargo run --package dungen worldid --pavement 4 --empty 2 --wall 0 --padding-pavement 2 --padding-wall 0 --min-room-size 3 --max-room-size 8 --width 60 --height 80

Sandy Valley
cargo run --package dungen worldid --pavement 4 --wall 0 --padding 10 --min-room-size 5  --max-room-size 12 --width 100 --height 50

Simmetry 
cargo run --package dungen worldid --pavement 1 --wall 8 --padding 10 --min-room-size 3 --max-room-size 6 --width 70 --height 70 --symmetry
*/

#[derive(Parser, Debug)]
#[clap(author, version, about)]
struct Args {
    /// The ID of the world to be generated.
    world_id: u32,

    /// Width of the dungeon map (default: 80)
    #[clap(long, default_value_t = 80)]
    width: usize,

    /// Height of the dungeon map (default: 60)
    #[clap(long, default_value_t = 60)]
    height: usize,

    /// Minimum size of a room (default: 6)
    #[clap(long, default_value_t = 6)]
    min_room_size: usize,

    /// Maximum size of a room (default: 15)
    #[clap(long, default_value_t = 15)]
    max_room_size: usize,

    /// Character representing pavement inside rooms and corridors (default: B)
    #[clap(long, default_value = "B")]
    pavement: String,

    /// Character representing walls (default: H)
    #[clap(long, default_value = "H")]
    wall: String,

    /// Character representing empty space in biome tiles (default: 0)
    #[clap(long, default_value = "0")]
    empty: String,

    /// Character representing no wall in construction tiles (default: 0)
    #[clap(long, default_value = "0")]
    no_wall: String,

    /// Number of tiles to use as padding around world edges (default: 20)
    #[clap(long, default_value_t = 20)]
    padding: usize,

    /// Fill DOUNGEON_EMPTY biome tiles with DOUNGEON_WALL in construction tiles.
    #[clap(long)]
    fill: bool,

    /// Fill DOUNGEON_EMPTY biome tiles with DOUNGEON_WALL in biome tiles.
    #[clap(long)]
    fill_pavement: bool,

    /// Cell type to use in padding for pavement
    #[clap(long)]
    padding_pavement: Option<String>,

    /// Cell type to use in padding for wall
    #[clap(long)]
    padding_wall: Option<String>,

    /// Enable quadrant symmetry (default: false)
    #[clap(long)]
    symmetry: bool,
}

struct Room {
    x: usize,
    y: usize,
    width: usize,
    height: usize,
}

impl Room {
    fn center(&self) -> (usize, usize) {
        (self.x + self.width / 2, self.y + self.height / 2)
    }
}

fn create_room(dungeon_map: &mut Vec<Vec<char>>, room: &Room, pavement: char) {
    for y in room.y..(room.y + room.height) {
        for x in room.x..(room.x + room.width) {
            dungeon_map[y][x] = pavement;
        }
    }
}

fn create_h_tunnel(
    dungeon_map: &mut Vec<Vec<char>>,
    x1: usize,
    x2: usize,
    y: usize,
    pavement: char,
) {
    let (start, end) = if x1 <= x2 { (x1, x2) } else { (x2, x1) };
    for x in start..=end {
        dungeon_map[y][x] = pavement;
    }
}

fn create_v_tunnel(
    dungeon_map: &mut Vec<Vec<char>>,
    y1: usize,
    y2: usize,
    x: usize,
    pavement: char,
) {
    let (start, end) = if y1 <= y2 { (y1, y2) } else { (y2, y1) };
    for y in start..=end {
        dungeon_map[y][x] = pavement;
    }
}

fn split_space(
    x: usize,
    y: usize,
    width: usize,
    height: usize,
    rooms: &mut Vec<Room>,
    rng: &mut impl Rng,
    min_room_size: usize,
    max_room_size: usize,
    dungeon_map: &mut Vec<Vec<char>>,
    pavement: char,
) {
    if width < max_room_size * 2 && height < max_room_size * 2 {
        let room_width = rng.gen_range(min_room_size..=width.min(max_room_size));
        let room_height = rng.gen_range(min_room_size..=height.min(max_room_size));
        let room_x = x + rng.gen_range(0..=width - room_width);
        let room_y = y + rng.gen_range(0..=height - room_height);
        let new_room = Room {
            x: room_x,
            y: room_y,
            width: room_width,
            height: room_height,
        };
        create_room(dungeon_map, &new_room, pavement);
        rooms.push(new_room);
        return;
    }

    let split_horizontally = if width as f32 / height as f32 >= 1.25 {
        false
    } else if height as f32 / width as f32 >= 1.25 {
        true
    } else {
        rng.gen_bool(0.5)
    };

    if split_horizontally {
        let split = rng.gen_range((height as f32 * 0.3) as usize..=(height as f32 * 0.7) as usize);
        split_space(
            x,
            y,
            width,
            split,
            rooms,
            rng,
            min_room_size,
            max_room_size,
            dungeon_map,
            pavement,
        );
        split_space(
            x,
            y + split,
            width,
            height - split,
            rooms,
            rng,
            min_room_size,
            max_room_size,
            dungeon_map,
            pavement,
        );
    } else {
        let split = rng.gen_range((width as f32 * 0.3) as usize..=(width as f32 * 0.7) as usize);
        split_space(
            x,
            y,
            split,
            height,
            rooms,
            rng,
            min_room_size,
            max_room_size,
            dungeon_map,
            pavement,
        );
        split_space(
            x + split,
            y,
            width - split,
            height,
            rooms,
            rng,
            min_room_size,
            max_room_size,
            dungeon_map,
            pavement,
        );
    }
}

fn connect_rooms(rooms: &[Room], dungeon_map: &mut Vec<Vec<char>>, pavement: char, rng: &mut impl Rng) {
    for i in 1..rooms.len() {
        let (prev_center_x, prev_center_y) = rooms[i - 1].center();
        let (curr_center_x, curr_center_y) = rooms[i].center();

        if rng.gen_bool(0.5) {
            create_h_tunnel(dungeon_map, prev_center_x, curr_center_x, prev_center_y, pavement);
            create_v_tunnel(dungeon_map, prev_center_y, curr_center_y, curr_center_x, pavement);
        } else {
            create_v_tunnel(dungeon_map, prev_center_y, curr_center_y, prev_center_x, pavement);
            create_h_tunnel(dungeon_map, prev_center_x, curr_center_x, curr_center_y, pavement);
        }
    }
}

fn cleanup_walls(
    dungeon_map: &Vec<Vec<char>>,
    width: usize,
    height: usize,
    pavement: char,
    wall: char,
    empty: char,
) -> Vec<Vec<char>> {
    let mut new_dungeon_map = vec![vec![empty; width]; height];

    for y in 0..height {
        for x in 0..width {
            if dungeon_map[y][x] == pavement {
                new_dungeon_map[y][x] = pavement;
            } else {
                let mut adjacent_to_floor = false;
                for dy in -1i32..=1 {
                    for dx in -1i32..=1 {
                        if dy == 0 && dx == 0 {
                            continue;
                        }
                        let ny = y as i32 + dy;
                        let nx = x as i32 + dx;
                        if ny >= 0 && ny < height as i32 && nx >= 0 && nx < width as i32 {
                            if dungeon_map[ny as usize][nx as usize] == pavement {
                                adjacent_to_floor = true;
                                break;
                            }
                        }
                    }
                    if adjacent_to_floor {
                        break;
                    }
                }
                if adjacent_to_floor {
                    new_dungeon_map[y][x] = wall;
                } else {
                    new_dungeon_map[y][x] = empty;
                }
            }
        }
    }
    new_dungeon_map
}

// Helper function to flip the map horizontally
fn flip_horizontal(map: &Vec<Vec<char>>) -> Vec<Vec<char>> {
    map.iter()
        .map(|row| row.iter().rev().cloned().collect())
        .collect()
}

// Helper function to flip the map vertically
fn flip_vertical(map: &Vec<Vec<char>>) -> Vec<Vec<char>> {
    let mut new_map = map.clone();
    new_map.reverse();
    new_map
}

fn main() {
    let args = Args::parse();

    // Ensure width and height are even when symmetry is enabled
    if args.symmetry {
        if args.width % 2 != 0 || args.height % 2 != 0 {
            eprintln!("When using symmetry, both width and height must be even numbers.");
            std::process::exit(1);
        }
    }

    let dungeon_pavement = args.pavement.chars().next().unwrap_or('B');
    let dungeon_wall = args.wall.chars().next().unwrap_or('H');
    let dungeon_empty = args.empty.chars().next().unwrap_or('0');
    let dungeon_no_wall = args.no_wall.chars().next().unwrap_or('0');

    let padding_pavement = args
        .padding_pavement
        .as_deref()
        .unwrap_or(&args.pavement)
        .chars()
        .next()
        .unwrap_or(dungeon_pavement);

    let padding_wall = args
        .padding_wall
        .as_deref()
        .unwrap_or(&args.wall)
        .chars()
        .next()
        .unwrap_or(dungeon_wall);

    // Initialize the full dungeon map with walls
    let mut full_dungeon_map = vec![vec![dungeon_wall; args.width]; args.height];

    // Define the top-left quadrant dimensions
    let half_width = args.width / 2;
    let half_height = args.height / 2;

    // Initialize the top-left quadrant map with walls
    let mut top_left_map = vec![vec![dungeon_wall; half_width]; half_height];

    let mut rooms = Vec::new();
    let mut rng = rand::thread_rng();

    if args.symmetry {
        // Generate only the top-left quadrant
        split_space(
            0,
            0,
            half_width,
            half_height,
            &mut rooms,
            &mut rng,
            args.min_room_size,
            args.max_room_size,
            &mut top_left_map,
            dungeon_pavement,
        );

        connect_rooms(&rooms, &mut top_left_map, dungeon_pavement, &mut rng);

        top_left_map = cleanup_walls(
            &top_left_map,
            half_width,
            half_height,
            dungeon_pavement,
            dungeon_wall,
            dungeon_empty,
        );

        // Create other quadrants by mirroring
        let top_right_map = flip_horizontal(&top_left_map);
        let bottom_left_map = flip_vertical(&top_left_map);
        let bottom_right_map = flip_horizontal(&bottom_left_map);

        // Assemble the full dungeon map
        for y in 0..half_height {
            for x in 0..half_width {
                full_dungeon_map[y][x] = top_left_map[y][x];
                full_dungeon_map[y][x + half_width] = top_right_map[y][x];
                full_dungeon_map[y + half_height][x] = bottom_left_map[y][x];
                full_dungeon_map[y + half_height][x + half_width] = bottom_right_map[y][x];
            }
        }
    } else {
        // Generate the entire map without symmetry
        split_space(
            1,
            1,
            args.width - 2,
            args.height - 2,
            &mut rooms,
            &mut rng,
            args.min_room_size,
            args.max_room_size,
            &mut full_dungeon_map,
            dungeon_pavement,
        );

        connect_rooms(&rooms, &mut full_dungeon_map, dungeon_pavement, &mut rng);

        full_dungeon_map = cleanup_walls(
            &full_dungeon_map,
            args.width,
            args.height,
            dungeon_pavement,
            dungeon_wall,
            dungeon_empty,
        );
    }

    // Generate biome_tiles and construction_tiles
    let mut biome_tiles = vec![vec![dungeon_empty; args.width]; args.height];
    let mut construction_tiles = vec![vec![dungeon_no_wall; args.width]; args.height];

    for y in 0..args.height {
        for x in 0..args.width {
            if full_dungeon_map[y][x] == dungeon_pavement {
                biome_tiles[y][x] = dungeon_pavement;
            } else {
                biome_tiles[y][x] = dungeon_empty;
            }

            if full_dungeon_map[y][x] == dungeon_wall {
                construction_tiles[y][x] = dungeon_wall;
            } else {
                construction_tiles[y][x] = dungeon_no_wall;
            }
        }
    }

    // Post-processing: If fill flag is present, update construction tiles
    if args.fill {
        for y in 0..args.height {
            for x in 0..args.width {
                if biome_tiles[y][x] == dungeon_empty {
                    construction_tiles[y][x] = dungeon_wall;
                    biome_tiles[y][x] = dungeon_wall;
                }
            }
        }
    } else if args.fill_pavement {
        for y in 0..args.height {
            for x in 0..args.width {
                if biome_tiles[y][x] == dungeon_empty {
                    biome_tiles[y][x] = dungeon_wall;
                }
            }
        }
    }

    // Convert tile grids to strings
    let mut biome_tile_strings: Vec<String> = biome_tiles
        .iter()
        .map(|row| row.iter().collect())
        .collect();

    let mut construction_tile_strings: Vec<String> = construction_tiles
        .iter()
        .map(|row| row.iter().collect())
        .collect();

    // Post-processing: Add padding tiles
    let padding_horizontal_biomes = padding_pavement.to_string().repeat(args.padding);
    let padding_horizontal_constructions = padding_wall.to_string().repeat(args.padding);

    for i in 0..biome_tile_strings.len() {
        biome_tile_strings[i] = format!(
            "{}{}{}",
            padding_horizontal_biomes, biome_tile_strings[i], padding_horizontal_biomes
        );
        construction_tile_strings[i] = format!(
            "{}{}{}",
            padding_horizontal_constructions, construction_tile_strings[i], padding_horizontal_constructions
        );
    }

    let padding_vertical_biomes = vec![
        padding_pavement.to_string().repeat(biome_tile_strings[0].len());
        args.padding
    ];
    biome_tile_strings = [
        padding_vertical_biomes.clone(),
        biome_tile_strings,
        padding_vertical_biomes,
    ]
    .concat();

    let padding_vertical_constructions = vec![
        padding_wall.to_string().repeat(construction_tile_strings[0].len());
        args.padding
    ];
    construction_tile_strings = [
        padding_vertical_constructions.clone(),
        construction_tile_strings,
        padding_vertical_constructions,
    ]
    .concat();

    // Create BiomeTile and ConstructionTile sets
    let biome_tileset = TileSet::<BiomeTile>::with_tiles(
        1002,
        biome_tile_strings
            .iter()
            .map(|row| {
                row.chars()
                    .map(|c| BiomeTile::from_data(c))
                    .collect::<Vec<BiomeTile>>()
            })
            .collect(),
    );

    let construction_tileset = TileSet::<ConstructionTile>::with_tiles(
        1003,
        construction_tile_strings
            .iter()
            .map(|row| {
                row.chars()
                    .map(|c| ConstructionTile::from_data(c))
                    .collect::<Vec<ConstructionTile>>()
            })
            .collect(),
    );

    // Assemble world data
    let mut world = World::new(args.world_id);
    world.biome_tiles = biome_tileset;
    world.construction_tiles = construction_tileset;
    world.world_type = if args.padding == 0 { WorldType::Dungeon } else { WorldType::Exterior };
    world.ephemeral_state = true;

    // Serialize world to JSON
    let output_filename = format!("data/{}.json", args.world_id);
    let serialized_world = serde_json::to_string_pretty(&world).unwrap();
    let mut file = File::create(&output_filename).expect("Failed to create output file");
    file.write_all(serialized_world.as_bytes())
        .expect("Failed to write to output file");

    println!(
        "Dungeon {} has been generated and saved to {}",
        args.world_id, output_filename
    );
    if args.fill {
        println!("Fill parameter was used: DOUNGEON_EMPTY biome tiles have been filled with DOUNGEON_WALL in construction tiles.");
    }
    if args.symmetry {
        println!("Symmetry parameter was used: Dungeon is quadrant-symmetrical.");
    }
}