// Shared top HUD row: a single left-anchored horizontal strip that holds the
// HP bar, the coin counter and the ammo counter side by side, in that order.
// Each of those is still its own feature/file — this is only the cross-cutting
// layout container they drop into, the structural sibling of dom.js / uiTokens.js.
//
// The strip runs from the left margin to a right margin that clears the touch
// menu button. The HP bar is the one elastic item (min..max width): on a narrow
// phone it gives up width so the fixed-size coin + ammo chips still fit on the
// same line and never overlap it. Flex siblings can't overlap, so keeping the
// three in one row is what guarantees that.

import { el } from "./dom.js";

let root = null;

export function topHudRow() {
  if (root) return root;
  injectStyles();
  root = el("div", { id: "top-hud-row" });
  document.body.appendChild(root);
  return root;
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("top-hud-row-styles")) return;
  const style = document.createElement("style");
  style.id = "top-hud-row-styles";
  style.textContent = `
    #top-hud-row {
      position: fixed;
      top: 12px;
      left: 12px;
      right: 12px;
      display: flex;
      align-items: flex-start;
      gap: 8px;
      z-index: 11;
      pointer-events: none;
    }
    /* Fixed left-to-right order, independent of which HUD installs first. */
    #top-hud-row > #health-hud { order: 0; }
    #top-hud-row > #coin-hud   { order: 1; }
    #top-hud-row > #ammo-hud   { order: 2; }
    /* Leave room for the ☰ menu button (top-right, ~56px) on touch. This
       right margin is also what makes the HP bar shrink instead of letting
       the row run under the button. */
    body.touch-mode #top-hud-row { right: 76px; }
  `;
  document.head.appendChild(style);
}
