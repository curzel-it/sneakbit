// On-screen touch controls for mobile: 4-way directional pad on the
// bottom-left and action buttons on the bottom-right (talk + throw).
// Synthesises the same keydown/keyup events that input.js already listens
// for, so no extra wiring is needed downstream.
//
// Hidden by default; show when a touch (or pointer with pointerType ===
// "touch") is detected so we don't clutter desktop screens.

import { tryShoot, getShootCooldownProgress } from "./shooting.js";
import { tryMelee, getMeleeSwingProgress } from "./melee.js";
import { getEquipped, onEquipmentChange, SLOT_MELEE, SLOT_RANGED } from "./equipment.js";
import { getAmmo } from "./inventory.js";
import { getPvpAmmo, getPvpRangedWeapon, bulletOfWeapon } from "./pvpLoadout.js";
import { getNetRole } from "./onlineBootstrap.js";
import { codesFor } from "./keyBindings.js";
import { isTowerDefenseMode, isPvp } from "./gameMode.js";
import { onActiveInputDeviceChange } from "./activeInputDevice.js";
import { getSettings } from "./settings.js";
import { mountJoystick, unmountJoystick } from "./touchJoystick.js";
import { getSpecies } from "./species.js";
import { getSprite } from "./assets.js";
import { TILE_SIZE } from "./constants.js";
import { el } from "./dom.js";

// Weapon-icon supersample: paint the 16px inventory tile into an ×8 backing
// canvas and let CSS downscale it crisply (same trick as ammoHud.js).
const WICON_RES = TILE_SIZE * 8;

// Fallback bullet when the equipped ranged weapon doesn't resolve to one
// (default loadout / tests) — matches ammoHud.js / shooting.js.
const KUNAI_BULLET_SPECIES_ID = 7000;

