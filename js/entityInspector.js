// EntityInspector: creative-mode panel for editing a placed entity's
// behavior after the player closes its dialogue. The map editor
// (mapEditor.js) opens this when you left-click a placed entity with no
// placement selection active; picking a mode mutates the raw entity's
// `after_dialogue` field and calls back so the editor can rebuild + flush
// the zone. The runtime behaviors themselves live in afterDialogue.js —
// this is purely the authoring UI for the `after_dialogue` enum.
//
// DOM is built lazily inside the open path so this module is import-safe
// in the pure node tests (which exercise entityAtTile below). Nothing at
// module scope touches `document`.

import { AFTER_DIALOGUE_BEHAVIORS } from "./afterDialogue.js";
import { el } from "./dom.js";

// Human-readable labels for the enum values. Keys should cover every value
// in AFTER_DIALOGUE_BEHAVIORS; any unlisted value falls back to its raw name.
export const BEHAVIOR_LABEL = {
  Nothing: "Nothing — stay, re-openable",
  Disappear: "Disappear — vanish instantly",
  FlyAwayEast: "Fly away east",
  VanishSmoke: "Vanish (smoke bomb)",
  VanishTeleport: "Vanish (teleport)",
  WalkToNearestExit: "Walk to nearest exit",
};

let panelEl = null;
let current = null; // { entity, onChange }

// Pure hit-test: the topmost entity whose frame covers (tileX, tileY).
// Later entities draw on top, so we scan back-to-front and return the
// first cover. Exported for the editor's click routing and unit tests.
export function entityAtTile(entities, tileX, tileY) {
  if (!Array.isArray(entities)) return null;
  for (let i = entities.length - 1; i >= 0; i--) {
    const e = entities[i];
    const f = e?.frame;
    if (!f) continue;
    const w = f.w || 1;
    const h = f.h || 1;
    if (tileX >= f.x && tileX < f.x + w && tileY >= f.y && tileY < f.y + h) {
      return e;
    }
  }
  return null;
}

export function openEntityInspector(entity, opts = {}) {
  if (!entity || typeof document === "undefined") return;
  current = { entity, onChange: opts.onChange || (() => {}) };
  if (!panelEl) buildPanel();
  injectStyles();
  populate(opts.title);
  panelEl.style.display = "block";
}

export function closeEntityInspector() {
  current = null;
  if (panelEl) panelEl.style.display = "none";
}

export function isEntityInspectorOpen() {
  return !!panelEl && panelEl.style.display === "block";
}

// The entity the inspector is currently editing, or null. Lets the editor
// notice when an erase removes the inspected entity and close the panel
// instead of leaving it pointed at a detached object.
export function inspectedEntity() {
  return current?.entity ?? null;
}

function buildPanel() {
  panelEl = el("div", {
    id: "entity-inspector",
    html: `
    <div class="ei-head">
      <strong>Entity</strong>
      <button id="ei-close" class="ei-close">×</button>
    </div>
    <div class="ei-name" id="ei-name"></div>
    <label class="ei-field">
      <span>After dialogue</span>
      <select id="ei-after-dialogue"></select>
    </label>
    <div class="ei-hint">Plays once the player closes this entity's dialogue. No effect in creative mode.</div>
  `,
  });
  document.body.appendChild(panelEl);
  panelEl.querySelector("#ei-close").addEventListener("click", closeEntityInspector);
  const select = panelEl.querySelector("#ei-after-dialogue");
  for (const beh of AFTER_DIALOGUE_BEHAVIORS) {
    select.appendChild(el("option", { value: beh, text: BEHAVIOR_LABEL[beh] ?? beh }));
  }
  select.addEventListener("change", () => {
    if (!current?.entity) return;
    current.entity.after_dialogue = select.value;
    current.onChange();
  });
}

function populate(title) {
  if (!panelEl || !current?.entity) return;
  panelEl.querySelector("#ei-name").textContent = title || `#${current.entity.id}`;
  const select = panelEl.querySelector("#ei-after-dialogue");
  select.value = current.entity.after_dialogue || "Nothing";
}

function injectStyles() {
  if (document.getElementById("entity-inspector-styles")) return;
  const css = `
    #entity-inspector {
      position: fixed; left: 0; bottom: 0;
      width: 280px; max-width: 40vw;
      background: rgba(20, 20, 20, 0.95);
      color: #eee;
      font-family: monospace;
      font-size: 11px;
      z-index: 31;
      padding: 8px 10px;
      border-top: 1px solid #333;
      border-right: 1px solid #333;
    }
    #entity-inspector .ei-head { display: flex; align-items: center; gap: 6px; margin-bottom: 6px; }
    #entity-inspector .ei-head strong { flex: 1; }
    #entity-inspector .ei-close { background: #2a2a2a; color: #eee; border: 1px solid #444;
      padding: 2px 8px; border-radius: 3px; cursor: pointer; font-family: inherit; }
    #entity-inspector .ei-name { background: #1f1f1f; border: 1px solid #333;
      border-radius: 3px; padding: 4px 6px; margin-bottom: 8px; color: #d8d8d8; }
    #entity-inspector .ei-field { display: flex; flex-direction: column; gap: 3px; margin-bottom: 6px; }
    #entity-inspector .ei-field span { color: #aaa; text-transform: uppercase; letter-spacing: 1px; }
    #entity-inspector select {
      background: #1f1f1f; color: #eee; border: 1px solid #2e2e2e;
      border-radius: 3px; padding: 4px; font-family: inherit; font-size: 11px;
    }
    #entity-inspector .ei-hint { color: #888; font-size: 10px; line-height: 1.3; }
  `;
  const style = document.createElement("style");
  style.id = "entity-inspector-styles";
  style.textContent = css;
  document.head.appendChild(style);
}
