use crate::game_engine::storage::{get_value_for_global_key, set_value_for_key, StorageKey};

impl StorageKey {
    fn dialogue_answer(dialogue: &str) -> String {
        format!("dialogue.answer.{}", dialogue)
    }

    fn dialogue_reward_collected(dialogue: &str) -> String {
        format!("dialogue.reward.{}", dialogue)
    }
}

pub fn set_dialogue_read(dialogue: &str) {
    set_value_for_key(&StorageKey::dialogue_answer(dialogue), 1);
}

pub fn set_dialogue_reward_collected(dialogue: &str) {
    set_value_for_key(&StorageKey::dialogue_reward_collected(dialogue), 1);    
}

pub fn has_dialogue_reward_been_collected(dialogue: &str) -> bool {
    if let Some(collected) = get_value_for_global_key(&StorageKey::dialogue_reward_collected(dialogue)) {
        collected == 1
    } else {
        false
    }
}
