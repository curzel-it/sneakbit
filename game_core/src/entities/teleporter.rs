use crate::{features::{destination::Destination, entity::Entity, locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}, toasts::{Toast, ToastMode}}, is_creative_mode, lang::localizable::LocalizableText, worlds::world::World};

impl Entity {
    pub fn setup_teleporter(&mut self) {
        self.sprite.frame.y = if is_creative_mode() { 5.0 } else { 6.0 };
        self.is_rigid = false;
    }

    pub fn update_teleporter(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {   
        self.is_rigid = !matches!(self.lock_type, LockType::None);

        let player = world.players[0].props;
        let is_near_entrance = player.hittable_frame.is_around_and_pointed_at(&self.frame, &player.direction);
        let is_moving = player.speed > 0.0;

        if is_near_entrance && is_moving {
            if !is_creative_mode() && self.lock_type != LockType::None {
                vec![show_locked_message()]
            } else if let Some(destination) = self.destination.clone() {
                vec![engine_update_push_world(destination)]
            } else {
                vec![]
            }
        } else {
            vec![]
        }        
    }
}

fn engine_update_push_world(destination: Destination) -> WorldStateUpdate {
    WorldStateUpdate::EngineUpdate(
        EngineStateUpdate::Teleport(
            destination
        )
    )
}

fn show_locked_message() -> WorldStateUpdate {        
    WorldStateUpdate::EngineUpdate(
        EngineStateUpdate::Toast(
            Toast::new(
                ToastMode::Regular,
                "teleporter.locked".localized()
            )
        )
    )
}