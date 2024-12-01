use crate::{constants::TILE_SIZE, game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}};

impl Entity {
    pub fn setup_equipment(&mut self) {
        // ...
    }

    pub fn update_equipment(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {   
        let hero = world.cached_hero_props;
        self.direction = hero.direction;
        self.frame.x = hero.frame.x;
        self.frame.y = hero.frame.y;
        self.offset.x = hero.offset.x - TILE_SIZE / 2.0;
        self.offset.y = hero.offset.y + TILE_SIZE / 8.0;        
        vec![]
    }
}