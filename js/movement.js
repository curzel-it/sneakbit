// Straight-line movement primitive. Mirrors Rust
// movement/straight_movement.rs::move_straight + projected_frames_by_moving_straight.
//
// Used as a building block by features that need ballistic, non-tile-locked
// motion: knockback on hit, ranged-monster projectiles, the minion-ejection
// animation, and (eventually) projectile trail spawning. The hero's own
// movement stays tile-locked in player.js — knockback callers temporarily
// take the hero out of step state and drive it through this primitive.
//
// Speed is in tiles-per-second (matches how species.base_speed is stored).
// `direction` accepts both Rust-style "Up"/"Down"/... and lowercase.

const DELTA = {
  up:    { x:  0, y: -1 },
  down:  { x:  0, y:  1 },
  left:  { x: -1, y:  0 },
  right: { x:  1, y:  0 },
  none:  { x:  0, y:  0 },
};

function vec(direction) {
  if (!direction) return DELTA.none;
  return DELTA[direction.toLowerCase()] ?? DELTA.none;
}

// Returns the frame this entity *would* occupy if it kept moving straight
// for `dt` seconds at `speed`. Pure — does not mutate `frame`.
export function projectStraight(frame, direction, speed, dt) {
  const d = vec(direction);
  return {
    x: frame.x + d.x * speed * dt,
    y: frame.y + d.y * speed * dt,
    w: frame.w,
    h: frame.h,
  };
}

// Steps `frame` in place by one slice of motion. Returns true if the step
// was applied, false if it was rejected (zero speed, no direction, or the
// step would leave the zone). The zone bounds check matches Rust: the
// projected hittable frame must stay inside zone.bounds (cols × rows).
export function moveStraight(frame, direction, speed, dt, zone) {
  if (!speed || speed === 0) return false;
  const d = vec(direction);
  if (d.x === 0 && d.y === 0) return false;
  const next = projectStraight(frame, direction, speed, dt);
  if (!zoneContains(zone, next)) return false;
  frame.x = next.x;
  frame.y = next.y;
  return true;
}

function zoneContains(zone, frame) {
  if (!zone) return true;
  if (frame.x < 0 || frame.y < 0) return false;
  if (frame.x + frame.w > zone.cols) return false;
  if (frame.y + frame.h > zone.rows) return false;
  return true;
}
