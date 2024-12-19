use crate::{entities::{bullets::{BulletHits, BulletId}, species::SpeciesId}, features::destination::Destination, maps::{biome_tiles::Biome, constructions_tiles::Construction}};

use super::{entity::{Entity, EntityId}, entity_props::EntityProps, locks::LockType, messages::DisplayableMessage, toasts::Toast};

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
    AddToInventory(PlayerIndex, SpeciesId, AddToInventoryReason),
    RemoveFromInventory(PlayerIndex, SpeciesId),
    Toast(Toast),
    Message(DisplayableMessage),
    BulletBounced,
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