// Flat-shaded 3D face helpers for the experimental iso renderer. A "shape" is
// a set of axis-aligned box faces (or flat quads) expressed in world units:
// x,y in tiles (offset from a shape's tile centre), z in height tiers. The
// renderer projects + fills these fresh every frame, so they render correctly
// at any continuous camera angle. Ported from the flyingquake prototype.

const LIGHT = normalize([-0.35, -0.5, 1.0]); // fixed overhead-ish key light

// A flat floor tile: four corner offsets (tiles) at z=0, centred on its tile.
export const FLOOR_QUAD = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];

// The 6 faces of an axis-aligned box [x0,y0,z0, x1,y1,z1], each with an
// outward normal. Points are ordered so the winding is consistent.
export function boxFaces(b) {
  const [x0, y0, z0, x1, y1, z1] = b;
  return [
    { n: [0, 0, 1], pts: [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]] },
    { n: [0, 0, -1], pts: [[x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0]] },
    { n: [1, 0, 0], pts: [[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]] },
    { n: [-1, 0, 0], pts: [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]] },
    { n: [0, 1, 0], pts: [[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]] },
    { n: [0, -1, 0], pts: [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]] },
  ];
}

// A shaded box: faces pre-tinted by the light, ready to depth-sort + fill.
// `base` is a "#rrggbb" hex. Optional top/bottom recolour the z-facing faces.
export function shadedBox(b, base, opts = {}) {
  return boxFaces(b).map((f) => {
    let c = base;
    if (opts.top && f.n[2] > 0.5) c = opts.top;
    else if (opts.bottom && f.n[2] < -0.5) c = opts.bottom;
    return { n: f.n, pts: f.pts, c: shade(f.n, c) };
  });
}

// Average depth of a face's vertices, for the painter's sort within a shape.
export function faceDepth(q, f) {
  let cx = 0, cy = 0, cz = 0;
  for (const p of f.pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
  const n = f.pts.length;
  cx /= n; cy /= n; cz /= n;
  return (cx * q.sinA + cy * q.cosA) * q.Sy + cz * q.tierH;
}

// Lambert-ish shade of a base colour by a face normal.
export function shade(n, base) {
  const d = Math.max(0, n[0] * LIGHT[0] + n[1] * LIGHT[1] + n[2] * LIGHT[2]);
  return scaleColor(base, 0.42 + 0.58 * d);
}

function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

export function scaleColor(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.min(255, Math.round((n >> 16) * f));
  const g = Math.min(255, Math.round(((n >> 8) & 255) * f));
  const b = Math.min(255, Math.round((n & 255) * f));
  return `rgb(${r},${g},${b})`;
}
