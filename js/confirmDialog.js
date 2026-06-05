// Styled confirm modal — the in-game replacement for native confirm().
// Returns a Promise<boolean> (true = confirmed, false = cancelled/dismissed)
// so callers read `if (await showConfirm(...))` just like the old sync call.
//
// Why not confirm(): the native dialog can't be styled, looks nothing like
// the rest of the game, and — the real blocker — isn't reachable with a
// controller, so a Steam Full Controller Support player hits a dead end on
// "New game (wipe save)". This modal registers as a menu surface, so the
// shared keyboard/controller nav (arrows + A/B) drives it for free.
//
// Layout: buttons sit in a row on desktop and stack vertically on coarse
// pointers (phones), where a side-by-side pair would be cramped. The
// primary action stays visually first (top / left) via column-reverse so
// DOM order can keep Cancel first — that lets us default focus to the safe
// choice on danger prompts without reordering the markup.

import { playSfx } from "./audio.js";
import { registerMenuSurface } from "./menuNav.js";
import { el } from "./dom.js";

let root = null;
let open = false;
let resolver = null;

export function isConfirmOpen() { return open; }

// showConfirm({ title, text, confirmLabel, cancelLabel, danger }) -> Promise<boolean>
// `danger` tints the confirm button red and defaults focus to Cancel, so a
// stray A/Enter on a destructive prompt cancels rather than fires.
export function showConfirm(opts = {}) {
  const {
    title = "Are you sure?",
    text = "",
    confirmLabel = "Confirm",
    cancelLabel = "Cancel",
    danger = false,
  } = opts;
  if (!root) install();
  if (!root) return Promise.resolve(false);
  // Re-entrancy guard: a second prompt over the first resolves the first
  // as cancelled so no caller is left awaiting a promise that never settles.
  if (resolver) { const r = resolver; resolver = null; r(false); }

  root.querySelector("#confirm-title").textContent = title;
  const body = root.querySelector("#confirm-text");
  body.textContent = text;
  body.style.display = text ? "" : "none";

  const okBtn = root.querySelector("#confirm-ok");
  const cancelBtn = root.querySelector("#confirm-cancel");
  okBtn.textContent = confirmLabel;
  cancelBtn.textContent = cancelLabel;
  okBtn.classList.toggle("confirm-danger", !!danger);

  open = true;
  root.style.display = "flex";
  try { playSfx("hintReceived", { volume: 0.5 }); } catch {}

  // Disable briefly so the same keypress/controller press that opened the
  // dialog (Enter / A on the triggering button) can't carry through and
  // instantly resolve it. Then focus the safe default.
  okBtn.disabled = true;
  cancelBtn.disabled = true;
  setTimeout(() => {
    if (!open) return;
    okBtn.disabled = false;
    cancelBtn.disabled = false;
    setHighlight(danger ? cancelBtn : okBtn);
  }, 180);

  return new Promise((resolve) => { resolver = resolve; });
}

function setHighlight(btn) {
  // Mirror menuNav's own highlight: clear any prior .nav-focused, mark this
  // button, and move real focus onto it so the shared move()/confirm() nav
  // (which keys off document.activeElement) continues from here. We can't
  // reuse focusFirstIn — it querySelectorAll's a *container's* descendants,
  // and a single button isn't its own descendant.
  for (const prev of document.querySelectorAll(".nav-focused")) {
    prev.classList.remove("nav-focused");
  }
  btn.classList.add("nav-focused");
  try { btn.focus({ preventScroll: true }); } catch { btn.focus(); }
}

function close(result) {
  if (!open) return;
  open = false;
  root.style.display = "none";
  const r = resolver;
  resolver = null;
  if (r) r(result);
}

function onKeydown(e) {
  if (!open) return;
  if (e.code === "Escape") {
    e.preventDefault();
    e.stopImmediatePropagation();
    close(false);
  }
  // Enter/Space activate the focused button natively (shared menu nav keeps
  // a button highlighted), so they need no handling here.
}

function install() {
  if (root) return root;
  if (typeof document === "undefined") return null;
  root = el("div", {
    id: "confirm-dialog",
    html: `
    <div class="confirm-card">
      <h1 id="confirm-title"></h1>
      <p  id="confirm-text"></p>
      <div class="confirm-actions">
        <button id="confirm-cancel" type="button"></button>
        <button id="confirm-ok" type="button"></button>
      </div>
    </div>
  `,
    style: {
      position: "fixed",
      inset: "0",
      display: "none",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.74)",
      zIndex: "30",
      color: "var(--sb-text)",
      fontFamily: "var(--sb-font)",
    },
  });
  document.body.appendChild(root);
  injectStyles();
  root.querySelector("#confirm-ok").addEventListener("click", () => close(true));
  root.querySelector("#confirm-cancel").addEventListener("click", () => close(false));
  // Clicking the dim backdrop (outside the card) cancels, matching the
  // "click away to dismiss" feel of the rest of the UI.
  root.addEventListener("click", (e) => { if (e.target === root) close(false); });
  window.addEventListener("keydown", onKeydown);
  // Highest priority of the modal surfaces — a confirm can legitimately
  // open on top of a message/menu and must own input while it's up.
  registerMenuSurface({ root: () => root, isOpen: isConfirmOpen, priority: 30 });
  return root;
}

function injectStyles() {
  if (document.getElementById("confirm-dialog-styles")) return;
  const css = `
    #confirm-dialog .confirm-card {
      background: var(--sb-card-bg);
      border: var(--sb-card-border);
      border-radius: var(--sb-card-radius);
      padding: 24px 28px;
      max-width: min(440px, 88vw);
      box-shadow: 0 16px 48px rgba(0,0,0,0.6);
      text-align: center;
    }
    #confirm-dialog h1 {
      margin: 0 0 12px; font-size: 17px; letter-spacing: 1.5px; color: #c8d4ff;
    }
    #confirm-dialog p {
      margin: 0 0 20px; color: var(--sb-text-muted); line-height: 1.55;
      white-space: pre-wrap; font-size: 13px;
    }
    #confirm-dialog .confirm-actions {
      display: flex; gap: 10px; justify-content: center;
    }
    #confirm-dialog button {
      flex: 0 1 auto; min-width: 116px;
      background: #1d2440; color: var(--sb-text); border: 1px solid #303a60;
      padding: 9px 20px; border-radius: var(--sb-surface-radius); cursor: pointer;
      font-family: inherit; font-size: 13px; letter-spacing: 1px;
    }
    #confirm-dialog button:hover:enabled { background: #2a345a; }
    #confirm-dialog button:disabled { opacity: 0.5; cursor: default; }
    #confirm-dialog button.confirm-danger {
      background: var(--sb-accent-danger-bg);
      border-color: var(--sb-accent-danger-border);
      color: #ffd9d9;
    }
    #confirm-dialog button.confirm-danger:hover:enabled { background: #4d2727; }
    /* Phones: stack the buttons full-width. column-reverse keeps the
       primary (confirm) on top while DOM order stays Cancel-first. */
    @media (pointer: coarse) {
      #confirm-dialog .confirm-actions { flex-direction: column-reverse; }
      #confirm-dialog button { width: 100%; }
    }
  `;
  const style = document.createElement("style");
  style.id = "confirm-dialog-styles";
  style.textContent = css;
  document.head.appendChild(style);
}

if (typeof window !== "undefined") {
  // Devtools helper: `await window.showConfirm({ title: "Hi?", danger: true })`.
  window.showConfirm = (o) => showConfirm(o);
}
