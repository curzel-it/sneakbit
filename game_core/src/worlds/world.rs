use std::{cell::RefCell, cmp::Ordering};

use crate::{constants::{MAX_PLAYERS, PLAYER1_ENTITY_ID, PLAYER1_INDEX, PLAYER2_ENTITY_ID, PLAYER2_INDEX, PLAYER3_ENTITY_ID, PLAYER3_INDEX, PLAYER4_ENTITY_ID, PLAYER4_INDEX}, current_player_index, entities::{known_species::SPECIES_HERO, species::EntityType}, features::{cutscenes::CutScene, entity::is_player, light_conditions::LightConditions}, input::keyboard_events_provider::{KeyboardEventsProvider, NO_KEYBOARD_EVENTS}, is_turn_based_game_mode, maps::{biomes::Biome, biome_tiles::BiomeTile, constructions::Construction, construction_tiles::ConstructionTile, tiles::TileSet}, multiplayer::player_props::{empty_props_for_all_players, PlayerProps}, number_of_players, utils::{directions::Direction, rect::FRect, vector::Vector2d}};
use crate::features::{hitmaps::Hitmap, entity::Entity, locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{lock_override, save_lock_override, set_value_for_key, StorageKey}};

use super::world_type::WorldType;

#[derive(Clone)]
pub struct World {
    pub id: u32,
    pub revision: u32,
    pub bounds: FRect,
    pub biome_tiles: TileSet<BiomeTile>,
    pub construction_tiles: TileSet<ConstructionTile>,
    pub entities: RefCell<Vec<Entity>>,    
    pub visible_entities: Vec<(usize, u32)>,
    pub ephemeral_state: bool,
    pub players: Vec<PlayerProps>,
    pub has_confirmation_key_been_pressed_by_anyone: bool,
    pub is_any_arrow_key_down: bool,
    pub(crate) hitmap: Hitmap,
    pub tiles_hitmap: Hitmap,
    pub world_type: WorldType,
    pub pressure_plate_down_red: bool,
    pub pressure_plate_down_green: bool,
    pub pressure_plate_down_blue: bool,
    pub pressure_plate_down_silver: bool,
    pub pressure_plate_down_yellow: bool,
    pub spawn_point: (f32, f32),
    pub light_conditions: LightConditions,
    pub soundtrack: Option<String>,
    pub cutscenes: Vec<CutScene>,
    pub number_of_entities: usize
}

const WORLD_SIZE_COLUMNS: usize = 30;
const WORLD_SIZE_ROWS: usize = 30;

impl World {
    pub fn new(id: u32) -> Self {
        Self {
            id,
            revision: 0,
            bounds: FRect::from_origin(WORLD_SIZE_COLUMNS as f32, WORLD_SIZE_ROWS as f32),
            biome_tiles: TileSet::empty(),
            construction_tiles: TileSet::empty(),
            entities: RefCell::new(vec![]),
            visible_entities: vec![],
            ephemeral_state: false,
            players: empty_props_for_all_players(),
            has_confirmation_key_been_pressed_by_anyone: false,
            is_any_arrow_key_down: false,
            hitmap: Hitmap::new(),
            tiles_hitmap: Hitmap::new(),
            world_type: WorldType::HouseInterior,
            pressure_plate_down_red: false,
            pressure_plate_down_green: false,
            pressure_plate_down_blue: false,
            pressure_plate_down_silver: false,
            pressure_plate_down_yellow: false,
            light_conditions: LightConditions::Day,
            cutscenes: vec![],
            spawn_point: (0.0, 0.0),
            soundtrack: None, 
            number_of_entities: 0
        }
    }

    pub fn add_entity(&mut self, entity: Entity) -> (usize, u32) {
        let index = self.entities.borrow().len();
        let id = entity.id;

        if self.insert_entity(entity, index) {
            (index, id)
        } else {
            (0, 0)
        }
    }

    pub fn insert_entity(&mut self, entity: Entity, index: usize) -> bool {
        let id = entity.id;

        if !entity.should_be_visible(self) {
            return false
        }

        let mut entities = self.entities.borrow_mut();        
        entities.insert(index, entity);
        entities[index].setup();

        if let Some(lock_type) = lock_override(&id) {
            entities[index].lock_type = lock_type;
        }
        self.number_of_entities = entities.len();
        true
    }

    pub fn remove_entity_by_id(&mut self, id: u32) {        
        if id != PLAYER1_ENTITY_ID {
            if let Some(player_index) = self.player_index_by_entity_id(id) {
                self.players[player_index].props.is_invulnerable = true;
            }
            if let Some(index) = self.index_for_entity(id) {
                self.remove_entity_at_index(index);
            }
        }
    }

