#ifndef GAME_CORE_H
#define GAME_CORE_H

#include <stdarg.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdlib.h>

#define ANIMATIONS_FPS 10.0

#define WORLD_SIZE_ROWS 80

#define WORLD_SIZE_COLUMNS 120

#define UNLIMITED_LIFESPAN -420.0

#define NO_PARENT 0

#define HERO_KUNAI_COOLDOWN 0.1

#define KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS_FIRST 0.4

#define KEYBOARD_KEY_HOLD_TIME_TO_NEXT_PRESS 0.1

#define HERO_ENTITY_ID 420

#define WORLD_ID_NONE 1000

#define WORLD_ID_DEMO 1001

#define WORLD_TRANSITION_TIME 0.3

#define MENU_CLOSE_TIME 0.2

#define MENU_OPEN_TIME 0.1

#define HOUSE_INTERIOR_ROWS 6

#define HOUSE_INTERIOR_COLUMNS 10

#define TILE_VARIATIONS_FPS 1.0

#define TILE_SIZE 16.0

#define BIOME_NUMBER_OF_FRAMES 4

#define STEP_COMMITMENT_THRESHOLD (TILE_SIZE / 16.0)

#define SPRITE_SHEET_BLANK 1000

#define SPRITE_SHEET_INVENTORY 1001

#define SPRITE_SHEET_BIOME_TILES 1002

#define SPRITE_SHEET_CONSTRUCTION_TILES 1003

#define SPRITE_SHEET_BUILDINGS 1004

#define SPRITE_SHEET_BASE_ATTACK 1005

#define SPRITE_SHEET_HUMANOIDS_1X2 1009

#define SPRITE_SHEET_STATIC_OBJECTS 1010

#define SPRITE_SHEET_MENU 1011

#define SPRITE_SHEET_ANIMATED_OBJECTS 1012

#define SPRITE_SHEET_HUMANOIDS_1X1 1014

#define SPRITE_SHEET_AVATARS 1015

#define SPRITE_SHEET_HUMANOIDS_2X2 1016

#define SPRITE_SHEET_FARM_PLANTS 1017

#define SPRITE_SHEET_HUMANOIDS_2X3 1018

#define SPECIES_HERO 1001

#define SPECIES_HOUSE_1 1002

#define SPECIES_HOUSE_2 1003

#define SPECIES_HOUSE_3 1004

#define SPECIES_VILLA_2 1010

#define SPECIES_HOUSE_TWO_FLOORS_1 1005

#define SPECIES_HOUSE_TWO_FLOORS_2 1006

#define SPECIES_HOUSE_TWO_FLOORS_3 1007

#define SPECIES_HOUSE_SHOP_1 1070

#define SPECIES_HOUSE_SHOP_2 1071

#define SPECIES_HOUSE_SHOP_3 1072

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

#define SPECIES_KUNAI 7000

#define SPECIES_TELEPORTER 1019

#define SPECIES_ZOMBIE 4002

#define SPECIES_GHOST 4003

#define SPECIES_HOMUNCULUS 4004

#define SPECIES_DEEP_HOLE 5001

enum Biome {
  Biome_Nothing = 0,
  Biome_Grass,
  Biome_GrassFlowersRed,
  Biome_GrassFlowersYellow,
  Biome_GrassFlowersBlue,
  Biome_GrassFlowersPurple,
  Biome_Water,
  Biome_Rock,
  Biome_Desert,
  Biome_Snow,
  Biome_DarkWood,
  Biome_LightWood,
  Biome_DarkRock,
  Biome_Ice,
  Biome_DarkGrass,
  Biome_RockPlates,
  Biome_Lava,
  Biome_Farmland,
};
typedef uint32_t Biome;

enum Construction {
  Construction_Nothing = 0,
  Construction_WoodenFence,
  Construction_MetalFence,
  Construction_DarkRock,
  Construction_LightWall,
  Construction_Counter,
  Construction_Library,
  Construction_TallGrass,
  Construction_Forest,
  Construction_Bamboo,
  Construction_Box,
  Construction_Rail,
  Construction_StoneWall,
  Construction_IndicatorArrow,
  Construction_Bridge,
  Construction_Broadleaf,
  Construction_StoneBox,
  Construction_SpoiledTree,
};
typedef uint32_t Construction;

