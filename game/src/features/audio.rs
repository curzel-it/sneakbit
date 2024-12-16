use common_macros::hash_map;
use raylib::prelude::*;

use std::{collections::HashMap, path::PathBuf};

use game_core::{current_sound_effects, current_soundtrack_string, features::sound_effects::{are_sound_effects_enabled, is_music_enabled, SoundEffect}};

use super::paths::root_path;

#[derive(Clone, PartialEq, Eq, Hash)]
pub enum AppSound {
    Effect(SoundEffect),
    Track(String)
}

pub struct SoundContext<'a> {
    pub music_was_enabled: bool,
    pub sound_library: HashMap<AppSound, Sound<'a>>
}

pub fn load_sounds(rl: &mut Result<raylib::prelude::RaylibAudio, RaylibAudioInitError>) -> HashMap<AppSound, Sound> {
    if let Ok(rl) = rl {
        vec![
            (AppSound::Effect(SoundEffect::DeathOfNonMonster), "sfx_deathscream_android7.mp3"),
            (AppSound::Effect(SoundEffect::DeathOfMonster), "sfx_deathscream_human11.mp3"),
            (AppSound::Effect(SoundEffect::SmallExplosion), "sfx_exp_short_hard8.mp3"),
            (AppSound::Effect(SoundEffect::WorldChange), "sfx_movement_dooropen1.mp3"),
            (AppSound::Effect(SoundEffect::StepTaken), "sfx_movement_footsteps1a.mp3"),
            (AppSound::Effect(SoundEffect::KnifeThrown), "sfx_movement_jump12_landing.mp3"),
            (AppSound::Effect(SoundEffect::BulletBounced), "sfx_movement_jump20.mp3"),
            (AppSound::Effect(SoundEffect::HintReceived), "sfx_sound_neutral5.mp3"),
            (AppSound::Effect(SoundEffect::KeyCollected), "sfx_sounds_fanfare3.mp3"),
            (AppSound::Effect(SoundEffect::AmmoCollected), "sfx_sounds_interaction22.mp3"),
            (AppSound::Effect(SoundEffect::GameOver), "sfx_sounds_negative1.mp3"),
            (AppSound::Effect(SoundEffect::PlayerResurrected), "sfx_sounds_powerup1.mp3"), 
            (AppSound::Effect(SoundEffect::NoAmmo), "sfx_wpn_noammo3.mp3"),
            (AppSound::Effect(SoundEffect::SwordSlash), "sfx_wpn_sword2.mp3"),
            (AppSound::Effect(SoundEffect::GunShot), "sfx_wpn_machinegun_loop1.mp3"),
            (AppSound::Effect(SoundEffect::LoudGunShot), "sfx_weapon_shotgun3.mp3"),
            track_track_pair("pol_brave_worm_short.mp3"),
            track_track_pair("pol_cactus_land_short.mp3"),
            track_track_pair("pol_chubby_cat_short.mp3"),
            track_track_pair("pol_clouds_castle_short.mp3"),
            track_track_pair("pol_combat_plan_short.mp3"),
            track_track_pair("pol_flash_run_short.mp3"),
            track_track_pair("pol_king_of_coins_short.mp3"),
            track_track_pair("pol_magical_sun_short.mp3"),
            track_track_pair("pol_nuts_and_bolts_short.mp3"),
            track_track_pair("pol_palm_beach_short.mp3"),
            track_track_pair("pol_pyramid_sands_short.mp3"),
            track_track_pair("pol_spirits_dance_short.mp3"),
            track_track_pair("pol_the_dojo_short.mp3"),
            track_track_pair("pol_final_sacrifice_short.mp3"),
            track_track_pair("pol_code_geek_short.mp3"),

        ]
        .into_iter()
        .filter_map(|(effect, filename)| {
            if let Some(path) = audio_path_for_filename(filename).as_os_str().to_str() {
                if let Ok(mut sound) = rl.new_sound(path) {
                    sound.set_volume(volume_for_sound_effect(&effect));
                    return Some((effect, sound))
                }
            }
            None
        })
        .collect()
    } else {
        hash_map!()
    }
}

pub fn play_sound_effects(context: &SoundContext) {
    let sound_effects = current_sound_effects();
    if sound_effects.is_empty() {
        return
    }
    if !are_sound_effects_enabled() {
        return
    }
    sound_effects.iter().for_each(|effect| {
        let key = &AppSound::Effect(effect.clone());
        if let Some(sound) = context.sound_library.get(key) {
            sound.play();
        }
    })
}

pub fn play_music(context: &mut SoundContext) {
    if is_music_enabled() {
        context.music_was_enabled = true;
        update_sound_track(context);
    } else if context.music_was_enabled {
        context.music_was_enabled = false;
        stop_music(context);
    }
}

pub fn update_sound_track(context: &mut SoundContext) {
    if let Some(track_name) = current_soundtrack_string() {
        if !track_name.is_empty() {
            
            let key = &AppSound::Track(track_name);
            
            if let Some(sound) = context.sound_library.get(key) {
                if !sound.is_playing() {
                    let _ = sound;
                    stop_music(context);
                }
            }            
            if let Some(sound) = context.sound_library.get(key) {
                if !sound.is_playing() {
                    sound.play();
                }
            }
        }
    }
}

fn track_track_pair(filename: &str) -> (AppSound, &str) {
    (AppSound::Track(filename.to_owned()), filename)
}

fn volume_for_sound_effect(sound: &AppSound) -> f32 {
    match sound {
        AppSound::Effect(effect) => match effect {
            SoundEffect::StepTaken => 0.1,
            SoundEffect::KnifeThrown => 0.3,
            SoundEffect::GunShot => 0.8,
            SoundEffect::LoudGunShot => 1.0,
            SoundEffect::BulletBounced => 0.2,
            SoundEffect::WorldChange => 0.7,
            SoundEffect::AmmoCollected => 0.6,
            _ => 0.8
        },
        AppSound::Track(_) => 0.3
    }
}

fn audio_path_for_filename(filename: &str) -> PathBuf {
    let mut path = root_path();
    path.push("audio");
    path.push(filename);
    path
}

fn stop_music(context: &mut SoundContext) {
    let sounds: Vec<AppSound> = context.sound_library.keys().cloned().collect();

    sounds.iter().for_each(|key| {
        if matches!(key, AppSound::Track(_)) {
            if let Some(sound) = context.sound_library.get_mut(key) {
                if sound.is_playing() {
                    sound.stop();
                }
            }
        }
    });
}