    pub fn mark_as_collected_if_needed(&self, entity_id: u32, parent_id: u32) {
        if !self.ephemeral_state && !is_player(entity_id) && !is_player(parent_id) {
            set_value_for_key(&StorageKey::item_collected(entity_id), 1);
        }
    }

    pub fn remove_entity_at_index(&mut self, index: usize) {
        let entities = self.entities.borrow();
        let entity = &entities[index];
        self.mark_as_collected_if_needed(entity.id, entity.parent_id);
        drop(entities);
        self.entities.borrow_mut().swap_remove(index);
    }

    pub fn index_for_entity(&self, id: u32) -> Option<usize> {
        self.entities.borrow().iter()
            .enumerate()
            .find(|(_, entity)|{ entity.id == id })
            .map(|(index, _)| index)
    }

    pub fn update(
        &mut self, 
        time_since_last_update: f32,
        viewport: &FRect,
        keyboard: &KeyboardEventsProvider
    ) -> Vec<EngineStateUpdate> {
        self.update_players(keyboard);

        self.has_confirmation_key_been_pressed_by_anyone = keyboard.has_confirmation_been_pressed_by_anyone();
        self.is_any_arrow_key_down = keyboard.is_any_arrow_key_down_for_anyone();
        self.biome_tiles.update(time_since_last_update);

        let mut engine_updates: Vec<EngineStateUpdate> = vec![];
        engine_updates.extend(self.update_entities(time_since_last_update));
        engine_updates.extend(self.update_cutscenes(time_since_last_update));

        unsafe {
            self.update_hitmaps(viewport);
        }
        engine_updates
    }

    fn update_entities(&mut self, time_since_last_update: f32) -> Vec<EngineStateUpdate> { 
        let mut entities = self.entities.borrow_mut();
        let mut updates: Vec<WorldStateUpdate> = vec![];

        for &(index, _) in &self.visible_entities {
            if let Some(entity) = entities.get_mut(index) {
                let entity_updates = entity.update(self, time_since_last_update);
                updates.extend(entity_updates);
            }
        }
        
        drop(entities);
        self.apply_state_updates(updates)
    }

    fn update_cutscenes(&mut self, time_since_last_update: f32) -> Vec<EngineStateUpdate> { 
        if self.cutscenes.is_empty() {
            return vec![]
        }
        let updates: Vec<WorldStateUpdate> = self.cutscenes.iter_mut()
            .flat_map(|c| 
                c.update(&self.players[0].props.hittable_frame, time_since_last_update)
            )
            .collect();
        
        self.apply_state_updates(updates)
    }

    pub fn apply_state_updates(&mut self, updates: Vec<WorldStateUpdate>) -> Vec<EngineStateUpdate> {
        updates.into_iter().flat_map(|u| self.apply_state_update(u)).collect()
    }

    fn apply_state_update(&mut self, update: WorldStateUpdate) -> Vec<EngineStateUpdate> {
        update.log();

        match update {
            WorldStateUpdate::AddEntity(entity) => { 
                self.add_entity(*entity); 
            }
            WorldStateUpdate::RemoveEntity(id) => {
                self.remove_entity_by_id(id)
            }
            WorldStateUpdate::RemoveEntityAtCoordinates(row, col) => {
                self.remove_entities_by_coords(row, col)
            }
            WorldStateUpdate::CacheHeroProps(props) => { 
                if let Some(index) = self.player_index_by_entity_id(props.id) {
                    self.players[index].props = *props;                
                }                
            }
            WorldStateUpdate::ChangeLock(entity_id, lock_type) => {
                self.change_lock(entity_id, lock_type)
            }
            WorldStateUpdate::BiomeTileChange(row, col, new_biome) => {
                self.update_biome_tile(row, col, new_biome)
            }
            WorldStateUpdate::ConstructionTileChange(row, col, new_construction) => {
                self.update_construction_tile(row, col, new_construction)
            }
            WorldStateUpdate::StopHeroMovement => {
                self.stop_hero_movement()
            }
            WorldStateUpdate::EngineUpdate(update) => {
                return vec![update]
            }
            WorldStateUpdate::HandleBulletStopped(bullet_id) => {
                return self.handle_bullet_stopped(bullet_id)
            }
            WorldStateUpdate::HandleBulletCatched(bullet_id) => {
                self.handle_bullet_catched(bullet_id)
            }
            WorldStateUpdate::HandleHits(hit) => {
                return self.handle_hits(&hit)
            }
            WorldStateUpdate::SetPressurePlateState(lock_type, is_down) => {
                match lock_type {
                    LockType::Yellow => self.pressure_plate_down_yellow = is_down,
                    LockType::Blue => self.pressure_plate_down_blue = is_down,
                    LockType::Green => self.pressure_plate_down_green = is_down,
                    LockType::Red => self.pressure_plate_down_red = is_down,
                    LockType::Silver => self.pressure_plate_down_silver = is_down,
                    LockType::None => {}
                    LockType::Permanent => {}
                }                
            }
        };
        vec![]
    }

