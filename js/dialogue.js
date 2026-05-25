// Dialogue overlay. HTML element above the canvas with the current line.
// Advances on Space / Enter / Click. While open, the player is paused.

import { tr } from "./strings.js";
import { playSfx } from "./audio.js";

let root = null;
let active = null; // { lines: string[], idx: number, resolve }
let listener = null;

export function installDialogue() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "dialogue";
  Object.assign(root.style, {
    position: "fixed",
    left: "50%",
    transform: "translateX(-50%)",
    bottom: "5%",
    maxWidth: "min(720px, 90vw)",
    minWidth: "min(400px, 80vw)",
    padding: "16px 20px",
    background: "rgba(10, 10, 10, 0.92)",
    border: "1px solid #444",
    borderRadius: "6px",
    color: "#eee",
    fontFamily: "monospace",
    fontSize: "14px",
    lineHeight: "1.4",
    whiteSpace: "pre-wrap",
    display: "none",
    zIndex: "15",
    boxShadow: "0 8px 30px rgba(0,0,0,0.5)",
    cursor: "pointer",
  });
  root.innerHTML = `<div id="dialogue-text"></div><div id="dialogue-hint">▾ space / enter / click</div>`;
  document.body.appendChild(root);
  const style = document.createElement("style");
  style.textContent = `
    #dialogue-hint { color: #888; font-size: 11px; margin-top: 8px; text-align: right; }
  `;
  document.head.appendChild(style);

  listener = (e) => {
    if (!active) return;
    if (e.code === "Space" || e.code === "Enter" || e.code === "KeyE") {
      e.preventDefault();
      advance();
    }
  };
  window.addEventListener("keydown", listener);
  root.addEventListener("click", () => advance());
  return root;
}

export function isDialogueOpen() { return active !== null; }

export function showDialogue(lines) {
  return new Promise((resolve) => {
    const flat = (Array.isArray(lines) ? lines : [lines]).flatMap(splitOnSeparator);
    active = { lines: flat, idx: 0, resolve };
    paint();
    root.style.display = "block";
    playSfx("interact", { volume: 0.5 });
  });
}

function splitOnSeparator(s) {
  return String(s).split(/^---?$/m).map((x) => x.trim()).filter(Boolean);
}

function advance() {
  if (!active) return;
  active.idx++;
  if (active.idx >= active.lines.length) {
    close();
    return;
  }
  paint();
  playSfx("neutral", { volume: 0.3 });
}

function paint() {
  if (!active) return;
  root.querySelector("#dialogue-text").textContent = active.lines[active.idx];
}

function close() {
  if (!active) return;
  const resolve = active.resolve;
  active = null;
  root.style.display = "none";
  resolve();
}

// Resolves an entity's dialogue list to displayable text lines.
export function resolveEntityDialogue(entity) {
  const dialogues = entity.dialogues || [];
  if (dialogues.length === 0) return null;
  return dialogues.map((d) => tr(d.text));
}
