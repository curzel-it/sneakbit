use serde::{Deserialize, Serialize};

use crate::{constants::{ANIMATIONS_FPS, NO_PARENT, PLAYER1_ENTITY_ID, PLAYER1_INDEX, PLAYER2_ENTITY_ID, PLAYER2_INDEX, PLAYER3_ENTITY_ID, PLAYER3_INDEX, PLAYER4_ENTITY_ID, PLAYER4_INDEX, SPRITE_SHEET_ANIMATED_OBJECTS, UNLIMITED_LIFESPAN, Z_INDEX_OVERLAY, Z_INDEX_UNDERLAY}, entities::species::{species_by_id, EntityType, Species}, features::{animated_sprite::AnimatedSprite, destination::Destination, dialogues::{AfterDialogueBehavior, Dialogue, EntityDialogues}, storage::{set_value_for_key, StorageKey}}, is_creative_mode, utils::{directions::Direction, rect::FRect}, worlds::world::World};

use super::{movements::MovementDirections, fast_travel::is_fast_travel_available, locks::LockType, messages::DisplayableMessage, pvp_arena::is_pvp_arena_available, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{bool_for_global_key, key_value_matches}};

pub type EntityId = u32;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Entity {
    pub id: EntityId,
    pub frame: FRect,  
    pub species_id: u32,  
    pub direction: Direction,
    pub dialogues: EntityDialogues,
    pub destination: Option<Destination>,
    pub lock_type: LockType,
    
    #[serde(skip)]
    pub current_speed: f32,

    #[serde(skip)]
    pub entity_type: EntityType,  

    #[serde(skip)]
    pub sprite: AnimatedSprite,
    
    #[serde(skip)]
    pub original_sprite_frame: FRect,
    
    #[serde(skip)]
    pub is_rigid: bool,
    
    #[serde(skip)]
    pub z_index: i32,

    #[serde(skip)]
    pub name: String,  

    #[serde(skip)]
    pub time_immobilized: f32,

    #[serde(default)]
    pub display_conditions: Vec<DisplayCondition>,

    #[serde(skip)]
    pub movement_directions: MovementDirections,

    #[serde(skip)]
    pub hp: f32,

    #[serde(skip)]
    pub dps: f32,

    #[serde(default)]
    pub is_consumable: bool,
    
    #[serde(skip)]
    pub speed_multiplier: f32,
    
    #[serde(skip)]
    pub is_dying: bool,

    #[serde(skip)]
    pub remaining_lifespan: f32,  

    #[serde(skip)]
    pub action_cooldown_remaining: f32,  

    #[serde(skip)]
    pub parent_id: u32,  

    #[serde(skip)]
    pub is_in_interaction_range: bool,

    #[serde(skip)]
    pub is_invulnerable: bool,

    #[serde(skip)]
    pub is_equipped: bool,

    #[serde(default)]
    pub demands_attention: bool,

    #[serde(default)]
    pub after_dialogue: AfterDialogueBehavior,
    
    #[serde(skip)]
    pub sorting_key: u32,
    
    #[serde(skip)]
    pub player_index: usize,
    
    #[serde(skip)]
    pub species: Species,
    
    #[serde(skip)]
    pub reset_offset_on_next_direction_change: bool,
    
    #[serde(skip)]
    pub direction_change_cooldown: f32,
}

