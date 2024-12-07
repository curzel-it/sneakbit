use crate::{constants::{HERO_ENTITY_ID, HERO_KUNAI_COOLDOWN, TILE_SIZE}, entities::{known_species::SPECIES_KUNAI, species::species_by_id}, game_engine::{entity::Entity, state_updates::{EngineStateUpdate, WorldStateUpdate}, storage::has_species_in_inventory, world::World}, utils::directions::Direction};

impl Entity {
    pub fn setup_equipment(&mut self) {
        self.update_sprite_for_current_state();
    }

    pub fn update_equipment(&mut self, world: &World, _: f32) -> Vec<WorldStateUpdate> {   
        let hero = world.cached_hero_props;
        self.direction = hero.direction;
        self.current_speed = hero.speed;
        self.frame.x = hero.frame.x;
        self.frame.y = hero.frame.y;
        self.offset.x = hero.offset.x - 1.5 * TILE_SIZE;
        self.offset.y = hero.offset.y - 1.0 * TILE_SIZE;
        self.update_sprite_for_current_state();
        vec![]
    }
}

impl Entity {
    pub fn setup_sword(&mut self) {
        self.setup_equipment();
    }

    pub fn update_sword(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {   
        self.update_equipment(world, time_since_last_update)
    }

    fn slash(&mut self) -> Vec<WorldStateUpdate> {
        self.sprite.reset();
        self.sprite.frame.y = slash_sprite_y_for_direction(&self.direction);
        vec![]
    } 
}

fn slash_sprite_y_for_direction(direction: &Direction) -> i32 {
    match direction {
        Direction::Up => 37,
        Direction::Down => 45,
        Direction::Right => 41,
        Direction::Left => 49,
        Direction::Unknown => 37,
        Direction::Still => 37,
    }
}

impl Entity {
    pub fn setup_kunai_launcher(&mut self) {
        self.setup_equipment();
    }

    pub fn update_kunai_launcher(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {   
        let mut updates: Vec<WorldStateUpdate> = vec![];
        updates.extend(self.update_equipment(world, time_since_last_update));
        updates.extend(self.fire(world, time_since_last_update));
        updates
    }

    fn fire(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        let hero = world.cached_hero_props;

        self.action_cooldown_remaining -= time_since_last_update;
        
        if self.action_cooldown_remaining > 0.0 {
            return vec![]
        }
        if !world.has_attack_key_been_pressed {
            return vec![]
        }
        if !has_species_in_inventory(&SPECIES_KUNAI) {
            return vec![]
        }

        self.action_cooldown_remaining = HERO_KUNAI_COOLDOWN;

        let mut bullet = species_by_id(SPECIES_KUNAI).make_entity();
        bullet.direction = hero.direction;
        let (dx, dy) = hero.direction.as_col_row_offset();
        bullet.frame = hero.hittable_frame.offset(dx, dy); //.offset_y(1).with_h(1);
        
        if hero.offset.x > TILE_SIZE / 2.0 { bullet.frame.x += 1 }
        if hero.offset.x < -TILE_SIZE / 2.0 { bullet.frame.x -= 1 }
        if hero.offset.y > TILE_SIZE / 2.0 { bullet.frame.y += 1 }
        if hero.offset.y < -TILE_SIZE / 2.0 { bullet.frame.y -= 1 }
        
        bullet.parent_id = HERO_ENTITY_ID;
        bullet.remaining_lifespan = 3.0;
        bullet.reset_speed();

        vec![
            WorldStateUpdate::EngineUpdate(EngineStateUpdate::RemoveFromInventory(SPECIES_KUNAI)),
            WorldStateUpdate::AddEntity(Box::new(bullet))
        ]
    } 
}