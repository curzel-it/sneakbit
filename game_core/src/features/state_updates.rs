use crate::{entities::{bullets::{BulletHits, BulletId}, species::SpeciesId}, features::destination::Destination, maps::{biome_tiles::Biome, constructions_tiles::Construction}, menus::toasts::Toast};

use super::{entity::{Entity, EntityId}, entity_props::EntityProps, locks::LockType};

pub type PlayerIndex = usize;

#[derive(Debug, Clone)]
pub enum WorldStateUpdate {
    AddEntity(Box<Entity>),
    RemoveEntity(EntityId),
    RemoveEntityAtCoordinates(usize, usize),
    CacheHeroProps(Box<EntityProps>),
    ChangeLock(EntityId, LockType),
    BiomeTileChange(usize, usize, Biome),
    StopHeroMovement,
    ConstructionTileChange(usize, usize, Construction),
    EngineUpdate(EngineStateUpdate),
    HandleHits(BulletHits),
    HandleBulletCatched(BulletId),
    HandleBulletStopped(BulletId),
    SetPressurePlateState(LockType, bool)
}

#[derive(Debug, Clone)]
pub enum EngineStateUpdate {
    EntityKilled(EntityId, SpeciesId),
    Teleport(Destination),
    SaveGame,
    Exit,
    AddToInventory(PlayerIndex, SpeciesId, AddToInventoryReason),
    RemoveFromInventory(PlayerIndex, SpeciesId),
    Toast(Toast),
    Confirmation(String, String, Vec<WorldStateUpdate>),
    DisplayLongText(String, String),
    ResumeGame,
    ToggleFullScreen,
    NewGame,
    BulletBounced,
    ExternalLink(String),
    PlayerDied(PlayerIndex),
    NoAmmo(PlayerIndex),
    KnifeThrown(PlayerIndex),
    SwordSlash(PlayerIndex),
    GunShot(PlayerIndex),
    LoudGunShot(PlayerIndex),
}

#[derive(Debug, Clone)]
pub enum AddToInventoryReason {
    PickedUp,
    Reward
}

pub fn visit(link: &str) -> WorldStateUpdate {
    WorldStateUpdate::EngineUpdate(EngineStateUpdate::ExternalLink(link.to_owned()))
}

impl WorldStateUpdate {
    pub fn log(&self) {
        match self {
            WorldStateUpdate::EngineUpdate(_) => {},
            WorldStateUpdate::CacheHeroProps(_) => {},
            _ => println!("World update: {:#?}", self)
        }   
    }
}

impl EngineStateUpdate {
    pub fn log(&self) {
        println!("Engine update: {:#?}", self)
    }
}