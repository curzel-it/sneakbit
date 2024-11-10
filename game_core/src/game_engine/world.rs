use std::{cell::RefCell, cmp::Ordering, collections::HashSet, fmt::{self, Debug}};

use common_macros::hash_set;
use crate::{constants::{ANIMATIONS_FPS, HERO_ENTITY_ID, SPRITE_SHEET_ANIMATED_OBJECTS}, entities::{known_species::SPECIES_HERO, species::EntityType}, features::{animated_sprite::AnimatedSprite, cutscenes::CutScene, destination::Destination, hitmap::{EntityIdsMap, Hitmap, WeightsMap}, light_conditions::LightConditions}, maps::{biome_tiles::{Biome, BiomeTile}, constructions_tiles::{Construction, ConstructionTile}, tiles::TileSet}, utils::{directions::Direction, rect::IntRect, vector::Vector2d}};

use super::{entity::{Entity, EntityId, EntityProps}, inventory::add_to_inventory, keyboard_events_provider::{KeyboardEventsProvider, NO_KEYBOARD_EVENTS}, locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{has_boomerang_skill, has_bullet_catcher_skill, has_piercing_bullet_skill, lock_override, save_lock_override}};

#[derive(Clone)]
pub struct World {
    pub id: u32,
    pub revision: u32,
    pub total_elapsed_time: f32,
    pub bounds: IntRect,
    pub biome_tiles: TileSet<BiomeTile>,
    pub constructions_tiles: TileSet<ConstructionTile>,
    pub entities: RefCell<Vec<Entity>>,    
    pub visible_entities: HashSet<(usize, u32)>,
    melee_attackers: HashSet<u32>,
    buildings: HashSet<u32>,
    pub ephemeral_state: bool,
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
    pub default_biome: Biome,
    pub pressure_plate_down_red: bool,
    pub pressure_plate_down_green: bool,
    pub pressure_plate_down_blue: bool,
    pub pressure_plate_down_silver: bool,
    pub pressure_plate_down_yellow: bool,
    pub light_conditions: LightConditions,
    pub cutscenes: Vec<CutScene>,
}

const WORLD_SIZE_COLUMNS: usize = 30;
const WORLD_SIZE_ROWS: usize = 30;

impl World {
    pub fn new(id: u32) -> Self {
        Self {
            id,
            revision: 0,
            total_elapsed_time: 0.0,
            bounds: IntRect::from_origin(WORLD_SIZE_COLUMNS as i32, WORLD_SIZE_ROWS as i32),
            biome_tiles: TileSet::empty(),
            constructions_tiles: TileSet::empty(),
            entities: RefCell::new(vec![]),
            visible_entities: hash_set![],
            ephemeral_state: false,
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
            default_biome: Biome::Nothing,
            pressure_plate_down_red: false,
            pressure_plate_down_green: false,
            pressure_plate_down_blue: false,
            pressure_plate_down_silver: false,
            pressure_plate_down_yellow: false,
            melee_attackers: hash_set![],
            buildings: hash_set![],
            light_conditions: LightConditions::Day,
            cutscenes: vec![],
        }
    }

    pub fn add_entity(&mut self, entity: Entity) -> (usize, u32) {
        let id = entity.id;

        if !entity.should_be_visible(self) {
            return (0, 0)
        }

        let mut entities = self.entities.borrow_mut();        
        let new_index = entities.len();
        entities.push(entity);        

        entities[new_index].setup(self.creative_mode);        

        if let Some(lock_type) = lock_override(&id) {
            entities[new_index].lock_type = lock_type;
        }
        if entities[new_index].melee_attacks_hero {
            self.melee_attackers.insert(id);
        }
        if matches!(entities[new_index].entity_type, EntityType::Building) {
            self.buildings.insert(id);
        }

        (new_index, id)
    }