const KEY_FOR_DIR = { up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight" };

// Touch button icons. Inline SVG so there's no extra HTTP request and
// no font dependency. `aria-hidden` keeps them out of the AT tree (the
// button itself takes the label via data-action). `focusable="false"`
// prevents IE/Edge legacy tabbing into the icon. Tile size is 22×22
// inside a 56×56 button — leaves a clear margin around the pad so the
// outer border reads even on small phones. Everything strokes from
// currentColor so the icon picks up the button's color rule.
function svg(content, size = 22) {
  return `<span class="touch-icon"><svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${content}</svg></span>`;
}

// Direction arrows — chevron-style so the angle reads as "direction
// you'll move" rather than a generic up/down play-button.
const ICON_DIR_UP    = svg(`<polyline points="6,15 12,9 18,15"></polyline>`);
const ICON_DIR_DOWN  = svg(`<polyline points="6,9 12,15 18,9"></polyline>`);
const ICON_DIR_LEFT  = svg(`<polyline points="15,6 9,12 15,18"></polyline>`);
const ICON_DIR_RIGHT = svg(`<polyline points="9,6 15,12 9,18"></polyline>`);

// Action icons. Kept iconographic, not photorealistic — fewer points
// = crisper at small sizes.
//   Interact: speech-bubble + dot, signals "talk / use".
//   Throw:    star-spark for kunai. Generic enough to still read if a
//             different ranged weapon ever takes the slot.
//   Melee:    a sword outline. Sized larger so the cross-guard reads.
// (The ☰ menu button now lives in the top HUD bar — see topHudRow.js.)
const ICON_INTERACT = svg(`<path d="M21 12a8 8 0 0 1-11.5 7.2L4 21l1.8-5.5A8 8 0 1 1 21 12z"></path><circle cx="12" cy="12" r="0.6" fill="currentColor"></circle>`, 24);
const ICON_THROW    = svg(`<path d="M12 3 L13.4 9.4 L20 11 L13.4 12.6 L12 19 L10.6 12.6 L4 11 L10.6 9.4 Z" fill="currentColor" stroke="none"></path>`, 24);
const ICON_MELEE    = svg(`<path d="M14 4 L20 4 L20 10 L9.5 20.5 L7 21 L3 17 L3.5 14.5 L14 4 Z"></path><line x1="9" y1="9" x2="15" y2="15"></line>`, 24);
//   Switch:  two looping arrows — "cycle to the next hero" (TD only).
//   Start:   a play triangle — "start the next wave now" (TD build).
//   Recruit: a person + plus — "buy another hero" (TD build).
const ICON_SWITCH   = svg(`<polyline points="17 3 21 7 17 11"></polyline><path d="M21 7H8a4 4 0 0 0-4 4"></path><polyline points="7 21 3 17 7 13"></polyline><path d="M3 17h13a4 4 0 0 0 4-4"></path>`, 24);
const ICON_START    = svg(`<path d="M8 5 L19 12 L8 19 Z" fill="currentColor" stroke="none"></path>`, 24);
const ICON_RECRUIT  = svg(`<circle cx="9" cy="8" r="3.2"></circle><path d="M3.5 20a5.5 5.5 0 0 1 11 0"></path><line x1="19" y1="8" x2="19" y2="14"></line><line x1="16" y1="11" x2="22" y2="11"></line>`, 24);

const heldBindings = new Map(); // dir -> pointerId

// pointerId -> direction button currently "pressed" by that finger. Used
// to implement drag-to-switch: as the finger moves over a different D-pad
// button, we release the old and press the new without requiring a lift.
const dirPointerHeld = new Map();

let root = null;
let visible = false;
// "buttons" = 4-way d-pad, "joystick" = floating analog stick. Read from
// settings at install; changeable live from the settings panel.
let controlStyle = "buttons";
// Desktop dev flag: `?touch=1` forces the overlay visible on a fine
// pointer so the joystick can be tuned with a mouse (and so the e2e /
// remote-verify harness can drive it). Off in normal play.
let forcedTouch = false;
// Localized label for the auto-managed interact button, or null when there's
// nothing in front to interact with (button hidden). Driven each frame by
// main.js forwarding interact.tickInteract()'s return value. In Tower Defense
// the cluster is owned by setTdActionMode, so we only remember the verb and
// reapply it once TD hands the buttons back.
let interactVerb = null;

// Cached refs for the two attack buttons' weapon-icon canvas + cooldown ring,
// keyed by action ("melee" | "throw"). `lastCd` memoises the last ring value
// written so updateTouchCombat only touches the DOM on a real change.
const combatEls = { melee: null, throw: null };
// True when a weapon icon couldn't paint yet (sprite sheet still loading) and
// updateTouchCombat should retry. Cleared once both icons resolve.
let weaponIconsPending = false;

export function installTouchControls() {
  if (root) return root;
  // SVG icons (not text glyphs): the previous "▲ ◀ ▶ ▼ ⚔ ✦ E ☰"
  // glyphs let iOS Safari pop the "magnifier loupe" on long-press
  // even with -webkit-user-select: none + -webkit-touch-callout: none
  // — those CSS rules suppress selection and the callout but not the
  // loupe over text. SVG paths aren't text, so the loupe never fires.
  // The SVGs themselves are wrapped in <span class="touch-icon"> with
  // pointer-events: none so taps still hit the parent <button> and
  // dispatch the keydown.
  root = el("div", {
    id: "touch-controls",
    html: `
    <div class="touch-pad" data-side="left">
      <button class="touch-btn" data-dir="up">${ICON_DIR_UP}</button>
      <button class="touch-btn" data-dir="left">${ICON_DIR_LEFT}</button>
      <button class="touch-btn" data-dir="right">${ICON_DIR_RIGHT}</button>
      <button class="touch-btn" data-dir="down">${ICON_DIR_DOWN}</button>
    </div>
    <div class="touch-pad" data-side="right">
      <button class="touch-btn touch-action touch-melee"    data-action="melee">${ICON_MELEE}<canvas class="touch-wicon"></canvas><span class="touch-cd"></span><span class="touch-label"></span></button>
      <button class="touch-btn touch-action touch-throw"    data-action="throw">${ICON_THROW}<canvas class="touch-wicon"></canvas><span class="touch-cd"></span><span class="touch-label"></span></button>
      <button class="touch-btn touch-action touch-interact" data-action="interact">${ICON_INTERACT}<span class="touch-verb"></span><span class="touch-label"></span></button>
    </div>
  `,
    style: {
      position: "fixed",
      inset: "0",
      pointerEvents: "none",
      zIndex: "12",
      display: "none",
      userSelect: "none",
      touchAction: "none",
    },
  });
  controlStyle = getSettings().touchControls === "joystick" ? "joystick" : "buttons";
  try { forcedTouch = new URLSearchParams(location.search).has("touch"); } catch { /* ignore */ }
  if (forcedTouch) root.classList.add("force-touch");
  document.body.appendChild(root);
  injectStyles();

  for (const btn of root.querySelectorAll(".touch-btn")) {
    btn.addEventListener("pointerdown", (e) => onPress(e, btn));
    btn.addEventListener("pointerup", (e) => onRelease(e, btn));
    btn.addEventListener("pointercancel", (e) => onRelease(e, btn));
    btn.addEventListener("pointerleave", (e) => {
      // Action buttons (no data-dir) auto-release on leave. Directional
      // buttons stay "held" until either pointerup or until the finger
      // moves over a *different* directional button — handled in the
      // document-level pointermove below.
      if (!btn.dataset.dir && btn.dataset.action) onRelease(e, btn);
    });
    // Prevent the browser's default context menu / long-press behaviour.
    btn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // Drag-to-switch on the D-pad: pointer events have implicit capture to
  // the original target, so we can't rely on pointerdown firing on a
  // *different* button when the finger slides. Instead we listen for
  // pointermove at the document level and use elementFromPoint to find
  // which button (if any) the finger is currently over.
  document.addEventListener("pointermove", onPointerMove, { passive: false });
  // We released implicit capture on pointerdown for D-pad buttons, so
  // pointerup fires on whichever element is under the finger at release
  // — that may be off the pad entirely. Catch it at the document level
  // to make sure direction keys go up exactly once.
  document.addEventListener("pointerup", onPointerUp);
  document.addEventListener("pointercancel", onPointerUp);

  // Auto-reveal once we see touch input.
  window.addEventListener("pointerdown", (e) => {
    if (visible) return;
    if (e.pointerType === "touch") show();
  }, { capture: true });

  if (forcedTouch || matchMedia("(pointer: coarse)").matches) show();

  // Fold into the active-device model: the on-screen pad belongs to touch,
  // so hide it the moment a key or controller is used and bring it back on
  // touch. Keeps a desktop player who taps once from being stuck with the
  // overlay, and vice-versa.
  onActiveInputDeviceChange((d) => {
    // While forced on for desktop testing, ignore device changes so a
    // stray mouse/keyboard event doesn't yank the overlay away.
    if (forcedTouch) return;
    if (d === "touch") show(); else hide();
  });

  cacheCombatEls();
  syncMeleeVisibility();
  onEquipmentChange((slot) => {
    if (slot === SLOT_MELEE) syncMeleeVisibility();
    if (slot === SLOT_MELEE || slot === SLOT_RANGED) refreshWeaponIcons();
  });

  applyControlStyle();
  applyInteractPrompt(); // start hidden until something's in range
  refreshWeaponIcons();  // paint the equipped weapon onto each attack button
  return root;
}

// Auto-managed interact button. `verb` is the localized label to show ("Talk"),
// or null to hide the button. Cheap to call every frame — bails when nothing
// changed. While Tower Defense owns the cluster we just remember the verb;
// applyTdActionMode reapplies it when TD hands the buttons back.
export function setInteractPrompt(verb) {
  const next = verb || null;
  if (next === interactVerb) return;
  interactVerb = next;
  if (!tdActionMode) applyInteractPrompt();
}

function applyInteractPrompt() {
  if (!root) return;
  const btn = root.querySelector(".touch-interact");
  if (!btn) return;
  if (interactVerb) {
    const verbEl = btn.querySelector(".touch-verb");
    if (verbEl) verbEl.textContent = interactVerb;
    btn.classList.add("show-verb");
    btn.style.display = "";
  } else {
    btn.style.display = "none";
  }
}

// Show the d-pad or the floating joystick for movement, depending on the
// current style. The action buttons + menu are shared and untouched.
function applyControlStyle() {
  if (!root) return;
  const leftPad = root.querySelector('.touch-pad[data-side="left"]');
  if (controlStyle === "joystick") {
    if (leftPad) leftPad.style.display = "none";
    mountJoystick(root);
  } else {
    unmountJoystick();
    if (leftPad) leftPad.style.display = "";
  }
}

// Switch movement input live from the settings panel.
export function setTouchControlStyle(style) {
  controlStyle = style === "joystick" ? "joystick" : "buttons";
  applyControlStyle();
}

function syncMeleeVisibility() {
  if (!root) return;
  const btn = root.querySelector(".touch-melee");
  if (!btn) return;
  // In Tower Defense the active hero may carry no melee weapon yet still needs
  // the wave-phase swing button, so show it regardless of what's equipped.
  // (tdActionMode hides it during build, where there's nothing to swing at.)
  btn.style.display = (isTowerDefenseMode() || getEquipped(SLOT_MELEE)) ? "" : "none";
}

// The bullet the local hero's equipped ranged weapon fires (mirrors
// ammoHud.js::rangedBulletFor) — falls back to the kunai when none resolves.
function localRangedBullet() {
  const sp = getSpecies(getEquipped(SLOT_RANGED, 0));
  return sp?.bullet_species_id || KUNAI_BULLET_SPECIES_ID;
}

// True when the local hero can actually fire: TD heroes have unlimited kunai;
// PvP draws from the per-player scavenge pool; story/co-op from the persisted
// inventory. Mirrors shooting.js::shoot's ammo gate so the button matches what
// a tap would do.
function hasRangedAmmo() {
  if (isTowerDefenseMode()) return true;
  if (isPvp()) return getPvpAmmo(0, bulletOfWeapon(getPvpRangedWeapon(0))) > 0;
  return getAmmo(localRangedBullet(), 0) > 0;
}

// Hide the throw button when the ranged weapon is out of ammo so a thumb never
// taps a dead control. TD owns the button's display by phase, so leave it alone
// there (tdActionMode gates the per-frame caller). Memoised on lastThrowHidden
// so the per-frame poll only writes the DOM on a real change.
let lastThrowHidden = null;
function syncThrowVisibility() {
  if (!root) return;
  const btn = root.querySelector(".touch-throw");
  if (!btn) return;
  const hidden = !hasRangedAmmo();
  if (hidden === lastThrowHidden) return;
  lastThrowHidden = hidden;
  btn.style.display = hidden ? "none" : "";
}

// Re-evaluate which action buttons show — towerDefense calls this when a run
// starts so the melee/remove button appears even if the squad carries no
// melee weapon (and the mode flips after the overlay was first built).
export function refreshTouchActions() {
  if (tdActionMode) applyTdActionMode(); else syncMeleeVisibility();
}

// — Tower-Defense action cluster ——————————————————————————————————————————
// In TD the three right-side buttons change job by phase:
//   build → none (you build by walking the hero into stones to shove them)
//   wave  → attack cluster (shoot + melee), no labels
//   null  → back to the normal game cluster
// Driven each frame by tdHud.updateTdHud, cached so the DOM only churns on a
// real change.
let tdActionMode = null;
// Cluster-render inputs pushed from tdHud each frame. Tracked so a change while
// the mode stays the same (a falling countdown, a now-affordable recruit, a
// hero going down) still re-renders. Handlers (onStart/onRecruit) are stable
// refs straight from the run's install-time wiring.
let tdCanSwitch = false;
let tdEarlyBonus = 0;
let tdRecruit = null;   // { cost, can, full } or null
let tdHandlers = {};    // { onStart, onRecruit }
let tdSig = "";

export function setTdActionMode(mode, opts = {}) {
  const next = mode || null;
  tdHandlers = opts; // onStart / onRecruit live here, stable across frames
  const canSwitch = !!opts.canSwitch;
  const recruit = opts.recruit || null;
  const sig = [
    next, canSwitch ? 1 : 0, opts.earlyBonus | 0,
    recruit ? `${recruit.cost}|${recruit.can ? 1 : 0}|${recruit.full ? 1 : 0}` : "",
  ].join(":");
  if (sig === tdSig) return;
  tdSig = sig;
  tdActionMode = next;
  tdCanSwitch = canSwitch;
  tdEarlyBonus = opts.earlyBonus | 0;
  tdRecruit = recruit;
  applyTdActionMode();
}

function applyTdActionMode() {
  if (!root) return;
  const interact = root.querySelector(".touch-interact");
  const melee = root.querySelector(".touch-melee");
  const throwBtn = root.querySelector(".touch-throw");
  if (!interact || !melee || !throwBtn) return;

  if (tdActionMode === "build") {
    // Movement (d-pad / joystick) shoves the stones; the right cluster carries
    // the build actions — Start wave (▶), Recruit, Switch — so the dock can
    // shrink to a slim countdown strip. Start sits in the bottom (melee) slot,
    // the most thumb-reachable spot.
    setActionButton(melee, ICON_START, tdEarlyBonus > 0 ? `+${tdEarlyBonus}g` : "", "");
    if (tdRecruit && !tdRecruit.full) {
      setActionButton(throwBtn, ICON_RECRUIT, `${tdRecruit.cost}g`, "");
      throwBtn.classList.toggle("touch-dim", !tdRecruit.can);
    } else {
      setActionButton(throwBtn, ICON_RECRUIT, "", "none");
    }
    if (tdCanSwitch) setActionButton(interact, ICON_SWITCH, "", "");
    else setActionButton(interact, ICON_INTERACT, "", "none");
  } else if (tdActionMode === "wave") {
    setActionButton(throwBtn, ICON_THROW, "", "");
    setActionButton(melee, ICON_MELEE, "", "");
    // The interact slot becomes "switch hero" mid-wave (there's nothing to talk
    // to). Hidden when the squad has only one hero standing.
    if (tdCanSwitch) setActionButton(interact, ICON_SWITCH, "", "");
    else setActionButton(interact, ICON_INTERACT, "", "none");
  } else {
    // Not TD — restore the normal game cluster. The interact button is then
    // auto-managed by setInteractPrompt (shown only when something's in range),
    // so reapply its current verb/hidden state rather than forcing the icon.
    setActionButton(interact, ICON_INTERACT, "", "none");
    setActionButton(throwBtn, ICON_THROW, "", "");
    setActionButton(melee, ICON_MELEE, "", "");
    syncMeleeVisibility();
    applyInteractPrompt();
  }
  // Hide the weapon canvases in any TD mode; repaint them when the normal
  // cluster returns. refreshWeaponIcons() gates on tdActionMode internally.
  refreshWeaponIcons();
  // We just forced the throw button's display by phase, so drop the memo —
  // syncThrowVisibility re-asserts ammo gating on the next normal-cluster tick.
  lastThrowHidden = null;
}

function setActionButton(btn, iconHtml, label, display) {
  const icon = btn.querySelector(".touch-icon");
  if (icon) icon.outerHTML = iconHtml; // constants include the .touch-icon wrapper
  const lbl = btn.querySelector(".touch-label");
  if (lbl) lbl.textContent = label;
  // An explicit icon takes the button face — drop the auto verb-text mode
  // (only the interact button ever carries it) so the icon isn't CSS-hidden,
  // and clear any leftover "dimmed" (can't-afford) state from a prior phase.
  btn.classList.remove("show-verb", "touch-dim");
  btn.style.display = display;
}

// — Equipped-weapon icons + cooldown rings ————————————————————————————————
// The throw/melee buttons paint the actual equipped weapon's inventory icon
// (so a thumb knows what it's holding at a glance, sword included) and overlay
// a sweep that drains over the weapon's cooldown. Both are gated off in Tower
// Defense, where the cluster is build controls rather than attacks.

function cacheCombatEls() {
  if (!root) return;
  for (const action of ["melee", "throw"]) {
    const btn = root.querySelector(`.touch-${action}`);
    if (!btn) continue;
    combatEls[action] = {
      btn,
      svg: btn.querySelector(".touch-icon"),
      wicon: btn.querySelector(".touch-wicon"),
      cd: btn.querySelector(".touch-cd"),
      lastCd: 0,
    };
  }
}

// Repaint both attack buttons from the currently equipped weapons. In TD the
// cluster carries build glyphs, so hide the weapon canvases and fall back to
// whatever icon setActionButton put there.
function refreshWeaponIcons() {
  if (!root) return;
  if (tdActionMode) { hideWeaponIcon("melee"); hideWeaponIcon("throw"); return; }
  weaponIconsPending = false;
  applyWeaponIcon("melee", getEquipped(SLOT_MELEE, 0));
  applyWeaponIcon("throw", getEquipped(SLOT_RANGED, 0));
}

function applyWeaponIcon(action, weaponId) {
  const e = combatEls[action];
  if (!e) return;
  // setActionButton swaps .touch-icon's outerHTML for the TD glyphs, so re-grab
  // the live SVG node before toggling it.
  e.svg = e.btn.querySelector(".touch-icon");
  const sp = weaponId != null ? getSpecies(weaponId) : null;
  const painted = sp ? paintWeaponIcon(e.wicon, sp) : false;
  if (painted) {
    // Explicit value — the base rule is display:none, so "" wouldn't reveal it.
    e.wicon.style.display = "block";
    if (e.svg) e.svg.style.display = "none";
  } else {
    e.wicon.style.display = "none";
    if (e.svg) e.svg.style.display = "";
    // We expected an icon but it isn't ready yet — installTouchControls runs
    // before main.js awaits loadAssets()/loadSpecies(), so the first paint sees
    // an unloaded species (sp === null) or sprite sheet. Retry next frame. Skip
    // weapons that resolve to no inventory icon at all, so we don't spin forever
    // on a species that legitimately has no offset.
    if (weaponId != null && (!sp || sp.inventory_texture_offset)) weaponIconsPending = true;
  }
}

function hideWeaponIcon(action) {
  const e = combatEls[action];
  if (!e) return;
  if (e.wicon) e.wicon.style.display = "none";
  const svg = e.btn.querySelector(".touch-icon");
  if (svg) svg.style.display = "";
}

// Blit a weapon species' inventory icon into the button canvas. Returns false
// (leaving the SVG fallback up) when the offset or sprite sheet isn't ready.
// inventory_texture_offset is [row, col] — same convention as ammoHud.js.
function paintWeaponIcon(canvas, sp) {
  const off = sp?.inventory_texture_offset;
  if (!off || !canvas) return false;
  let sheet;
  try { sheet = getSprite("inventory"); } catch { return false; }
  if (!sheet || !sheet.complete) return false;
  if (canvas.width !== WICON_RES) { canvas.width = WICON_RES; canvas.height = WICON_RES; }
  const [row, col] = off;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, WICON_RES, WICON_RES);
  ctx.drawImage(sheet, col * TILE_SIZE, row * TILE_SIZE, TILE_SIZE, TILE_SIZE, 0, 0, WICON_RES, WICON_RES);
  return true;
}

// Per-frame combat HUD tick, called from the main loop. Cheap: bails while the
// overlay is hidden or TD owns the cluster, and only writes the DOM on change.
export function updateTouchCombat() {
  if (!visible || tdActionMode) return;
  if (weaponIconsPending) refreshWeaponIcons();
  syncThrowVisibility();
  updateCooldownRing("melee", getMeleeSwingProgress(0));
  updateCooldownRing("throw", getShootCooldownProgress(0));
}

function updateCooldownRing(action, progress) {
  const e = combatEls[action];
  if (!e || !e.cd) return;
  if (progress == null) {
    if (e.lastCd !== 0) { e.cd.style.opacity = "0"; e.lastCd = 0; }
    return;
  }
  // Quantise so a 0.35s cooldown doesn't write a new value every single frame.
  const q = Math.round(progress * 50) / 50;
  if (q === e.lastCd) return;
  e.lastCd = q;
  e.cd.style.setProperty("--cd", String(q));
  e.cd.style.opacity = "1";
}

function show() {
  if (visible) return;
  visible = true;
  lastThrowHidden = null; // re-assert ammo gating on the next combat tick
  root.style.display = "block";
  document.body.classList.add("touch-mode");
  // The action set can depend on the live game mode (TD relabels the cluster
  // by phase) — re-evaluate each time the overlay appears, respecting any
  // active TD mode rather than just the melee-visibility default.
  refreshTouchActions();
  refreshWeaponIcons();
}

function hide() {
  if (!visible) return;
  visible = false;
  root.style.display = "none";
  document.body.classList.remove("touch-mode");
}

function onPress(e, btn) {
  e.preventDefault();
  btn.classList.add("active");
  const dir = btn.dataset.dir;
  const action = btn.dataset.action;
  if (dir) {
    // Release implicit pointer capture so pointermove on the document
    // fires for the *element under the finger* rather than always for
    // the button we started on.
    try { btn.releasePointerCapture?.(e.pointerId); } catch { /* ignore */ }
    heldBindings.set(dir, e.pointerId);
    dirPointerHeld.set(e.pointerId, btn);
    dispatchKey("keydown", KEY_FOR_DIR[dir]);
  } else if (action === "interact") {
    // In any TD phase the interact slot is the "switch hero" button — synthesise
    // a single Q press (towerDefense.onKey owns Tab/Q switching). Otherwise it's
    // the normal talk/use key.
    if (isTowerDefenseMode() && tdActionMode) dispatchKey("keydown", "KeyQ");
    else dispatchKey("keydown", "KeyE");
  } else if (action === "throw") {
    if (isTowerDefenseMode() && tdActionMode === "build") {
      // Build cluster: this slot is the Recruit button, not an attack.
      tdHandlers.onRecruit?.();
    } else if (isTowerDefenseMode() || getNetRole() === "guest") {
      // TD wave: shoot the active hero (route through onKey so possession is
      // respected). Guests can't drive the local sim — synthesise a keydown so
      // guestInputForwarder turns it into a `shoot` intent on the wire.
      dispatchKey("keydown", codesFor("shoot")[0] || "KeyF");
    } else {
      // Don't synthesise a key event — shooting.js owns its own cooldown
      // and we want a single shot per tap, not a held-key auto-repeat.
      tryShoot();
    }
  } else if (action === "melee") {
    if (isTowerDefenseMode() && tdActionMode === "build") {
      // Build cluster: this slot starts the next wave early, not a swing.
      tdHandlers.onStart?.();
    } else if (isTowerDefenseMode() || getNetRole() === "guest") {
      // TD wave: a swing for the active hero.
      dispatchKey("keydown", codesFor("melee")[0] || "KeyG");
    } else {
      tryMelee();
    }
  }
}

function onRelease(e, btn) {
  e.preventDefault();
  // Direction releases follow the pointer, not the original element — the
  // finger may have moved off `btn` onto a sibling D-pad button.
  if (e.pointerId != null && dirPointerHeld.has(e.pointerId)) {
    releaseDirForPointer(e.pointerId);
    return;
  }
  btn.classList.remove("active");
  const action = btn.dataset.action;
  if (action === "interact") {
    const code = (isTowerDefenseMode() && tdActionMode) ? "KeyQ" : "KeyE";
    dispatchKey("keyup", code);
  }
}

function onPointerUp(e) {
  if (dirPointerHeld.has(e.pointerId)) releaseDirForPointer(e.pointerId);
}

function onPointerMove(e) {
  const current = dirPointerHeld.get(e.pointerId);
  if (!current) return;
  // Decide direction by the dominant axis from the pad's centre rather
  // than requiring elementFromPoint to land on a button. The grid has
  // empty corner cells between adjacent directions, so a strict hit-test
  // releases the direction key while the finger crosses the corner —
  // feels like "I had to lift to switch." Quadrant logic keeps a
  // direction pressed continuously and switches at the diagonals.
  const next = directionButtonAt(e.clientX, e.clientY, current);
  if (next === current) return;
  releaseDirForPointer(e.pointerId);
  if (next) pressDir(next, e.pointerId);
  e.preventDefault();
}

// How far from the pad's centre we still treat the finger as "on the pad."
// The pad is a 3×3 grid of 52px cells (156px square); going much past the
// outer edge releases the held direction so dragging the finger entirely
// off the pad doesn't leave a stuck key.
const PAD_RELEASE_RADIUS_PX = 110;

function directionButtonAt(x, y, current) {
  if (!root) return null;
  const dirs = {};
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const b of root.querySelectorAll('.touch-btn[data-dir]')) {
    const r = b.getBoundingClientRect();
    dirs[b.dataset.dir] = b;
    sumX += r.left + r.width / 2;
    sumY += r.top + r.height / 2;
    count++;
  }
  if (!count) return null;
  const cx = sumX / count;
  const cy = sumY / count;
  const dx = x - cx;
  const dy = y - cy;
  if (Math.hypot(dx, dy) > PAD_RELEASE_RADIUS_PX) return null;
  // Dominant axis wins. On exact ties (|dx| === |dy| — diagonal drag or
  // sitting at centre) keep the current direction to avoid flapping
  // between perpendicular keys.
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax > ay) return (dx >= 0 ? dirs.right : dirs.left) || null;
  if (ay > ax) return (dy >= 0 ? dirs.down  : dirs.up)   || null;
  return current;
}

