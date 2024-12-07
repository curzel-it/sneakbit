use crate::{constants::{SLASH_LIFESPAN, SWORD_SLASH_COOLDOWN}, entities::{bullets::make_hero_bullet, known_species::SPECIES_SLASH}, game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}, utils::directions::Direction};

impl Entity {
    pub fn setup_sword(&mut self) {
        self.setup_equipment();
    }

    pub fn update_sword(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {   
        let mut updates: Vec<WorldStateUpdate> = vec![];
        self.update_equipment_position(world);
        updates.extend(self.slash(world, time_since_last_update));
        updates
    }

    fn slash(&mut self, world: &World, time_since_last_update: f32) -> Vec<WorldStateUpdate> {
        self.action_cooldown_remaining -= time_since_last_update;
        
        if self.action_cooldown_remaining > 0.0 {
            self.sprite.frame.y = slash_sprite_y_for_direction(&self.direction);
            return vec![]
        }
        if world.has_attack_key_been_pressed {
            self.action_cooldown_remaining = SWORD_SLASH_COOLDOWN;
            self.sprite.reset();
            self.sprite.frame.y = slash_sprite_y_for_direction(&self.direction);
            
            let mut bullet = make_hero_bullet(SPECIES_SLASH, world, SLASH_LIFESPAN);
            bullet.frame = self.frame;

            return vec![WorldStateUpdate::AddEntity(Box::new(bullet))]
        }
        self.update_sprite_for_current_state();

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