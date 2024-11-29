use crate::{entities::species::{EntityType, SPECIES_NONE}, game_engine::{entity::Entity, keyboard_events_provider::KeyboardEventsProvider, locks::LockType, state_updates::{EngineStateUpdate, WorldStateUpdate}}, is_creative_mode, lang::localizable::LocalizableText, ui::components::View};
use super::{menu::{Menu, MenuItem, MenuUpdate}, text_input::TextInput};

#[derive(Debug, Clone)]
pub enum EntityOptionMenuItem {
    Remove,
    Rename,
    ToggleDemandAttention,
    ChangeLock,
    ChangeDestinationWorld,
    ChangeDestinationX,
    ChangeDestinationY,
}

impl MenuItem for EntityOptionMenuItem {
    fn title(&self) -> String {
        match self {
            EntityOptionMenuItem::Remove => "entity.menu.remove".localized(),
            EntityOptionMenuItem::Rename => "entity.menu.rename".localized(),
            EntityOptionMenuItem::ToggleDemandAttention => "entity.menu.toggle_demand_attention".localized(),
            EntityOptionMenuItem::ChangeLock => "entity.menu.change_lock".localized(),
            EntityOptionMenuItem::ChangeDestinationWorld => "entity.menu.change_destination_world".localized(),
            EntityOptionMenuItem::ChangeDestinationX => "entity.menu.change_destination_x".localized(),
            EntityOptionMenuItem::ChangeDestinationY => "entity.menu.change_destination_y".localized(),
        }
    }
}

impl MenuItem for LockType {
    fn title(&self) -> String {
        self.localized_name()
    }
}

pub enum EntityOptionsMenuState {
    Closed,
    ChangingName,
    ChangingLock,
    ChangingDestinationWorld,
    ChangingDestinationX,
    ChangingDestinationY,
}

pub struct EntityOptionsMenu {
    entity: Box<Entity>,
    time_since_last_closed: f32,
    pub menu: Menu<EntityOptionMenuItem>,
    state: EntityOptionsMenuState,
    text_input: TextInput,
    lock_menu: Menu<LockType>
}

impl EntityOptionsMenu {
    pub fn new() -> Self {
        Self {
            entity: Box::new(SPECIES_NONE.make_entity()),
            time_since_last_closed: 1.0,
            menu: Menu::new("entity.menu.title".localized(), vec![]),
            state: EntityOptionsMenuState::Closed,
            text_input: TextInput::new(),
            lock_menu: Menu::new("entity.menu.change_lock_title".localized(), vec![
                LockType::None,
                LockType::Yellow,
                LockType::Red,
                LockType::Blue,
                LockType::Green,
                LockType::Silver,
                LockType::Permanent,
            ])
        }
    }

    pub fn show(&mut self, entity: Box<Entity>) {
        if self.time_since_last_closed < 0.5 {
            return;
        }
        self.entity = entity;
        self.time_since_last_closed = 0.0;
        self.menu.items = self.available_options();

        if self.menu.items.is_empty() {
            return
        }

        if is_creative_mode() {
            self.menu.title = format!("{} #{}", self.entity.name, self.entity.id);
        } else {
            self.menu.title = self.entity.name.clone();
        }
        self.menu.show();
        self.state = EntityOptionsMenuState::Closed;
    }

    pub fn is_open(&self) -> bool {
        self.menu.is_open
    }

