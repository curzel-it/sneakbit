use nohash_hasher::IntMap;
use raylib::prelude::*;

use game_core::constants::{BIOME_NUMBER_OF_FRAMES, SPRITE_SHEET_ANIMATED_OBJECTS, SPRITE_SHEET_BIOME_TILES, SPRITE_SHEET_BUILDINGS, SPRITE_SHEET_CAVE_DARKNESS, SPRITE_SHEET_CONSTRUCTION_TILES, SPRITE_SHEET_DEMON_LORD_DEFEAT, SPRITE_SHEET_HEROES, SPRITE_SHEET_HUMANOIDS_1X1, SPRITE_SHEET_HUMANOIDS_1X2, SPRITE_SHEET_HUMANOIDS_2X2, SPRITE_SHEET_INVENTORY, SPRITE_SHEET_MENU, SPRITE_SHEET_MONSTERS, SPRITE_SHEET_STATIC_OBJECTS, SPRITE_SHEET_TENTACLES, SPRITE_SHEET_WEAPONS};

use crate::features::paths::root_path;

use super::ui::get_rendering_config_mut;

pub fn load_tile_map_textures(rl: &mut RaylibHandle, thread: &RaylibThread, world_id: u32) {
    let config = get_rendering_config_mut();
    
    (0..BIOME_NUMBER_OF_FRAMES).for_each(|variant| {
        let key = world_id * 10 + variant as u32;
        let filename = format!("{}-{}", world_id, variant);
        
        if let Some(texture) = texture(rl, thread, &filename) {
            config.textures.insert(key, texture);
        }
    });    
}

pub fn load_textures(rl: &mut RaylibHandle, thread: &RaylibThread) -> IntMap<u32, Texture2D> {    
    let mut textures: IntMap<u32, Texture2D> = IntMap::default();
    textures.insert(SPRITE_SHEET_INVENTORY, texture(rl, thread, "inventory").unwrap());
    textures.insert(SPRITE_SHEET_BIOME_TILES, texture(rl, thread, "tiles_biome").unwrap());
    textures.insert(SPRITE_SHEET_CONSTRUCTION_TILES, texture(rl, thread, "tiles_constructions").unwrap());
    textures.insert(SPRITE_SHEET_BUILDINGS, texture(rl, thread, "buildings").unwrap());
    textures.insert(SPRITE_SHEET_STATIC_OBJECTS, texture(rl, thread, "static_objects").unwrap());
    textures.insert(SPRITE_SHEET_MENU, texture(rl, thread, "menu").unwrap());        
    textures.insert(SPRITE_SHEET_ANIMATED_OBJECTS, texture(rl, thread, "animated_objects").unwrap());     
    textures.insert(SPRITE_SHEET_HUMANOIDS_1X1, texture(rl, thread, "humanoids_1x1").unwrap());      
    textures.insert(SPRITE_SHEET_HUMANOIDS_1X2, texture(rl, thread, "humanoids_1x2").unwrap());
    textures.insert(SPRITE_SHEET_HUMANOIDS_2X2, texture(rl, thread, "humanoids_2x2").unwrap());
    textures.insert(SPRITE_SHEET_DEMON_LORD_DEFEAT, texture(rl, thread, "demon_lord_defeat").unwrap());         
    textures.insert(SPRITE_SHEET_CAVE_DARKNESS, texture(rl, thread, "cave_darkness").unwrap());       
    textures.insert(SPRITE_SHEET_TENTACLES, texture(rl, thread, "tentacles").unwrap()); 
    textures.insert(SPRITE_SHEET_WEAPONS, texture(rl, thread, "weapons").unwrap()); 
    textures.insert(SPRITE_SHEET_MONSTERS, texture(rl, thread, "monsters").unwrap()); 
    textures.insert(SPRITE_SHEET_HEROES, texture(rl, thread, "heroes").unwrap()); 
    textures        
}

fn texture(rl: &mut RaylibHandle, thread: &RaylibThread, name: &str) -> Option<Texture2D> {
    let mut path = root_path();
    path.push("assets");
    path.push(format!("{}.png", name));

    let filename = path.as_os_str().to_str().unwrap();
    let result = rl.load_texture(thread, filename);
    
    match result {
        Ok(texture) => Some(texture),
        Err(err) => {
            eprintln!("Failed to load texture at {}: {:#?}", filename, err);
            None
        }
    }
}