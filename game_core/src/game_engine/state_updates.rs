use crate::{entities::{bullets::{BulletId, Damage}, species::SpeciesId}, features::destination::Destination, maps::{biome_tiles::Biome, constructions_tiles::Construction}, menus::toasts::Toast, utils::vector::Vector2d};

use super::{entity::{Entity, EntityId, EntityProps}, locks::LockType};

#[derive(Debug, Clone)]
pub enum WorldStateUpdate {
    AddEntity(Box<Entity>),
    RemoveEntity(EntityId),
    RemoveEntityAtCoordinates(usize, usize),
    RenameEntity(EntityId, String),
    ToggleDemandAttention(EntityId),
    UpdateDestinationWorld(EntityId, u32),
    UpdateDestinationX(EntityId, i32),
    UpdateDestinationY(EntityId, i32),
    CacheHeroProps(Box<EntityProps>),
    ChangeLock(EntityId, LockType),
    BiomeTileChange(usize, usize, Biome),
    StopHeroMovement,
    ConstructionTileChange(usize, usize, Construction),
    EngineUpdate(EngineStateUpdate),
    HandleHits(BulletId, Vec<EntityId>, Damage),
    HandleHeroDamage(Damage),
    HandleBulletCatched(BulletId),
    HandleBulletStopped(BulletId),
    SetPressurePlateState(LockType, bool)
}

#[derive(Debug, Clone)]
pub enum EngineStateUpdate {
    EntityKilled(EntityId, SpeciesId),
    CenterCamera(i32, i32, Vector2d),
    Teleport(Destination),
    SaveGame,
    Exit,
    AddToInventory(SpeciesId, AddToInventoryReason),
    RemoveFromInventory(SpeciesId),
    Toast(Toast),
    Confirmation(String, String, Vec<WorldStateUpdate>),
    DisplayLongText(String, String),
    DeathScreen,
    ResumeGame,
    ToggleFullScreen,
    NewGame,
    BulletBounced,
    SpecialEffect(SpecialEffect),
    ExternalLink(String)
}

#[derive(Debug, Clone)]
pub enum SpecialEffect {
    SwordSlash,
    ClaymoreSlash
}

#[derive(Debug, Clone)]
pub enum AddToInventoryReason {
    PickedUp,
    Reward
}

pub fn visit(link: &str) -> WorldStateUpdate {
    WorldStateUpdate::EngineUpdate(EngineStateUpdate::ExternalLink(link.to_owned()))
}
