// Turns a Building entity into a massed 3D volume for the iso renderer, instead
// of a flat sprite billboard. Every building sprite in buildings.png is a walled
// body (windows/door) under a pitched roof, so we build exactly that: a box for
// the walls topped by a gabled roof. The two colours are sampled once per
// species straight from the sprite, so each variant (orange/brown/green/red/
// stone/snow, intact or ruined) keeps its own palette without hand-authoring.

import { TILE_SIZE } from "./constants.js";
import { getSprite } from "./assets.js";
import { getEntitySheet } from "./species.js";
import { shade } from "./isoGeometry.js";

const colorCache = new Map(); // species id -> { wall, roof }

// Wall + roof heights in tiers, scaled to the footprint so a big house stands
// tall and boxy rather than squat under an oversized roof. The sprite's tile
// height bakes in the roof drawn upward, so we don't map it to ground depth —
// we spend it on Z instead: taller walls, a proper ridge.
function massing(w, h) {
  const s = Math.min(w, h);
  return { eave: s * 0.9, rise: s * 0.7 };
}

// Faces for a building entity whose footprint top-left is (fx,fy) tiles, sized
// (w,h) tiles, resting on ground elevation baseZ. Returns {n,pts,c} faces ready
// for the renderer's per-shape painter sort.
export function buildingFaces(e, sp, baseZ = 0) {
  const f = e.frame;
  const x0 = f.x, y0 = f.y, x1 = f.x + f.w, y1 = f.y + f.h;
  const cy = (y0 + y1) / 2;
  const { eave, rise } = massing(f.w, f.h);
  const ze = baseZ + eave, zr = baseZ + eave + rise;
  const { wall, roof } = buildingColors(sp);

  const faces = [];
  const push = (pts, base) => faces.push({ pts, c: shade(faceNormal(pts), base) });

  // Walls: the four upright sides of the body box (skip the hidden top/bottom).
  push([[x0, y0, baseZ], [x0, y0, ze], [x1, y0, ze], [x1, y0, baseZ]], wall); // -y
  push([[x1, y1, baseZ], [x1, y1, ze], [x0, y1, ze], [x0, y1, baseZ]], wall); // +y
  push([[x0, y1, baseZ], [x0, y1, ze], [x0, y0, ze], [x0, y0, baseZ]], wall); // -x
  push([[x1, y0, baseZ], [x1, y0, ze], [x1, y1, ze], [x1, y1, baseZ]], wall); // +x

  // Gable triangles: the walls carry on up to the ridge on the -x/+x ends.
  push([[x0, y0, ze], [x0, y1, ze], [x0, cy, zr]], wall);
  push([[x1, y1, ze], [x1, y0, ze], [x1, cy, zr]], wall);

  // Roof: two slopes meeting at the ridge (x0..x1 at z=zr, y=cy).
  push([[x0, y0, ze], [x0, cy, zr], [x1, cy, zr], [x1, y0, ze]], roof); // back slope
  push([[x1, y1, ze], [x1, cy, zr], [x0, cy, zr], [x0, y1, ze]], roof); // front slope

  return faces;
}

// The wall + roof colours for a species, sampled once from its sprite. Roof is
// read near the top-centre of the sprite, wall near a lower corner (away from
// door/windows). Falls back to neutral tones if the sheet isn't sampleable.
function buildingColors(sp) {
  let c = colorCache.get(sp.id);
  if (c) return c;
  c = sampleColors(sp) ?? { wall: "#b48a5a", roof: "#c25a34" };
  colorCache.set(sp.id, c);
  return c;
}

let sampler = null; // { ctx, w, h } lazily-built offscreen copy of the sheet

function sampleColors(sp) {
  let sheet;
  try { sheet = getEntitySheet(sp) ?? getSprite("buildings"); } catch { return null; }
  if (!sheet || !sheet.complete || !sheet.naturalWidth) return null;
  if (!sampler || sampler.src !== sheet) {
    const cv = document.createElement("canvas");
    cv.width = sheet.naturalWidth;
    cv.height = sheet.naturalHeight;
    const ctx = cv.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(sheet, 0, 0);
    sampler = { ctx, src: sheet };
  }
  const px = sp.texture_x * TILE_SIZE, py = sp.texture_y * TILE_SIZE;
  const pw = sp.width * TILE_SIZE, ph = sp.height * TILE_SIZE;
  const roof = patchColor(px + pw * 0.5, py + ph * 0.14);
  const wall = patchColor(px + pw * 0.14, py + ph * 0.82);
  return { wall: roof && wall ? wall : "#b48a5a", roof: roof ?? "#c25a34" };
}

// Average an 8x8 patch centred at (cx,cy), skipping transparent pixels. Returns
// "#rrggbb" or null if the patch is empty (fully transparent).
function patchColor(cx, cy) {
  const R = 4;
  const d = sampler.ctx.getImageData(Math.round(cx - R), Math.round(cy - R), R * 2, R * 2).data;
  let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 128) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return null;
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}

// Outward normal of a face from its first three points (winding-consistent).
function faceNormal(pts) {
  const [a, b, c] = pts;
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}
