// Experimental polygon renderer (?iso=1). A parallel render path to renderer.js
// that draws the live zone as flat-shaded 3D polygons through a rotatable
// axonometric camera — the "flyingquake" look. Read-only over sim state.
//
// Draw order is the iso painter's algorithm: floors first (ascending depth),
// then constructions + entities + players as one depth-sorted upright pass so
// near shapes correctly occlude far ones at any camera angle.

import { isoProject, isoX, isoY, isoDepth } from "./isoCamera.js";
import { FLOOR_QUAD, shadedBox, faceDepth, shade, scaleColor } from "./isoGeometry.js";
import { biomeFloorColor, biomeFloorZ, constructionSpec, isSkippedConstruction, darknessOpacity, darken } from "./isoPalette.js";
import { elevationFor } from "./isoElevation.js";
import { rowToMask } from "./constructionTiles.js";
import { TILE_SIZE, ANIMATIONS_FPS } from "./constants.js";
import { getSpecies, getEntitySheet } from "./species.js";
import { getSprite } from "./assets.js";
import { getPlayerSpriteFrame } from "./player.js";

export function renderIso(renderer, zone, cam, players, tSec = 0) {
  const { ctx, canvas } = renderer;
  const view = { w: canvas.width, h: canvas.height };
  const q = isoProject(cam, view);

  const elev = elevationFor(zone);

  ctx.imageSmoothingEnabled = true; // AA edges — the drawn (non-pixel) look
  ctx.fillStyle = "#12151a";
  ctx.fillRect(0, 0, view.w, view.h);

  drawFloors(ctx, view, q, zone, elev);

  // One depth-sorted upright pass. Each item is a footprint (wx,wy in tiles)
  // and a face-builder; sorted by footprint depth so nearer draws later.
  const items = [];
  collectConstructions(zone, items, elev);
  collectActors(zone, players, items, elev, tSec);
  items.sort((a, b) => isoDepth(q, a.wx, a.wy) - isoDepth(q, b.wx, b.wy));

  // Build faces / sprite placement once and cache each item's screen bounding
  // box, then draw. Anything that sorts in front of a tracked actor (drawn
  // later) and overlaps its screen box is "in the way" — fade it so the actor
  // stays visible.
  for (const it of items) {
    if (it.sprite) it.box = spriteScreenBox(q, it);
    else { it.faces = it.build(q); it.box = screenBox(q, it.faces); }
  }
  const tracked = [];
  for (let i = 0; i < items.length; i++) if (items[i].track) tracked.push(i);
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let alpha = 1;
    if (!it.track) {
      for (const ti of tracked) {
        if (i > ti && boxesOverlap(it.box, items[ti].box)) { alpha = OCCLUDER_ALPHA; break; }
      }
    }
    if (it.sprite) drawBillboard(ctx, it, alpha);
    else drawShape(ctx, q, it.faces, alpha);
  }
}

const OCCLUDER_ALPHA = 0.35;

