use std::{cell::RefCell, collections::HashSet, fmt::{self, Debug}};

use common_macros::hash_set;
use crate::{constants::{ANIMATIONS_FPS, HERO_ENTITY_ID, SPRITE_SHEET_ANIMATED_OBJECTS, WORLD_SIZE_COLUMNS, WORLD_SIZE_ROWS}, entities::{known_species::SPECIES_HERO, species::EntityType}, features::{animated_sprite::AnimatedSprite, hitmap::{EntityIdsMap, Hitmap, WeightsMap}}, maps::{biome_tiles::{Biome, BiomeTile}, constructions_tiles::{Construction, ConstructionTile}, tiles::TileSet}, utils::{directions::Direction, rect::IntRect, vector::Vector2d}};

use super::{entity::{Entity, EntityId, EntityProps}, keyboard_events_provider::{KeyboardEventsProvider, NO_KEYBOARD_EVENTS}, locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::save_pressure_plate_states};

pub struct World {
    pub id: u32,
    pub revision: u32,
    pub total_elapsed_time: f32,
    pub bounds: IntRect,
    pub visible_bounds: IntRect,
    pub biome_tiles: TileSet<BiomeTile>,
    pub constructions_tiles: TileSet<ConstructionTile>,
    pub entities: RefCell<Vec<Entity>>,    
    pub renderable_entities: HashSet<(usize, u32)>,
    pub updatable_entities: HashSet<(usize, u32)>,
    pub cached_hero_props: EntityProps,
    pub hitmap: Hitmap,
    pub tiles_hitmap: Hitmap,
    pub weights_map: WeightsMap,
    pub entities_map: EntityIdsMap,
    pub creative_mode: bool,
    pub direction_based_on_current_keys: Direction,
    pub is_any_arrow_key_down: bool,
    pub has_attack_key_been_pressed: bool,
    pub has_confirmation_key_been_pressed: bool,
    pub creep_spawn_enabled: bool,
    pub creep_spawn_interval: f32,
    pub default_biome: Biome,
    pub pressure_plate_down_red: bool,
    pub pressure_plate_down_green: bool,
    pub pressure_plate_down_blue: bool,
    pub pressure_plate_down_silver: bool,
    pub pressure_plate_down_yellow: bool,
}

impl World {
    pub fn new(id: u32) -> Self {
        Self {
            id,
            revision: 0,
            total_elapsed_time: 0.0,
            bounds: IntRect::square_from_origin(150),
            visible_bounds: IntRect::square_from_origin(150),
            biome_tiles: TileSet::empty(),
            constructions_tiles: TileSet::empty(),
            entities: RefCell::new(vec![]),
            renderable_entities: hash_set![],
            updatable_entities: hash_set![],
            cached_hero_props: EntityProps::default(),
            hitmap: vec![vec![false; WORLD_SIZE_COLUMNS]; WORLD_SIZE_ROWS],
            tiles_hitmap: vec![vec![false; WORLD_SIZE_COLUMNS]; WORLD_SIZE_ROWS],
            weights_map: vec![vec![0; WORLD_SIZE_COLUMNS]; WORLD_SIZE_ROWS],
            entities_map: vec![vec![0; WORLD_SIZE_COLUMNS]; WORLD_SIZE_ROWS],
            creative_mode: false,
            direction_based_on_current_keys: Direction::Unknown,
            is_any_arrow_key_down: false,
            has_attack_key_been_pressed: false,
            has_confirmation_key_been_pressed: false,
            creep_spawn_enabled: false,
            creep_spawn_interval: 5.0,
            default_biome: Biome::Nothing,
            pressure_plate_down_red: false,
            pressure_plate_down_green: false,
            pressure_plate_down_blue: false,
            pressure_plate_down_silver: false,
            pressure_plate_down_yellow: false,
        }
    }

    pub fn add_entity(&mut self, entity: Entity) -> (usize, u32) {
        let id = entity.id;
        let mut entities = self.entities.borrow_mut();        
        entities.push(entity);
        let new_index = entities.len() - 1;
        entities[new_index].setup(self.creative_mode);
        (new_index, id)
    }

    fn remove_entity_by_id(&mut self, id: u32) {
        if id != HERO_ENTITY_ID {
            if let Some(index) = self.index_for_entity(id) {
                self.remove_entity_at_index(index);
            }
        }
    }

