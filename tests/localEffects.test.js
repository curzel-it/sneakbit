// localEffects holds the guest's short-lived cosmetic flashes (muzzle flash
// for a predicted shot, etc). The lifecycle — spawn, age out, clear — must be
// self-contained and never leak across worlds, since drawing reads this list
// directly. (Drawing itself needs a canvas + loaded sprites, so it's covered
// by e2e, not here.)

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  spawnLocalFlash,
  tickLocalEffects,
  clearLocalEffects,
  _getLocalEffectsForTesting,
} from "../js/localEffects.js?v=20260531c";

function reset() { clearLocalEffects(); }

test("spawnLocalFlash adds an effect; a null speciesId is ignored", () => {
  reset();
  spawnLocalFlash({ speciesId: 7000, x: 3, y: 4, direction: "up" });
  assert.equal(_getLocalEffectsForTesting().length, 1);
  spawnLocalFlash({ speciesId: null, x: 1, y: 1 });
  spawnLocalFlash({ x: 1, y: 1 }); // undefined speciesId
  assert.equal(_getLocalEffectsForTesting().length, 1, "null/undefined speciesId must not spawn");
});

test("tickLocalEffects ages effects out after their lifespan", () => {
  reset();
  spawnLocalFlash({ speciesId: 7000, x: 0, y: 0, lifespan: 0.12 });
  tickLocalEffects(0.05);
  assert.equal(_getLocalEffectsForTesting().length, 1, "still alive mid-lifespan");
  tickLocalEffects(0.10); // total 0.15 > 0.12
  assert.equal(_getLocalEffectsForTesting().length, 0, "expired effect must be dropped");
});

test("a non-positive lifespan falls back to the default (doesn't vanish instantly)", () => {
  reset();
  spawnLocalFlash({ speciesId: 7000, x: 0, y: 0, lifespan: 0 });
  tickLocalEffects(0.05);
  assert.equal(_getLocalEffectsForTesting().length, 1, "default lifespan keeps it alive at 50ms");
});

test("clearLocalEffects drops everything (guest leave / world swap)", () => {
  reset();
  spawnLocalFlash({ speciesId: 7000, x: 1, y: 1 });
  spawnLocalFlash({ speciesId: 7001, x: 2, y: 2 });
  assert.equal(_getLocalEffectsForTesting().length, 2);
  clearLocalEffects();
  assert.equal(_getLocalEffectsForTesting().length, 0);
});

test("tickLocalEffects on an empty list is a cheap no-op (host path)", () => {
  reset();
  tickLocalEffects(0.016);
  assert.equal(_getLocalEffectsForTesting().length, 0);
});
