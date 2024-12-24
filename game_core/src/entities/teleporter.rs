use crate::{features::{destination::Destination, entity::Entity, locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}, toasts::{Toast, ToastMode}}, is_creative_mode, lang::localizable::LocalizableText, utils::directions::Direction, worlds::world::World};

impl Entity {
    pub fn setup_teleporter(&mut self) {
        self.sprite.frame.y = if is_creative_mode() { 5 } else { 6 };
        self.is_rigid = false;
    }

    pub fn update_teleporter(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {   
        self.is_rigid = !matches!(self.lock_type, LockType::None);

        if is_player_entering_tile(world, self.frame.x, self.frame.y) {
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

pub fn is_player_entering_tile(world: &World, x: i32, y: i32) -> bool {
    if !(world.is_any_arrow_key_down || world.is_any_hero_on_a_slippery_surface()) { return false }
    if world.players[0].props.speed <= 0.0 { return false }

    let hero = world.players[0].props.hittable_frame;
    let hero_direction = world.players[0].props.direction;

    if matches!(hero_direction, Direction::Up) && hero.x == x && hero.y == y + 1 {
        return true
    }
    if matches!(hero_direction, Direction::Down) && hero.x == x && hero.y == y - 1 {
        return true
    }
    if matches!(hero_direction, Direction::Right) && hero.x == x - 1 && hero.y == y {
        return true
    }
    if matches!(hero_direction, Direction::Left) && hero.x == x + 1 && hero.y == y {
        return true
    }
    false
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