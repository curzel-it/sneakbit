
use crate::{constants::{SPRITE_SHEET_INVENTORY, TILE_SIZE}, entities::{known_species::SPECIES_HERO, species::{EntityType, Species, ALL_SPECIES}}, game_engine::{keyboard_events_provider::KeyboardEventsProvider, mouse_events_provider::MouseEventsProvider, state_updates::WorldStateUpdate}, lang::localizable::LocalizableText, maps::{biome_tiles::Biome, constructions_tiles::Construction}, prefabs::all::new_building, spacing, text, texture, ui::{components::{with_fixed_position, GridSpacing, NonColor, Spacing, Typography, View, COLOR_BLACK, COLOR_BLACK_50, COLOR_RED_60, COLOR_YELLOW}, scaffold::scaffold}, utils::{rect::IntRect, vector::Vector2d}, vstack, zstack};

use super::menu::MENU_BORDERS_TEXTURES;

#[derive(Debug)]
pub struct MapEditor {
    stock: Vec<Stockable>,
    state: MapEditorState,
    pub current_world_id: u32,
    columns: usize,
    offset: usize,
    camera_viewport: IntRect,
}

#[derive(Debug, Clone)]
enum MapEditorState {
    SelectingItem(usize),
    PlacingItem(usize, Stockable, IntRect),
}

impl MapEditor {
    pub fn new() -> Self {
        Self {
            stock: MapEditor::all_possible_items().into_iter().collect(),
            state: MapEditorState::SelectingItem(0),
            current_world_id: 0,
            columns: 12,
            offset: 0,
            camera_viewport: IntRect::square_from_origin(10),
        }
    }

    pub fn is_placing_item(&self) -> bool {
        matches!(self.state, MapEditorState::PlacingItem(_, _, _))
    }

    pub fn update(
        &mut self,
        camera_viewport: &IntRect,    
        keyboard: &KeyboardEventsProvider,
        mouse: &MouseEventsProvider,
    ) -> Vec<WorldStateUpdate> {
        self.camera_viewport = *camera_viewport;

        match self.state.clone() {
            MapEditorState::SelectingItem(selected_index) => {
                self.update_item_selection(selected_index, keyboard)
            }
            MapEditorState::PlacingItem(selected_index, item, frame) => self.update_item_placement(
                selected_index,
                item,
                frame,
                keyboard,
                mouse,
            ),
        }
    }

    fn update_item_selection(
        &mut self,
        selected_index: usize,
        keyboard: &KeyboardEventsProvider,
    ) -> Vec<WorldStateUpdate> {
        if keyboard.direction_up.is_pressed {
            if selected_index >= self.columns {
                self.state = MapEditorState::SelectingItem(selected_index - self.columns);
            } else {
                self.state = MapEditorState::SelectingItem(self.stock.len() - (self.columns - selected_index));
            }
        }
        if keyboard.direction_right.is_pressed && selected_index < self.stock.len() - 1 {
            self.state = MapEditorState::SelectingItem(selected_index + 1);
        }
        if keyboard.direction_down.is_pressed {
            if selected_index + self.columns < self.stock.len() {
                self.state = MapEditorState::SelectingItem(selected_index + self.columns);
            } else {
                self.state = MapEditorState::SelectingItem(
                    (selected_index + self.columns) % self.stock.len(),
                );
            }
        }
        if keyboard.direction_left.is_pressed && selected_index > 0 {
            self.state = MapEditorState::SelectingItem(selected_index - 1);
        }
        if keyboard.has_confirmation_been_pressed {
            let selection = self.stock[selected_index].clone();
            let indicator_frame = self.initial_selection_frame(&selection);

            self.state = MapEditorState::PlacingItem(
                selected_index,
                selection,
                indicator_frame,
            )
        }
        vec![]
    }

    fn initial_selection_frame(&self, item: &Stockable) -> IntRect {
        let size = item.size();
        IntRect::new(
            self.camera_viewport.x + self.camera_viewport.w / 2,
            self.camera_viewport.y + self.camera_viewport.h / 2,
            size.0, 
            size.1
        )
    }