impl Entity {
    /*
    over/under  y   z   pushable 
            Z AAA BBB   P
    Z AAA BBB   P
    ZAAABBBP
    ZA_AAB_BBP
    10_000_000 Z
        10_000 A
            10 B
    */
    pub fn update_sorting_key(&mut self) {
        let z = if self.z_index == Z_INDEX_OVERLAY { 20_000_000 }
        else if self.z_index == Z_INDEX_UNDERLAY { 0 }
        else { 10_000_000 };

        let a = 10_000 * (self.frame.y + self.frame.h).floor() as i32;
        let b = if self.z_index != Z_INDEX_OVERLAY && self.z_index != Z_INDEX_UNDERLAY { self.z_index * 10 } else { 0 };
        let p = if matches!(self.entity_type, EntityType::PushableObject) { 1 } else { 0 };

        self.sorting_key = (z + a + b + p) as u32;
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DisplayCondition {
    pub key: String,
    pub expected_value: u32,
    pub visible: bool
}

impl Entity {
    pub fn update(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        let mut updates = match self.entity_type {
            EntityType::Hero => self.update_hero(world, time_since_last_update),
            EntityType::Npc => self.update_npc(world, time_since_last_update),
            EntityType::CloseCombatMonster => self.update_monster(world, time_since_last_update),
            EntityType::Building => self.update_building(world, time_since_last_update),
            EntityType::StaticObject => self.update_static(world, time_since_last_update),
            EntityType::PickableObject | EntityType::Bundle => self.update_pickable_object(world, time_since_last_update),
            EntityType::Teleporter => self.update_teleporter(world, time_since_last_update),
            EntityType::PushableObject => self.update_pushable(world, time_since_last_update),
            EntityType::Gate => self.update_gate(world, time_since_last_update),
            EntityType::InverseGate => self.update_inverse_gate(world, time_since_last_update),
            EntityType::PressurePlate => self.update_pressure_plate(world, time_since_last_update),
            EntityType::Bullet => self.update_bullet(world, time_since_last_update),
            EntityType::RailObject => self.update_rail(world, time_since_last_update),
            EntityType::Hint => self.update_hint(world, time_since_last_update),
            EntityType::Trail => self.update_trail(),
            EntityType::WeaponMelee => self.update_melee(world, time_since_last_update),
            EntityType::WeaponRanged => self.update_ranged(world, time_since_last_update),
            EntityType::FastTravelLink => self.update_fast_travel(world),
            EntityType::PvpArenaLink => self.update_pvp_arena(world),
        };        
        self.sprite.update(time_since_last_update); 
        updates.append(&mut self.check_remaining_lifespan(time_since_last_update));
        updates
    }

    pub fn setup(&mut self) {    
        if self.parent_id == NO_PARENT {  
            self.remaining_lifespan = UNLIMITED_LIFESPAN;
        }
        species_by_id(self.species_id).reload_props(self);
        self.update_sorting_key();
        
        match self.entity_type {
            EntityType::Hero => self.setup_hero(),
            EntityType::Npc => self.setup_npc(),
            EntityType::CloseCombatMonster => self.setup_monster(),
            EntityType::Building => self.setup_generic(),
            EntityType::StaticObject => self.setup_generic(),
            EntityType::PickableObject | EntityType::Bundle => self.setup_generic(),
            EntityType::Teleporter => self.setup_teleporter(),
            EntityType::PushableObject => self.setup_generic(),
            EntityType::Gate => self.setup_gate(),
            EntityType::InverseGate => self.setup_inverse_gate(),
            EntityType::PressurePlate => self.setup_pressure_plate(),
            EntityType::Bullet => self.setup_bullet(),
            EntityType::RailObject => self.setup_rail(),
            EntityType::Hint => self.setup_hint(),
            EntityType::Trail => self.setup_generic(),
            EntityType::WeaponMelee => self.setup_melee(),
            EntityType::WeaponRanged => self.setup_ranged(),
            EntityType::FastTravelLink => self.setup_fast_travel(),
            EntityType::PvpArenaLink => self.setup_pvp_arena(),
        }
    }

    pub fn should_be_visible(&self, world: &World) -> bool {
        if is_creative_mode() {
            return true
        }
        if self.is_equipment() {
            return true
        }
        if self.is_fast_travel_link() {
            return is_fast_travel_available()
        }
        if self.is_pvp_arena_link() {
            return is_pvp_arena_available()
        }
        if bool_for_global_key(&StorageKey::item_collected(self.id)) {
            return false
        }
        for condition in &self.display_conditions {
            if key_value_matches(&condition.key, world, condition.expected_value) {
                return condition.visible
            }
        }
        true
    }

    pub fn sprite_sheet(&self) -> u32 {
        self.sprite.sheet_id
    }

    pub fn texture_source_rect(&self) -> FRect {
        self.sprite.texture_source_rect()
    }

    pub fn immobilize_for_seconds(&mut self, seconds: f32) {
        self.time_immobilized = seconds;
    }

    pub fn reset_speed(&mut self) {        
        self.current_speed = self.speed_multiplier * self.species.base_speed;
    }    
    
    pub fn next_dialogue(&self, world: &World) -> Option<Dialogue> {
        for option in &self.dialogues {
            if key_value_matches(&option.key, world, option.expected_value) {
                return Some(option.clone())
            }
        }
        None
    }

    pub fn hittable_frame(&self) -> FRect {
        match self.entity_type {
            EntityType::Hero | EntityType::Npc => self.npc_hittable_frame(),
            EntityType::Bullet => self.bullet_hittable_frame(),
            EntityType::PushableObject => self.pushable_object_hittable_frame(),
            EntityType::PressurePlate => self.pressure_plate_hittable_frame(),
            _ => {
                let x_offset = 0.15;
                let y_offset = if self.frame.h > 1.0 { 1.15 } else { 0.15 };
                let width = self.frame.w - 0.3;
                let height = self.frame.h - if self.frame.h > 1.0 { 1.3 } else { 0.3 };
        
                FRect {
                    x: self.frame.x + x_offset,
                    y: self.frame.y + y_offset,
                    w: width,
                    h: height
                }
            }
        }
    }

    pub fn is_at_the_edge_of_the_world(&self, bounds: &FRect) -> bool {
        if self.frame.x <= bounds.x { return true }
        if self.frame.y <= bounds.y { return true }
        if self.frame.x + self.frame.w >= bounds.x + bounds.w { return true }
        if self.frame.y + self.frame.h >= bounds.y + bounds.h { return true }
        false
    }
}

impl Entity {
    pub fn handle_dialogue_interaction(&mut self, world: &World) -> Option<Vec<WorldStateUpdate>> {
        if let Some(dialogue) = self.next_dialogue(world) {
            self.is_in_interaction_range = true;

            if let Some(player) = world.index_of_any_player_who_is_pressing_confirm() {
                self.demands_attention = false;
                set_value_for_key(&StorageKey::npc_interaction(self.id), 1);

                let show_dialogue = vec![
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::Message(
                            DisplayableMessage::new(format!("{}:", self.name.clone()), dialogue.localized_text())
                        )
                    )
                ];
                let reward = dialogue.handle_reward(player);
                let vanishing = self.handle_after_dialogue();
                let updates = vec![show_dialogue, reward, vanishing].into_iter().flatten().collect();
                return Some(updates)
            }
        }   
        None
    }

    fn handle_after_dialogue(&mut self) -> Vec<WorldStateUpdate> {
        match self.after_dialogue {
            AfterDialogueBehavior::Nothing => vec![],
            AfterDialogueBehavior::Disappear => 
                if is_creative_mode() {
                    vec![]
                } else {
                    vec![WorldStateUpdate::RemoveEntity(self.id)]
                },
            AfterDialogueBehavior::FlyAwayEast => {
                self.is_rigid = false;
                self.direction = Direction::Left;
                self.reset_speed();
                vec![]
            }
        }
    }
}

impl Entity {
    fn setup_generic(&mut self) {
        if is_creative_mode() {
            self.is_rigid = false
        }
    }

