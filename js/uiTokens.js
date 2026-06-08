// Shared design tokens for the HTML UI layer. Every chrome surface (HUD
// chips, touch buttons, modal cards, toasts) was historically growing
// its own copy of "what's a dark translucent rectangle in this game"
// — different rgba alphas, different border greys, different corner
// radii. The drift was visible: a player saw five almost-but-not-quite-
// matching boxes on screen at once.
//
// Tokens land as CSS custom properties on :root. Existing per-feature
// stylesheets reference them via var(...), so adding a new chrome bit
// stays a one-liner without re-introducing the ad-hoc constants.

let installed = false;

export function installUiTokens() {
  if (installed) return;
  installed = true;
  if (typeof document === "undefined") return;
  if (document.getElementById("sb-ui-tokens")) return;
  const style = document.createElement("style");
  style.id = "sb-ui-tokens";
  style.textContent = `
    :root {
      /* Floating HUD chips, touch buttons, party chip. Translucent
         enough to read the world underneath, opaque enough to read
         the text on top. */
      --sb-surface-bg: rgba(10, 10, 10, 0.72);
      --sb-surface-border: 1px solid rgba(255, 255, 255, 0.18);
      --sb-surface-radius: 6px;

      /* Modal cards (menu, party panel, dialogue, message). Fully
         opaque — they own the screen while open, and pretending to
         see through them just makes the text harder to read. */
      --sb-card-bg: #181818;
      --sb-card-border: 1px solid #333;
      --sb-card-radius: 8px;

      /* Type. Monospace everywhere — matches the pixel-art aesthetic
         and ships in every browser without a font download. */
      --sb-font: monospace;
      --sb-text: #eee;
      --sb-text-muted: #8a92ad;
      --sb-text-dim: #888;

      /* Action accents — used as border tints for the touch action
         buttons and the colored buttons inside modals (danger / etc).
         The intent is "subtle hue cue" not "big colored fill"; the
         icon does the heavy identification work. */
      --sb-accent-attack: rgba(220, 90, 90, 0.6);
      --sb-accent-positive: rgba(110, 200, 130, 0.6);
      --sb-accent-danger-bg: #3a1f1f;
      --sb-accent-danger-border: #6b3434;

      /* Interactive feedback for buttons — kept consistent across
         touch + DOM so a "pressed" state reads the same everywhere. */
      --sb-surface-bg-active: rgba(60, 60, 60, 0.85);

      /* Scrollbars. A thin dark-blue thumb on a transparent track, tuned
         to the modal palette (#3a4150 borders, #4a5878 button edges) so
         every scrollable surface — shop list, menu/inventory,
         panels — matches the rest of the chrome instead of showing the
         OS default. */
      --sb-scrollbar-size: 10px;
      --sb-scrollbar-thumb: #3a4150;
      --sb-scrollbar-thumb-hover: #4a5878;
    }

    /* Firefox. Applied to every element so nested scroll areas inherit it. */
    * {
      scrollbar-width: thin;
      scrollbar-color: var(--sb-scrollbar-thumb) transparent;
    }

    /* WebKit / Chromium / Safari. */
    *::-webkit-scrollbar { width: var(--sb-scrollbar-size); height: var(--sb-scrollbar-size); }
    *::-webkit-scrollbar-track { background: transparent; }
    *::-webkit-scrollbar-thumb {
      background: var(--sb-scrollbar-thumb);
      border-radius: 6px;
      /* Transparent border + padding-box clip insets the thumb so it reads
         as a slim pill with breathing room rather than filling the gutter. */
      border: 2px solid transparent;
      background-clip: padding-box;
    }
    *::-webkit-scrollbar-thumb:hover { background: var(--sb-scrollbar-thumb-hover); }
    *::-webkit-scrollbar-corner { background: transparent; }
  `;
  document.head.appendChild(style);
}