    fn update_item_placement(
        &mut self,
        selected_index: usize,
        item: Stockable,
        frame: IntRect,
        keyboard: &KeyboardEventsProvider,
        mouse: &MouseEventsProvider,
    ) -> Vec<WorldStateUpdate> {
        if mouse.has_right_been_pressed {
            return self.clear_tile(frame);
        }
        if self.has_selected_tile() && mouse.is_left_down {
            let updated_frame = self.updated_frame(&frame, mouse, keyboard);
            self.state = MapEditorState::PlacingItem(selected_index, item.clone(), updated_frame);
            return self.place_item(item, frame);
        }
        if mouse.has_left_been_pressed || keyboard.has_confirmation_been_pressed {
            return self.place_item(item, frame);
        }
        if keyboard.has_back_been_pressed {
            self.state = MapEditorState::SelectingItem(selected_index);
            return vec![];
        }
        
        let updated_frame = self.updated_frame(&frame, mouse, keyboard);
        self.state = MapEditorState::PlacingItem(selected_index, item.clone(), updated_frame);
        vec![]
    }

    fn updated_frame(&self, frame: &IntRect, mouse: &MouseEventsProvider, keyboard: &KeyboardEventsProvider) -> IntRect {
        let mut updated_frame = *frame;
        
        if mouse.has_moved {
            let x = mouse.x + self.camera_viewport.x;
            let y = mouse.y  + self.camera_viewport.y;
            updated_frame = IntRect::new(x, y, updated_frame.w, updated_frame.h);
        } else {
            if keyboard.direction_up.is_pressed {
                updated_frame = updated_frame.offset_y(-1);
            }
            if keyboard.direction_right.is_pressed {
                updated_frame = updated_frame.offset_x(1);
            }
            if keyboard.direction_down.is_pressed {
                updated_frame = updated_frame.offset_y(1);
            }
            if keyboard.direction_left.is_pressed {
                updated_frame = updated_frame.offset_x(-1);
            }     
        }
        updated_frame   
    }

    fn place_item(&mut self, item: Stockable, frame: IntRect) -> Vec<WorldStateUpdate> {
        let row = frame.y as usize;
        let col = frame.x as usize;

        match item {
            Stockable::BiomeTile(biome) => vec![WorldStateUpdate::BiomeTileChange(row, col, biome)],
            Stockable::ConstructionTile(construction) => match construction {
                Construction::Nothing => vec![
                    WorldStateUpdate::BiomeTileChange(row, col, Biome::Nothing),
                    WorldStateUpdate::ConstructionTileChange(row, col, Construction::Nothing),
                    WorldStateUpdate::RemoveEntityAtCoordinates(row, col),
                ],
                _ => vec![WorldStateUpdate::ConstructionTileChange(row, col, construction)],
            },
            Stockable::Entity(species) => match species.entity_type {
                EntityType::Building => self.place_building(frame, &species),
                EntityType::Npc => self.place_convertible(frame.offset_y(-1), &species),
                _ => self.place_convertible(frame, &species),
            },
        }
    }

    fn clear_tile(&mut self, frame: IntRect) -> Vec<WorldStateUpdate> {
        self.place_item(Stockable::ConstructionTile(Construction::Nothing), frame)
    }

    fn place_convertible(&self, frame: IntRect, species: &Species) -> Vec<WorldStateUpdate> {
        let mut entity = species.make_entity();
        entity.frame.x = frame.x;
        entity.frame.y = frame.y;
        let update = WorldStateUpdate::AddEntity(Box::new(entity));
        vec![update]
    }

    fn place_building(&self, frame: IntRect, species: &Species) -> Vec<WorldStateUpdate> {
        let x = frame.x;
        let y = frame.y;

        new_building(self.current_world_id, x, y, species)
            .into_iter()
            .map(Box::new)
            .map(WorldStateUpdate::AddEntity)
            .collect()
    }

    fn has_selected_tile(&self) -> bool {
        if let MapEditorState::PlacingItem(_, item, _) = self.state.clone() {
            matches!(item, Stockable::BiomeTile(_) | Stockable::ConstructionTile(_))
        } else {
            false
        }
    }
}