    pub fn update(&mut self, keyboard: &KeyboardEventsProvider, time_since_last_update: f32) -> MenuUpdate {
        if !self.menu.is_open {
            self.time_since_last_closed += time_since_last_update;
        }

        match self.state {
            EntityOptionsMenuState::ChangingName => {
                self.update_from_text_input(keyboard, time_since_last_update, vec![
                        WorldStateUpdate::RenameEntity(self.entity.id, self.current_text()),
                        WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame)
                    ]
                )
            },
            EntityOptionsMenuState::ChangingDestinationWorld => {
                self.update_from_text_input(keyboard, time_since_last_update, vec![
                        WorldStateUpdate::UpdateDestinationWorld(self.entity.id, self.current_u32()),
                        WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame)
                    ]
                )
            },
            EntityOptionsMenuState::ChangingDestinationX => {
                self.update_from_text_input(keyboard, time_since_last_update, vec![
                        WorldStateUpdate::UpdateDestinationX(self.entity.id, self.current_i32()),
                        WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame)
                    ]
                )
            },
            EntityOptionsMenuState::ChangingDestinationY => {
                self.update_from_text_input(keyboard, time_since_last_update, vec![
                        WorldStateUpdate::UpdateDestinationY(self.entity.id, self.current_i32()),
                        WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame)
                    ]
                )
            },
            EntityOptionsMenuState::ChangingLock => self.update_from_change_lock(keyboard, time_since_last_update),
            EntityOptionsMenuState::Closed => self.update_from_close(keyboard, time_since_last_update),
        }
    }

    fn update_from_text_input(
        &mut self, 
        keyboard: &KeyboardEventsProvider, 
        time_since_last_update: f32,
        updates: Vec<WorldStateUpdate>
    ) -> MenuUpdate {
        self.text_input.update(keyboard, time_since_last_update);

        if self.text_input.did_confirm() {
            self.menu.close();
            self.state = EntityOptionsMenuState::Closed;
            self.text_input.clear();
            return (false, updates);
        } else if self.text_input.did_cancel() {
            self.state = EntityOptionsMenuState::Closed;
            self.text_input.clear();
        }
        (self.menu.is_open, vec![])
    }

    fn update_from_change_lock(&mut self, keyboard: &KeyboardEventsProvider, time_since_last_update: f32) -> MenuUpdate {
        self.lock_menu.update(keyboard, time_since_last_update);

        if self.lock_menu.selection_has_been_confirmed {
            let selected_lock = self.lock_menu.selected_item();
            self.lock_menu.clear_selection();
            self.lock_menu.close();
            self.menu.clear_selection();
            self.menu.close();
            self.state = EntityOptionsMenuState::Closed;

            return (false, vec![
                WorldStateUpdate::ChangeLock(self.entity.id, selected_lock),
                WorldStateUpdate::EngineUpdate(EngineStateUpdate::SaveGame)
            ]);
        }
        if !self.lock_menu.is_open {
            self.lock_menu.clear_selection();
            self.lock_menu.close();
            self.menu.clear_selection();
            self.menu.close();
            self.state = EntityOptionsMenuState::Closed;
        }

        (self.menu.is_open, vec![])
    }

    fn update_from_close(&mut self, keyboard: &KeyboardEventsProvider, time_since_last_update: f32) -> MenuUpdate {
        self.menu.update(keyboard, time_since_last_update);
        
        if self.is_open() && self.menu.selection_has_been_confirmed {
            let updates = match self.menu.selected_item() {
                EntityOptionMenuItem::Remove => {
                    self.menu.clear_selection();
                    self.menu.close();
                    vec![WorldStateUpdate::RemoveEntity(self.entity.id)]
                },
                EntityOptionMenuItem::Rename => {
                    self.menu.clear_selection();
                    self.ask_for_new_name();
                    vec![]
                },
                EntityOptionMenuItem::ToggleDemandAttention => {
                    self.menu.clear_selection();
                    self.menu.close();
                    vec![
                        WorldStateUpdate::ToggleDemandAttention(self.entity.id),
                    ]
                },
                EntityOptionMenuItem::ChangeLock => {
                    self.menu.clear_selection();
                    self.ask_for_lock_type();
                    vec![]
                },
                EntityOptionMenuItem::ChangeDestinationWorld => {
                    self.menu.clear_selection();
                    self.ask_for_new_destination_world();
                    vec![]
                },
                EntityOptionMenuItem::ChangeDestinationX => {
                    self.menu.clear_selection();
                    self.ask_for_new_destination_x();
                    vec![]
                },
                EntityOptionMenuItem::ChangeDestinationY => {
                    self.menu.clear_selection();
                    self.ask_for_new_destination_y();
                    vec![]
                },
            };
            return (self.menu.is_open, updates);
        }

        (self.menu.is_open, vec![])
    }

    pub fn ui(&self) -> View {
        match self.state {
            EntityOptionsMenuState::ChangingDestinationWorld => self.text_input.ui(),
            EntityOptionsMenuState::ChangingDestinationX => self.text_input.ui(),
            EntityOptionsMenuState::ChangingDestinationY => self.text_input.ui(),
            EntityOptionsMenuState::ChangingName => self.text_input.ui(),
            EntityOptionsMenuState::ChangingLock => self.lock_menu.ui(),
            EntityOptionsMenuState::Closed => self.menu.ui(),
        }
    }

    fn ask_for_lock_type(&mut self) {
        self.state = EntityOptionsMenuState::ChangingLock;
        self.lock_menu.show();
    }

    fn ask_for_new_name(&mut self) {
        self.state = EntityOptionsMenuState::ChangingName;
        self.text_input.clear();
        self.text_input.title = "entity.menu.rename_title".localized();
    }

    fn ask_for_new_destination_world(&mut self) {
        self.state = EntityOptionsMenuState::ChangingDestinationWorld;
        self.text_input.clear();
        self.text_input.title = "entity.menu.change_destination_world".localized();
    }

    fn ask_for_new_destination_x(&mut self) {
        self.state = EntityOptionsMenuState::ChangingDestinationX;
        self.text_input.clear();
        self.text_input.title = "entity.menu.change_destination_x".localized();
    }

    fn ask_for_new_destination_y(&mut self) {
        self.state = EntityOptionsMenuState::ChangingDestinationY;
        self.text_input.clear();
        self.text_input.title = "entity.menu.change_destination_y".localized();
    }

    fn available_options(&self) -> Vec<EntityOptionMenuItem> {
        if is_creative_mode() {
            self.available_options_creative()
        } else {
            vec![]
        }
    }

    fn available_options_creative(&self) -> Vec<EntityOptionMenuItem> {
        let nothing: Vec<EntityOptionMenuItem> = vec![];

        match self.entity.entity_type {
            EntityType::Hero => nothing,
            EntityType::Npc => vec![
                EntityOptionMenuItem::Rename,
                EntityOptionMenuItem::ToggleDemandAttention,
                EntityOptionMenuItem::Remove,
            ],
            EntityType::Teleporter => vec![
                EntityOptionMenuItem::ChangeDestinationWorld,
                EntityOptionMenuItem::ChangeDestinationX,
                EntityOptionMenuItem::ChangeDestinationY,
                EntityOptionMenuItem::ChangeLock
            ],
            _ => vec![
                EntityOptionMenuItem::Remove,
            ],
        }
    }

    pub fn select_option_at_index(&mut self, index: usize) {
        self.menu.selected_index = index;
    }
}

impl EntityOptionsMenu {
    fn current_text(&self) -> String {
        self.text_input.text().trim().to_owned()
    }

    fn current_i32(&self) -> i32 {
        self.current_text().parse().unwrap_or_default()
    }

    fn current_u32(&self) -> u32 {
        self.current_text().parse().unwrap_or_default()
    }
}