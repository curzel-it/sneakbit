# Game Description
> Warning!<br>
> This document contains game spoilers and AI generated slope and it's garbage in general.

## Overview
SneakBit game concept combines adventure and action elements, allowing players to explore a world populated by demons and to engage in combat with unique mechanics. The player can throw kunai (small knives) to defeat or weaken demonic creatures encountered throughout various landscapes, immersing the player in a journey with elements of both strategy and action wrapped in a gameboy-like pixel art aesthetics.

### Tiling System
The game operates on a grid-based tile system.
There are two types of tiles:
* Biomes, which act as a background (water, grass, lava, rocky pavement, parquet, ...)
* Constructions, which act as a second layer of elements on the map

Both kinds of tiles can represent an obstacle, the player cannot walk on water, lava and over fences for example, but can walk over grass.
To mimic the effect of density, different construction tiles have different properties, for example some can reflect bullets (walls) while others don't.

### Combat System
The only available weapon are throwing knifes.
Knifes can be found on the ground here and there, the player can pick them up by just walking by.
When pressing FIRE a knife is throw in the direction the player is currently looking at.
The bullet goes perfectly straight until stopped or it expires (3 seconds).

### Skills
The player can complete optional quests to gain special combat skills:
1. Bouncing Knife, which makes knifes bounce off walls, enemies, etc
1. Knife Catcher, which allows the player to put back in the inventory a knife that comes back at him
1. Piercing Knife, which allows knifes to kill immortal enemies and makes them stop bouncing off enemies (while still bouncing off walls)

All skills are passive, stackable and perpetual.

## Plot
### In Short
1. The MC wakes up in a forest, surrounded by a magic circle
1. Nearby, a strange wizard, pretends he has nothing to do with the summoning and tells the MC to go and learn more about this world since he's already here
1. (Optional) MC meets Punk, a weird guy who seems to know something about the MC
1. (Optional) MC can meet with several members of a family of ninjas and acquires combat skills
1. (Optional) MC meets with the scientists that research the Manafren trees and discovers the Demon Lord is still alive and is the reason the number of monsters is increasing
1. (Optional) MC discovers a profecy about a hero
1. (Optional) Wizard tells MC he can try and defeat the Demon Lord if he wants
1. (Optional) Punk is pissed once he discovers the MC wants to defeat the Demon Lord
1. MC discovers he needs to visit every dungeon to retrieve special keys in order to reach Demon Lord location
1. The blue and the black ninjas are the siblings of a girl in Evergrove, which tells them they are the children of the great Red Ninja
1. (Optional) MC meets Punk again in a dungeon while looking for keys, Punk says he's just there to train and kill some monsters
1. (Optional) MC meets Silver, Punk's father, who explain Punk is the real hero, but he decided to ignore his destiny
1. MC reaches Demon Lord location, but Punk is there and defeats him right before his eyes. Turns out Punk was the hero from the profecy all along and was actually getting ready to defeat the demon lord all along.

## Characters
* Dr. Alistair Voss - Head of the Manafren trees research initiative

* Girl with blue hair in Evergrove Village
* Blue Ninja
* Black Ninja
* Red Ninja
* Chief Scientist
* Intern Scientist
* Wizard
* Punk
* Silver 
* Monsters

I also have assets ready for:
* Male soldier/guard
* Red-haired female hero
* Girl with long brown hair
* Girl with short green hair
* Old man
* Old woman
* Young boy

## Quests
The objective of the game is to defeat the Demon Lord, which by necessity leads the player to go through all dungeons in search of special keys.
Aside from that, the world is rich with quests, but they are all optional.

### Main Quest: Hero
The finale is always the same: Punk defeats the Demon Lord instead of the MC.
Completing (or ignoring) the "Hero" quest does not change this fact, but changes the relationship with NPCs, including Punk.
For example, if the MC does not interact with Punk at all, after the Demon Lord defeat Punk will simply as the MC who the hell he is.
Depending on the completion state, Punk might talk with a harsher tone for example.