function pressDir(btn, pointerId) {
  const dir = btn.dataset.dir;
  if (!dir) return;
  btn.classList.add("active");
  heldBindings.set(dir, pointerId);
  dirPointerHeld.set(pointerId, btn);
  dispatchKey("keydown", KEY_FOR_DIR[dir]);
}

function releaseDirForPointer(pointerId) {
  const btn = dirPointerHeld.get(pointerId);
  if (!btn) return;
  dirPointerHeld.delete(pointerId);
  btn.classList.remove("active");
  const dir = btn.dataset.dir;
  if (heldBindings.get(dir) === pointerId) {
    heldBindings.delete(dir);
    dispatchKey("keyup", KEY_FOR_DIR[dir]);
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
      grid-template-columns: repeat(3, 52px);
      grid-template-rows: repeat(3, 52px);
      gap: 0px;
    }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="up"]    { grid-column: 2; grid-row: 1; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="left"]  { grid-column: 1; grid-row: 2; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="right"] { grid-column: 3; grid-row: 2; }
    #touch-controls .touch-pad[data-side="left"] .touch-btn[data-dir="down"]  { grid-column: 2; grid-row: 3; }
    #touch-controls .touch-pad[data-side="right"] {
      right: 4vw;
      bottom: 14vh;
      display: flex;
      flex-direction: column-reverse;
      gap: 14px;
      align-items: center;
    }
    #touch-controls .touch-btn {
      pointer-events: auto;
      width: 56px;
      height: 56px;
      border-radius: var(--sb-surface-radius);
      background: var(--sb-surface-bg);
      color: var(--sb-text);
      border: var(--sb-surface-border);
      cursor: pointer;
      transition: background 80ms ease;
      user-select: none;
      -webkit-user-select: none;
      -webkit-touch-callout: none;
      -webkit-tap-highlight-color: transparent;
      touch-action: none;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    /* Action buttons share the neutral HUD surface but pick up a
       colored border tint so players can still read the verb at a
       glance (red = attack, green = positive/contact). The icon does
       most of the heavy identification — the tint is the "accent" of
       the design system, not a primary fill. */
    #touch-controls .touch-action {
      width: 64px;
      height: 64px;
      border-color: var(--sb-accent-positive);
    }
    #touch-controls .touch-throw {
      border-color: var(--sb-accent-attack);
    }
    #touch-controls .touch-btn.active {
      background: var(--sb-surface-bg-active);
    }
    /* Can't-afford state for a TD build-action button (e.g. Recruit with too
       little gold). Still tappable — the handler answers with a toast. */
    #touch-controls .touch-btn.touch-dim { opacity: 0.45; }
    /* Icon wrapper. pointer-events: none so taps that land on the SVG
       still bubble to the button — without this the wrapper would
       eat the pointerdown and onPress wouldn't fire on direct hits. */
    #touch-controls .touch-icon {
      display: flex; align-items: center; justify-content: center;
      width: 100%; height: 100%;
      pointer-events: none;
    }
    /* Equipped-weapon icon, painted from the inventory sprite sheet. Sits over
       the button face (the SVG glyph is hidden when this paints). Hidden until
       refreshWeaponIcons() succeeds. */
    #touch-controls .touch-wicon {
      position: absolute; top: 50%; left: 50%;
      width: 38px; height: 38px;
      transform: translate(-50%, -50%);
      image-rendering: pixelated;
      pointer-events: none;
      display: none;
    }
    /* Cooldown sweep: a translucent wedge whose angle = remaining fraction
       (--cd, 0..1). Drains to nothing as the weapon comes off cooldown.
       updateTouchCombat() toggles opacity so a ready weapon shows no ring. */
    #touch-controls .touch-cd {
      position: absolute; inset: 0;
      border-radius: var(--sb-surface-radius);
      pointer-events: none;
      opacity: 0;
      transition: opacity 90ms ease;
      background: conic-gradient(rgba(0,0,0,0.55) calc(var(--cd, 0) * 360deg), transparent 0);
    }
    /* Verb label for the TD build cluster. Sits to the LEFT of the round
       button (toward screen centre) so it never collides with the stacked
       buttons above/below, and reads as a little pill. Empty = hidden. */
    #touch-controls .touch-action { position: relative; }
    #touch-controls .touch-label {
      position: absolute; right: 100%; top: 50%; transform: translate(-8px, -50%);
      pointer-events: none; white-space: nowrap;
      font-family: var(--sb-font, monospace); font-size: 12px; font-weight: bold;
      color: var(--sb-text); background: var(--sb-surface-bg);
      border: var(--sb-surface-border); border-radius: var(--sb-surface-radius); padding: 3px 7px;
      text-shadow: 0 1px 0 #000;
    }
    #touch-controls .touch-label:empty { display: none; }
    /* Auto-managed interact button shows a verb word ("Talk") in place of the
       icon — the button only appears when something's in range, so the word
       reads as the action without a hint banner. Centered on the button face;
       the .touch-icon is swapped out for it via the show-verb class. */
    #touch-controls .touch-verb {
      display: none;
      align-items: center; justify-content: center;
      width: 100%; height: 100%;
      pointer-events: none;
      font-family: var(--sb-font, monospace);
      font-size: 14px; font-weight: bold; color: var(--sb-text);
      text-shadow: 0 1px 0 #000;
    }
    #touch-controls .touch-interact.show-verb .touch-icon { display: none; }
    #touch-controls .touch-interact.show-verb .touch-verb { display: flex; }
    @media (min-width: 980px) and (pointer: fine) {
      #touch-controls { display: none !important; }
      /* The ?touch=1 flag keeps the overlay up on desktop for tuning
         the joystick with a mouse. Higher specificity (id+class) plus
         !important beats the hide rule above. */
      #touch-controls.force-touch { display: block !important; }
    }
  `;
  document.head.appendChild(style);
}
