// Death animation lifecycle — pure logic, no DOM. Verifies that a killed
// entity is turned into a centred 1×1 fireball, that re-killing it doesn't
// reset the timer, and that it's removed once its lifespan burns out.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  startDeathAnimation,
  tickDeathAnimations,
  isDying,
} from "../js/deathAnimation.js?v=20260530f";

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
