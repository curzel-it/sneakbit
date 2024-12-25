#ifndef GAME_CORE_H
#define GAME_CORE_H

#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

#define BUILD_NUMBER 40

#define UNLIMITED_LIFESPAN -420.0

#define NO_PARENT 0

#define PRESSURE_PLATE_SWITCH_COOLDOWN 0.3

#define HERO_RECOVERY_PS 1.0

#define MAX_PLAYERS 4

#define TURN_DURATION 10.0

#define TURN_DURATION_AFTER_RANGED_WEAPON_USAGE 3.0

#define KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS_FIRST 0.4

#define KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS 0.1

#define PLAYER1_INDEX 0

#define PLAYER1_ENTITY_ID 420

#define PLAYER2_INDEX 1

#define PLAYER2_ENTITY_ID 421

#define PLAYER3_INDEX 2

#define PLAYER3_ENTITY_ID 422

#define PLAYER4_INDEX 3

#define PLAYER4_ENTITY_ID 423

#define WORLD_ID_NONE 1000

#define ANIMATIONS_FPS 10.0

#define WORLD_TRANSITION_TIME 0.3

#define MENU_CLOSE_TIME 0.2

#define MENU_OPEN_TIME 0.1

#define Z_INDEX_OVERLAY 99

#define Z_INDEX_UNDERLAY -1

#define HOUSE_INTERIOR_ROWS 6

#define HOUSE_INTERIOR_COLUMNS 10

#define TILE_VARIATIONS_FPS 0.75

#define TILE_SIZE 16.0

#define BIOME_NUMBER_OF_FRAMES 4

#define STEP_COMMITMENT_THRESHOLD (TILE_SIZE / 4.0)

#define SPRITE_SHEET_BLANK 1000

#define SPRITE_SHEET_INVENTORY 1001

#define SPRITE_SHEET_BIOME_TILES 1002

#define SPRITE_SHEET_CONSTRUCTION_TILES 1003

#define SPRITE_SHEET_BUILDINGS 1004

#define SPRITE_SHEET_HUMANOIDS_1X2 1009

#define SPRITE_SHEET_STATIC_OBJECTS 1010

#define SPRITE_SHEET_MENU 1011

#define SPRITE_SHEET_ANIMATED_OBJECTS 1012

#define SPRITE_SHEET_HUMANOIDS_1X1 1014

#define SPRITE_SHEET_HUMANOIDS_2X2 1016

#define SPRITE_SHEET_CAVE_DARKNESS 1019

#define SPRITE_SHEET_DEMON_LORD_DEFEAT 1020

#define SPRITE_SHEET_TENTACLES 1021

#define SPRITE_SHEET_WEAPONS 1022

#define SPRITE_SHEET_MONSTERS 1023

#define SPRITE_SHEET_HEROES 1024

#define SPECIES_HERO 1001

#define SPECIES_NPC_SHOP_CLERK 3008

#define SPECIES_STAIRS_UP 1010

#define SPECIES_STAIRS_DOWN 1011

#define SPECIES_SEAT_GREEN 1013

#define SPECIES_TABLE 1016

#define SPECIES_KEY_YELLOW 2000

#define SPECIES_KEY_RED 2001

#define SPECIES_KEY_GREEN 2002

#define SPECIES_KEY_BLUE 2003

#define SPECIES_KEY_SILVER 2004

#define SPECIES_KUNAI_BUNDLE 7001

#define SPECIES_TELEPORTER 1019

#define SPECIES_MR_MUGS 1131

#define SPECIES_FOOTSTEPS 1136

#define SPECIES_MONSTER_SMALL 4003

#define SPECIES_MONSTER 4004

#define SPECIES_MONSTER_BLUEBERRY 4005

#define SPECIES_MONSTER_STRAWBERRY 4006

#define SPECIES_MONSTER_GOOSEBERRY 4007

#define SPECIES_KUNAI 7000

#define SPECIES_KUNAI_LAUNCHER 1160

#define SPECIES_SWORD 1159

#define SPECIES_AR15 1154

#define SPECIES_AR15_BULLET 1169

#define SPECIES_CANNON 1167

#define SPECIES_CANNON_BULLET 1170

#define SPECIES_DAMAGE_INDICATOR 1178

#define SPECIES_BARREL_PURPLE 1038

#define SPECIES_BARREL_GREEN 1039

#define SPECIES_BARREL_BROWN 1073

#define SPECIES_BARREL_WOOD 1074

typedef enum FastTravelDestination {
  FastTravelDestination_Evergrove = 1001,
  FastTravelDestination_Aridreach = 1003,
  FastTravelDestination_Duskhaven = 1011,
  FastTravelDestination_PeakLevel = 1020,
  FastTravelDestination_Maritide = 1008,
  FastTravelDestination_Thermoria = 1006,
  FastTravelDestination_Vintoria = 1012,
} FastTravelDestination;

typedef enum GameMode {
  GameMode_RealTimeCoOp = 0,
  GameMode_Creative = 1,
  GameMode_TurnBasedPvp = 2,
} GameMode;

