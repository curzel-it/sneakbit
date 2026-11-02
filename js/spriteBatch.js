// WebGL 2 sprite batcher for the world canvas. It speaks the slice of the
// Canvas 2D API the world drawers use (`drawImage` with a source rect and
// `globalAlpha`), so entities, trails, cutscenes and effects draw through it
// unchanged, plus `flash` (0..1, a white hit flash) for the next draws.
// Sources upload once as NEAREST textures with premultiplied alpha, which is
// how Canvas 2D composites, so integer blits match it pixel for pixel.

const MAX_QUADS = 4096;
const FLOATS_PER_VERTEX = 9;
const MAX_TEXTURES = 320;
const TEXTURE_IDLE_FRAMES = 600;

const VERTEX_SHADER = `#version 300 es
in vec2 aPos;
in vec2 aUv;
in vec4 aColor;
in float aFlash;
uniform vec2 uView;
out vec2 vUv;
out vec4 vColor;
out float vFlash;
void main() {
  vec2 p = aPos / uView * 2.0 - 1.0;
  gl_Position = vec4(p.x, -p.y, 0.0, 1.0);
  vUv = aUv;
  vColor = aColor;
  vFlash = aFlash;
}`;

const FRAGMENT_SHADER = `#version 300 es
precision highp float;
uniform sampler2D uTex;
in vec2 vUv;
in vec4 vColor;
in float vFlash;
out vec4 outColor;
void main() {
  vec4 c = texture(uTex, vUv / vec2(textureSize(uTex, 0)));
  c.rgb = mix(c.rgb, vec3(c.a), vFlash);
  outColor = c * vColor;
}`;

/**
 * @typedef {{ x: number, y: number, w: number, h: number }} Rect
 * @typedef {HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap} Source
 */

/**
 * Clips a source rect to the source's bounds and shrinks the destination by
 * the same proportion, as Canvas 2D's drawImage does. Null when nothing is left.
 * @returns {{ sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number } | null}
 */
export function clipBlit(srcW, srcH, sx, sy, sw, sh, dx, dy, dw, dh) {
  if (sw <= 0 || sh <= 0 || dw <= 0 || dh <= 0) return null;
  const kx = dw / sw;
  const ky = dh / sh;
  if (sx < 0) { dx -= sx * kx; dw += sx * kx; sw += sx; sx = 0; }
  if (sy < 0) { dy -= sy * ky; dh += sy * ky; sh += sy; sy = 0; }
  if (sx + sw > srcW) { const cut = sx + sw - srcW; sw -= cut; dw -= cut * kx; }
  if (sy + sh > srcH) { const cut = sy + sh - srcH; sh -= cut; dh -= cut * ky; }
  if (sw <= 0 || sh <= 0) return null;
  return { sx, sy, sw, sh, dx, dy, dw, dh };
}

/** @param {Source} src */
function sourceSize(src) {
  return {
    w: src.naturalWidth || src.width || 0,
    h: src.naturalHeight || src.height || 0,
  };
}