typedef enum ToastMode {
  ToastMode_Regular = 0,
  ToastMode_Important,
} ToastMode;

typedef struct BordersTextures BordersTextures;

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
} RenderableItem;

typedef struct BiomeTile {
  Biome tile_type;
  Biome tile_up_type;
  Biome tile_right_type;
  Biome tile_down_type;
  Biome tile_left_type;
  int32_t texture_offset_x;
  int32_t texture_offset_y;
} BiomeTile;

typedef struct NonColorC {
  uint8_t red;
  uint8_t green;
  uint8_t blue;
  uint8_t alpha;
} NonColorC;

typedef struct ToastImageDescriptorC {
  uint32_t sprite_sheet_id;
  struct IntRect texture_frame;
} ToastImageDescriptorC;

typedef struct ToastDescriptorC {
  struct NonColorC background_color;
  const char *text;
  enum ToastMode mode;
  struct ToastImageDescriptorC image;
} ToastDescriptorC;

typedef struct MenuDescriptorItemC {
  const char *title;
} MenuDescriptorItemC;

typedef struct MenuDescriptorC {
  bool is_visible;
  const char *title;
  const char *text;
  const struct MenuDescriptorItemC *options;
  uint32_t options_count;
} MenuDescriptorC;

typedef struct ConstructionTile {
  Construction tile_type;
  Construction tile_up_type;
  Construction tile_right_type;
  Construction tile_down_type;
  Construction tile_left_type;
  struct IntRect texture_source_rect;
} ConstructionTile;

typedef struct InventoryItem {
  uint32_t species_id;
  uint32_t count;
  struct IntRect texture_source_rect;
} InventoryItem;



void initialize_game(bool creative_mode);

bool is_creative_mode(void);

bool is_game_running(void);

void stop_game(void);

void window_size_changed(float width,
                         float height,
                         float scale,
                         float font_size,
                         float line_spacing);

void update_game(float time_since_last_update);

void update_keyboard(bool up_pressed,
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
                     bool attack_pressed,
                     bool backspace_pressed,
                     uint32_t current_char,
                     float time_since_last_update);

void update_mouse(bool mouse_left_down,
                  bool mouse_left_pressed,
                  bool mouse_right_pressed,
                  float mouse_x,
                  float mouse_y,
                  float rendering_scale);

struct RenderableItem *get_renderables(uintptr_t *length);

void free_renderables(struct RenderableItem *ptr, uintptr_t length);

void initialize_config(float base_entity_speed,
                       const char *current_lang,
                       const char *levels_path,
                       const char *species_path,
                       const char *inventory_path,
                       const char *key_value_storage_path,
                       const char *localized_strings_path);

bool can_render_frame(void);

int32_t current_biome_tiles_variant(void);

int32_t current_world_width(void);

int32_t current_world_height(void);

struct IntRect camera_viewport(void);

struct Vector2d camera_viewport_offset(void);

struct BiomeTile current_world_default_tile(void);

uint32_t current_world_id(void);

uint32_t current_world_revision(void);

struct ToastDescriptorC current_toast(void);

struct MenuDescriptorC current_menu(void);

void free_c_char_ptr(const char *ptr);

float current_loading_screen_progress(void);

bool shows_death_screen(void);

void select_current_menu_option_at_index(uint32_t index);

uint32_t updated_tiles(uint32_t world_id,
                       const struct BiomeTile **out_biome_tiles,
                       const struct ConstructionTile **out_construction_tiles,
                       uintptr_t *out_len_x,
                       uintptr_t *out_len_y);

void free_biome_tiles(struct BiomeTile *tiles_ptr, uintptr_t len_x, uintptr_t len_y);

void free_construction_tiles(struct ConstructionTile *tiles_ptr, uintptr_t len_x, uintptr_t len_y);

struct InventoryItem *inventory_state(uintptr_t *length);

void free_inventory_state(struct InventoryItem *state, uintptr_t items_count);

#endif  /* GAME_CORE_H */
