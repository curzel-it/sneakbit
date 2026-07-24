// Isometric projection for the experimental polygon renderer (?iso=1).
// Ported from the flyingquake warehouse prototype and adapted to sneakbit's
// tile-space world. The classic 2D renderer stays untouched; this is a
// parallel path that projects live geometry through a rotatable axonometric
// transform and fills flat-shaded polygons.
//
// World space here is *tiles* (floats), matching the sim — unlike flyingquake
// which worked in world pixels. So the tile-diamond size is expressed directly
// in screen pixels per tile.

// Screen size of one tile's iso diamond, and the screen lift of one height
// tier. Feature-local: the iso look is tuned entirely from these three.
export const ISO_TILE_W = 32; // full diamond width in screen px at scale 1
export const ISO_TILE_H = 16; // full diamond height in screen px at scale 1
export const ISO_TIER_H = 20; // screen px a single z tier lifts

export function makeIsoCamera(zone) {
  return {
    cx: (zone?.cols ?? 0) / 2,
    cy: (zone?.rows ?? 0) / 2,
    scale: 2,
    rot: 0, // continuous float; whole values are the 8 classic angles
  };
}

// Azimuth in radians. rot=0 is classic corner-forward iso.
export function isoAzimuth(rot) {
  return (Math.PI / 4) * (1 + rot);
}

// Precompute the per-frame projection constants for a camera + viewport.
export function isoProject(cam, view) {
  const s = cam.scale;
  const a = isoAzimuth(cam.rot);
  const cosA = Math.cos(a), sinA = Math.sin(a);
  const Sx = ISO_TILE_W / 2 * Math.SQRT2; // px per unit along the rotated x axis
  const Sy = ISO_TILE_H / 2 * Math.SQRT2;
  const ccx = (cam.cx * cosA - cam.cy * sinA) * Sx * s;
  const ccy = (cam.cx * sinA + cam.cy * cosA) * Sy * s;
  return {
    s, cosA, sinA, Sx, Sy,
    tierH: ISO_TIER_H,
    ox: view.w / 2 - ccx,
    oy: view.h / 2 - ccy,
  };
}

// Project a world point (tiles x,y, tiers z) to screen. Coordinates couple
// x+y (and z), so this is a single project — no separate axes.
export function isoX(q, wx, wy) {
  return (wx * q.cosA - wy * q.sinA) * q.Sx * q.s + q.ox;
}

export function isoY(q, wx, wy, z = 0) {
  return (wx * q.sinA + wy * q.cosA) * q.Sy * q.s - z * q.tierH * q.s + q.oy;
}

// Painter's-depth of a footprint point: larger = nearer the camera (draw later).
export function isoDepth(q, wx, wy) {
  return wx * q.sinA + wy * q.cosA;
}

// Map a pressed screen direction to a sim grid direction for the current
// rotation, so "up" always heads up-screen regardless of camera heading.
export function isoControlMap(rot) {
  const a = isoAzimuth(rot);
  const c = Math.cos(a), s = Math.sin(a);
  const V = { up: { x: s, y: -c }, down: { x: -s, y: c }, right: { x: c, y: s }, left: { x: -c, y: -s } };
  const OPP = { up: "down", down: "up", right: "left", left: "right" };
  const keys = ["up", "down", "right", "left"];
  let top = keys[0];
  for (const k of keys) {
    if (V[k].y < V[top].y - 1e-9 || (Math.abs(V[k].y - V[top].y) < 1e-9 && V[k].x > V[top].x)) top = k;
  }
  const rem = keys.filter((k) => k !== top && k !== OPP[top]);
  const right = V[rem[0]].x >= V[rem[1]].x ? rem[0] : rem[1];
  return { up: top, down: OPP[top], right, left: OPP[right] };
}