typedef enum SoundEffect {
  SoundEffect_AmmoCollected = 1,
  SoundEffect_KeyCollected = 2,
  SoundEffect_KnifeThrown = 3,
  SoundEffect_BulletBounced = 4,
  SoundEffect_DeathOfMonster = 5,
  SoundEffect_DeathOfNonMonster = 6,
  SoundEffect_SmallExplosion = 7,
  SoundEffect_NoAmmo = 8,
  SoundEffect_GameOver = 9,
  SoundEffect_PlayerResurrected = 10,
  SoundEffect_WorldChange = 11,
  SoundEffect_StepTaken = 12,
  SoundEffect_HintReceived = 13,
  SoundEffect_SwordSlash = 14,
  SoundEffect_GunShot = 15,
  SoundEffect_LoudGunShot = 16,
} SoundEffect;

typedef enum ToastMode {
  ToastMode_Regular = 0,
  ToastMode_Hint,
  ToastMode_LongHint,
} ToastMode;

typedef struct Option_Toast Option_Toast;

typedef struct IntRect {
  int32_t x;
  int32_t y;
  int32_t w;
  int32_t h;
} IntRect;

typedef struct Vector2d {
  float x;
  float y;
} Vector2d;

typedef struct RenderableItem {
  uint32_t sprite_sheet_id;
  struct IntRect texture_rect;
  struct Vector2d offset;
  struct IntRect frame;
  uint32_t sorting_key;
} RenderableItem;

typedef struct CDisplayableMessage {
  bool is_valid;
  const char *title;
  const char *text;
} CDisplayableMessage;

typedef struct CToastImage {
  bool is_valid;
  uint32_t sprite_sheet_id;
  struct IntRect texture_frame;
} CToastImage;

typedef struct CToast {
  bool is_valid;
  const char *text;
  enum ToastMode mode;
  float duration;
  struct CToastImage image;
} CToast;

typedef struct CMatchResult {
  uintptr_t winner;
  bool unknown_winner;
  bool game_over;
  bool in_progress;
} CMatchResult;

void initialize_game(enum GameMode mode);

void window_size_changed(float width, float height, float scale);

void update_game(float time_since_last_update);

void update_keyboard(uintptr_t player,
                     bool up_pressed,
                     bool right_pressed,
                     bool down_pressed,
                     bool left_pressed,
                     bool up_down,
                     bool right_down,
                     bool down_down,
                     bool left_down,
                     bool escape_pressed,
                     bool menu_pressed,
                     bool confirm_pressed,
                     bool close_attack_pressed,
                     bool ranged_attack_pressed,
                     bool weapon_selection_pressed,
                     bool backspace_pressed,
                     float time_since_last_update);

void update_mouse(bool mouse_left_down,
                  bool mouse_left_pressed,
                  bool mouse_right_down,
                  bool mouse_right_pressed,
                  float mouse_x,
                  float mouse_y,
                  float rendering_scale);

struct RenderableItem *get_renderables(uintptr_t *length);

void free_renderables(struct RenderableItem *ptr, uintptr_t length);

void initialize_config(bool is_mobile,
                       float base_entity_speed,
                       const char *current_lang,
                       const char *levels_path,
                       const char *species_path,
                       const char *key_value_storage_path,
                       const char *localized_strings_path);

int32_t current_biome_tiles_variant(void);

int32_t current_world_width(void);

int32_t current_world_height(void);

struct IntRect camera_viewport(void);

struct Vector2d camera_viewport_offset(void);

uint32_t current_world_id(void);

int32_t number_of_kunai_in_inventory(uintptr_t player);

int32_t number_of_rem223_in_inventory(uintptr_t player);

int32_t number_of_cannonball_in_inventory(uintptr_t player);

float player_current_hp(uintptr_t player);

bool is_melee_equipped(uintptr_t player);

bool is_day(void);

bool is_night(void);

bool is_limited_visibility(void);

bool is_interaction_available(void);

void start_new_game(void);

enum SoundEffect *get_current_sound_effects(uintptr_t *length);

void free_sound_effects(enum SoundEffect *ptr, uintptr_t length);

const char *current_soundtrack(void);

bool is_pvp(void);

struct CDisplayableMessage next_message_c(void);

const struct Option_Toast *next_toast(void);

struct CToast next_toast_c(void);

struct CMatchResult match_result_c(void);

void revive(void);

bool did_request_fast_travel(void);

void cancel_fast_travel(void);

void handle_fast_travel(enum FastTravelDestination destination);

enum FastTravelDestination *available_fast_travel_destinations_from_current_world_c(uintptr_t *length);

void free_fast_travel_destinations(enum FastTravelDestination *ptr, uintptr_t length);

bool did_request_pvp_arena(void);

void cancel_pvp_arena_request(void);

void exit_pvp_arena(void);

void handle_pvp_arena(uintptr_t number_of_players);

uintptr_t current_player_index(void);

#endif  /* GAME_CORE_H */