// Screen-space AABB of an item's projected faces.
function screenBox(q, faces) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const f of faces) {
    for (const p of f.pts) {
      const X = isoX(q, p[0], p[1]), Y = isoY(q, p[0], p[1], p[2]);
      if (X < minX) minX = X;
      if (X > maxX) maxX = X;
      if (Y < minY) minY = Y;
      if (Y > maxY) maxY = Y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function boxesOverlap(a, b) {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

function drawFloors(ctx, view, q, zone, elev) {
  const cells = [];
  for (let r = 0; r < zone.rows; r++) {
    const brow = zone.biome[r];
    const crow = zone.construction[r];
    for (let c = 0; c < zone.cols; c++) {
      let color = biomeFloorColor(brow[c]);
      if (!color) continue;
      // Designer-placed darkness paint tints the floor beneath it (§8).
      const op = darknessOpacity(crow[c]);
      if (op) color = darken(color, op);
      const base = elev[r][c];
      const wx = c + 0.5, wy = r + 0.5;
      const cx = isoX(q, wx, wy), cy = isoY(q, wx, wy);
      if (cx < -48 || cx > view.w + 48 || cy < -48 || cy > view.h + 48) continue;
      cells.push([isoDepth(q, wx, wy), wx, wy, color, base + biomeFloorZ(brow[c]), base, r, c]);
    }
  }
  cells.sort((a, b) => a[0] - b[0]);
  for (const [, wx, wy, color, z, base, r, c] of cells) {
    // Cliff skirts: where this tile stands above a 4-neighbour, drop a vertical
    // face down to that neighbour so the plateau reads as solid, not floating.
    drawSkirts(ctx, q, zone, elev, r, c, wx, wy, base, color);
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

// Shared-edge corner offsets (in FLOOR_QUAD space) per neighbour direction.
const SKIRT_EDGE = {
  "-1,0": [[-0.5, -0.5], [0.5, -0.5]], // north
  "1,0":  [[0.5, 0.5], [-0.5, 0.5]],   // south
  "0,-1": [[-0.5, 0.5], [-0.5, -0.5]], // west
  "0,1":  [[0.5, -0.5], [0.5, 0.5]],   // east
};

function drawSkirts(ctx, q, zone, elev, r, c, wx, wy, base, color) {
  const wall = scaleColor(color, 0.5); // shaded side face
  for (const key in SKIRT_EDGE) {
    const [dr, dc] = key.split(",").map(Number);
    const nr = r + dr, nc = c + dc;
    const below = (nr < 0 || nr >= zone.rows || nc < 0 || nc >= zone.cols) ? base : elev[nr][nc];
    if (below >= base) continue;
    const [a, b] = SKIRT_EDGE[key];
    ctx.fillStyle = wall;
    ctx.beginPath();
    const corners = [
      [a[0], a[1], base], [b[0], b[1], base], [b[0], b[1], below], [a[0], a[1], below],
    ];
    for (let i = 0; i < corners.length; i++) {
      const p = corners[i];
      const X = isoX(q, wx + p[0], wy + p[1]), Y = isoY(q, wx + p[0], wy + p[1], p[2]);
      i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
    }
    ctx.closePath();
    ctx.fill();
  }
}

function collectConstructions(zone, out, elev) {
  for (let r = 0; r < zone.rows; r++) {
    const crow = zone.construction[r];
    for (let c = 0; c < zone.cols; c++) {
      const id = crow[c];
      if (isSkippedConstruction(id)) continue;
      const mask = rowToMask(zone.constructionRow[r][c]);
      const spec = constructionSpec(id, mask);
      if (!spec) continue;
      const wx = c + 0.5, wy = r + 0.5;
      const baseZ = elev[r][c];
      out.push({ wx, wy, build: (q) => buildSpec(spec, wx, wy, baseZ) });
    }
  }
}

// Build the shaded faces for a construction spec centred at (wx,wy). baseZ lifts
// the whole shape onto its tile's inferred ground elevation.
function buildSpec(spec, wx, wy, baseZ = 0) {
  if (spec.ramp) return rampFaces(spec.ramp, wx, wy, baseZ);
  const faces = [];
  for (const p of spec.parts) {
    // A part is a box centred at (wx+dx, wy+dy). Footprint half-extents come
    // from hx/hy when given, else from the uniform `inset` (legacy). dx/dy let
    // a part sit off-centre so a spec can build a real silhouette (posts, rails,
    // overhangs) instead of one concentric block.
    const inset = p.inset ?? 0;
    const hx = p.hx ?? (0.5 - inset);
    const hy = p.hy ?? (0.5 - inset);
    const cx = wx + (p.dx ?? 0);
    const cy = wy + (p.dy ?? 0);
    faces.push(...shadedBox(
      [cx - hx, cy - hy, baseZ + p.z0, cx + hx, cy + hy, baseZ + p.z1],
      p.color, p.top ? { top: p.top } : {},
    ));
  }
  return faces;
}

// A slope tile as a single shaded quad whose corners are lifted per the ramp,
// sitting on baseZ (the tile's low-edge elevation, so it bridges base -> base+1).
// Corner order TL,TR,BR,BL matches FLOOR_QUAD.
function rampFaces(ramp, wx, wy, baseZ = 0) {
  const hs = ramp.heights;
  const pts = FLOOR_QUAD.map((p, i) => [wx + p[0], wy + p[1], baseZ + hs[i]]);
  // Normal from two edge vectors for shading.
  const n = triNormal(pts[0], pts[1], pts[2]);
  return [{ n, pts, c: shade(n, ramp.color) }];
}

// NPCs, humanoids, mobs and players render as upright sprite billboards — the
// actual game sprite, screen-aligned, feet planted on the tile it stands on —
// instead of flat-shaded boxes. Constructions/floors stay polygons.
function collectActors(zone, players, out, elev, tSec) {
  const baseAt = (wx, wy) => {
    const r = Math.min(zone.rows - 1, Math.max(0, Math.floor(wy)));
    const c = Math.min(zone.cols - 1, Math.max(0, Math.floor(wx)));
    return elev[r][c];
  };
  for (const e of zone.entities || []) {
    const f = e.frame;
    if (!f || e._invisible) continue;
    const sp = getSpecies(e.species_id);
    if (!sp) continue;
    // Teleporters + hints are invisible trigger tiles in play (editor-only art).
    if (sp.entity_type === "Teleporter" || sp.entity_type === "Hint") continue;
    const rect = entitySpriteRect(e, sp, tSec);
    if (!rect) continue;
    // Feet: bottom-centre of the footprint.
    const wx = f.x + f.w / 2, wy = f.y + f.h;
    out.push(spriteItem(wx, wy, baseAt(wx, f.y + f.h / 2), rect, false));
  }
  for (const p of players) {
    if (!p || p.dead) continue;
    const rect = playerSpriteRect(p);
    if (!rect) continue;
    const wx = p.x + 0.5, wy = p.y + 1;
    out.push(spriteItem(wx, wy, baseAt(wx, wy), rect, true));
  }
}

// A billboard item: its footprint feet-point (wx,wy) at ground elevation baseZ,
// carrying the resolved sprite-sheet rect to blit. `track` marks the actor the
// camera follows — occluders in front of it fade.
function spriteItem(wx, wy, baseZ, rect, track = false) {
  return { wx, wy, baseZ, rect, track, sprite: true };
}

const DIR_ROW_STILL  = { up: 1, right: 3, down: 5, left: 7 };
const DIR_ROW_MOVING = { up: 0, right: 2, down: 4, left: 6 };

// Resolve an entity's sprite-sheet source rect + tile footprint at time tSec.
// Handles animated frames and the 8-row directional layout, mirroring the
// classic renderer's common path (special-case reskins/attacks are omitted —
// the iso view is an experiment).
function entitySpriteRect(e, sp, tSec) {
  const sheet = getEntitySheet(sp);
  if (!sheet) return null;
  const w = sp.width || 1, h = sp.height || 1;
  const frames = Math.max(1, sp.frames);
  const frame = frames > 1 ? Math.floor(tSec * ANIMATIONS_FPS) % frames : 0;
  let dirRow = 0;
  if (sp.directional) {
    const moving = !!(e._ai?.step || e.moving);
    const dir = (e.direction || "down").toLowerCase();
    dirRow = (moving ? DIR_ROW_MOVING : DIR_ROW_STILL)[dir] ?? DIR_ROW_STILL.down;
  }
  return {
    sheet,
    sx: (sp.texture_x + frame * w) * TILE_SIZE,
    sy: (sp.texture_y + dirRow * h) * TILE_SIZE,
    sw: w * TILE_SIZE, sh: h * TILE_SIZE, w, h,
  };
}

// The hero's directional/animated frame off the heroes sheet.
function playerSpriteRect(p) {
  let sheet;
  try { sheet = getSprite("heroes"); } catch { return null; }
  if (!sheet || !sheet.complete) return null;
  const f = getPlayerSpriteFrame(p);
  return {
    sheet,
    sx: f.x * TILE_SIZE, sy: f.y * TILE_SIZE,
    sw: f.w * TILE_SIZE, sh: f.h * TILE_SIZE, w: f.w, h: f.h,
  };
}

// Where a billboard lands on screen: feet at the projected footprint point,
// sized so one sprite tile is one height tier tall (keeps sprites proportionate
// to the iso world at any scale). Bottom-centre anchored.
function spritePlacement(q, it) {
  const X = isoX(q, it.wx, it.wy);
  const Y = isoY(q, it.wx, it.wy, it.baseZ);
  const unit = q.tierH * q.s;
  const dw = it.rect.w * unit;
  const dh = it.rect.h * unit;
  return { dx: Math.round(X - dw / 2), dy: Math.round(Y - dh), dw, dh };
}

function spriteScreenBox(q, it) {
  const { dx, dy, dw, dh } = spritePlacement(q, it);
  return { minX: dx, minY: dy, maxX: dx + dw, maxY: dy + dh };
}

function drawBillboard(ctx, it, alpha = 1) {
  const b = it.box; // placement already computed into the screen box
  const { rect } = it;
  const prevSmoothing = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false; // crisp pixel-art sprites
  if (alpha !== 1) ctx.globalAlpha = alpha;
  ctx.drawImage(rect.sheet, rect.sx, rect.sy, rect.sw, rect.sh,
    b.minX, b.minY, b.maxX - b.minX, b.maxY - b.minY);
  if (alpha !== 1) ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = prevSmoothing;
}

function drawShape(ctx, q, faces, alpha = 1) {
  if (alpha !== 1) ctx.globalAlpha = alpha;
  faces.sort((a, b) => faceDepth(q, a) - faceDepth(q, b));
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
  if (alpha !== 1) ctx.globalAlpha = 1;
}

function triNormal(a, b, c) {
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  if (n[2] < 0) { n[0] = -n[0]; n[1] = -n[1]; n[2] = -n[2]; }
  const len = Math.hypot(n[0], n[1], n[2]) || 1;
  return [n[0] / len, n[1] / len, n[2] / len];
}
