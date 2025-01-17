use crate::{current_world_id, entities::species::EntityType, features::{destination::Destination, entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::{bool_for_global_key, StorageKey}}, utils::rect::FRect, worlds::world::World};

impl Entity {
    pub fn setup_fast_travel(&mut self) {
        self.is_rigid = true;
    }

    pub fn update_fast_travel(&mut self, world: &World) -> Vec<WorldStateUpdate> {   
        let player = world.players[0].props;
        let is_near_entrance = player.hittable_frame.is_around_and_pointed_at(&self.fast_travel_entrance(), &player.direction);
        let is_moving = player.speed > 0.0;

        if is_near_entrance && is_moving {
            vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::FastTravel)]
        } else {
            vec![]
        }        
    }

    fn fast_travel_entrance(&self) -> FRect {
        FRect {
            x: self.frame.x + 1.0,
            y: self.frame.y + 1.0,
            w: 1.0,
            h: 1.0
        }
    }
}

#[derive(Clone)]
#[repr(C)]
pub enum FastTravelDestination {
    Evergrove = 1001,
    Aridreach = 1003,
    Duskhaven = 1011,
    PeakLevel = 1020,
    Maritide = 1008,
    Thermoria = 1006,
    Vintoria = 1012
}

impl FastTravelDestination {
    pub fn world_id(&self) -> u32 {
        self.clone() as u32
    }

    pub fn to_teleporter_destination(&self) -> Option<Destination> {
        let world_id = self.world_id();

        if let Some(world) = World::load(world_id) {
            let entities = world.entities.borrow();
            let link = entities.iter().find(|e| {
                matches!(e.entity_type, EntityType::FastTravelLink)
            });

            if let Some(link) = link {
                let x = link.frame.x + 1.0;
                let y = link.frame.y + link.frame.h;
                let destination = Destination::new(world_id, x, y);
                Some(destination)
            } else {
                None
            }
        } else {
            None
        }
    }
}

pub fn is_fast_travel_available() -> bool {
    [
        FastTravelDestination::Evergrove,
        FastTravelDestination::Aridreach,
        FastTravelDestination::Duskhaven,
        FastTravelDestination::PeakLevel,
        FastTravelDestination::Maritide,
        FastTravelDestination::Thermoria,
        FastTravelDestination::Vintoria,
    ]
    .iter()
    .filter(|destination| {
        let world_id = destination.world_id();
        let key = StorageKey::did_visit(world_id);
        bool_for_global_key(&key)
    })
    .count() >= 4    
}

pub fn available_fast_travel_destinations_from_current_world() -> Vec<FastTravelDestination> {
    let current_world = current_world_id();

    [
        FastTravelDestination::Evergrove,
        FastTravelDestination::Aridreach,
        FastTravelDestination::Duskhaven,
        FastTravelDestination::PeakLevel,
        FastTravelDestination::Maritide,
        FastTravelDestination::Thermoria,
        FastTravelDestination::Vintoria,
    ]
    .into_iter()
    .filter_map(|destination| {
        let world_id = destination.world_id();
        let key = StorageKey::did_visit(world_id);
        
        if world_id != current_world && bool_for_global_key(&key) {
            Some(destination)
        } else {
            None
        }
    })
    .collect()
}

impl Entity {
    pub fn is_fast_travel_link(&self) -> bool {
        matches!(self.entity_type, EntityType::FastTravelLink) | matches!(self.species_id, 1185)
    }
}