#[derive(Debug, Clone)]
enum Stockable {
    BiomeTile(Biome),
    ConstructionTile(Construction),
    Entity(Species),
}

impl Stockable {
    pub fn size(&self) -> (i32, i32) {
        match self {
            Stockable::BiomeTile(_) => (1, 1),
            Stockable::ConstructionTile(_) => (1, 1),
            Stockable::Entity(species) => (species.sprite_frame.w, species.sprite_frame.h)
        }
    }

    fn texture_source_rect(&self) -> IntRect {
        let (y, x) = match self {
            Stockable::BiomeTile(biome) => match biome {
                Biome::Nothing => (0, 0),
                Biome::Water => (0, 1),
                Biome::Desert => (0, 2),
                Biome::Grass => (0, 3),
                Biome::Rock => (0, 4),
                Biome::Snow => (0, 5),
                Biome::LightWood => (0, 6),
                Biome::DarkWood => (0, 7),
                Biome::DarkRock => (0, 8),
                Biome::Ice => (0, 9),
                Biome::DarkGrass => (0, 10),
                Biome::RockPlates => (0, 11),
                Biome::GrassFlowersRed => (0, 12),
                Biome::GrassFlowersYellow => (0, 13),
                Biome::GrassFlowersBlue => (0, 14),
                Biome::GrassFlowersPurple => (0, 15),
                Biome::Lava => (0, 24),
                Biome::Farmland => (0, 25),
            },
            Stockable::ConstructionTile(construction) => match construction {
                Construction::Nothing => (6, 1),
                Construction::WoodenFence => (1, 1),
                Construction::MetalFence => (1, 15),
                Construction::DarkRock => (1, 2),
                Construction::LightWall => (1, 3),
                Construction::Counter => (1, 4),
                Construction::Library => (1, 5),
                Construction::TallGrass => (1, 8),
                Construction::Forest => (1, 6),
                Construction::Bamboo => (1, 7),
                Construction::Box => (1, 9),
                Construction::Rail => (1, 10),
                Construction::StoneWall => (1, 11),
                Construction::IndicatorArrow => (1, 12),
                Construction::Bridge => (1, 13),
                Construction::Broadleaf => (1, 14),
                Construction::StoneBox => (3, 16),
                Construction::SpoiledTree => (2, 14),
                Construction::WineTree => (8, 9),
                Construction::SolarPanel => (8, 10)
            },
            Stockable::Entity(species) => species.inventory_texture_offset,
        };
        IntRect::new(x, y, 1, 1)
    }
}

impl Stockable {
    fn ui(&self, index: usize, selected_index: usize) -> View {
        let selected_size = 1.5 - 2.0 * Spacing::XS.unscaled_value() / TILE_SIZE;

        if index == selected_index {
            zstack!(
                Spacing::XS,
                COLOR_YELLOW,
                texture!(
                    SPRITE_SHEET_INVENTORY,
                    self.texture_source_rect(),
                    Vector2d::new(selected_size, selected_size)
                )
            )
        } else {
            texture!(
                SPRITE_SHEET_INVENTORY,
                self.texture_source_rect(),
                Vector2d::new(1.5, 1.5)
            )
        }
    }
}