    fn remove_entity_at_index(&mut self, index: usize) {
        self.entities.borrow_mut().swap_remove(index);
    }

    fn index_for_entity(&self, id: u32) -> Option<usize> {
        self.entities.borrow().iter()
            .enumerate()
            .find(|(_, entity)|{ entity.id == id })
            .map(|(index, _)| index)
    }

    pub fn update_rl(
        &mut self, 
        time_since_last_update: f32,
        viewport: &IntRect,
        keyboard: &KeyboardEventsProvider
    ) -> Vec<EngineStateUpdate> {
        self.total_elapsed_time += time_since_last_update;
        self.direction_based_on_current_keys = keyboard.direction_based_on_current_keys(self.cached_hero_props.direction);
        self.is_any_arrow_key_down = keyboard.is_any_arrow_key_down();
        self.has_attack_key_been_pressed = keyboard.has_attack_key_been_pressed;
        self.has_confirmation_key_been_pressed = keyboard.has_confirmation_been_pressed;

        let mut entities = self.entities.borrow_mut();

        let state_updates: Vec<WorldStateUpdate> = self.updatable_entities.iter()
            .flat_map(|(index, _)| {
                if let Some(entity) = entities.get_mut(*index) {
                    entity.update(self, time_since_last_update)
                } else {
                    vec![]
                }                
            })
            .collect();

        self.biome_tiles.update(time_since_last_update);

        drop(entities);
        let updates = self.apply_state_updates(state_updates);
        self.updatable_entities = self.compute_updatable_entities(viewport);
        self.renderable_entities = self.compute_renderable_entities(viewport);
        self.update_hitmaps();
        updates
    } 

    pub fn apply_state_updates(&mut self, updates: Vec<WorldStateUpdate>) -> Vec<EngineStateUpdate> {
        updates.into_iter().filter_map(|u| self.apply_state_update(u)).collect()
    }

    pub fn default_tile(&self) -> BiomeTile {
        let mut tile = BiomeTile {
            tile_type: self.default_biome,
            tile_up_type: self.default_biome,
            tile_right_type: self.default_biome,
            tile_down_type: self.default_biome,
            tile_left_type: self.default_biome,
            texture_offset_x: 0,
            texture_offset_y: 0
        };
        tile.setup_neighbors(self.default_biome, self.default_biome, self.default_biome, self.default_biome);
        tile
    }

    fn log_update(&self, update: &WorldStateUpdate) {
        match update {
            WorldStateUpdate::EngineUpdate(_) => {},
            WorldStateUpdate::CacheHeroProps(_) => {},
            _ => println!("World update: {:#?}", update)
        }        
    }

