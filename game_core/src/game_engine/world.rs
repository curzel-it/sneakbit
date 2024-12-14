use std::{cell::RefCell, cmp::Ordering, collections::HashSet, fmt::{self, Debug}};

use common_macros::hash_set;
use serde::{Deserialize, Serialize};
use crate::{constants::{ANIMATIONS_FPS, PLAYER1_ENTITY_ID, PLAYER1_INDEX, PLAYER2_ENTITY_ID, PLAYER2_INDEX, PLAYER3_ENTITY_ID, PLAYER3_INDEX, PLAYER4_ENTITY_ID, PLAYER4_INDEX, SPRITE_SHEET_ANIMATED_OBJECTS}, entities::{bullets::{BulletHits, BulletId}, known_species::{SPECIES_HERO, SPECIES_KUNAI}, species::{species_by_id, EntityType}}, equipment::basics::{available_weapons, is_equipped}, features::{animated_sprite::AnimatedSprite, cutscenes::CutScene, destination::Destination, light_conditions::LightConditions}, game_engine::entity::is_player, is_creative_mode, maps::{biome_tiles::{Biome, BiomeTile}, constructions_tiles::{Construction, ConstructionTile}, tiles::TileSet}, utils::{directions::Direction, rect::IntRect, vector::Vector2d}};

use super::{entity::{Entity, EntityId, EntityProps}, keyboard_events_provider::{KeyboardEventsProvider, NO_KEYBOARD_EVENTS}, locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{has_boomerang_skill, has_bullet_catcher_skill, has_piercing_knife_skill, increment_inventory_count, lock_override, save_lock_override, set_value_for_key, StorageKey}};

#[derive(Clone)]
pub struct World {
    pub id: u32,
    pub revision: u32,
    pub bounds: IntRect,
    pub biome_tiles: TileSet<BiomeTile>,
    pub constructions_tiles: TileSet<ConstructionTile>,
    pub entities: RefCell<Vec<Entity>>,    
    pub visible_entities: Vec<(usize, u32)>,
    melee_attackers: HashSet<u32>,
    buildings: HashSet<u32>,
    pub ephemeral_state: bool,
    pub players: Vec<PlayerProps>,
    pub has_confirmation_key_been_pressed_by_anyone: bool,
    pub is_any_arrow_key_down: bool,
    pub hitmap: Hitmap,
    pub tiles_hitmap: Hitmap,
    pub weights_map: Hitmap,
    pub idsmap: EntityIdsMap,
    pub world_type: WorldType,
    pub pressure_plate_down_red: bool,
    pub pressure_plate_down_green: bool,
    pub pressure_plate_down_blue: bool,
    pub pressure_plate_down_silver: bool,
    pub pressure_plate_down_yellow: bool,
    pub spawn_point: (i32, i32),
    pub light_conditions: LightConditions,
    pub soundtrack: Option<String>,
    pub cutscenes: Vec<CutScene>,
}

const WORLD_SIZE_COLUMNS: usize = 30;
const WORLD_SIZE_ROWS: usize = 30;

#[derive(Clone)]
pub struct Hitmap {
    bits: Vec<bool>,
    width: usize,
}

pub type EntityIdsMap = Vec<(i32, i32, EntityId)>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum WorldType {
    HouseInterior,
    Dungeon,
    Exterior
}

