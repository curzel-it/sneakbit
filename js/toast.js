// Toast overlay: brief, auto-dismissing notification used by pickups and
// hint triggers. Anchors to the top of the viewport so on mobile it doesn't
// fight the on-screen joystick at the bottom. Mirrors the original Rust
// core's ToastMode durations (Hint 2.0s, LongHint 3.0s, Regular 1.0s).

const DURATIONS = { regular: 1.0, hint: 2.0, longHint: 3.0 };
const FADE_OUT = 0.25; // seconds

let root = null;
let timer = null;
let fadeTimer = null;

export function installToast() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "toast";
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
    whiteSpace: "pre-wrap",
    textAlign: "center",
    display: "none",
    zIndex: "14",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
    pointerEvents: "none",
    opacity: "0",
    transition: `opacity ${FADE_OUT}s ease`,
    userSelect: "none",
    WebkitUserSelect: "none",
  });
  document.body.appendChild(root);
  return root;
}

export function showToast(text, mode = "hint") {
  if (!root) installToast();
  clearTimers();
  root.textContent = text;
  root.style.display = "block";
  // Force a reflow so the fade-in transition starts from opacity 0.
  void root.offsetWidth;
  root.style.opacity = "1";

  const duration = DURATIONS[mode] ?? DURATIONS.hint;
  timer = setTimeout(() => {
    root.style.opacity = "0";
    fadeTimer = setTimeout(() => { root.style.display = "none"; }, FADE_OUT * 1000);
  }, duration * 1000);
}

function clearTimers() {
  if (timer) { clearTimeout(timer); timer = null; }
  if (fadeTimer) { clearTimeout(fadeTimer); fadeTimer = null; }
}
