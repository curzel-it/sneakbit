// DisplayableMessage modal. Mirrors Rust features/messages.rs — a
// full-screen {title, text} popup distinct from toasts (transient) and
// dialogues (multi-line, NPC-driven). Use it for chapter intros, quest
// announcements, story beats, and anything that deserves to halt the
// loop until the player acknowledges.
//
// One modal at a time. `isMessageOpen()` reports the pause state to
// main.js so the game loop stops ticking while the message is up.

import { playSfx } from "./audio.js";

let root = null;
let open = false;
let pendingDismiss = null;

export function installMessage() {
  if (root) return root;
  if (typeof document === "undefined") return null;
  root = document.createElement("div");
  root.id = "message";
  root.innerHTML = `
    <div class="msg-card">
      <h1 id="msg-title"></h1>
      <p  id="msg-text"></p>
      <div class="msg-actions">
        <button id="msg-ok">OK</button>
      </div>
    </div>
  `;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.74)",
    zIndex: "24",
    color: "#e6ecff",
    fontFamily: "monospace",
  });
  document.body.appendChild(root);
  injectStyles();
  root.querySelector("#msg-ok").addEventListener("click", dismiss);
  window.addEventListener("keydown", onKeydown);
  return root;
}

export function isMessageOpen() { return open; }

export function showMessage(title, text, onDismiss) {
  if (!root) installMessage();
  if (!root) return;
  open = true;
  pendingDismiss = typeof onDismiss === "function" ? onDismiss : null;
  root.querySelector("#msg-title").textContent = title ?? "";
  root.querySelector("#msg-text").textContent = text ?? "";
  root.style.display = "flex";
  const btn = root.querySelector("#msg-ok");
  btn.disabled = true;
  setTimeout(() => { btn.disabled = false; btn.focus(); }, 200);
  try { playSfx("hintReceived", { volume: 0.5 }); } catch {}
}

function onKeydown(e) {
  if (!open) return;
  if (e.code !== "Enter" && e.code !== "Space" && e.code !== "Escape") return;
  e.preventDefault();
  const btn = root.querySelector("#msg-ok");
  if (btn?.disabled) return;
  dismiss();
}

function dismiss() {
  if (!open) return;
  open = false;
  root.style.display = "none";
  const cb = pendingDismiss;
  pendingDismiss = null;
  if (cb) cb();
}

if (typeof window !== "undefined") {
  // Devtools helper: `window.showMessage("Hi", "How are you?")`.
  window.showMessage = (title, text, cb) => showMessage(title, text, cb);
}

function injectStyles() {
  if (document.getElementById("message-styles")) return;
  const css = `
    #message .msg-card {
      background: #15182a;
      border: 1px solid #2c3654;
      border-radius: 8px;
      padding: 26px 32px;
      max-width: min(560px, 86vw);
      box-shadow: 0 16px 48px rgba(0,0,0,0.6);
      text-align: center;
    }
    #message h1 { margin: 0 0 12px; font-size: 18px; letter-spacing: 2px; color: #c8d4ff; }
    #message p  { margin: 0 0 18px; color: #cfd6e8; line-height: 1.55; white-space: pre-wrap; }
    #message .msg-actions { text-align: center; }
    #message button {
      background: #1d2440; color: #e6ecff; border: 1px solid #303a60;
      padding: 8px 22px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 13px; letter-spacing: 1px;
    }
    #message button:hover:enabled { background: #2a345a; }
    #message button:disabled { opacity: 0.5; cursor: default; }
  `;
  const style = document.createElement("style");
  style.id = "message-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
