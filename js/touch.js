// On-screen touch controls for mobile: 4-way directional pad on the
// bottom-left and an action button on the bottom-right. Synthesises the
// same keydown/keyup events that input.js already listens for, so no
// extra wiring is needed downstream.
//
// Hidden by default; show when a touch (or pointer with pointerType ===
// "touch") is detected so we don't clutter desktop screens.

const KEY_FOR_DIR = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };
const heldBindings = new Map(); // dir -> pointerId

let root = null;
let visible = false;

export function installTouchControls() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "touch-controls";
  root.innerHTML = `
    <div class="touch-pad" data-side="left">
      <button class="touch-btn" data-dir="up">▲</button>
      <button class="touch-btn" data-dir="left">◀</button>
      <button class="touch-btn" data-dir="right">▶</button>
      <button class="touch-btn" data-dir="down">▼</button>
    </div>
    <div class="touch-pad" data-side="right">
      <button class="touch-btn touch-action" data-action="interact">E</button>
    </div>
  `;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    pointerEvents: "none",
    zIndex: "12",
    display: "none",
    userSelect: "none",
    touchAction: "none",
  });
  document.body.appendChild(root);
  injectStyles();

  for (const btn of root.querySelectorAll(".touch-btn")) {
    btn.addEventListener("pointerdown", (e) => onPress(e, btn));
    btn.addEventListener("pointerup", (e) => onRelease(e, btn));
    btn.addEventListener("pointercancel", (e) => onRelease(e, btn));
    btn.addEventListener("pointerleave", (e) => {
      if (heldBindings.get(btn.dataset.dir) === e.pointerId) onRelease(e, btn);
    });
    // Prevent the browser's default context menu / long-press behaviour.
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // Auto-reveal once we see touch input.
  window.addEventListener("pointerdown", (e) => {
    if (visible) return;
    if (e.pointerType === "touch") show();
  }, { capture: true });

  if (matchMedia("(pointer: coarse)").matches) show();

  return root;
}

function show() {
  if (visible) return;
  visible = true;
  root.style.display = "block";
}

function onPress(e, btn) {
  e.preventDefault();
  btn.classList.add("active");
  const dir = btn.dataset.dir;
  const action = btn.dataset.action;
  if (dir) {
    heldBindings.set(dir, e.pointerId);
    dispatchKey("keydown", KEY_FOR_DIR[dir]);
  } else if (action === "interact") {
    dispatchKey("keydown", "KeyE");
  }
}

function onRelease(e, btn) {
  e.preventDefault();
  btn.classList.remove("active");
  const dir = btn.dataset.dir;
  const action = btn.dataset.action;
  if (dir) {
    if (heldBindings.get(dir) !== e.pointerId) return;
    heldBindings.delete(dir);
    dispatchKey("keyup", KEY_FOR_DIR[dir]);
  } else if (action === "interact") {
    dispatchKey("keyup", "KeyE");
  }
}

function dispatchKey(type, code) {
  window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
}

function injectStyles() {
  if (document.getElementById("touch-styles")) return;
  const style = document.createElement("style");
  style.id = "touch-styles";
  style.textContent = `
    #touch-controls .touch-pad {
      position: absolute;
      bottom: 5vh;
      pointer-events: none;
    }
    #touch-controls .touch-pad[data-side="left"] {
      left: 4vw;
      display: grid;
      grid-template-columns: repeat(3, 56px);
      grid-template-rows: repeat(3, 56px);
      gap: 6px;
    }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="up"]    { grid-column: 2; grid-row: 1; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="left"]  { grid-column: 1; grid-row: 2; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="right"] { grid-column: 3; grid-row: 2; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="down"]  { grid-column: 2; grid-row: 3; }
    #touch-controls .touch-pad[data-side="right"] {
      right: 4vw;
      bottom: 12vh;
    }
    #touch-controls .touch-btn {
      pointer-events: auto;
      width: 56px;
      height: 56px;
      border-radius: 50%;
      background: rgba(40, 40, 40, 0.6);
      color: #eee;
      border: 1px solid rgba(180, 180, 180, 0.4);
      font-size: 18px;
      font-family: monospace;
      cursor: pointer;
      transition: background 80ms ease;
    }
    #touch-controls .touch-action {
      width: 72px;
      height: 72px;
      font-size: 22px;
      background: rgba(60, 100, 60, 0.7);
    }
    #touch-controls .touch-btn.active {
      background: rgba(120, 120, 120, 0.85);
    }
    @media (min-width: 980px) and (pointer: fine) {
      #touch-controls { display: none !important; }
    }
  `;
  document.head.appendChild(style);
}
