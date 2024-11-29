use crate::{game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, world::World}, is_creative_mode};

impl Entity {
    pub fn handle_melee_attack(&mut self, world: &World) -> Vec<WorldStateUpdate> {
        if self.is_dying || is_creative_mode() {
            return vec![]
        }

        let hero_invulnerable = world.cached_hero_props.is_invulnerable;
        let hero = world.cached_hero_props.hittable_frame;
        let x = self.frame.x;
        let y = self.frame.y + if self.frame.h > 1 { 1 } else { 0 };
        
        if x == hero.x && y == hero.y && !hero_invulnerable {
            return vec![WorldStateUpdate::EngineUpdate(EngineStateUpdate::DeathScreen)]
        }
        vec![]
    }
}