// Death animation lifecycle — pure logic, no DOM. Verifies that a killed
// entity is turned into a centred 1×1 fireball, that re-killing it doesn't
// reset the timer, and that it's removed once its lifespan burns out.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startDeathAnimation,
  tickDeathAnimations,
  isDying,
  DEATH_SPRITE,
} from "../js/deathAnimation.js";
import { getValue, setValue } from "../js/storage.js";

test("startDeathAnimation centres a 1×1 fireball and flags the entity", () => {
  // A 1×2 monster occupying tiles (5,5)-(5,6); centre is (5.5, 6).
  const e = { species_id: 4004, direction: "Down", frame: { x: 5, y: 5, w: 1, h: 2 } };
  startDeathAnimation(e);
  assert.equal(isDying(e), true);
  assert.equal(e.direction, "None");
  assert.deepEqual(e.frame, { x: 5, y: 5.5, w: 1, h: 1 });
});

test("re-killing a dying entity doesn't reset its lifespan", () => {
  const e = { frame: { x: 0, y: 0, w: 1, h: 1 } };
  startDeathAnimation(e);
  const lifespan = e._deathLifespan;
  // simulate some burn, then a stray bullet tries to re-kill it
  e._deathLifespan -= 0.3;
  startDeathAnimation(e);
  assert.ok(e._deathLifespan < lifespan, "lifespan kept counting down, not reset");
});

test("opts.sprite / opts.lifespan / opts.onRemove are honored", () => {
  const e = { frame: { x: 0, y: 0, w: 1, h: 1 } };
  const sprite = { sheet: "animated_objects", texX: 0, texY: 3, frames: 4 };
  let removed = 0;
  startDeathAnimation(e, { sprite, lifespan: 0.4, onRemove: () => removed++ });
  assert.equal(e._deathSprite, sprite, "custom sprite stashed for the renderer");
  assert.equal(e._deathLifespan, 0.4, "custom lifespan used");

  const zone = { entities: [e] };
  tickDeathAnimations(zone, 0.2);
  assert.equal(removed, 0, "onRemove not called mid-burn");
  tickDeathAnimations(zone, 0.3);
  assert.ok(!zone.entities.includes(e), "removed once lifespan expires");
  assert.equal(removed, 1, "onRemove fired exactly once on removal");
});

test("the default call still uses the fireball and no onRemove", () => {
  const e = { frame: { x: 0, y: 0, w: 1, h: 1 } };
  startDeathAnimation(e);
  assert.deepEqual(e._deathSprite, DEATH_SPRITE);
  assert.equal(e._onDeathRemove, null);
});

test("a killed level entity is marked item_collected on removal (gates kill dialogues)", () => {
  // The haunted-pub monster: a static, positive-id zone entity. Once its
  // fireball burns out, item_collected.<id> must be set so the empty seat's
  // reward dialogue unlocks and the monster stays gone on reload.
  const monster = { id: 11767738, species_id: 4004, frame: { x: 6, y: 2, w: 1, h: 2 } };
  setValue(`item_collected.${monster.id}`, 0);
  startDeathAnimation(monster);
  const zone = { id: 11199907, entities: [monster] };
  tickDeathAnimations(zone, 5);
  assert.ok(!zone.entities.includes(monster), "monster removed");
  assert.equal(getValue(`item_collected.${monster.id}`), 1, "collected flag persisted");
});

test("runtime spawns and ephemeral zones don't write item_collected", () => {
  // Minions/coins use negative ids; coins carry _ephemeral; bullets _spawned.
  // None should pollute the save with a collected flag, and an ephemeral zone
  // never persists removals at all (mirrors Rust mark_as_collected_if_needed).
  const minion = { id: -1000001, species_id: 4004, frame: { x: 1, y: 1, w: 1, h: 1 } };
  const coin = { id: -42, _ephemeral: true, species_id: 1, frame: { x: 2, y: 2, w: 1, h: 1 } };
  startDeathAnimation(minion);
  startDeathAnimation(coin);
  const zone = { entities: [minion, coin] };
  tickDeathAnimations(zone, 5);
  assert.equal(getValue(`item_collected.${minion.id}`), null, "negative-id minion not flagged");
  assert.equal(getValue(`item_collected.${coin.id}`), null, "ephemeral coin not flagged");

  const authored = { id: 555, species_id: 4004, frame: { x: 3, y: 3, w: 1, h: 1 } };
  startDeathAnimation(authored);
  const ephemeralZone = { ephemeralState: true, entities: [authored] };
  tickDeathAnimations(ephemeralZone, 5);
  assert.equal(getValue(`item_collected.${authored.id}`), null, "ephemeral zone persists nothing");
});

test("an entity with _onDeathRemove keeps its own removal hook (no double-mark)", () => {
  // afterDialogue's VanishSmoke path persists via onRemove; the generic
  // markDeadCollected must not run for it.
  const e = { id: 777, frame: { x: 0, y: 0, w: 1, h: 1 } };
  setValue(`item_collected.${e.id}`, 0);
  let removed = 0;
  startDeathAnimation(e, { onRemove: () => removed++ });
  const zone = { entities: [e] };
  tickDeathAnimations(zone, 5);
  assert.equal(removed, 1, "onRemove fired");
  assert.equal(getValue(`item_collected.${e.id}`), 0, "generic mark skipped when onRemove present");
});

test("tickDeathAnimations removes the entity after its lifespan expires", () => {
  const fireball = { frame: { x: 1, y: 1, w: 1, h: 1 } };
  const bystander = { species_id: 4004, frame: { x: 9, y: 9, w: 1, h: 1 } };
  startDeathAnimation(fireball);
  const zone = { entities: [fireball, bystander] };

  // Half a second in: still burning.
  tickDeathAnimations(zone, 0.5);
  assert.ok(zone.entities.includes(fireball), "fireball still present mid-burn");

  // Past the 1.0s lifespan: gone, bystander untouched.
  tickDeathAnimations(zone, 0.6);
  assert.ok(!zone.entities.includes(fireball), "fireball removed");
  assert.ok(zone.entities.includes(bystander), "non-dying entity untouched");
});