    fn stop_hero_movement(&mut self) {
        self.entities
            .borrow_mut()
            .iter_mut()
            .filter(|e| e.is_player())
            .for_each(|e| e.current_speed = 0.0);
    }

    fn change_lock(&mut self, id: u32, lock_type: LockType) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            entity.lock_type = lock_type;
            save_lock_override(&entity.id, &lock_type);
        }
    }

    fn update_biome_tile(&mut self, row: usize, col: usize, new_biome: Biome) {
        self.biome_tiles.update_tile(row, col, new_biome);
        let viewport = self.bounds.clone();
        
        unsafe { 
            self.update_hitmaps(&viewport);
        }
    }

    fn update_construction_tile(&mut self, row: usize, col: usize, new_construction: Construction) {
        self.construction_tiles.update_tile(row, col, new_construction);
        let viewport = self.bounds.clone();

        unsafe { 
            self.update_hitmaps(&viewport);
        }
    }  
    
    pub fn find_teleporter_for_destination(&self, destination_world: u32) -> Option<FRect> {
        self.entities.borrow().iter()
            .find(|t| {
                if !matches!(t.entity_type, EntityType::Teleporter) {
                    return false
                } 
                if let Some(destination) = &t.destination {
                    return destination.world == destination_world;
                }
                false
            })
            .map(|t| t.frame)
    }

    pub fn find_any_teleporter(&self) -> Option<FRect> {
        let entities = self.entities.borrow();
        let mut teleporters: Vec<&Entity> = entities.iter().filter(|t| matches!(t.entity_type, EntityType::Teleporter)).collect();
        
        teleporters.sort_by(|a, b| {
            if let Some(dest_a) = &a.destination {
                if let Some(dest_b) = &b.destination {
                    if dest_a.world < dest_b.world { return Ordering::Less }
                    if dest_a.world > dest_b.world { return Ordering::Greater }
                }
            }
            Ordering::Equal            
        });

        if !teleporters.is_empty() {
            Some(teleporters[0].frame)
        } else {
            None
        }
    }

    pub fn is_any_hero_on_a_slippery_surface(&self) -> bool {
        self.is_player_by_index_on_slippery_surface(0) || self.is_player_by_index_on_slippery_surface(1) || self.is_player_by_index_on_slippery_surface(2) || self.is_player_by_index_on_slippery_surface(3)
    }

    pub fn is_player_by_index_on_slippery_surface(&self, index: usize) -> bool {
        let frame = self.players[index].props.hittable_frame;
        self.is_slippery_surface(frame.x as usize, frame.y as usize)
    }

    pub fn is_slippery_surface(&self, x: usize, y: usize) -> bool {
        if y < self.biome_tiles.tiles.len() {
            let tile = self.biome_tiles.tiles[y][x].tile_type;
            matches!(tile, Biome::Ice)
        } else {
            false
        }
    }

    pub fn frame_is_slippery_surface(&self, frame: &FRect) -> bool {
        self.is_slippery_surface(frame.x as usize, frame.y as usize)
    }

    pub fn is_hero_around_and_on_collision_with(&self, target: &FRect) -> bool {
        let hero = self.players[0].props.hittable_frame;
        let hero_direction: Direction = self.players[0].props.direction;        
        
        if self.is_any_player_in(target) {
            return true
        }
        if hero.is_around_and_pointed_at(&target, &hero_direction) {
            return true 
        }
        false
    }

    fn find_non_hero_entity_at_coords(&self, row: usize, col: usize) -> Option<(usize, u32)> {
        let point = Vector2d::from_indeces(row, col);
        self.entities.borrow().iter()
            .enumerate()
            .find(|(_, entity)| {
                entity.species_id != SPECIES_HERO && entity.frame.contains_or_touches(&point)
            })
            .map(|(index, e)| (index, e.id))
    }

    fn remove_entities_by_coords(&mut self, row: usize, col: usize) {
        while let Some((index, _)) = self.find_non_hero_entity_at_coords(row, col) {
            self.remove_entity_at_index(index)
        }      
    }
    
    pub fn update_no_input(&mut self, time_since_last_update: f32) -> Vec<EngineStateUpdate> {
        let keyboard = &NO_KEYBOARD_EVENTS;
        let viewport = self.bounds;
        self.update(time_since_last_update, &viewport, keyboard)
    }

    pub fn is_pressure_plate_down(&self, lock_type: &LockType) -> bool {
        match lock_type {
            LockType::Blue => self.pressure_plate_down_blue,
            LockType::Red => self.pressure_plate_down_red,
            LockType::Green => self.pressure_plate_down_green,
            LockType::Silver => self.pressure_plate_down_silver,
            LockType::Yellow => self.pressure_plate_down_yellow,
            LockType::Permanent => false,
            LockType::None => false
        }
    }

    pub fn is_pressure_plate_up(&self, lock_type: &LockType) -> bool {
        !self.is_pressure_plate_down(lock_type)
    }

    pub fn index_of_any_player_who_is_pressing_confirm(&self) -> Option<usize> {
        for player in &self.players {
            if player.has_confirmation_key_been_pressed {
                return Some(player.index)
            }
        }
        None
    }

    pub fn player_index_by_entity_id(&self, entity_id: u32) -> Option<usize> {
        match entity_id {
            PLAYER1_ENTITY_ID => Some(0),
            PLAYER2_ENTITY_ID => Some(1),
            PLAYER3_ENTITY_ID => Some(2),
            PLAYER4_ENTITY_ID => Some(3),
            _ => None
        }
    }

    pub fn player_entity_ids(&self) -> Vec<u32> {
        match number_of_players() {
            1 => vec![PLAYER1_ENTITY_ID],
            2 => vec![PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID],
            3 => vec![PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID],
            4 => vec![PLAYER1_ENTITY_ID, PLAYER2_ENTITY_ID, PLAYER3_ENTITY_ID, PLAYER4_ENTITY_ID],
            _ => vec![PLAYER1_ENTITY_ID]
        }
    }

    pub fn player_entity_indeces(&self) -> Vec<usize> {
        match number_of_players() {
            1 => vec![PLAYER1_INDEX],
            2 => vec![PLAYER1_INDEX, PLAYER2_INDEX],
            3 => vec![PLAYER1_INDEX, PLAYER2_INDEX, PLAYER3_INDEX],
            4 => vec![PLAYER1_INDEX, PLAYER2_INDEX, PLAYER3_INDEX, PLAYER4_INDEX],
            _ => vec![PLAYER1_INDEX]
        }
    }

    fn update_players(&mut self, keyboard: &KeyboardEventsProvider) {
        if is_turn_based_game_mode() {
            let current = current_player_index();

            for index in 0..MAX_PLAYERS {
                if index == current {
                    self.players[index].update(keyboard);
                } else {
                    self.players[index].update(&NO_KEYBOARD_EVENTS);
                }
            }
        } else {
            self.players[0].update(keyboard);
            self.players[1].update(keyboard);
            self.players[2].update(keyboard);
            self.players[3].update(keyboard);
        }
    }

    pub fn construction_at(&self, x: f32, y: f32) -> &Construction {
        let (x, y) = self.coordinates_to_indeces(x, y);
        &self.construction_tiles.tiles[y][x].tile_type
    }

    pub fn constructions_in(&self, area: &FRect) -> Vec<Construction> {
        self.coordinates_to_indeces_from_area(area)
            .iter()
            .map(|&(x, y)| self.construction_tiles.tiles[y][x].tile_type)
            .collect()
    }

    pub fn biome_at(&self, x: f32, y: f32) -> &Biome {
        let (x, y) = self.coordinates_to_indeces(x, y);
        &self.biome_tiles.tiles[y][x].tile_type
    }

    pub fn coordinates_to_indeces(&self, x: f32, y: f32) -> (usize, usize) {
        let rows = self.construction_tiles.tiles.len();
        let columns = self.construction_tiles.tiles[0].len();
        let x = (x.max(0.0) as usize).min(columns - 1);
        let y = (y.max(0.0) as usize).min(rows - 1);
        (x, y)
    }

    fn coordinates_to_indeces_from_area(&self, area: &FRect) -> Vec<(usize, usize)> {
        let min_x = area.x.floor() as usize;
        let max_x = area.max_x().ceil() as usize;
        let min_y = area.y.floor() as usize;
        let max_y = area.max_y().ceil() as usize;

        let mut coordinates: Vec<(usize, usize)> = vec![];
        
        for x in min_x..max_x {
            for y in min_y..max_y {
                coordinates.push((x, y));
            }
        }

        coordinates
    }
}