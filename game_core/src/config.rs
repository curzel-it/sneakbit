use std::path::PathBuf;

pub struct Config {
    pub base_entity_speed: f32,
    pub current_lang: String,
    pub levels_path: PathBuf,
    pub species_path: PathBuf,
    pub inventory_path: PathBuf,
    pub key_value_storage_path: PathBuf,
    pub localized_strings_path: PathBuf,
}

static mut CONFIG: *mut Config = std::ptr::null_mut();

pub fn config() -> &'static Config {
    unsafe {
        &*CONFIG
    }
}

pub fn initialize_config_paths(
    base_entity_speed: f32,
    user_lang: String,
    levels_path: PathBuf,
    species_path: PathBuf,
    inventory_path: PathBuf,
    key_value_storage_path: PathBuf,
    localized_strings_path: PathBuf,
) {
    unsafe {
        let supported_languages = vec!["en", "it"];
        let user_lang_supported = supported_languages.contains(&user_lang.as_str());
        let actual_lang = if user_lang_supported { user_lang } else { "en".to_string() };

        let config = Config {
            base_entity_speed,
            current_lang: actual_lang,
            levels_path,
            species_path,
            inventory_path,
            key_value_storage_path,
            localized_strings_path
        };
        let boxed = Box::new(config);
        CONFIG = Box::into_raw(boxed);      
    }
}
