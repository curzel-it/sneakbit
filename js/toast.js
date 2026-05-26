// Toast overlay: brief, auto-dismissing notification used by pickups and
// hint triggers. Anchors to the top of the viewport so on mobile it doesn't
// fight the on-screen joystick at the bottom. Mirrors the original Rust
// core's ToastMode durations (Hint 2.0s, LongHint 3.0s, Regular 1.0s).
//
// Optional `opts.image` mirrors Rust ToastImage. Caller passes:
//   { url, sx, sy, sw, sh, renderSize? }
// where (sx, sy, sw, sh) is the source rect in pixels into `url` and
// renderSize (default 32px) is the CSS size of the icon shown left of
// the text.

const DURATIONS = { regular: 1.0, hint: 2.0, longHint: 3.0 };
const FADE_OUT = 0.25; // seconds

let root = null;
let textEl = null;
let iconEl = null;
let timer = null;
let fadeTimer = null;

export function installToast() {
  if (root) return root;
  if (typeof document === "undefined") return null;
  root = document.createElement("div");
  root.id = "toast";
  iconEl = document.createElement("canvas");
  iconEl.width = 16;
  iconEl.height = 16;
  textEl = document.createElement("div");
  root.appendChild(iconEl);
  root.appendChild(textEl);
  Object.assign(root.style, {
    position: "fixed",
    top: "6%",
    left: "50%",
    transform: "translateX(-50%)",
    maxWidth: "min(640px, 86vw)",
    padding: "10px 16px",
    background: "rgba(10, 10, 10, 0.92)",
    border: "1px solid #444",
    borderRadius: "6px",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "14px",
    lineHeight: "1.4",
    display: "none",
    zIndex: "14",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
    pointerEvents: "none",
    opacity: "0",
    transition: `opacity ${FADE_OUT}s ease`,
    userSelect: "none",
    WebkitUserSelect: "none",
    alignItems: "center",
    gap: "12px",
  });
  Object.assign(iconEl.style, {
    flexShrink: "0",
    imageRendering: "pixelated",
    display: "none",
  });
  Object.assign(textEl.style, {
    whiteSpace: "pre-wrap",
    textAlign: "center",
    flex: "1",
  });
  document.body.appendChild(root);
  return root;
}

export function showToast(text, mode = "hint", opts = {}) {
  if (!root) installToast();
  if (!root) return;
  // Skip empty toasts silently — they used to show up as an unexplained
  // empty box (one of the 1001 hints had an empty dialogue line and
  // tripped this).
  if (text == null || String(text).trim() === "") return;
  clearTimers();
  textEl.textContent = text;
  applyToastImage(opts.image);
  root.style.display = "flex";
  // Force a reflow so the fade-in transition starts from opacity 0.
  void root.offsetWidth;
  root.style.opacity = "1";

  const duration = DURATIONS[mode] ?? DURATIONS.hint;
  timer = setTimeout(() => {
    root.style.opacity = "0";
    fadeTimer = setTimeout(() => { root.style.display = "none"; }, FADE_OUT * 1000);
  }, duration * 1000);
}

// Renders the optional ToastImage as a small pixel-art icon to the left
// of the text. Caller passes either:
//   { img: HTMLImageElement, sx, sy, sw, sh, renderSize? }
// or
//   { url: string, sx, sy, sw, sh, renderSize? }
// The (sx, sy, sw, sh) source rect is blitted onto a small canvas with
// imageSmoothingEnabled=false so pixel-art icons stay crisp.
function applyToastImage(image) {
  if (!iconEl) return;
  if (!image) {
    iconEl.style.display = "none";
    return;
  }
  const sw = image.sw || 16;
  const sh = image.sh || 16;
  const sx = image.sx || 0;
  const sy = image.sy || 0;
  const size = image.renderSize ?? 32;
  iconEl.width = sw;
  iconEl.height = sh;
  iconEl.style.width = `${size}px`;
  iconEl.style.height = `${size}px`;
  iconEl.style.imageRendering = "pixelated";
  iconEl.style.display = "block";
  iconEl.style.flexShrink = "0";
  const ctx = iconEl.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, sw, sh);
  const src = image.img ?? loadIconImage(image.url);
  if (src && src.complete) {
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
  } else if (src) {
    src.addEventListener("load", () => {
      ctx.imageSmoothingEnabled = false;
      ctx.clearRect(0, 0, sw, sh);
      ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    }, { once: true });
  }
}

const iconCache = new Map();
function loadIconImage(url) {
  if (!url) return null;
  let img = iconCache.get(url);
  if (img) return img;
  img = new Image();
  img.src = url;
  iconCache.set(url, img);
  return img;
}

function clearTimers() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
}