/** @param {HTMLCanvasElement} canvas */
export function createSpriteBatch(canvas) {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) return null;

  let program, vao, vbo, ibo, white, uView;
  const textures = new Map();
  const data = new Float32Array(MAX_QUADS * 4 * FLOATS_PER_VERTEX);
  let quads = 0;
  let boundTex = null;
  let frame = 0;
  let slice = { x: 0, y: 0, w: 1, h: 1 };

  function init() {
    program = linkProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER);
    uView = gl.getUniformLocation(program, "uView");
    vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.byteLength, gl.DYNAMIC_DRAW);
    const stride = FLOATS_PER_VERTEX * 4;
    const attr = (name, size, offset) => {
      const loc = gl.getAttribLocation(program, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride, offset * 4);
    };
    attr("aPos", 2, 0);
    attr("aUv", 2, 2);
    attr("aColor", 4, 4);
    attr("aFlash", 1, 8);
    const indices = new Uint16Array(MAX_QUADS * 6);
    for (let i = 0, v = 0; i < indices.length; i += 6, v += 4) {
      indices.set([v, v + 1, v + 2, v + 2, v + 1, v + 3], i);
    }
    ibo = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    white = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, white);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));
    setNearest(gl);
    textures.clear();
    quads = 0;
    boundTex = null;
  }

  function textureFor(src) {
    let entry = textures.get(src);
    if (!entry) {
      const { w, h } = sourceSize(src);
      if (!w || !h) return null;
      if (src instanceof HTMLImageElement && !src.complete) return null;
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
      setNearest(gl);
      entry = { tex, w, h, used: frame };
      textures.set(src, entry);
      if (textures.size > MAX_TEXTURES) evictIdleTextures();
    }
    entry.used = frame;
    return entry;
  }

  function evictIdleTextures() {
    for (const [src, entry] of textures) {
      if (frame - entry.used < TEXTURE_IDLE_FRAMES) continue;
      if (entry.tex === boundTex) flush();
      gl.deleteTexture(entry.tex);
      textures.delete(src);
    }
  }

  function flush() {
    if (!quads) return;
    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, data, 0, quads * 4 * FLOATS_PER_VERTEX);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, boundTex);
    gl.uniform2f(uView, slice.w, slice.h);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.TRIANGLES, quads * 6, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null);
    quads = 0;
  }

  function pushQuad(tex, x0, y0, x1, y1, u0, v0, u1, v1, r, g, b, a, flash) {
    if (tex !== boundTex) { flush(); boundTex = tex; }
    if (quads === MAX_QUADS) flush();
    let o = quads * 4 * FLOATS_PER_VERTEX;
    const vertex = (x, y, u, v) => {
      data[o++] = x; data[o++] = y; data[o++] = u; data[o++] = v;
      data[o++] = r; data[o++] = g; data[o++] = b; data[o++] = a;
      data[o++] = flash;
    };
    vertex(x0, y0, u0, v0);
    vertex(x1, y0, u1, v0);
    vertex(x0, y1, u0, v1);
    vertex(x1, y1, u1, v1);
    quads++;
  }

  init();
  canvas.addEventListener("webglcontextlost", (e) => e.preventDefault());
  canvas.addEventListener("webglcontextrestored", init);

  const batch = {
    gl,
    canvas,
    globalAlpha: 1,
    flash: 0,

    beginFrame() {
      frame++;
      setSlice({ x: 0, y: 0, w: canvas.width, h: canvas.height });
    },

    /** Restricts drawing to a backing-pixel rect whose top-left becomes (0, 0). */
    setSlice,

    /** @returns {Rect} */
    get slice() { return slice; },

    /** Fills the current slice with an opaque colour. */
    clear(r, g, b) {
      flush();
      gl.clearColor(r, g, b, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
    },

    drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) {
      const alpha = batch.globalAlpha;
      if (alpha <= 0) return;
      const entry = textureFor(src);
      if (!entry) return;
      const c = clipBlit(entry.w, entry.h, sx, sy, sw, sh, dx, dy, dw ?? sw, dh ?? sh);
      if (!c) return;
      pushQuad(entry.tex,
        c.dx, c.dy, c.dx + c.dw, c.dy + c.dh,
        c.sx, c.sy, c.sx + c.sw, c.sy + c.sh,
        alpha, alpha, alpha, alpha, batch.flash);
    },

    /** Fills a slice-local rect with a straight-alpha colour (0..1 channels). */
    fillRect(x, y, w, h, r, g, b, a = 1) {
      if (w <= 0 || h <= 0) return;
      pushQuad(white, x, y, x + w, y + h, 0, 0, 1, 1, r * a, g * a, b * a, a, 0);
    },

    flush,
  };

  function setSlice(rect) {
    flush();
    slice = rect;
    const y = canvas.height - rect.y - rect.h;
    gl.viewport(rect.x, y, rect.w, rect.h);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(rect.x, y, rect.w, rect.h);
  }

  return batch;
}

function setNearest(gl) {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/** @param {WebGL2RenderingContext} gl */
export function linkProgram(gl, vertexSource, fragmentSource) {
  const program = gl.createProgram();
  for (const [type, source] of [[gl.VERTEX_SHADER, vertexSource], [gl.FRAGMENT_SHADER, fragmentSource]]) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      throw new Error(gl.getShaderInfoLog(shader) || "shader compile failed");
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(gl.getProgramInfoLog(program) || "program link failed");
  }
  return program;
}
