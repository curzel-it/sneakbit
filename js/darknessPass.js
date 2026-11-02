// Light-condition overlay as a shader pass over one world slice: a flat wash
// for Night, and for CantSeeShit a radial cone that is clear inside `inner`,
// 85% black at 60% of the way to `outer` and opaque beyond it, matching the
// Canvas 2D radial gradient it replaces.

import { linkProgram } from "./spriteBatch.js";

const VERTEX_SHADER = `#version 300 es
uniform vec2 uView;
out vec2 vPos;
void main() {
  vec2 corner = vec2(gl_VertexID & 1, gl_VertexID >> 1);
  vPos = corner * uView;
  gl_Position = vec4(corner.x * 2.0 - 1.0, 1.0 - corner.y * 2.0, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform vec4 uWash;
uniform vec2 uCenter;
uniform vec2 uRadii;
in vec2 vPos;
out vec4 outColor;
void main() {
  if (uRadii.y <= 0.0) {
    outColor = uWash;
    return;
  }
  float t = clamp((distance(vPos, uCenter) - uRadii.x) / (uRadii.y - uRadii.x), 0.0, 1.0);
  float a = t < 0.6 ? t / 0.6 * 0.85 : 0.85 + (t - 0.6) / 0.4 * 0.15;
  outColor = vec4(0.0, 0.0, 0.0, a);
}`;

const NO_WASH = [0, 0, 0, 0];

// Canvas 2D stores a fill colour as 8-bit premultiplied RGBA before blending;
// rounding the same way here keeps the wash identical to the old renderer.
export function premultiplied8(r, g, b, a) {
  const a8 = Math.round(a * 255);
  const p = (c) => Math.round(c * a8) / 255;
  return [p(r), p(g), p(b), a8 / 255];
}

/** @param {ReturnType<import("./spriteBatch.js").createSpriteBatch>} batch */
export function createDarknessPass(batch) {
  const { gl, canvas } = batch;
  let program, vao, u;

  function init() {
    program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    vao = gl.createVertexArray();
    u = {
      view: gl.getUniformLocation(program, "uView"),
      wash: gl.getUniformLocation(program, "uWash"),
      center: gl.getUniformLocation(program, "uCenter"),
      radii: gl.getUniformLocation(program, "uRadii"),
    };
  }

  function draw(wash, cx, cy, inner, outer) {
    batch.flush();
    const { w, h } = batch.slice;
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.view, w, h);
    gl.uniform4fv(u.wash, wash);
    gl.uniform2f(u.center, cx, cy);
    gl.uniform2f(u.radii, inner, outer);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  init();
  canvas.addEventListener("webglcontextrestored", init);

  return {
    /** Flat translucent wash, straight-alpha channels in 0..1. */
    wash(r, g, b, a) { draw(premultiplied8(r, g, b, a), 0, 0, 0, 0); },
    /** Black everywhere but a cone of vision centred on slice-local (cx, cy). */
    cone(cx, cy, inner, outer) { draw(NO_WASH, cx, cy, inner, outer); },
  };
}
