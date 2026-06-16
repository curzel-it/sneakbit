// Design-system showcase. A dev-only reference page (play/showcase.html, not
// linked from the game, not in the production bundle) that lays the whole HTML
// UI layer out in one place: the shared tokens from uiTokens.js as labelled
// swatches, a static gallery of the common chrome built from those same
// tokens, and live triggers that pop the REAL modals/toast/dialogue so drift
// between "what the tokens say" and "what a component actually renders" is
// visible at a glance.
//
// It deliberately imports and calls the real components — playSfx no-ops
// without audio, tr() falls back to its key, and showDialogue takes a literal
// lines array + explicit speaker — so nothing here needs game data to boot.

import { installUiTokens } from "./uiTokens.js";
import { el } from "./dom.js";
import { showMessage } from "./message.js";
import { showConfirm } from "./confirmDialog.js";
import { showToast } from "./toast.js";
import { installDialogue, showDialogue } from "./dialogue.js";
import { richLineToHtml } from "./richText.js";

// Curated catalog of the tokens worth documenting, grouped the same way
// uiTokens.js comments them. `kind` decides how the swatch is drawn; values
// are read live from :root so this never goes stale.
const GROUPS = [
  {
    title: "Surfaces — floating HUD chips, touch buttons",
    tokens: [
      ["--sb-surface-bg", "color", "Translucent chip fill"],
      ["--sb-surface-border", "border", "Chip hairline border"],
      ["--sb-surface-radius", "radius", "Chip corner radius"],
      ["--sb-surface-bg-active", "color", "Pressed-button feedback"],
    ],
  },
  {
    title: "Cards — modals (menu, message, confirm, dialogue, panels)",
    tokens: [
      ["--sb-card-bg", "color", "Opaque navy card fill"],
      ["--sb-card-border", "border", "Card border"],
      ["--sb-card-border-color", "color", "Card border colour (bare)"],
      ["--sb-card-border-hi", "color", "Lit top edge"],
      ["--sb-card-radius", "radius", "Card corner radius"],
    ],
  },
  {
    title: "Text",
    tokens: [
      ["--sb-text", "text", "Primary text"],
      ["--sb-text-muted", "text", "Muted / secondary"],
      ["--sb-text-dim", "text", "Dim / tertiary"],
      ["--sb-title", "text", "Modal heading (periwinkle)"],
      ["--sb-text-body", "text", "Modal body"],
      ["--sb-text-em", "text", "Rich-text _italic_"],
      ["--sb-text-strong", "text", "Rich-text *bold* (gold)"],
    ],
  },
  {
    title: "Buttons — the shared blue modal action",
    tokens: [
      ["--sb-button-bg", "color", "Button fill"],
      ["--sb-button-border", "color", "Button border"],
      ["--sb-button-bg-hover", "color", "Button hover fill"],
    ],
  },
  {
    title: "Accents — subtle hue cues",
    tokens: [
      ["--sb-accent-attack", "color", "Attack (red)"],
      ["--sb-accent-positive", "color", "Positive (green)"],
      ["--sb-accent-danger-bg", "color", "Danger button fill"],
      ["--sb-accent-danger-border", "color", "Danger button border"],
    ],
  },
  {
    title: "Scrollbars",
    tokens: [
      ["--sb-scrollbar-thumb", "color", "Thumb"],
      ["--sb-scrollbar-thumb-hover", "color", "Thumb hover"],
    ],
  },
];

