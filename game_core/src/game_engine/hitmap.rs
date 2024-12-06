use crate::{constants::HERO_ENTITY_ID, entities::species::EntityType, game_engine::{entity::{Entity, EntityId}, world::World}, is_creative_mode, maps::constructions_tiles::Construction};

pub type Hitmap = Vec<Vec<bool>>;
pub type EntityIdsMap = Vec<Vec<EntityId>>;
pub type WeightsMap = Vec<Vec<i32>>;

impl World {    
    pub fn update_hitmaps(&mut self) {
        (self.hitmap, self.entities_map, self.weights_map) = self.compute_hitmap();
    }    

    fn compute_hitmap(&self) -> (Hitmap, EntityIdsMap, WeightsMap) {
        let entities = self.entities.borrow();    
        let height = self.bounds.h as usize;
        let width = self.bounds.w as usize;
    
        let mut hitmap = self.tiles_hitmap.clone();
        let mut idsmap = vec![vec![0; width]; height];
        let mut weightsmap = vec![vec![0; width]; height];
    
        for &(index, id) in &self.visible_entities {
            let entity = &entities[index];
            let hittable_frame = entity.hittable_frame();

            let col_start = hittable_frame.x.max(0) as usize;
            let col_end = ((hittable_frame.x + hittable_frame.w) as usize).max(0).min(width);            
            let row_start = hittable_frame.y.max(0) as usize;
            let row_end = ((hittable_frame.y + hittable_frame.h)  as usize).max(0).min(height);
    
            let is_rigid = entity.is_rigid && id != HERO_ENTITY_ID;
            let has_weight = entity.has_weight();
    
            for x in col_start..col_end {
                for y in row_start..row_end {
                    if is_rigid {
                        hitmap[y][x] = true;
                    }
                    if has_weight {
                        weightsmap[y][x] += 1;
                    }
                    idsmap[y][x] = id;
                }
            }
        }
    
        (hitmap, idsmap, weightsmap)
    }

    #[allow(clippy::needless_range_loop)] 
    pub fn update_tiles_hitmap(&mut self) {    
        let mut hitmap = vec![vec![false; self.bounds.w as usize]; self.bounds.h as usize];

        if !is_creative_mode() && !self.biome_tiles.tiles.is_empty() {
            let min_row = self.bounds.y as usize;
            let max_row = ((self.bounds.y + self.bounds.h) as usize).min(self.biome_tiles.tiles.len());
            let min_col = self.bounds.x as usize;
            let max_col = ((self.bounds.x + self.bounds.w) as usize).min(self.biome_tiles.tiles[0].len());
    
            for row in min_row..max_row {
                for col in min_col..max_col {
                    if !hitmap[row][col] {
                        let biome_tile = &self.biome_tiles.tiles[row][col];
                        let construction_tile = &self.constructions_tiles.tiles[row][col];
    
                        let is_obstacle = !matches!(construction_tile.tile_type, Construction::Bridge) && (
                            biome_tile.is_obstacle() || construction_tile.is_obstacle()
                        );
    
                        if is_obstacle {
                            hitmap[row][col] = true;
                        }
                    }
                }
            }
        }
        self.tiles_hitmap = hitmap;
    }
}

impl Entity {
    fn has_weight(&self) -> bool {
        !matches!(self.entity_type, EntityType::PressurePlate | EntityType::Gate | EntityType::InverseGate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    use crate::{entities::species::make_entity_by_species, maps::{biome_tiles::{Biome, BiomeTile}, constructions_tiles::ConstructionTile}, utils::{ids::get_next_id, rect::IntRect}};
    
    const SPECIES_NPC_OLD_MAN: u32 = 3005;
    
    #[test]
    fn test_hitmap_with_rigid_entity_excludes_top_row() {
        let mut world = World::new(get_next_id());        
        let mut npc = make_entity_by_species(SPECIES_NPC_OLD_MAN);
        npc.frame.x = 5;
        npc.frame.y = 5;
        world.add_entity(npc);
        world.visible_entities = world.compute_visible_entities(&IntRect::square_from_origin(20));
        
        let (hitmap, _, _) = world.compute_hitmap();
        assert!(!hitmap[5][5]);
        assert!(hitmap[6][5]);
    }

    #[test]
    fn test_hitmap_ignores_non_rigid_entity() {
        let mut world = World::new(get_next_id());
        let mut npc = make_entity_by_species(SPECIES_NPC_OLD_MAN);
        npc.frame = IntRect::new(5, 5, 2, 2);
        npc.is_rigid = false;
        
        world.add_entity(npc);
        world.visible_entities = world.compute_visible_entities(&IntRect::square_from_origin(20));
        
        let (hitmap, _, _) = world.compute_hitmap();
        assert!(!hitmap[6][5]);
        assert!(!hitmap[6][6]);
        assert!(!hitmap[5][5]);
        assert!(!hitmap[5][6]);
    }

    #[test]
    fn test_hitmap_with_biome_tiles_nothing_still_hits() {
        let mut world = World::new(get_next_id());
        world.bounds = IntRect::new(0, 0, 10, 10);
        world.cached_hero_props.frame = IntRect::new(4, 4, 2, 2);
        
        world.constructions_tiles.tiles = vec![vec![ConstructionTile::from_data('0'); 10]; 10];
        world.biome_tiles.tiles = vec![vec![BiomeTile::from_data('0'); 10]; 10];
        
        world.update_tiles_hitmap();
        let (hitmap, _, _) = world.compute_hitmap();

        assert!(hitmap[4][4]);
        assert!(hitmap[5][5]);
        assert!(hitmap[6][6]);
    }

    #[test]
    fn test_hitmap_with_biome_tiles() {
        let mut world = World::new(get_next_id());
        world.bounds = IntRect::new(0, 0, 10, 10);
        world.cached_hero_props.frame = IntRect::new(4, 4, 2, 2);
        
        world.constructions_tiles.tiles = vec![vec![ConstructionTile::from_data('0'); 10]; 10];
        world.biome_tiles.tiles = vec![vec![BiomeTile::from_data('1'); 10]; 10];
        world.biome_tiles.tiles[5][5].tile_type = Biome::Water;
        
        world.update_tiles_hitmap();
        let (hitmap, _, _) = world.compute_hitmap();

        assert!(!hitmap[4][4]);
        assert!(!hitmap[4][5]);
        assert!(!hitmap[4][6]);

        assert!(!hitmap[5][4]);
        assert!(hitmap[5][5]);
        assert!(!hitmap[5][6]);

        assert!(!hitmap[6][4]);
        assert!(!hitmap[6][5]);
        assert!(!hitmap[6][6]);
    }
}
