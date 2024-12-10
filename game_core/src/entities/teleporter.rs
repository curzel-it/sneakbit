use crate::{features::destination::Destination, game_engine::{entity::Entity, locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::has_species_in_inventory, world::World}, is_creative_mode, lang::localizable::LocalizableText, menus::toasts::Toast, utils::directions::Direction};

impl Entity {
    pub fn setup_teleporter(&mut self) {
        self.sprite.frame.y = if is_creative_mode() { 5 } else { 6 };
        self.is_rigid = false;
    }

    pub fn update_teleporter(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {   
        self.is_rigid = !matches!(self.lock_type, LockType::None);

        if self.should_teleport(world) {
            if !is_creative_mode() && self.lock_type != LockType::None {
                if has_species_in_inventory(&self.lock_type.key_species_id()) {
                    vec![self.show_unlock_confirmation()]
                } else {
                    vec![self.show_locked_message()]
                }                
            } else if let Some(destination) = self.destination.clone() {
                vec![self.engine_update_push_world(destination)]
            } else {
                vec![]
            }
        } else {
            vec![]
        }        
    }

    fn should_teleport(&self, world: &World) -> bool {
        if !(world.is_any_arrow_key_down || world.is_any_hero_on_a_slippery_surface()) { return false }
        if world.cached_players_props.player1.speed <= 0.0 { return false }

        let hero = world.cached_players_props.player1.hittable_frame;
        let hero_direction = world.cached_players_props.player1.direction;

        if matches!(hero_direction, Direction::Up) && hero.x == self.frame.x && hero.y == self.frame.y + 1 {
            return true
        }
        if matches!(hero_direction, Direction::Down) && hero.x == self.frame.x && hero.y == self.frame.y - 1 {
            return true
        }
        if matches!(hero_direction, Direction::Right) && hero.x == self.frame.x - 1 && hero.y == self.frame.y {
            return true
        }
        if matches!(hero_direction, Direction::Left) && hero.x == self.frame.x + 1 && hero.y == self.frame.y {
            return true
        }
        false
    }

    fn engine_update_push_world(&self, destination: Destination) -> WorldStateUpdate {
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::Teleport(
                destination
            )
        )
    }

    fn show_locked_message(&self) -> WorldStateUpdate {        
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::Toast(
                Toast::regular(self.locked_message())
            )
        )
    }

    fn locked_message(&self) -> String {
        if matches!(self.lock_type, LockType::Permanent) {
            "telepoter.locked.permanent".localized()
        } else {
            let name = self.lock_type.localized_name().to_uppercase();
            "teleporter.locked".localized().replace("%s", &name)
        }
    } 

    fn show_unlock_confirmation(&self) -> WorldStateUpdate {
        let name = self.lock_type.localized_name().to_uppercase();
        
        WorldStateUpdate::EngineUpdate(
            EngineStateUpdate::Confirmation(
                "teleporter.unlock.title".localized(),
                "teleporter.unlock.message".localized().replace("%s", &name),
                vec![
                    WorldStateUpdate::ChangeLock(self.id, LockType::None),
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::SaveGame
                    ),
                    WorldStateUpdate::EngineUpdate(
                        EngineStateUpdate::RemoveFromInventory(
                            self.lock_type.key_species_id()
                        )
                    )
                ]
            )
        )
    }
}