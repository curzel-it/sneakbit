use game_core::{constants::WORLD_TRANSITION_TIME, text, ui::components::{Typography, View}, utils::animator::Animator};

use super::context::GameContext;

pub fn update_loading_screen(context: &mut GameContext, time_since_last_update: f32) {
    context.loading_screen.update(time_since_last_update);
}

pub struct LoadingScreen {
    pub text: String,
    animator: Animator,
}

impl LoadingScreen {
    pub fn new() -> Self {
        Self {
            text: "".to_owned(),
            animator: Animator::new(),
        }
    }

    fn update(&mut self, time_since_last_update: f32) {
        self.animator.update(time_since_last_update);
    }

    pub fn is_in_progress(&self) -> bool {
        self.animator.is_active
    }

    pub fn progress(&self) -> f32 {
        self.animator.current_value
    }

    pub fn animate_world_transition(&mut self) {
        self.animator.animate(0.0, 1.0, WORLD_TRANSITION_TIME);
    }

    pub fn ui(&self) -> View {
        text!(Typography::Title, format!("{}", self.text))
    }
}