    fn update_static(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {  
        self.is_in_interaction_range = false;

        if !self.dialogues.is_empty() {
            if world.is_hero_around_and_on_collision_with(&self.frame) {    
                self.handle_dialogue_interaction(world).unwrap_or_default()
            } else {
                vec![]
            }
        } else {
            vec![]
        }
    }
}

pub fn is_player_index(index: usize) -> bool {
    matches!(index, PLAYER1_INDEX | PLAYER2_INDEX | PLAYER3_INDEX | PLAYER4_INDEX)
}

pub fn is_player(entity_id: u32) -> bool {
    matches!(entity_id, PLAYER1_ENTITY_ID | PLAYER2_ENTITY_ID | PLAYER3_ENTITY_ID | PLAYER4_ENTITY_ID)
}

impl Entity {
    pub fn is_player(&self) -> bool {
        matches!(self.entity_type, EntityType::Hero)
    }

    pub fn is_equipment(&self) -> bool {
        matches!(self.entity_type, EntityType::WeaponMelee | EntityType::WeaponRanged)
    }

    pub fn can_be_hit_by_bullet(&self) -> bool {
        if self.is_invulnerable {
            return false
        }
        if self.is_dying {
            return false
        }
        if is_player(self.parent_id) {
            return false
        }
        if matches!(self.entity_type, EntityType::Bullet | EntityType::Bundle | EntityType::PickableObject) {
            return false
        }
        true
    }

    pub fn play_death_animation(&mut self) {
        self.direction = Direction::Unknown;
        self.current_speed = 0.0;
        self.is_rigid = false;
        self.is_dying = true;
        self.remaining_lifespan = 10.0 / ANIMATIONS_FPS;                
        self.frame = FRect::square_from_origin(1.0).centered_at(&self.frame.center());
        self.sprite = AnimatedSprite::new(
            SPRITE_SHEET_ANIMATED_OBJECTS, 
            FRect::new(0.0, 10.0, 1.0, 1.0), 
            5
        );
    }
}