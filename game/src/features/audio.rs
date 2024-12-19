use raylib::prelude::*;

use std::{collections::HashMap, path::PathBuf, sync::mpsc::{self, Sender}, thread};

use game_core::{current_sound_effects, current_soundtrack_string, features::sound_effects::{are_sound_effects_enabled, is_music_enabled, SoundEffect}};

use crate::GameContext;

use super::paths::root_path;

#[derive(Clone, PartialEq, Eq, Hash, Debug)]
pub enum AppSound {
    Effect(SoundEffect),
    Track(String),
}

pub enum AudioCommand {
    PlaySoundEffect(SoundEffect),
    PlayMusic(String),
    StopMusic,
}

pub struct AudioManager {
    sender: Sender<AudioCommand>,
}

pub fn play_audio(context: &GameContext) {
    play_sound_effects(context);
    play_music(context);
}

impl AudioManager {
    pub fn new() -> Self {
        let (sender, receiver) = mpsc::channel();

        thread::spawn(move || {
            let mut rl_audio = match RaylibAudio::init_audio_device() {
                Ok(audio) => audio,
                Err(e) => {
                    eprintln!("Failed to initialize audio device: {:?}", e);
                    return;
                }
            };

            let mut sound_library = load_sounds(&mut rl_audio);
            let mut current_track: Option<AppSound> = None;

            for command in receiver {
                match command {
                    AudioCommand::PlaySoundEffect(effect) => {
                        let key = AppSound::Effect(effect);
                        if let Some(sound) = sound_library.get(&key) {
                            sound.play();
                        }
                    }
                    AudioCommand::PlayMusic(track_name) => {
                        let key = AppSound::Track(track_name.clone());

                        if current_track.as_ref() != Some(&key) {
                            stop_music(&mut sound_library);
                        }
                        if let Some(sound) = sound_library.get(&key) {
                            if !sound.is_playing() {
                                sound.play();
                            }
                            current_track = Some(key);
                        }
                    }
                    AudioCommand::StopMusic => {
                        stop_music(&mut sound_library);
                        current_track = None;
                    }
                }
            }
        });

        AudioManager { sender }
    }

    pub fn play_sound_effect(&self, effect: SoundEffect) {
        let _ = self.sender.send(AudioCommand::PlaySoundEffect(effect));
    }

    pub fn play_music(&self, track_name: String) {
        let _ = self.sender.send(AudioCommand::PlayMusic(track_name));
    }

    pub fn stop_music(&self) {
        let _ = self.sender.send(AudioCommand::StopMusic);
    }
}

fn load_sounds(rl_audio: &mut RaylibAudio) -> HashMap<AppSound, Sound> {
    let sound_filenames = vec![
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
    ];

    let mut sound_library = HashMap::new();

    for (app_sound, filename) in sound_filenames {
        let path = audio_path_for_filename(filename);
        if let Some(path_str) = path.to_str() {
            if let Ok(mut sound) = rl_audio.new_sound(path_str) {
                sound.set_volume(volume_for_sound_effect(&app_sound));
                sound_library.insert(app_sound, sound);
            } else {
                eprintln!("Failed to load sound: {}", filename);
            }
        } else {
            eprintln!("Invalid path for sound: {}", filename);
        }
    }

    sound_library
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
            _ => 0.8,
        },
        AppSound::Track(_) => 0.3,
    }
}

fn audio_path_for_filename(filename: &str) -> PathBuf {
    let mut path = root_path();
    path.push("audio");
    path.push(filename);
    path
}

fn stop_music(sound_library: &mut HashMap<AppSound, Sound<'_>>) {
    let keys: Vec<AppSound> = sound_library.keys().cloned().collect();
    for key in keys {
        if let AppSound::Track(_) = key {
            if let Some(sound) = sound_library.get_mut(&key) {
                if sound.is_playing() {
                    sound.stop();
                }
            }
        }
    }
}

fn play_sound_effects(context: &GameContext) {
    let sound_effects = current_sound_effects();
    if sound_effects.is_empty() {
        return;
    }
    if !are_sound_effects_enabled() {
        return;
    }
    for effect in sound_effects.iter() {
        context.audio_manager.play_sound_effect(effect.clone());
    }
}

fn play_music(context: &GameContext) {
    if is_music_enabled() {
        if let Some(track_name) = current_soundtrack_string() {
            if !track_name.is_empty() {
                context.audio_manager.play_music(track_name.clone());
            }
        }
    } else {
        context.audio_manager.stop_music();
    }
}