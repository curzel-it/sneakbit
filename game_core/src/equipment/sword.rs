use crate::{constants::{SLASH_LIFESPAN, SWORD_SLASH_COOLDOWN}, entities::{bullets::make_hero_bullet, known_species::SPECIES_SLASH, species::species_by_id}, game_engine::{entity::Entity, state_updates::WorldStateUpdate, world::World}, utils::{directions::Direction, vector::Vector2d}};

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
            
            let base_speed = species_by_id(self.species_id).base_speed;
            let offsets = bullet_offsets(world.cached_hero_props.direction);

            return offsets.into_iter()
                .map(|(dx, dy)| {
                    let mut bullet = make_hero_bullet(SPECIES_SLASH, world, SLASH_LIFESPAN);
                    bullet.offset = Vector2d::zero();
                    bullet.frame = bullet.frame.offset_by((dx, dy)); 
                    bullet.current_speed = base_speed;
                    WorldStateUpdate::AddEntity(Box::new(bullet))
                })
                .collect();
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

fn bullet_offsets(direction: Direction) -> Vec<(i32, i32)> {
    match direction {
        Direction::Up => vec![
            (-1, 0), (0, -1), (1, 0)
        ],
        Direction::Down | Direction::Unknown | Direction::Still => vec![
            (-1, 0), (0, 1), (1, 0)
        ],
        Direction::Right => vec![
            (0, -1), (1, 0), (0, 1)
        ],
        Direction::Left => vec![
            (0, -1), (-1, 0), (0, 1)
        ],
    }
}