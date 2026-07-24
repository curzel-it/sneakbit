// Experimental polygon renderer (?iso=1). A parallel render path to renderer.js
// that draws the live zone as flat-shaded 3D polygons through a rotatable
// axonometric camera — the "flyingquake" look. Read-only over sim state.
//
// Draw order is the iso painter's algorithm: floors first (ascending depth),
// then constructions + entities + players as one depth-sorted upright pass so
// near shapes correctly occlude far ones at any camera angle.

import { isoProject, isoX, isoY, isoDepth } from "./isoCamera.js";
import { FLOOR_QUAD, shadedBox, faceDepth, shade } from "./isoGeometry.js";
import { biomeFloorColor, biomeFloorZ, constructionSpec, isSkippedConstruction } from "./isoPalette.js";

export function renderIso(renderer, zone, cam, players, tSec = 0) {
  const { ctx, canvas } = renderer;
  const view = { w: canvas.width, h: canvas.height };
  const q = isoProject(cam, view);

  ctx.imageSmoothingEnabled = true; // AA edges — the drawn (non-pixel) look
  ctx.fillStyle = "#12151a";
  ctx.fillRect(0, 0, view.w, view.h);

  drawFloors(ctx, view, q, zone);

  // One depth-sorted upright pass. Each item is a footprint (wx,wy in tiles)
  // and a face-builder; sorted by footprint depth so nearer draws later.
  const items = [];
  collectConstructions(zone, items);
  collectActors(zone, players, items);
  items.sort((a, b) => isoDepth(q, a.wx, a.wy) - isoDepth(q, b.wx, b.wy));
  for (const it of items) drawShape(ctx, q, it);
}

function drawFloors(ctx, view, q, zone) {
  const cells = [];
  for (let r = 0; r < zone.rows; r++) {
    const brow = zone.biome[r];
    for (let c = 0; c < zone.cols; c++) {
      const color = biomeFloorColor(brow[c]);
      if (!color) continue;
      const wx = c + 0.5, wy = r + 0.5;
      const cx = isoX(q, wx, wy), cy = isoY(q, wx, wy);
      if (cx < -48 || cx > view.w + 48 || cy < -48 || cy > view.h + 48) continue;
      cells.push([isoDepth(q, wx, wy), wx, wy, color, biomeFloorZ(brow[c])]);
    }
  }
  cells.sort((a, b) => a[0] - b[0]);
  for (const [, wx, wy, color, z] of cells) {
    ctx.fillStyle = color;
    ctx.strokeStyle = color; // 1px stroke closes AA seams between tiles
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < FLOOR_QUAD.length; i++) {
      const p = FLOOR_QUAD[i];
      const X = isoX(q, wx + p[0], wy + p[1]), Y = isoY(q, wx + p[0], wy + p[1], z);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

function collectConstructions(zone, out) {
  for (let r = 0; r < zone.rows; r++) {
    const crow = zone.construction[r];
    for (let c = 0; c < zone.cols; c++) {
      const id = crow[c];
      if (isSkippedConstruction(id)) continue;
      const spec = constructionSpec(id);
      if (!spec) continue;
      const wx = c + 0.5, wy = r + 0.5;
      out.push({ wx, wy, build: (q) => buildSpec(spec, wx, wy) });
    }
  }
}

// Build the shaded faces for a construction spec centred at (wx,wy).
function buildSpec(spec, wx, wy) {
  if (spec.ramp) return rampFaces(spec.ramp, wx, wy);
  const faces = [];
  for (const p of spec.parts) {
    const h = 0.5 - p.inset;
    faces.push(...shadedBox(
      [wx - h, wy - h, p.z0, wx + h, wy + h, p.z1],
      p.color, p.top ? { top: p.top } : {},
    ));
  }
  return faces;
}

// A slope tile as a single shaded quad whose corners are lifted per the ramp.
// Corner order TL,TR,BR,BL matches FLOOR_QUAD.
function rampFaces(ramp, wx, wy) {
  const hs = ramp.heights;
  const pts = FLOOR_QUAD.map((p, i) => [wx + p[0], wy + p[1], hs[i]]);
  // Normal from two edge vectors for shading.
  const n = triNormal(pts[0], pts[1], pts[2]);
  return [{ n, pts, c: shade(n, ramp.color) }];
}

function collectActors(zone, players, out) {
  for (const e of zone.entities || []) {
    const f = e.frame;
    if (!f) continue;
    out.push(actorShape(f.x + f.w / 2, f.y + f.h / 2, f.w, f.h, actorColor(e.species_id)));
  }
  for (const p of players) {
    if (!p || p.dead) continue;
    out.push(actorShape(p.x + 0.5, p.y + 1, 1, 2, "#e8c05a"));
  }
}

// A little character box: a footprint-sized column, height scaled by tile-height.
function actorShape(wx, wy, tw, th, color) {
  const half = Math.min(0.34, tw * 0.34);
  const z1 = Math.max(0.9, th * 0.8);
  return {
    wx, wy,
    build: () => shadedBox([wx - half, wy - half, 0, wx + half, wy + half, z1], color, { top: "#ffffff" }),
  };
}

function drawShape(ctx, q, it) {
  const faces = it.build(q).sort((a, b) => faceDepth(q, a) - faceDepth(q, b));
  for (const f of faces) {
    ctx.fillStyle = f.c;
    ctx.beginPath();
    for (let i = 0; i < f.pts.length; i++) {
      const p = f.pts[i];
      const X = isoX(q, p[0], p[1]), Y = isoY(q, p[0], p[1], p[2]);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function triNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (n[2] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}

// Stable-ish colour from a species id, so entity types read distinctly.
function actorColor(id) {
  const h = ((id | 0) * 2654435761) >>> 0;
  const r = 80 + (h & 127), g = 80 + ((h >> 8) & 127), b = 80 + ((h >> 16) & 127);
  return "#" + ((r << 16) | (g << 8) | b).toString(16).padStart(6, "0");
}