    pub fn remove_hero(&mut self) {
        if let Some(index) = self.index_for_entity(HERO_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
    }

    fn remove_entity_by_id(&mut self, id: u32) {
        if id != HERO_ENTITY_ID {
            if let Some(index) = self.index_for_entity(id) {
                self.remove_entity_at_index(index);
            }
        }
    }

    fn remove_entity_at_index(&mut self, index: usize) {
        let entities = self.entities.borrow();
        let entity = &entities[index];
        
        if entity.melee_attacks_hero {
            self.melee_attackers.remove(&entity.id);
        }
        if matches!(entity.entity_type, EntityType::Building) {
            self.buildings.remove(&entity.id);
        }
        drop(entities);

        self.entities.borrow_mut().swap_remove(index);
    }

    fn index_for_entity(&self, id: u32) -> Option<usize> {
        self.entities.borrow().iter()
            .enumerate()
            .find(|(_, entity)|{ entity.id == id })
            .map(|(index, _)| index)
    }

    pub fn update(
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

        self.biome_tiles.update(time_since_last_update);

        let mut entities = self.entities.borrow_mut();

        let entity_state_updates: Vec<WorldStateUpdate> = self.visible_entities.iter()
            .flat_map(|(index, _)| {
                if let Some(entity) = entities.get_mut(*index) {
                    entity.update(self, time_since_last_update)
                } else {
                    vec![]
                }                
            })
            .collect();
        drop(entities);

        let cutscene_state_updates: Vec<WorldStateUpdate> = self.cutscenes.iter_mut()
            .flat_map(|c| 
                c.update(&self.cached_hero_props.hittable_frame, time_since_last_update)
            )
            .collect();

        let mut engine_updates = self.apply_state_updates(entity_state_updates);
        let cutscene_engine_updates = self.apply_state_updates(cutscene_state_updates);
        engine_updates.extend(cutscene_engine_updates);

        self.visible_entities = self.compute_visible_entities(viewport);
        self.update_hitmaps();
        engine_updates
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
            WorldStateUpdate::HandleBulletStopped(bullet_id) => {
                self.handle_bullet_stopped(bullet_id)
            }
            WorldStateUpdate::HandleBulletCatched(bullet_id) => {
                self.handle_bullet_catched(bullet_id)
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
            }
        };
        None
    }

    fn handle_hit(&mut self, bullet_id: EntityId, target_id: EntityId) {
        let mut did_hit = false;

        let mut entities = self.entities.borrow_mut();
        if let Some(target) = entities.iter_mut().find(|e| e.id == target_id) {    
            let is_vulnerable = !target.is_invulnerable || (has_piercing_bullet_skill() && target.melee_attacks_hero);

            if !target.is_dying && is_vulnerable && target.parent_id != HERO_ENTITY_ID {
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

        if did_hit && bullet_id != 0 && !has_piercing_bullet_skill() {
            self.handle_bullet_stopped(bullet_id);
        }
    }

    fn handle_bullet_stopped(&mut self, bullet_id: u32) {
        if has_boomerang_skill() {
            let mut entities = self.entities.borrow_mut();
            if let Some(bullet) = entities.iter_mut().find(|e| e.id == bullet_id) {
                if bullet.parent_id == HERO_ENTITY_ID {
                    bullet.direction = bullet.direction.opposite();
                    let (dx, dy) = bullet.direction.as_col_row_offset();
                    bullet.frame.x += dx;
                    bullet.frame.y += dy;
                    return
                }
            }
            drop(entities);
        }
        self.remove_entity_by_id(bullet_id)
    }

    fn handle_bullet_catched(&mut self, bullet_id: u32) {
        if has_bullet_catcher_skill() {
            let species_id = self.entities.borrow().iter().find(|e| e.id == bullet_id).and_then(|e| Some(e.species_id));
            self.remove_entity_by_id(bullet_id);

            if let Some(species_id) = species_id {
                add_to_inventory(&species_id, 1);
            }
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
            save_lock_override(&entity.id, &lock_type);
        }
    }

    fn change_destination_world(&mut self, id: u32, world: u32) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            if let Some(destination) = entity.destination.as_mut() {
                destination.world = world;
            } else {
                entity.destination = Some(Destination::new(world, 0, 0));
            }
        }
    }

    fn change_destination_x(&mut self, id: u32, x: i32) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            if let Some(destination) = entity.destination.as_mut() {
                destination.x = x;
            } else {
                entity.destination = Some(Destination::new(0, x, 0));
            }
        }
    }

    fn change_destination_y(&mut self, id: u32, y: i32) {
        let mut entities = self.entities.borrow_mut();
        if let Some(entity) = entities.iter_mut().find(|e| e.id == id) {
            if let Some(destination) = entity.destination.as_mut() {
                destination.y = y;
            } else {
                entity.destination = Some(Destination::new(0, 0, y));
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

    pub fn find_any_teleporter(&self) -> Option<IntRect> {
        let entities = self.entities.borrow();
        let mut teleporters: Vec<&Entity> = entities.iter().filter(|t| matches!(t.entity_type, EntityType::Teleporter)).collect();
        
        teleporters.sort_by(|a, b| {
            if let Some(dest_a) = a.destination.clone() {
                if let Some(dest_b) = b.destination.clone() {
                    if dest_a.world < dest_b.world { return Ordering::Less }
                    if dest_a.world > dest_b.world { return Ordering::Greater }
                }
            }
            return Ordering::Equal            
        });

        if teleporters.len() > 0 {
            Some(teleporters[0].frame)
        } else {
            None
        }
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
    pub fn update_no_input(&mut self, time_since_last_update: f32) -> Vec<EngineStateUpdate> {
        let keyboard = &NO_KEYBOARD_EVENTS;
        let viewport = self.bounds;
        self.update(time_since_last_update, &viewport, keyboard)
    }
}

impl World {
    pub fn is_creep(&self, id: u32) -> bool {
        self.melee_attackers.contains(&id)
    }

    pub fn is_building(&self, id: u32) -> bool {
        self.buildings.contains(&id)
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
}