function readToken(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// The showcase chrome — its own classes, styled from the same tokens so the
// gallery examples track the real ones. Scoped under #showcase so it can't
// bleed into the live components it pops.
function injectShowcaseStyles() {
  const css = `
    #showcase {
      max-width: 1040px; margin: 0 auto; padding: 40px 24px 120px;
      font-family: var(--sb-font); color: var(--sb-text);
    }
    #showcase h1 { font-size: 22px; letter-spacing: 2px; color: var(--sb-title); margin: 0 0 4px; }
    #showcase .sc-sub { color: var(--sb-text-muted); font-size: 13px; margin: 0 0 36px; line-height: 1.5; }
    #showcase h2 {
      font-size: 13px; letter-spacing: 1.5px; text-transform: uppercase;
      color: var(--sb-title); margin: 40px 0 14px;
      border-bottom: 1px solid var(--sb-card-border-color); padding-bottom: 8px;
    }
    #showcase .sc-group { margin-bottom: 28px; }
    #showcase .sc-group-title { color: var(--sb-text-muted); font-size: 12px; margin: 0 0 12px; }
    #showcase .sc-swatches { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    #showcase .sc-swatch { display: flex; align-items: center; gap: 12px; }
    #showcase .sc-chip {
      width: 52px; height: 52px; flex-shrink: 0; border-radius: 6px;
      background: #0c0e16; border: 1px solid #2c3654;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; color: var(--sb-text);
    }
    #showcase .sc-meta { min-width: 0; }
    #showcase .sc-name { font-size: 12px; color: var(--sb-text); word-break: break-all; }
    #showcase .sc-val { font-size: 11px; color: var(--sb-text-dim); margin-top: 2px; }
    #showcase .sc-desc { font-size: 11px; color: var(--sb-text-muted); margin-top: 2px; }
    #showcase .sc-row { display: flex; flex-wrap: wrap; gap: 16px; align-items: flex-start; }

    /* Gallery: faithful copies of the real chrome, built from the tokens. */
    #showcase .sc-card {
      background: var(--sb-card-bg); border: var(--sb-card-border);
      border-radius: var(--sb-card-radius); padding: 20px 24px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.6); max-width: 360px;
    }
    #showcase .sc-card h3 { margin: 0 0 10px; font-size: 15px; letter-spacing: 1px; color: var(--sb-title); }
    #showcase .sc-card p { margin: 0; color: var(--sb-text-body); font-size: 13px; line-height: 1.55; }
    #showcase .sc-surface {
      background: var(--sb-surface-bg); border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius); padding: 6px 12px;
      font-size: 13px; color: var(--sb-text);
    }
    #showcase .sc-btn {
      background: var(--sb-button-bg); color: var(--sb-text);
      border: 1px solid var(--sb-button-border); border-radius: var(--sb-surface-radius);
      padding: 9px 20px; font-family: inherit; font-size: 13px; letter-spacing: 1px; cursor: pointer;
    }
    #showcase .sc-btn:hover { background: var(--sb-button-bg-hover); }
    #showcase .sc-btn.danger {
      background: var(--sb-accent-danger-bg); border-color: var(--sb-accent-danger-border); color: #ffd9d9;
    }
    #showcase .sc-rich { font-size: 14px; line-height: 1.6; color: var(--sb-text); }
    #showcase .sc-rich em { font-style: italic; color: var(--sb-text-em); }
    #showcase .sc-rich strong { font-weight: 700; color: var(--sb-text-strong); }
    #showcase .sc-note {
      margin-top: 10px; font-size: 12px; color: var(--sb-text-muted);
      background: rgba(255,233,168,0.06); border-left: 2px solid var(--sb-text-strong);
      padding: 8px 12px; border-radius: 4px; line-height: 1.5;
    }
  `;
  const style = el("style", { id: "showcase-styles", text: css });
  document.head.appendChild(style);
}

function swatchChip(kind, name) {
  // The little 52px preview tile, drawn appropriately for the token's kind.
  if (kind === "color") return el("div", { class: "sc-chip", style: { background: `var(${name})` } });
  if (kind === "border") return el("div", { class: "sc-chip", style: { border: `var(${name})` } });
  if (kind === "radius") {
    return el("div", { class: "sc-chip", style: { background: "var(--sb-card-bg)", borderRadius: `var(${name})` } });
  }
  // text
  return el("div", { class: "sc-chip", style: { color: `var(${name})` }, text: "Aa" });
}

function tokenSwatch([name, kind, desc]) {
  return el("div", { class: "sc-swatch" }, [
    swatchChip(kind, name),
    el("div", { class: "sc-meta" }, [
      el("div", { class: "sc-name", text: name }),
      el("div", { class: "sc-val", text: readToken(name) || "—" }),
      el("div", { class: "sc-desc", text: desc }),
    ]),
  ]);
}

function tokenSection() {
  const groups = GROUPS.map((g) =>
    el("div", { class: "sc-group" }, [
      el("div", { class: "sc-group-title", text: g.title }),
      el("div", { class: "sc-swatches" }, g.tokens.map(tokenSwatch)),
    ]),
  );
  return el("section", {}, [el("h2", { text: "Tokens" }), ...groups]);
}

function gallerySection() {
  const card = el("div", { class: "sc-card" }, [
    el("h3", { text: "MODAL CARD" }),
    el("p", { text: "Opaque navy card with a periwinkle heading and a lighter body line. Shared by message, confirm and the panels." }),
  ]);

  const chips = el("div", { class: "sc-row" }, [
    el("span", { class: "sc-surface", text: "◆ 12" }),
    el("span", { class: "sc-surface", text: "HP ▮▮▮▯▯" }),
    el("span", { class: "sc-surface", text: "≡ Menu" }),
  ]);

  const buttons = el("div", { class: "sc-row" }, [
    el("button", { class: "sc-btn", text: "Action" }),
    el("button", { class: "sc-btn danger", text: "Destructive" }),
  ]);

  const rich = el("div", { class: "sc-rich", html: richLineToHtml("Take the *Rusty Key* — it _might_ open the north gate.") });

  return el("section", {}, [
    el("h2", { text: "Gallery" }),
    el("div", { class: "sc-group" }, [el("div", { class: "sc-group-title", text: "Card" }), card]),
    el("div", { class: "sc-group" }, [el("div", { class: "sc-group-title", text: "HUD chips (surface)" }), chips]),
    el("div", { class: "sc-group" }, [el("div", { class: "sc-group-title", text: "Buttons" }), buttons]),
    el("div", { class: "sc-group" }, [
      el("div", { class: "sc-group-title", text: "Rich text (*bold* gold, _italic_ periwinkle)" }),
      rich,
    ]),
  ]);
}

function liveSection() {
  const btn = (label, onClick) => el("button", { class: "sc-btn", text: label, on: { click: onClick } });

  const dialogueLines = [
    "Well met, traveller. The road south has been _quiet_ of late...",
    "If you find the *Rusty Key*, the north gate is yours to open.",
  ];

  const buttons = el("div", { class: "sc-row" }, [
    btn("Dialogue (named NPC)", () => showDialogue(dialogueLines, 0, "Old Marek")),
    btn("Dialogue (sign / anonymous)", () => showDialogue(["* Beware *\nThe bridge ahead is out."], 0, "")),
    btn("Message", () => showMessage("CHAPTER ONE", "The frost had not yet left the valley when the bell began to ring.")),
    btn("Confirm", () => showConfirm({ title: "Leave the area?", text: "Unsaved progress in this room will be lost." })),
    btn("Confirm (danger)", () => showConfirm({ title: "New game?", text: "This wipes your current save.", confirmLabel: "Wipe save", danger: true })),
    btn("Toast (hint)", () => showToast("Equipped: Rusty Sword")),
    btn("Toast (long)", () => showToast("You received 10 Kunai", "longHint")),
  ]);

  const note = el("div", { class: "sc-note", html:
    "<strong>Known drift:</strong> the toast pill still hardcodes its own fill/border (rgba(10,10,10,.92) / #444) instead of the surface tokens — pop one above and compare it to the HUD chips in the gallery." });

  return el("section", {}, [
    el("h2", { text: "Live components" }),
    el("div", { class: "sc-group-title", text: "Click to pop the real component (not a copy):" }),
    buttons,
    note,
  ]);
}

function boot() {
  installUiTokens();
  installDialogue(); // showDialogue needs its root in the DOM first
  injectShowcaseStyles();

  const root = el("div", { id: "showcase" }, [
    el("h1", { text: "SneakBit — Design System" }),
    el("p", { class: "sc-sub", html:
      "The shared HTML UI layer: tokens from <code>js/uiTokens.js</code>, the chrome built from them, and the live modals. " +
      "Dev-only reference — not shipped to players." }),
    tokenSection(),
    gallerySection(),
    liveSection(),
  ]);
  document.body.appendChild(root);
}

boot();