impl MapEditor {
    fn all_possible_items() -> Vec<Stockable> {
        let mut all = vec![
            Stockable::BiomeTile(Biome::Water),
            Stockable::BiomeTile(Biome::Desert),
            Stockable::BiomeTile(Biome::Grass),
            Stockable::BiomeTile(Biome::DarkGrass),
            Stockable::BiomeTile(Biome::GrassFlowersRed),
            Stockable::BiomeTile(Biome::GrassFlowersYellow),
            Stockable::BiomeTile(Biome::GrassFlowersBlue),
            Stockable::BiomeTile(Biome::GrassFlowersPurple),
            Stockable::BiomeTile(Biome::Rock),
            Stockable::BiomeTile(Biome::DarkRock),
            Stockable::BiomeTile(Biome::Snow),
            Stockable::BiomeTile(Biome::LightWood),
            Stockable::BiomeTile(Biome::DarkWood),
            Stockable::BiomeTile(Biome::RockPlates),
            Stockable::BiomeTile(Biome::Ice),
            Stockable::BiomeTile(Biome::Lava),
            Stockable::BiomeTile(Biome::Farmland),
            Stockable::ConstructionTile(Construction::Nothing),
            Stockable::ConstructionTile(Construction::WoodenFence),
            Stockable::ConstructionTile(Construction::MetalFence),
            Stockable::ConstructionTile(Construction::DarkRock),
            Stockable::ConstructionTile(Construction::LightWall),
            Stockable::ConstructionTile(Construction::Counter),
            Stockable::ConstructionTile(Construction::Library),
            Stockable::ConstructionTile(Construction::TallGrass),
            Stockable::ConstructionTile(Construction::Forest),
            Stockable::ConstructionTile(Construction::Bamboo),
            Stockable::ConstructionTile(Construction::Box),
            Stockable::ConstructionTile(Construction::Rail),
            Stockable::ConstructionTile(Construction::StoneWall),
            Stockable::ConstructionTile(Construction::IndicatorArrow),
            Stockable::ConstructionTile(Construction::Bridge),
            Stockable::ConstructionTile(Construction::Broadleaf),
            Stockable::ConstructionTile(Construction::StoneBox),
            Stockable::ConstructionTile(Construction::SpoiledTree),
            Stockable::ConstructionTile(Construction::WineTree),
            Stockable::ConstructionTile(Construction::SolarPanel)
        ];
        let mut species: Vec<Stockable> = ALL_SPECIES
            .iter()
            .filter(|s| s.id != SPECIES_HERO)
            .map(|s| Stockable::Entity(s.clone()))
            .collect();
        all.append(&mut species);
        all
    }
}

impl MapEditor {
    pub fn ui(&self, camera_viewport: &IntRect) -> View {
        scaffold(
            self.uses_backdrop(),
            self.background_color(),
            Some(MENU_BORDERS_TEXTURES),
            match self.state {
                MapEditorState::SelectingItem(selected_index) => self.regular_ui(selected_index),
                MapEditorState::PlacingItem(_, _, ref frame) => {
                    self.placement_ui(camera_viewport, frame)
                }
            },
        )
    }

    fn uses_backdrop(&self) -> bool {
        !matches!(self.state, MapEditorState::PlacingItem(_, _, _))
    }

    fn background_color(&self) -> NonColor {
        match self.state {
            MapEditorState::PlacingItem(_, _, _) => COLOR_BLACK_50,
            MapEditorState::SelectingItem(_) => COLOR_BLACK,
        }
    }

    fn placement_ui(&self, camera_viewport: &IntRect, frame: &IntRect) -> View {
        vstack!(
            Spacing::MD,
            text!(Typography::Regular, "map_editor.placement".localized()),
            with_fixed_position(
                Vector2d::new(
                    TILE_SIZE * (frame.x - camera_viewport.x) as f32,
                    TILE_SIZE * (frame.y - camera_viewport.y) as f32,
                ),
                zstack!(
                    Spacing::Zero,
                    COLOR_RED_60,
                    spacing!(Spacing::Custom(TILE_SIZE * frame.w as f32))
                )
            )
        )
    }

    fn regular_ui(&self, selected_item_index: usize) -> View {
        let mut ui_elements = vec![
            text!(Typography::Title, "map_editor.title".localized()),
            text!(Typography::Regular, "map_editor.subtitle".localized()),
            View::VGrid {
                spacing: GridSpacing::sm(),
                columns: self.columns,
                children: self
                    .stock
                    .iter()
                    .enumerate()
                    .map(|(index, item)| item.ui(index, selected_item_index))
                    .collect(),
            },
        ];

        if self.offset > 0 {
            ui_elements.push(text!(Typography::Regular, "^".to_string()));
        }

        View::VStack {
            spacing: Spacing::LG,
            children: ui_elements,
        }
    }
}
