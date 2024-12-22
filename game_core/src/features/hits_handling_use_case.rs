use crate::{current_game_mode, entities::{bullets::{BulletHits, BulletId}, known_species::{is_monster, SPECIES_DAMAGE_INDICATOR, SPECIES_KUNAI}, species::species_by_id}, equipment::basics::{available_weapons, is_equipped}, features::entity::is_player, utils::{rect::IntRect, vector::Vector2d}, worlds::world::World};
use crate::features::{entity::Entity, state_updates::EngineStateUpdate, storage::{has_boomerang_skill, has_bullet_catcher_skill, has_piercing_knife_skill, increment_inventory_count}};

impl World {
    pub fn handle_hits(&mut self, hits: &BulletHits) -> Vec<EngineStateUpdate> {
        let mut updates: Vec<EngineStateUpdate> = vec![];
        let mut bullet_expended = false;
        let mut entities = self.entities.borrow_mut();

        let shooter_is_player = is_player(hits.bullet_parent_id);
        let pvp_allowed = current_game_mode().allows_pvp();

        let targets = entities.iter_mut().filter(|e| {
            hits.target_ids.contains(&e.id) && e.can_be_hit_by_bullet()
        });

        let mut damage_indicator_positions: Vec<(IntRect, Vector2d)> = vec![];

        for target in targets {
            let (did_kill, show_damage_indicator) = if target.is_player() {
                if !shooter_is_player || pvp_allowed {
                    let player_died = self.handle_hero_damage(target, hits.damage);
                    if player_died {
                        updates.push(EngineStateUpdate::PlayerDied(target.player_index));
                    }
                    (false, false)
                } else {
                    (false, false)
                }
            } else {
                let did_kill = self.handle_target_hit(hits.damage, hits.bullet_species_id, target);
                (did_kill, !did_kill && is_monster(target.species_id))
            };
            bullet_expended = bullet_expended || did_kill;
            if did_kill {
                updates.push(EngineStateUpdate::EntityKilled(target.id, target.species_id));
            }
            if show_damage_indicator {
                damage_indicator_positions.push((target.hittable_frame(), target.offset))
            }
        }
        drop(entities);

        for (frame, offset) in damage_indicator_positions {
            let mut damage_indicator = species_by_id(SPECIES_DAMAGE_INDICATOR).make_entity();            
            damage_indicator.frame = frame;
            damage_indicator.offset = offset;
            damage_indicator.remaining_lifespan = 0.2;
            damage_indicator.parent_id = hits.bullet_id;
            self.add_entity(damage_indicator);
        }

        if bullet_expended && hits.bullet_id != 0 {
            updates.append(&mut self.handle_bullet_stopped_from_hit(hits.bullet_id, hits.supports_bullet_boomerang));
        } 
        updates
    }

    pub fn handle_bullet_stopped(&mut self, bullet_id: BulletId) -> Vec<EngineStateUpdate> {
        let supports_bullet_boomerang = if let Some(index) = self.index_for_entity(bullet_id) {
            if let Some(entity) = self.entities.borrow().get(index) {
                species_by_id(entity.species_id).supports_bullet_boomerang
            } else {
                false
            }
        } else {
            false
        };
        self.handle_bullet_stopped_from_hit(bullet_id, supports_bullet_boomerang)
    }

    pub fn handle_bullet_catched(&mut self, bullet_id: u32) {
        if has_bullet_catcher_skill() {
            let entities = self.entities.borrow();

            if let Some(bullet) = entities.iter().find(|e| e.id == bullet_id) {
                let species_id = bullet.species_id;
                let player = bullet.player_index;
                _ = bullet;
                drop(entities);
                self.remove_entity_by_id(bullet_id);
                increment_inventory_count(species_id, player);
            }
        }
    }   

    fn handle_hero_damage(&self, hero: &mut Entity, damage: f32) -> bool {
        let mut damage_reductions: Vec<f32> = available_weapons(hero.player_index)
            .iter()
            .filter_map(|s| 
                if is_equipped(s, hero.player_index) {
                    Some(s.received_damage_reduction)
                } else {
                    None
                }
            )   
            .collect();
        
        damage_reductions.sort_by(|a, b| b.partial_cmp(a).unwrap_or(std::cmp::Ordering::Equal));     

        let actual_damage = damage_reductions
            .iter()
            .fold(damage, |current_damage, discount| current_damage * (1.0 - discount))
            .max(0.0);

        hero.hp -= actual_damage;
        
        if hero.hp <= 0.0 {
            hero.play_death_animation();
            true
        } else {
            false
        }
    }

    fn handle_target_hit(&self, damage: f32, bullet_species_id: u32, target: &mut Entity) -> bool {
        target.hp -= damage * damage_multiplier(target.parent_id, bullet_species_id);
        
        if target.hp <= 0.0 {
            target.play_death_animation();
            self.mark_as_collected_if_needed(target.id, target.parent_id);
            true
        } else {
            false
        }
    }

    fn handle_bullet_stopped_from_hit(&mut self, bullet_id: u32, supports_bullet_boomerang: bool) -> Vec<EngineStateUpdate> {
        if has_boomerang_skill() && supports_bullet_boomerang {
            let mut entities = self.entities.borrow_mut();
            if let Some(bullet) = entities.iter_mut().find(|e| e.id == bullet_id) {
                if is_player(bullet.parent_id) {
                    bullet.direction = bullet.direction.opposite();
                    bullet.update_sprite_for_current_state();
                    let (dx, dy) = bullet.direction.as_col_row_offset();
                    bullet.frame.x += dx;
                    bullet.frame.y += dy;
                    return vec![EngineStateUpdate::BulletBounced]
                }
            }
            drop(entities);
        }
        self.remove_entity_by_id(bullet_id);
        vec![]
    }
}

fn damage_multiplier(parent_id: u32, bullet_species_id: u32) -> f32 {
    if is_player(parent_id) && matches!(bullet_species_id, SPECIES_KUNAI) && has_piercing_knife_skill() {
        2.0
    } else {
        1.0
    }
}