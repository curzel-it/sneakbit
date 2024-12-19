use std::fmt::{self, Debug};

use crate::{entities::species::{EntityType, SpeciesId}, features::entity::{is_player, Entity, EntityId}, is_creative_mode, worlds::world::World};

#[derive(Clone)]
pub struct Hitmap {
    bits: Vec<bool>,
    width: usize,
}

pub type EntityIdsMap = Vec<(i32, i32, EntityId, SpeciesId)>;

impl World {
    pub fn hits(&self, x: i32, y: i32) -> bool {
        if x < 0 || y < 0 || y >= self.bounds.h || x >= self.bounds.w { 
            false 
        } else { 
            let x = x as usize;
            let y = y as usize;
            self.hitmap.hits(x, y) || self.tiles_hitmap.hits(x, y) 
        }
    }

    pub fn hits_or_out_of_bounds(&self, x: i32, y: i32) -> bool {
        x < 0 || y < 0 || self.hits(x, y)
    }

    pub fn entity_ids(&self, x: i32, y: i32) -> Vec<(EntityId, SpeciesId)> {
        self.idsmap
            .iter()
            .filter_map(|&(ex, ey, id, species_id)| {
                if ex == x && ey == y {
                    Some((id, species_id))
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn has_weight(&self, x: i32, y: i32) -> bool {
        if x < 0 || y < 0 || y >= self.bounds.h || x >= self.bounds.w { 
            false 
        } else { 
            self.weightmap.hits(x as usize, y as usize) 
        }
    }
}

impl World {
    pub fn update_hitmaps(&mut self) {
        self.hitmap.clear();
        self.weightmap.clear();
        self.idsmap.clear();
        
        let entities = self.entities.borrow();
        let height = self.bounds.h as usize;
        let width = self.bounds.w as usize;

        for &(index, id) in &self.visible_entities {
            let entity = &entities[index];
            let is_rigid = entity.is_rigid && !is_player(id);
            let has_weight = entity.has_weight();

            if !is_rigid && !has_weight {
                continue;
            }

            let hittable_frame = entity.hittable_frame();

            let col_start = hittable_frame.x.max(0) as usize;
            let col_end = ((hittable_frame.x + hittable_frame.w) as usize).min(width);
            let row_start = hittable_frame.y.max(0) as usize;
            let row_end = ((hittable_frame.y + hittable_frame.h) as usize).min(height);

            for y in row_start..row_end {
                for x in col_start..col_end {
                    if is_rigid {
                        self.hitmap.set(x, y, true);
                    }
                    if has_weight {
                        self.weightmap.set(x, y, true);
                    }
                    self.idsmap.push((x as i32, y as i32, id, entity.species_id));
                }
            }
        }
    }

    #[allow(clippy::needless_range_loop)] 
    pub fn update_tiles_hitmap(&mut self) {    
        self.weightmap = Hitmap::new(self.bounds.w as usize, self.bounds.h as usize);
        self.tiles_hitmap = Hitmap::new(self.bounds.w as usize, self.bounds.h as usize);
        self.hitmap = Hitmap::new(self.bounds.w as usize, self.bounds.h as usize);

        if is_creative_mode() || self.biome_tiles.tiles.is_empty() {
            return;
        }

        let min_row = self.bounds.y as usize;
        let max_row = ((self.bounds.y + self.bounds.h) as usize).min(self.biome_tiles.tiles.len());
        let min_col = self.bounds.x as usize;
        let max_col = ((self.bounds.x + self.bounds.w) as usize).min(self.biome_tiles.tiles[0].len());

        for row in min_row..max_row {
            for col in min_col..max_col {
                if !self.tiles_hitmap.hits(col, row) {
                    let biome = &self.biome_tiles.tiles[row][col];
                    let constructions = &self.constructions_tiles.tiles[row][col];
                    let is_obstacle = (biome.is_obstacle() || constructions.is_obstacle()) && !constructions.is_bridge();

                    if is_obstacle {
                        self.tiles_hitmap.set(col, row, true);
                    }
                }
            }
        }
    }
}

impl Hitmap {
    pub fn new(width: usize, height: usize) -> Self {
        Hitmap {
            bits: vec![false; width * height],
            width,
        }
    }

    fn clear(&mut self) {
        self.bits = vec![false; self.bits.len()];
    }

    fn get_index(&self, x: usize, y: usize) -> usize {
        y * self.width + x
    }

    pub fn hits(&self, x: usize, y: usize) -> bool {
        let index = self.get_index(x, y);
        self.bits[index]
    }

    fn set(&mut self, x: usize, y: usize, value: bool) {
        let index = self.get_index(x, y);
        self.bits[index] = value;
    }
}

impl Debug for Hitmap {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        for y in 0..(self.bits.len() / self.width) {
            for x in 0..self.width {
                let bit = if self.hits(x, y) { '1' } else { '0' };
                write!(f, "{}", bit)?;
            }
            writeln!(f)?; 
        }
        Ok(())
    }
}

impl Entity {
    fn has_weight(&self) -> bool {
        !matches!(self.entity_type, EntityType::PressurePlate | EntityType::Gate | EntityType::InverseGate | EntityType::WeaponMelee | EntityType::WeaponRanged)
    }
}