The quest has the following steps:
1. (Optional) Meet Punk for the first time - Punk is pissed at the fact an outer-worlder has been summoned
2. (Optional) Meet Punk for the second time - Punk expresses doubts about the concept of "a hero"
3. (Optional) Meet Punk for the third time - Punk is pissed as MC seems to follow him
4. (Optional) Meet Punk for the fourth time - Punk is enranged by the mistrust of others
5. (Optional) Meet Silver for the first time - Silver reveals he's Punk's father, the hero profecy is Punk's profecy and Punk has given up of being the hero
6. Reach Demon Lord location - A cutscene shows Punk defeating the Demon Lord
7. (Optional) Talk to Punk - Punk response changes based on the completion state of the quest

Reward: Player wins the game

### Side Quest: Bouncing Knifes
1. (Optional) Meet with the blue-haired girl in Evergrove
1. Meet with the Blue Ninja
1. Meet with his sister in Evergrove
1. Go back to the Blue Ninja

Reward: Bouncing knifes skill

### Side Quest: Knife Catcher
1. (Optional) Meet with the blue-haired girl in Evergrove
1. Meet with the Black Ninja
1. Meet with his sister in Evergrove
1. Go back to the Black Ninja

Reward: Knife catcher skill

### Side Quest: Piercing Knifes
1. (Optional) Meet with the Red Ninja
1. Complete the "Bouncing Knifes" quest
1. Complete the "Knife catcher" quest
1. Meet with the Red Ninja

Reward: Piercing Knife skill

### Side Quest: Manafren Research
1. Meet with Dr Voss
1. (Optional) Talk to the village elder
1. (Optional) Read the scroll in the dungeon
1. Find the old book in the mountains to the East
1. Report your findings to Dr Voss

Reward: 10x Kunai

## Lore
### Locations
#### Evergrove Village (1001)
The small village near the spawn location of the MC.

#### Verdant Way (1002)
A network of paths in the forest near Evergrove that connect various locations:
* Evergrove Village
* Thermoria
* Aridreach
* Shadowveil Path
* Demon Maze

#### Demon Maze (1017)
A dark, misterious maze full of monsters. 
Legend says the throne of the Demon Lord is at the center of the maze.

#### Shadowveil Path (1010)
A network of paths in a dark near Verdant Way that connect various locations:
* Verdant Way
* Duskhaven
* Vintoria

#### Aridreach (1003)
A city built on top of a mountain in the middle of what is now Grimsun desert.
The once lush environment has left way to a vast expanse of sand, on which the largest solar farm of the continent is built.
The city also acts as the passage way to Grimsun Basin, a hot, deathly pile of sand and narrow passages between rocky mountinas.

#### Thermoria (1006)
A group of interconnected islands off the cost of Verdant Way.
A still active volcano, Mount Ignis, is now at the core of a geothermal power plant.
A vast dungeon is accessible from underneath the geothermal plant.

#### Maritide Haven (1008)
Originally a large island, a terrific incident in the underground mine cause the town to collapse under the sea.
Lots of time has passed since then, the landscape now looks like a small arcipelago.
Due to the unique conditions that created the islands and the amount of underground cavities, a series of whirpools surrounds the area.
The remote location is now only accessible from Thermoria using a particular naval route.

#### Duskhaven (1011)
Duskhaven is a small touristic village, the only place where Manafren trees still grow.
The trees are essetial to the town not just as a popular turist attraction, but also as a source of mana.
An ancient underground power plant converts the mana into electricity.
In order to study the trees, there are frequent visits by scientists and researchers from all over the world.

#### Vintoria (1012)
Vintoria is a mountain village, home to the best wineries in the continent.
The river than once carved the valley has been redirected to an hydroelectric power plant.
The basement of the power plant is embedded in the mountain and is built on multiple levels.

### Flora and Fauna
#### Manafren trees
The Manafern Trees, native to the twilight land of Duskhaven, are renowned for their mystical energy properties, marked by vibrant purple leaves that absorb ethereal particles from the soil and air. Through a unique, photosynthesis-like process, the Manaferns convert these particles into pure mana, illuminating the region and powering its ecosystem. However, a darker truth lies beneath their allure: a centuries-old pact with the Demon Lord has embedded fragments of his essence within the trees, making each pulse of mana a subtle extension of his influence. Though they enrich life in Duskhaven, the Manaferns also inch the world closer to his dominion, veiling a sinister force within their radiant glow.