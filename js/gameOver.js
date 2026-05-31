// Death / GameOver modal.
//
// Shown when the player's HP drops to zero. Mirrors Rust
// MatchResult::GameOver — the play loop halts behind a dimmed overlay and
// the player has to acknowledge before the zone teleports them back to
// the starting spawn. The modal lives in the DOM (like menu.js) so we get
// styling + a real button focusable by keyboard for free.

import { playSfx } from "./audio.js?v=20260531b";
import { registerMenuSurface, focusFirstIn } from "./menuNav.js?v=20260531b";
import { tr } from "./strings.js?v=20260531b";

const DEFAULT_TITLE = "You died";
const DEFAULT_SUB = "The shadows have taken you.";

let root = null;
let open = false;
let pendingContinue = null;

export function installGameOver() {
  if (root) return root;
  root = document.createElement("div");
  root.id = "gameover";
  root.innerHTML = `
    <div class="go-card">
      <h1>You died</h1>
      <p class="go-sub">The shadows have taken you.</p>
      <button id="go-continue">Continue</button>
    </div>
  `;
  Object.assign(root.style, {
    position: "fixed",
    inset: "0",
    display: "none",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0,0,0,0.78)",
    zIndex: "25",
    color: "#f1d4d4",
    fontFamily: "monospace",
  });
  document.body.appendChild(root);
  injectStyles();
  root.querySelector("#go-continue").addEventListener("click", commitContinue);
  window.addEventListener("keydown", onKeydown);
  registerMenuSurface({ root: () => root, isOpen: isGameOverOpen, priority: 20 });
  return root;
}

export function isGameOverOpen() { return open; }

export function showGameOver(onContinue, opts = {}) {
  if (open) return;
  setCard(DEFAULT_TITLE, DEFAULT_SUB, "Continue");
  open = true;
  pendingContinue = typeof onContinue === "function" ? onContinue : null;
  root.style.display = "flex";
  const btn = root.querySelector("#go-continue");
  // Online co-op guests can't drive their own respawn — only the host
  // can teleport them back to the spawn point. We surface the overlay
  // but hide the Continue button and the keyboard accelerator; an
  // event:respawn from the host dismisses it via hideGameOver().
  if (opts.waitingForHost) {
    btn.style.display = "none";
    const sub = root.querySelector(".go-sub");
    if (sub) sub.textContent = "Waiting for the host…";
  } else {
    btn.style.display = "";
    btn.disabled = true;
    // Brief delay before the button accepts a press so the player can't
    // skip the screen with a stale Enter from in-game input.
    setTimeout(() => { btn.disabled = false; focusFirstIn(root); }, 350);
  }
  playSfx("gameOver");
}

// PvP end-of-match screen. Mirrors Rust's death-screen reading of
// MatchResult: a winner (death_screen.player_won) or an unknown result
// (death_screen.unknown_result), both inviting a rematch
// (death_screen.start_new_match). Confirm runs onRematch. Reuses the same
// modal as the co-op death overlay; setCard restores the text each time.
// opts.waitingForHost hides the Rematch button (online guests can't drive their
// own rematch — only the host's pvpStart/pvpEnd dismisses it), so a guest can't
// dead-end the modal into a bare arena.
export function showMatchResult(result, onRematch, opts = {}) {
  if (open) return;
  const won = result?.kind === "winner";
  const title = won
    ? tr("death_screen.player_won").replace("%PLAYER_NAME%", String((result.playerIndex | 0) + 1))
    : tr("death_screen.unknown_result");
  const waiting = !!opts.waitingForHost;
  setCard(title, waiting ? "Waiting for the host…" : tr("death_screen.start_new_match"), "Rematch");
  open = true;
  pendingContinue = (!waiting && typeof onRematch === "function") ? onRematch : null;
  root.style.display = "flex";
  const btn = root.querySelector("#go-continue");
  if (waiting) {
    btn.style.display = "none";
  } else {
    btn.style.display = "";
    btn.disabled = true;
    setTimeout(() => { btn.disabled = false; focusFirstIn(root); }, 350);
  }
  playSfx("gameOver");
}

function setCard(title, sub, buttonLabel) {
  const h1 = root.querySelector("h1");
  const subEl = root.querySelector(".go-sub");
  const btn = root.querySelector("#go-continue");
  if (h1) h1.textContent = title;
  if (subEl) subEl.textContent = sub;
  if (btn) btn.textContent = buttonLabel;
}

// Programmatic dismiss used by the guest's event:respawn handler. Does
// NOT invoke the onContinue callback (the host already did the respawn
// work; this is just hiding the overlay).
export function hideGameOver() {
  if (!open) return;
  open = false;
  pendingContinue = null;
  root.style.display = "none";
  const sub = root.querySelector(".go-sub");
  if (sub) sub.textContent = "The shadows have taken you.";
  const btn = root.querySelector("#go-continue");
  if (btn) btn.style.display = "";
}

function onKeydown(e) {
  if (!open) return;
  if (e.code !== "Enter" && e.code !== "Space" && e.code !== "Escape") return;
  const btn = root.querySelector("#go-continue");
  // Guest "waiting for host" mode hides the button — swallow the key so
  // a stray Enter doesn't accidentally trigger a no-op pendingContinue.
  if (btn?.style.display === "none") { e.preventDefault(); return; }
  e.preventDefault();
  if (btn?.disabled) return;
  commitContinue();
}

function commitContinue() {
  if (!open) return;
  open = false;
  root.style.display = "none";
  const cb = pendingContinue;
  pendingContinue = null;
  if (cb) cb();
}

function injectStyles() {
  if (document.getElementById("gameover-styles")) return;
  const css = `
    #gameover .go-card {
      background: #1b0d0d;
      border: 1px solid #4a2424;
      border-radius: 8px;
      padding: 28px 32px;
      min-width: 280px;
      box-shadow: 0 18px 60px rgba(0,0,0,0.7);
      text-align: center;
    }
    #gameover h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: 2px; color: #f3b4b4; }
    #gameover .go-sub { color: #ad8a8a; margin: 0 0 22px; font-size: 12px; }
    #gameover button {
      background: #3a1a1a; color: #f1d4d4; border: 1px solid #5c2a2a;
      padding: 10px 22px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 13px; letter-spacing: 1px;
    }
    #gameover button:hover:enabled { background: #4d2222; }
    #gameover button:disabled { opacity: 0.5; cursor: default; }
  `;
  const style = document.createElement("style");
  style.id = "gameover-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