    fn apply_state_update(&mut self, update: WorldStateUpdate) -> Option<EngineStateUpdate> {
        self.log_update(&update);

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
            WorldStateUpdate::RenameEntity(id, new_name) => {
                self.rename_entity(id, new_name)
            }
            WorldStateUpdate::ToggleDemandAttention(id) => {
                self.toggle_demand_attention(id)
            }
            WorldStateUpdate::UseItem(species_id) => {
                self.use_item(species_id)
            }
            WorldStateUpdate::CacheHeroProps(props) => { 
                self.cached_hero_props = *props; 
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
                return Some(update)
            }
            WorldStateUpdate::UpdateDestinationWorld(entity_id, world) => {
                self.change_destination_world(entity_id, world)
            }
            WorldStateUpdate::UpdateDestinationX(entity_id, x) => {
                self.change_destination_x(entity_id, x)
            }
            WorldStateUpdate::UpdateDestinationY(entity_id, y) => {
                self.change_destination_y(entity_id, y)
            }
            WorldStateUpdate::HandleHit(bullet_id, target_id) => {
                self.handle_hit(bullet_id, target_id)
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
                save_pressure_plate_states(self)
            }
        };
        None
    }

    fn handle_hit(&mut self, bullet_id: EntityId, target_id: EntityId) {
        let mut did_hit = false;
        let mut entities = self.entities.borrow_mut();

        if let Some(target) = entities.iter_mut().find(|e| e.id == target_id) {    
            if !target.is_dying && !target.is_invulnerable {
                did_hit = true;
                target.direction = Direction::Unknown;
                target.current_speed = 0.0;
                target.is_rigid = false;
                target.is_dying = true;
                target.remaining_lifespan = 10.0 / ANIMATIONS_FPS;                
                target.frame = IntRect::new(target.frame.x, target.frame.y, 1, 1).offset_y(if target.frame.h > 1 { 1 } else { 0 });
                target.sprite = AnimatedSprite::new(
                    SPRITE_SHEET_ANIMATED_OBJECTS, 
                    IntRect::new(0, 10, 1, 1), 
                    5
                );
            }
        }
        drop(entities);

        if did_hit {
            self.remove_entity_by_id(bullet_id)
        }
    }

    fn stop_hero_movement(&mut self) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == HERO_ENTITY_ID) {            
            entity.offset = Vector2d::zero();
            entity.current_speed = 0.0;
        }
    }

    fn toggle_demand_attention(&mut self, id: u32) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            entity.demands_attention = !entity.demands_attention
        }
    }

    fn rename_entity(&mut self, id: u32, name: String) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            entity.name = name;
        }
    }

    fn change_lock(&mut self, id: u32, lock_type: LockType) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            entity.lock_type = lock_type;
        }
    }

    fn change_destination_world(&mut self, id: u32, world: u32) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            if let Some(destination) = entity.destination.as_mut() {
                destination.world = world;
            }
        }
    }

    fn change_destination_x(&mut self, id: u32, x: i32) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            if let Some(destination) = entity.destination.as_mut() {
                destination.x = x;
            }
        }
    }

    fn change_destination_y(&mut self, id: u32, y: i32) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            if let Some(destination) = entity.destination.as_mut() {
                destination.y = y;
            }
        }
    }

    fn update_biome_tile(&mut self, row: usize, col: usize, new_biome: Biome) {
        self.biome_tiles.update_tile(row, col, new_biome);
        self.update_tiles_hitmap();
    }

    fn update_construction_tile(&mut self, row: usize, col: usize, new_construction: Construction) {
        self.constructions_tiles.update_tile(row, col, new_construction);
        self.update_tiles_hitmap();
    }  
    
    pub fn find_teleporter_for_destination(&self, destination_world: u32) -> Option<IntRect> {
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


    pub fn is_hero_on_slippery_surface(&self) -> bool {
        let frame = self.cached_hero_props.hittable_frame;
        
        if self.biome_tiles.tiles.len() > frame.y as usize {
            let tile = self.biome_tiles.tiles[frame.y as usize][frame.x as usize].tile_type;
            matches!(tile, Biome::Ice)
        } else {
            false
        }
    }

    pub fn is_hero_around_and_on_collision_with(&self, target: &IntRect) -> bool {
        let hero = self.cached_hero_props.hittable_frame;
        let hero_direction: Direction = self.cached_hero_props.direction;        
        if !self.has_confirmation_key_been_pressed { return false }  
        
        if self.is_hero_at(target.x, target.y) {
            return true
        }
        if hero.is_around_and_pointed_at(target, &hero_direction) {
            return true 
        }
        if self.hitmap[(hero.y as usize).saturating_sub(1)][hero.x as usize] && hero.x == target.x && hero.y.saturating_sub(3) == target.y && matches!(hero_direction, Direction::Up) {
            return true
        }
        false
    }

    pub fn is_hero_at(&self, x: i32, y: i32) -> bool {
        let hero = self.cached_hero_props.hittable_frame;
        hero.x == x && hero.y == y
    }

    fn find_non_hero_entity_id_at_coords(&self, row: usize, col: usize) -> Option<(usize, u32)> {
        self.entities.borrow().iter()
            .enumerate()
            .find(|(_, entity)| {
                entity.species_id != SPECIES_HERO && entity.frame.contains_or_touches_tile(col as i32, row as i32)
            })
            .map(|(index, e)| (index, e.id))
    }

    fn remove_entities_by_coords(&mut self, row: usize, col: usize) {
        while let Some((index, _)) = self.find_non_hero_entity_id_at_coords(row, col) {
            self.remove_entity_at_index(index)
        }      
    }
}

impl Debug for World {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Game")
            .field("bounds", &self.bounds)
            .field("entities", &self.entities)
            .finish()
    }
}

impl World {        
    pub fn update(&mut self, time_since_last_update: f32) -> Vec<EngineStateUpdate> {
        let keyboard = &NO_KEYBOARD_EVENTS;
        let viewport = self.bounds;
        self.update_rl(time_since_last_update, &viewport, keyboard)
    }
}