// Minimal loading splash with a progress bar. Renders into the DOM
// before main() awaits the asset/data Promise.all and tears itself
// down once the game canvas is ready to paint.
//
// The bar's progress is incremental: callers call `bumpLoadingProgress()`
// after each finished step. The exact ratio matters less than giving
// the player a sign that something is happening on slow networks.

let root = null;
let bar = null;
let total = 1;
let done = 0;

export function showLoadingScreen(steps = 1) {
  total = Math.max(1, steps);
  done = 0;
  if (typeof document === "undefined") return;
  root = document.createElement("div");
  root.id = "loading";
  root.innerHTML = `
    <div class="ld-card">
      <div class="ld-title">SneakBit</div>
      <div class="ld-track"><div class="ld-fill"></div></div>
      <div class="ld-sub">Loading…</div>
    </div>
  `;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#070707",
    color: "#cfd6e8",
    fontFamily: "monospace",
    zIndex: "30",
  });
  injectStyles();
  document.body.appendChild(root);
  bar = root.querySelector(".ld-fill");
  updateBar(0);
}

export function bumpLoadingProgress(label) {
  if (!root) return;
  done = Math.min(total, done + 1);
  updateBar(done / total);
  if (label) {
    const sub = root.querySelector(".ld-sub");
    if (sub) sub.textContent = label;
  }
}

export function hideLoadingScreen() {
  if (!root) return;
  // Fade out so the zone appears underneath instead of a hard cut.
  root.style.transition = "opacity 220ms ease";
  root.style.opacity = "0";
  setTimeout(() => { root?.remove(); root = null; bar = null; }, 240);
}

function updateBar(pct) {
  if (!bar) return;
  bar.style.width = `${Math.round(pct * 100)}%`;
}

function injectStyles() {
  if (document.getElementById("loading-styles")) return;
  const css = `
    #loading .ld-card { text-align: center; }
    #loading .ld-title { font-size: 24px; letter-spacing: 3px; color: #e6ecff; margin-bottom: 20px; }
    #loading .ld-track {
      width: min(320px, 70vw); height: 6px;
      background: #1a1d26; border: 1px solid #2a2f3e;
      border-radius: 3px; overflow: hidden;
      margin: 0 auto;
    }
    #loading .ld-fill {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #5b73c7, #9ab1ff);
      transition: width 120ms ease;
    }
    #loading .ld-sub { margin-top: 14px; color: #8a92ad; font-size: 11px; letter-spacing: 1px; }
  `;
  const style = document.createElement("style");
  style.id = "loading-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