impl World {
    pub fn new(id: u32) -> Self {
        Self {
            id,
            revision: 0,
            bounds: IntRect::from_origin(WORLD_SIZE_COLUMNS as i32, WORLD_SIZE_ROWS as i32),
            biome_tiles: TileSet::empty(),
            constructions_tiles: TileSet::empty(),
            entities: RefCell::new(vec![]),
            visible_entities: vec![],
            ephemeral_state: false,
            players: vec![PlayerProps::new(0), PlayerProps::new(1), PlayerProps::new(2), PlayerProps::new(3)],
            has_confirmation_key_been_pressed_by_anyone: false,
            is_any_arrow_key_down: false,
            hitmap: Hitmap::new(WORLD_SIZE_COLUMNS, WORLD_SIZE_ROWS),
            tiles_hitmap: Hitmap::new(WORLD_SIZE_COLUMNS, WORLD_SIZE_ROWS),
            weights_map: Hitmap::new(WORLD_SIZE_COLUMNS, WORLD_SIZE_ROWS),
            idsmap: vec![],
            world_type: WorldType::HouseInterior,
            pressure_plate_down_red: false,
            pressure_plate_down_green: false,
            pressure_plate_down_blue: false,
            pressure_plate_down_silver: false,
            pressure_plate_down_yellow: false,
            melee_attackers: hash_set![],
            buildings: hash_set![],
            light_conditions: LightConditions::Day,
            cutscenes: vec![],
            spawn_point: (0, 0),
            soundtrack: None
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
        if entities[index].melee_attacks_hero() {
            self.melee_attackers.insert(id);
        }
        if matches!(entities[index].entity_type, EntityType::Building) {
            self.buildings.insert(id);
        }
        true
    }

    pub fn remove_players(&mut self) {
        if let Some(index) = self.index_for_entity(PLAYER1_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
        if let Some(index) = self.index_for_entity(PLAYER2_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
        if let Some(index) = self.index_for_entity(PLAYER3_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
        if let Some(index) = self.index_for_entity(PLAYER4_ENTITY_ID) {
            self.remove_entity_at_index(index);
        }
    }

    pub fn remove_all_equipment(&mut self) {
        let equipment_ids: Vec<u32> = self.entities.borrow().iter().filter_map(|e| {
            if e.is_equipment() {
                Some(e.id)
            } else {
                None
            }
        })
        .collect();
    
        equipment_ids.into_iter().for_each(|id| self.remove_entity_by_id(id));
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

    fn mark_as_collected_if_needed(&self, entity_id: u32, parent_id: u32) {
        if !self.ephemeral_state && !is_player(entity_id) && !is_player(parent_id) {
            set_value_for_key(&StorageKey::item_collected(entity_id), 1);
        }
    }

    fn remove_entity_at_index(&mut self, index: usize) {
        let entities = self.entities.borrow();
        let entity = &entities[index];

        if entity.melee_attacks_hero() {
            self.melee_attackers.remove(&entity.id);
        }
        if matches!(entity.entity_type, EntityType::Building) {
            self.buildings.remove(&entity.id);
        }
        self.mark_as_collected_if_needed(entity.id, entity.parent_id);
        drop(entities);

        self.entities.borrow_mut().swap_remove(index);
    }

    fn index_for_entity(&self, id: u32) -> Option<usize> {
        self.entities.borrow().iter()
            .enumerate()
            .find(|(_, entity)|{ entity.id == id })
            .map(|(index, _)| index)
    }

    pub fn direction_based_on_current_keys_for_player_by_entity_id(&self, entity_id: u32) -> Direction {
        if let Some(index) = self.player_index_by_entity_id(entity_id) {
            self.players[index].direction_based_on_current_keys
        } else {
            Direction::Unknown
        }        
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

    pub fn update(
        &mut self, 
        time_since_last_update: f32,
        viewport: &IntRect,
        keyboard: &KeyboardEventsProvider
    ) -> Vec<EngineStateUpdate> {
        self.players[0].update(keyboard);
        self.players[1].update(keyboard);
        self.players[2].update(keyboard);
        self.players[3].update(keyboard);
        self.has_confirmation_key_been_pressed_by_anyone = keyboard.has_confirmation_been_pressed_by_anyone();
        self.is_any_arrow_key_down = keyboard.is_any_arrow_key_down_for_anyone();
        self.biome_tiles.update(time_since_last_update);

        let mut engine_updates: Vec<EngineStateUpdate> = vec![];
        engine_updates.extend(self.update_hero(time_since_last_update));
        engine_updates.extend(self.update_entities(time_since_last_update));
        engine_updates.extend(self.update_cutscenes(time_since_last_update));

        self.update_visible_entities(viewport);
        self.update_hitmaps();
        engine_updates
    }

    fn update_hero(&mut self, time_since_last_update: f32) -> Vec<EngineStateUpdate> { 
        let mut entities = self.entities.borrow_mut();

        if let Some(hero) = entities.get_mut(0) {
            let hero_updates = hero.update(self, time_since_last_update);
            _ = hero;
            drop(entities);
            self.apply_state_updates(hero_updates)
        } else {
            vec![]
        }
    }

    fn update_entities(&mut self, time_since_last_update: f32) -> Vec<EngineStateUpdate> { 
        let mut entities = self.entities.borrow_mut();
        let mut updates: Vec<WorldStateUpdate> = vec![];

        for &(index, _) in &self.visible_entities {
            if index == 0 { continue }
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

    fn log_update(&self, update: &WorldStateUpdate) {
        match update {
            WorldStateUpdate::EngineUpdate(_) => {},
            WorldStateUpdate::CacheHeroProps(_) => {},
            _ => println!("World update: {:#?}", update)
        }        
    }

    fn apply_state_update(&mut self, update: WorldStateUpdate) -> Vec<EngineStateUpdate> {
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

    fn kill_with_animation(&self, target: &mut Entity) {
        target.direction = Direction::Unknown;
        target.current_speed = 0.0;
        target.is_rigid = false;
        target.is_dying = true;
        target.remaining_lifespan = 10.0 / ANIMATIONS_FPS;                
        target.frame = target.hittable_frame(); 
        target.sprite = AnimatedSprite::new(
            SPRITE_SHEET_ANIMATED_OBJECTS, 
            IntRect::new(0, 10, 1, 1), 
            5
        );
        self.mark_as_collected_if_needed(target.id, target.parent_id);
    }

    fn handle_hits(&mut self, hits: &BulletHits) -> Vec<EngineStateUpdate> {
        let mut updates: Vec<EngineStateUpdate> = vec![];
        let mut bullet_expended = false;
        let mut entities = self.entities.borrow_mut();

        let targets = entities.iter_mut().filter(|e| {
            hits.target_ids.contains(&e.id) && e.can_be_hit_by_bullet()
        });

        for target in targets {
            let did_kill = if target.is_player() {
                let player_died = self.handle_hero_damage(target, hits.damage);
                if player_died {
                    updates.push(EngineStateUpdate::PlayerDied(target.player_index));
                }
                false
            } else {
                self.handle_target_hit(hits.damage, hits.bullet_species_id, target)
            };
            bullet_expended = bullet_expended || did_kill;
            if did_kill {
                updates.push(EngineStateUpdate::EntityKilled(target.id, target.species_id));
            }
        }
        drop(entities);

        if bullet_expended && hits.bullet_id != 0 {
            updates.append(&mut self.handle_bullet_stopped_from_hit(hits.bullet_id, hits.supports_bullet_boomerang));
        } 
        updates
    }

    fn handle_hero_damage(&self, hero: &mut Entity, damage: f32) -> bool {
        let mut damage_reductions: Vec<f32> = available_weapons(hero.player_index)
            .iter()
            .filter_map(|s| 
                if is_equipped(s, hero.player_index) {
                    Some(s.received_damage_reduction)
                } else {
                    None
                }
            )   
            .collect();
        
        damage_reductions.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));     

        let actual_damage = damage_reductions
            .iter()
            .fold(damage, |current_damage, discount| current_damage * (1.0 - discount))
            .max(0.0);

        hero.hp -= actual_damage;
        
        if hero.hp <= 0.0 {
            self.kill_with_animation(hero);
            true
        } else {
            false
        }
    }

    fn handle_target_hit(&self, damage: f32, bullet_species_id: u32, target: &mut Entity) -> bool {
        target.hp -= damage * damage_multiplier(target.parent_id, bullet_species_id);
        
        if target.hp <= 0.0 {
            self.kill_with_animation(target);
            true
        } else {
            false
        }
    }

    fn handle_bullet_stopped(&mut self, bullet_id: BulletId) -> Vec<EngineStateUpdate> {
        let supports_bullet_boomerang = if let Some(index) = self.index_for_entity(bullet_id) {
            if let Some(entity) = self.entities.borrow().get(index) {
                species_by_id(entity.species_id).supports_bullet_boomerang
            } else {
                false
            }
        } else {
            false
        };
        self.handle_bullet_stopped_from_hit(bullet_id, supports_bullet_boomerang)
    }

    fn handle_bullet_stopped_from_hit(&mut self, bullet_id: u32, supports_bullet_boomerang: bool) -> Vec<EngineStateUpdate> {
        if has_boomerang_skill() && supports_bullet_boomerang {
            let mut entities = self.entities.borrow_mut();
            if let Some(bullet) = entities.iter_mut().find(|e| e.id == bullet_id) {
                if is_player(bullet.parent_id) {
                    bullet.direction = bullet.direction.opposite();
                    bullet.update_sprite_for_current_state();
                    let (dx, dy) = bullet.direction.as_col_row_offset();
                    bullet.frame.x += dx;
                    bullet.frame.y += dy;
                    return vec![EngineStateUpdate::BulletBounced]
                }
            }
            drop(entities);
        }
        self.remove_entity_by_id(bullet_id);
        vec![]
    }

    fn handle_bullet_catched(&mut self, bullet_id: u32) {
        if has_bullet_catcher_skill() {
            let entities = self.entities.borrow();

            if let Some(bullet) = entities.iter().find(|e| e.id == bullet_id) {
                let species_id = bullet.species_id;
                let player = bullet.player_index;
                _ = bullet;
                drop(entities);
                self.remove_entity_by_id(bullet_id);
                increment_inventory_count(species_id, player);
            }
        }
    }

    fn stop_hero_movement(&mut self) {
        self.entities
            .borrow_mut()
            .iter_mut()
            .filter(|e| e.is_player())
            .for_each(|e| {            
                e.offset = Vector2d::zero();
                e.current_speed = 0.0;
            });
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

    pub fn frame_is_slippery_surface(&self, frame: &IntRect) -> bool {
        self.is_slippery_surface(frame.x as usize, frame.y as usize)
    }

    pub fn is_hero_around_and_on_collision_with(&self, target: &IntRect) -> bool {
        let hero = self.players[0].props.hittable_frame;
        let hero_direction: Direction = self.players[0].props.direction;        
        
        if self.is_any_hero_at(target.x, target.y) {
            return true
        }
        if target.is_around_and_pointed_at(&hero.origin(), &hero_direction) {
            return true 
        }
        if self.hits(hero.x, hero.y - 1) && hero.x == target.x && hero.y.saturating_sub(3) == target.y && matches!(hero_direction, Direction::Up) {
            return true
        }
        false
    }

    pub fn index_of_player_at(&self, x: i32, y: i32) -> Option<usize> {
        for p in &self.players {
            if p.props.hittable_frame.x == x && p.props.hittable_frame.y == y {
                return Some(p.index)
            }
        }
        None
    }
    
    pub fn entity_ids_of_all_players_at(&self, x: i32, y: i32) -> Vec<u32> { 
        self.index_of_all_players_at(x, y)
            .into_iter()
            .filter_map(|i| self.player_entity_id_by_index(i)) 
            .collect()
    }

    fn player_entity_id_by_index(&self, index: usize) -> Option<u32> {
        match index {
            PLAYER1_INDEX => Some(PLAYER1_ENTITY_ID),
            PLAYER2_INDEX => Some(PLAYER2_ENTITY_ID),
            PLAYER3_INDEX => Some(PLAYER3_ENTITY_ID),
            PLAYER4_INDEX => Some(PLAYER4_ENTITY_ID),
            _ => None
        }
    }

    fn index_of_all_players_at(&self, x: i32, y: i32) -> Vec<usize> {
        self.players.iter().filter_map(|p| {
            if p.props.hittable_frame.x == x && p.props.hittable_frame.y == y {
                Some(p.index)
            } else {
                None
            }
        })
        .collect()
    }

    pub fn is_any_hero_at(&self, x: i32, y: i32) -> bool {
        for p in &self.players {
            if p.props.hittable_frame.x == x && p.props.hittable_frame.y == y {
                return true
            }
        }
        false
    }

    fn find_non_hero_entity_at_coords(&self, row: usize, col: usize) -> Option<(usize, u32)> {
        self.entities.borrow().iter()
            .enumerate()
            .find(|(_, entity)| {
                entity.species_id != SPECIES_HERO && entity.frame.contains_or_touches_tile(col as i32, row as i32)
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

    pub fn hits(&self, x: i32, y: i32) -> bool {
        if x < 0 || y < 0 || y >= self.bounds.h || x >= self.bounds.w { 
            false 
        } else { 
            let x = x as usize;
            let y = y as usize;
            self.hitmap.hits(x, y) || self.tiles_hitmap.hits(x, y) 
        }
    }

    pub fn hits_or_out_of_bounds(&self, x: i32, y: i32) -> bool {
        x < 0 || y < 0 || self.hits(x, y)
    }

    pub fn entity_ids(&self, x: i32, y: i32) -> Vec<u32> {
        self.idsmap
            .iter()
            .filter_map(|&(ex, ey, id)| {
                if ex == x && ey == y {
                    Some(id)
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn has_weight(&self, x: i32, y: i32) -> bool {
        if x < 0 || y < 0 || y >= self.bounds.h || x >= self.bounds.w { 
            false 
        } else { 
            self.weights_map.hits(x as usize, y as usize) 
        }
    }

    pub fn is_creep(&self, id: u32) -> bool {
        self.melee_attackers.contains(&id)
    }

    pub fn is_building(&self, id: &u32) -> bool {
        self.buildings.contains(id)
    }

    pub fn contains_building(&self, ids: &[u32]) -> bool {
        ids.iter().any(|id| self.is_building(id))
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
    
    pub fn update_visible_entities(&mut self, viewport: &IntRect) {
        self.visible_entities.clear();

        let min_row = viewport.y - 1;
        let max_row = viewport.y + viewport.h + 1;
        let min_col = viewport.x - 1;
        let max_col = viewport.x + viewport.w + 1;

        let entities = self.entities.borrow();

        for (index, entity) in entities.iter().enumerate() {
            let is_visible = index == 0 || {
                let frame = entity.frame;
                let frame_y = frame.y;
                let frame_x = frame.x;
                let max_y = frame_y + frame.h;
                let max_x = frame_x + frame.w;
                max_y >= min_row && frame_y <= max_row && max_x >= min_col && frame_x <= max_col
            };

            if is_visible {
                self.visible_entities.push((index, entity.id));
            }
        }
    }

    pub fn update_hitmaps(&mut self) {
        self.hitmap.clear();
        self.weights_map.clear();
        self.idsmap.clear();
        
        let entities = self.entities.borrow();
        let height = self.bounds.h as usize;
        let width = self.bounds.w as usize;

        for &(index, id) in &self.visible_entities {
            let entity = &entities[index];
            let is_rigid = entity.is_rigid && !is_player(id);
            let has_weight = entity.has_weight();

            if !is_rigid && !has_weight {
                continue;
            }

            let hittable_frame = entity.hittable_frame();

            let col_start = hittable_frame.x.max(0) as usize;
            let col_end = ((hittable_frame.x + hittable_frame.w) as usize).min(width);
            let row_start = hittable_frame.y.max(0) as usize;
            let row_end = ((hittable_frame.y + hittable_frame.h) as usize).min(height);

            for y in row_start..row_end {
                for x in col_start..col_end {
                    if is_rigid {
                        self.hitmap.set(x, y, true);
                    }
                    if has_weight {
                        self.weights_map.set(x, y, true);
                    }
                    self.idsmap.push((x as i32, y as i32, id));
                }
            }
        }
        
    }

    #[allow(clippy::needless_range_loop)] 
    pub fn update_tiles_hitmap(&mut self) {    
        self.weights_map = Hitmap::new(self.bounds.w as usize, self.bounds.h as usize);
        self.tiles_hitmap = Hitmap::new(self.bounds.w as usize, self.bounds.h as usize);
        self.hitmap = Hitmap::new(self.bounds.w as usize, self.bounds.h as usize);

        if is_creative_mode() || self.biome_tiles.tiles.is_empty() {
            return;
        }

        let min_row = self.bounds.y as usize;
        let max_row = ((self.bounds.y + self.bounds.h) as usize).min(self.biome_tiles.tiles.len());
        let min_col = self.bounds.x as usize;
        let max_col = ((self.bounds.x + self.bounds.w) as usize).min(self.biome_tiles.tiles[0].len());

        for row in min_row..max_row {
            for col in min_col..max_col {
                if !self.tiles_hitmap.hits(col, row) {
                    let biome = &self.biome_tiles.tiles[row][col];
                    let constructions = &self.constructions_tiles.tiles[row][col];
                    let is_obstacle = (biome.is_obstacle() || constructions.is_obstacle()) && !constructions.is_bridge();

                    if is_obstacle {
                        self.tiles_hitmap.set(col, row, true);
                    }
                }
            }
        }
    }

    pub fn index_of_any_player_who_is_pressing_confirm(&self) -> Option<usize> {
        for player in &self.players {
            if player.has_confirmation_key_been_pressed {
                return Some(player.index)
            }
        }
        None
    }
}

impl Entity {
    fn has_weight(&self) -> bool {
        !matches!(self.entity_type, EntityType::PressurePlate | EntityType::Gate | EntityType::InverseGate | EntityType::WeaponMelee | EntityType::WeaponRanged)
    }
}

impl Hitmap {
    fn new(width: usize, height: usize) -> Self {
        Hitmap {
            bits: vec![false; width * height],
            width,
        }
    }

    fn clear(&mut self) {
        self.bits = vec![false; self.bits.len()];
    }

    fn get_index(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    fn hits(&self, x: usize, y: usize) -> bool {
        let index = self.get_index(x, y);
        self.bits[index]
    }

    fn set(&mut self, x: usize, y: usize, value: bool) {
        let index = self.get_index(x, y);
        self.bits[index] = value;
    }
}

impl Debug for Hitmap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for y in 0..(self.bits.len() / self.width) {
            for x in 0..self.width {
                let bit = if self.hits(x, y) { '1' } else { '0' };
                write!(f, "{}", bit)?;
            }
            writeln!(f)?; 
        }
        Ok(())
    }
}

#[derive(Clone, Default, Debug)]
pub struct PlayerProps {
    pub index: usize,
    pub direction_based_on_current_keys: Direction,
    pub is_any_arrow_key_down: bool,
    pub has_ranged_attack_key_been_pressed: bool,
    pub has_close_attack_key_been_pressed: bool,
    pub has_confirmation_key_been_pressed: bool,
    pub props: EntityProps
}

impl PlayerProps {
    fn new(index: usize) -> Self {
        Self {
            index,
            direction_based_on_current_keys: Direction::Unknown,
            is_any_arrow_key_down: false,
            has_ranged_attack_key_been_pressed: false,
            has_close_attack_key_been_pressed: false,
            has_confirmation_key_been_pressed: false,
            props: EntityProps::default()
        }
    }

    fn update(&mut self, keyboard: &KeyboardEventsProvider) {
        self.direction_based_on_current_keys = keyboard.direction_based_on_current_keys(self.index, self.props.direction);
        self.is_any_arrow_key_down = keyboard.is_any_arrow_key_down(self.index);
        self.has_ranged_attack_key_been_pressed = keyboard.has_ranged_attack_key_been_pressed(self.index);
        self.has_close_attack_key_been_pressed = keyboard.has_close_attack_key_been_pressed(self.index);
        self.has_confirmation_key_been_pressed = keyboard.has_confirmation_been_pressed(self.index);
    }
}

fn damage_multiplier(parent_id: u32, bullet_species_id: u32) -> f32 {
    if is_player(parent_id) && matches!(bullet_species_id, SPECIES_KUNAI) && has_piercing_knife_skill() {
        2.0
    } else {
        1.0
    }
}