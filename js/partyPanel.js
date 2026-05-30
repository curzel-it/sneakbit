// Multiplayer UI: a small status chip pinned to the top-left while a
// session is live, plus a single role-aware dialog (reachable from the
// pause menu's "Multiplayer" entry or by clicking the chip). The chip
// stays hidden offline; the dialog works in every role.
//
// Four states, picked by role + game mode in renderPanel():
//   single        — offline & single player: join field + four host
//                   buttons (online co-op / online pvp / offline co-op /
//                   offline pvp)
//   hostingOnline — runtime role "host": mode description, invite code +
//                   copy/link, peer list, and a start-match (online pvp,
//                   not yet started) / end-session control
//   hostingOffline— offline & local multi-player (co-op or pvp): mode
//                   description, a 2|3|4 player toggle, end-session
//   guest         — runtime role "guest": mode description + leave
//
// State sources:
//   onlineMode.getRuntimeRole / onRoleChange — which view to show
//   gameMode.isPvp / isRealtimePvp — co-op vs pvp flavor
//   coopMode.isCoopMode / localPlayerCount — local multi-player
//   onlineBootstrap getters + onSessionState — code, peers, slot, etc.
//
// Actions are switchRole(...) (offline ↔ host ↔ guest), setLocalPlayers,
// startPvpMatch/exitPvp (local pvp), startDeathmatch/exitDeathmatch
// (online pvp), and net.send({op: "host.kick"}). No location.replace
// anywhere — role transitions stay in-page.

import { getRuntimeRole, onRoleChange, isValidJoinCode } from "./onlineMode.js?v=20260530g";
import {
  getInviteCode,
  getKnownPeers,
  getMySlot,
  getHostPlayerId,
  getLastJoinError,
  getNameForPlayerId,
  getNet,
  onSessionState,
} from "./onlineBootstrap.js?v=20260530g";
import { switchRole } from "./switchRole.js?v=20260530g";
import { showToast } from "./toast.js?v=20260530g";
import { isCreativeMode } from "./creativeMode.js?v=20260530g";
import { isCoopMode, localPlayerCount } from "./coopMode.js?v=20260530g";
import { setLocalPlayers } from "./main.js?v=20260530g";
import { registerMenuSurface, focusFirstIn } from "./menuNav.js?v=20260530g";
import { startMatch as startDeathmatch, exit as exitDeathmatch } from "./onlineDeathmatch.js?v=20260530g";
import { startPvpMatch, exitPvp } from "./pvpController.js?v=20260530g";
import { isPvp, isRealtimePvp, isPvpHostSetup, setPvpHostSetup } from "./gameMode.js?v=20260530g";

let chip = null;
let chipLabel = null;
let overlay = null;
let card = null;
let installed = false;
// Latch so the auto-close-on-join behavior only fires once per session.
// Without it a stray render after closing could re-close the panel if the
// user re-opens it before leaving the session.
let guestAutoClosedForSlot = null;
// Which flavor the host picked on the way in ("coop" | "pvp"). Chosen by
// the single-player view's Online co-op / Online PvP buttons, read by the
// hosting-online view to pick its description and whether a "Start match"
// button is offered. Reset to null whenever we drop back to offline. A
// deep-link host (?host=1) never sets it — the view defaults to co-op.
let onlineHostMode = null;

// View subtrees — built once, toggled by display.
let views = { single: null, hostingOnline: null, hostingOffline: null, guest: null };

// Single-player view widgets.
let spJoinInput = null;
let spErrorEl = null;
let spOnlineHostBtns = null; // [coop, pvp] — disabled in creative mode

// Hosting-online widgets we mutate on session-state updates.
let hoDescEl = null;
let hoCodeEl = null;
let hoCopyBtn = null;
let hoShareBtn = null;
let hoPeerList = null;
let hoStartBtn = null;
let hoEndControl = null; // inline-confirm "End session"
// playerId → { row, nameEl, slotEl } so we can patch peer rows in place
// instead of tearing out the entire <ul> on every session-state update.
const peerRowsByPlayerId = new Map();
let peerEmptyRow = null;

// Hosting-offline widgets.
let offDescEl = null;
let offToggleBtns = null; // [2,3,4] segmented buttons
let offEndControl = null;

// Guest widgets.
let guestDescEl = null;
let guestLeaveControl = null;

let lastFocusedView = null;

export function installPartyPanel() {
  if (installed || typeof document === "undefined") return;
  installed = true;
  injectStyles();
  buildChip();
  buildOverlay();
  document.body.appendChild(chip);
  document.body.appendChild(overlay);
  onRoleChange(() => renderAll());
  onSessionState(() => renderAll());
  registerMenuSurface({ root: visiblePartyView, isOpen: isPartyPanelOpen, priority: 5 });
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (!isPartyPanelOpen()) return;
    e.preventDefault();
    // installPartyPanel registers before installMenu, so this listener
    // fires first. Without stopImmediatePropagation the menu's keydown
    // listener still runs after, sees the panel already closed, and pops
    // the pause overlay on top — defeating the dismissal.
    e.stopImmediatePropagation();
    dismissPartyPanel();
  });
  renderAll();
}

export function openPartyPanel() {
  if (!installed) installPartyPanel();
  if (!overlay) return;
  overlay.style.display = "flex";
  // renderAll highlights the first item of the visible view (keyboard +
  // controller navigation).
  renderAll();
}

export function closePartyPanel() {
  if (overlay) overlay.style.display = "none";
  lastFocusedView = null;
}

// User-initiated dismiss (Close button, Escape, backdrop click). While
// hosting an Online PvP setup the dialog is the lobby: dismissing it lifts the
// host-world freeze and, if a friend has already joined, starts the deathmatch
// (which teleports everyone into the arena). With no peer yet we just unfreeze
// so the host isn't stranded in a frozen world while waiting. Every other view
// (and all programmatic closes elsewhere) just close.
function dismissPartyPanel() {
  if (isPvpHostSetup()) {
    setPvpHostSetup(false);
    closePartyPanel();
    if (getKnownPeers().length >= 1) startDeathmatch();
    return;
  }
  closePartyPanel();
}

// The currently shown view subtree — the root menuNav navigates within.
function visiblePartyView() {
  return [views.single, views.hostingOnline, views.hostingOffline, views.guest]
    .find((v) => v && v.style.display !== "none") || null;
}

export function isPartyPanelOpen() {
  return !!overlay && overlay.style.display === "flex";
}

function buildChip() {
  chip = document.createElement("div");
  chip.id = "party-chip";
  chip.style.display = "none";
  chip.addEventListener("click", openPartyPanel);
  const dot = document.createElement("span");
  dot.className = "party-chip-dot";
  chipLabel = document.createElement("span");
  chip.appendChild(dot);
  chip.appendChild(chipLabel);
}

function buildOverlay() {
  overlay = document.createElement("div");
  overlay.id = "party-overlay";
  overlay.style.display = "none";
  card = document.createElement("div");
  card.className = "party-card";
  overlay.appendChild(card);
  views.single = buildSingleView();
  views.hostingOnline = buildHostingOnlineView();
  views.hostingOffline = buildHostingOfflineView();
  views.guest = buildGuestView();
  card.appendChild(views.single);
  card.appendChild(views.hostingOnline);
  card.appendChild(views.hostingOffline);
  card.appendChild(views.guest);
  card.appendChild(buildCloseRow());
  // Click outside the card dismisses the overlay (offline play is one
  // tap from re-opening anyway).
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) dismissPartyPanel();
  });
}

function buildCloseRow() {
  const row = document.createElement("div");
  row.className = "party-row party-controls";
  const btn = document.createElement("button");
  btn.textContent = "Close";
  btn.addEventListener("click", dismissPartyPanel);
  row.appendChild(btn);
  return row;
}

// — Inline confirm ————————————————————————————————————————————————————————
// A danger button that, on first click, swaps itself for an "Are you sure?
// [Cancel] [Yes]" row instead of popping a browser confirm(). Keeps the
// styled dialog self-contained. onConfirm is read at click time so the
// caller can branch on live state (co-op vs pvp, etc.).
function makeConfirmControl(label, onConfirm) {
  const root = document.createElement("div");
  root.className = "party-confirm";
  const danger = document.createElement("button");
  danger.className = "party-danger";
  danger.textContent = label;
  const confirmRow = document.createElement("div");
  confirmRow.className = "party-row party-confirm-row";
  confirmRow.style.display = "none";
  const q = document.createElement("span");
  q.className = "party-confirm-q";
  q.textContent = "Are you sure?";
  const cancel = document.createElement("button");
  cancel.textContent = "Cancel";
  const yes = document.createElement("button");
  yes.className = "party-danger";
  yes.textContent = "Yes";
  confirmRow.append(q, cancel, yes);
  root.append(danger, confirmRow);
  function arm(on) {
    danger.style.display = on ? "none" : "";
    confirmRow.style.display = on ? "flex" : "none";
    // Move the keyboard/controller highlight onto the just-revealed row so
    // the hidden danger button isn't left as the focused (invisible) item.
    if (on && isPartyPanelOpen()) focusFirstIn(confirmRow);
  }
  danger.addEventListener("click", () => arm(true));
  cancel.addEventListener("click", () => arm(false));
  yes.addEventListener("click", () => { arm(false); onConfirm(); });
  return { root, reset: () => arm(false) };
}

// — Single-player view ————————————————————————————————————————————————————
function buildSingleView() {
  const root = document.createElement("div");
  root.className = "party-view";
  root.dataset.view = "single";

  const title = document.createElement("h1");
  title.textContent = "Multiplayer";
  root.appendChild(title);

  const joinLabel = document.createElement("p");
  joinLabel.className = "party-hint";
  joinLabel.textContent = "Join an online game with an invite code from a friend:";
  root.appendChild(joinLabel);

  const joinRow = document.createElement("div");
  joinRow.className = "party-row";
  spJoinInput = document.createElement("input");
  spJoinInput.id = "party-join-code";
  spJoinInput.maxLength = 5;
  spJoinInput.placeholder = "ABC12";
  spJoinInput.className = "party-code-input";
  spJoinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onJoinClick(); }
  });
  const joinBtn = document.createElement("button");
  joinBtn.id = "party-join";
  joinBtn.textContent = "Join";
  joinBtn.addEventListener("click", onJoinClick);
  joinRow.append(spJoinInput, joinBtn);
  root.appendChild(joinRow);

  spErrorEl = document.createElement("p");
  spErrorEl.className = "party-error";
  spErrorEl.style.display = "none";
  root.appendChild(spErrorEl);

  const hostLabel = document.createElement("p");
  hostLabel.className = "party-hint";
  hostLabel.textContent = "…or host a match:";
  root.appendChild(hostLabel);

  const stack = document.createElement("div");
  stack.className = "party-stack";
  const onlineCoop = hostButton("party-online-coop", "Online co-op", () => onHostOnlineClick("coop"));
  const onlinePvp = hostButton("party-online-pvp", "Online PvP", () => onHostOnlineClick("pvp"));
  spOnlineHostBtns = [onlineCoop, onlinePvp];
  stack.appendChild(onlineCoop);
  stack.appendChild(onlinePvp);
  stack.appendChild(hostButton("party-offline-coop", "Offline co-op", onOfflineCoopClick));
  stack.appendChild(hostButton("party-offline-pvp", "Offline PvP", onOfflinePvpClick));
  root.appendChild(stack);

  return root;
}

function hostButton(id, label, handler) {
  const btn = document.createElement("button");
  btn.id = id;
  btn.textContent = label;
  btn.addEventListener("click", handler);
  return btn;
}

function renderSingleView() {
  const creative = isCreativeMode();
  for (const btn of spOnlineHostBtns) {
    btn.disabled = creative;
    btn.title = creative ? "Leave creative mode first." : "";
    btn.classList.toggle("party-disabled", creative);
  }
  const err = getLastJoinError();
  if (err) {
    spErrorEl.textContent = friendlyReason(err);
    spErrorEl.style.display = "block";
  } else {
    spErrorEl.textContent = "";
    spErrorEl.style.display = "none";
  }
}

// — Hosting-online view ————————————————————————————————————————————————————
function buildHostingOnlineView() {
  const root = document.createElement("div");
  root.className = "party-view";
  root.dataset.view = "hostingOnline";

  const title = document.createElement("h1");
  title.textContent = "Hosting online";
  root.appendChild(title);

  hoDescEl = document.createElement("p");
  hoDescEl.className = "party-hint";
  root.appendChild(hoDescEl);

  const codeWrap = document.createElement("div");
  codeWrap.className = "party-code-wrap";
  const codeLabel = document.createElement("div");
  codeLabel.className = "party-code-label";
  codeLabel.textContent = "Invite code";
  hoCodeEl = document.createElement("div");
  hoCodeEl.className = "party-code";
  hoCodeEl.textContent = "…";
  codeWrap.append(codeLabel, hoCodeEl);
  root.appendChild(codeWrap);

  const codeBtns = document.createElement("div");
  codeBtns.className = "party-row";
  hoCopyBtn = document.createElement("button");
  hoCopyBtn.textContent = "Copy code";
  hoCopyBtn.addEventListener("click", onCopyClick);
  hoShareBtn = document.createElement("button");
  // Desktop has no native share sheet, so the button just copies the
  // join URL to the clipboard. Calling it "Share link" there suggests an
  // action the browser can't actually take — keep the label honest.
  hoShareBtn.textContent = canNativeShare() ? "Share link" : "Copy link";
  hoShareBtn.addEventListener("click", onShareClick);
  codeBtns.append(hoCopyBtn, hoShareBtn);
  root.appendChild(codeBtns);

  const usage = document.createElement("p");
  usage.className = "party-hint";
  usage.textContent = "Friends open Multiplayer, paste this code, and Join. Up to 4 players total.";
  root.appendChild(usage);

  const peersTitle = document.createElement("p");
  peersTitle.className = "party-hint";
  peersTitle.textContent = "Friends in your session:";
  root.appendChild(peersTitle);

  hoPeerList = document.createElement("ul");
  hoPeerList.className = "party-peer-list";
  root.appendChild(hoPeerList);

  // Start (online pvp, before the match) / End session (otherwise) — exactly
  // one is shown, picked in renderHostingOnlineView.
  hoStartBtn = document.createElement("button");
  hoStartBtn.id = "party-start-match";
  hoStartBtn.textContent = "Start match";
  hoStartBtn.addEventListener("click", onStartMatchClick);
  root.appendChild(hoStartBtn);

  hoEndControl = makeConfirmControl("End session", endOnlineSession);
  root.appendChild(hoEndControl.root);

  return root;
}

function renderHostingOnlineView() {
  const mode = onlineHostMode || "coop";
  hoDescEl.textContent = mode === "pvp"
    ? "Online PvP — a realtime deathmatch. Share the code, then start the match once a friend has joined."
    : "Online co-op — friends drop into your world and play alongside you.";

  const code = getInviteCode();
  hoCodeEl.textContent = code || "…";
  const hasCode = !!code;
  hoCopyBtn.disabled = !hasCode;
  hoShareBtn.disabled = !hasCode;

  const peers = getKnownPeers();
  patchPeerList(peers);

  // "Start match" only exists for online pvp, and only before a match runs.
  // While a deathmatch is live (or for plain co-op) we show "End session".
  const showStart = mode === "pvp" && !isRealtimePvp();
  hoStartBtn.style.display = showStart ? "" : "none";
  hoEndControl.root.style.display = showStart ? "none" : "";
  if (showStart) hoEndControl.reset();

  if (showStart) {
    const canStart = peers.length >= 1;
    hoStartBtn.disabled = !canStart;
    hoStartBtn.classList.toggle("party-disabled", !canStart);
    hoStartBtn.title = canStart ? "" : "Wait for a friend to join first.";
  }
}

function onStartMatchClick() {
  if (getKnownPeers().length < 1) {
    showToast("Wait for a friend to join before starting PvP.", "hint");
    return;
  }
  setPvpHostSetup(false);
  closePartyPanel();
  startDeathmatch();
}

async function endOnlineSession() {
  // During a live deathmatch, tear the match down first (resets game mode to
  // co-op, clears the arena + overlays, tells guests) before leaving the
  // session entirely — otherwise the rebuilt offline state would still be in
  // pvp mode.
  if (isRealtimePvp()) {
    try { await exitDeathmatch(); } catch (e) { console.error("[party] exitDeathmatch", e); }
  }
  onlineHostMode = null;
  setPvpHostSetup(false);
  switchRole("offline")
    .then(() => showToast("Session ended", "hint"))
    .catch((e) => console.error("[party] switchRole(offline) from host", e));
}

// — Hosting-offline view ——————————————————————————————————————————————————
function buildHostingOfflineView() {
  const root = document.createElement("div");
  root.className = "party-view";
  root.dataset.view = "hostingOffline";

  const title = document.createElement("h1");
  title.textContent = "Local game";
  root.appendChild(title);

  offDescEl = document.createElement("p");
  offDescEl.className = "party-hint";
  root.appendChild(offDescEl);

  // Player-count toggle: 2 | 3 | 4 on this device.
  const toggle = document.createElement("div");
  toggle.className = "party-toggle";
  offToggleBtns = [2, 3, 4].map((n) => {
    const btn = document.createElement("button");
    btn.dataset.count = String(n);
    btn.textContent = String(n);
    btn.addEventListener("click", () => onCountToggle(n));
    toggle.appendChild(btn);
    return btn;
  });
  root.appendChild(toggle);

  const hint = document.createElement("p");
  hint.className = "party-hint";
  hint.textContent = "P2 uses IJKL + B/N/M. P3/P4 start with no keys — bind them in Settings → Key Bindings, or give each a controller (pads map by connection order).";
  root.appendChild(hint);

  offEndControl = makeConfirmControl("End session (back to single player)", endOfflineSession);
  root.appendChild(offEndControl.root);

  return root;
}

function renderHostingOfflineView() {
  const pvp = isPvp();
  offDescEl.textContent = pvp
    ? "Local PvP — last ninja standing in the arena. One controller per player recommended."
    : "Local co-op — up to 4 players share this device.";
  const count = localPlayerCount();
  for (const btn of offToggleBtns) {
    btn.classList.toggle("active", parseInt(btn.dataset.count, 10) === count);
  }
}

function onCountToggle(n) {
  if (isPvp()) {
    // Re-arm the arena with n players (reloads the map, scatters everyone).
    startPvpMatch(n);
  } else {
    setLocalPlayers(n);
  }
  renderAll();
}

function endOfflineSession() {
  if (isPvp()) exitPvp();
  else setLocalPlayers(1);
  renderAll();
}

// — Guest view ————————————————————————————————————————————————————————————
function buildGuestView() {
  const root = document.createElement("div");
  root.className = "party-view";
  root.dataset.view = "guest";

  const title = document.createElement("h1");
  title.textContent = "Connected";
  root.appendChild(title);

  guestDescEl = document.createElement("p");
  guestDescEl.className = "party-hint";
  root.appendChild(guestDescEl);

  guestLeaveControl = makeConfirmControl("Leave session", onLeaveCoopClick);
  root.appendChild(guestLeaveControl.root);

  return root;
}

function renderGuestView() {
  const hostPid = getHostPlayerId();
  const hostName = (hostPid && getNameForPlayerId(hostPid)) || "the host";
  const slot = getMySlot();
  const flavor = isPvp() ? "PvP deathmatch" : "co-op session";
  const where = slot != null
    ? `You're in ${hostName}'s ${flavor} (slot ${slot}).`
    : `Joining ${hostName}'s ${flavor}…`;
  guestDescEl.textContent = where;
}

// — Render orchestration ——————————————————————————————————————————————————
function renderAll() {
  renderChip();
  // Always patch the panel so opening is instant — the per-view render
  // routines diff against last-rendered state and skip work when nothing
  // has changed (peer list patches in place, etc.).
  renderPanel();
  maybeAutoCloseAfterGuestJoin();
  // Re-highlight the first item only when the visible view changes (not on
  // every patch), so navigating within a view isn't reset by a re-render.
  if (isPartyPanelOpen()) {
    const v = visiblePartyView();
    if (v && v !== lastFocusedView) { lastFocusedView = v; focusFirstIn(v); }
  } else {
    lastFocusedView = null;
  }
}

// Once a guest has been assigned a slot, the connected view has nothing
// actionable on it — the player just wants to start playing. Drop the
// overlay so they're not stuck on the dialog. Latched per-slot so we don't
// fight a user re-opening the panel after we closed it.
function maybeAutoCloseAfterGuestJoin() {
  const role = getRuntimeRole();
  if (role !== "guest") { guestAutoClosedForSlot = null; return; }
  const slot = getMySlot();
  if (slot == null) return;
  if (guestAutoClosedForSlot === slot) return;
  guestAutoClosedForSlot = slot;
  if (isPartyPanelOpen()) closePartyPanel();
}

function renderChip() {
  if (!chip) return;
  const role = getRuntimeRole();
  if (role === "host") {
    const peers = getKnownPeers();
    const flavor = isRealtimePvp() ? "PvP" : "Hosting";
    chipLabel.textContent = `${flavor} · ${peers.length + 1}/4`;
    chip.style.display = "flex";
  } else if (role === "guest") {
    const slot = getMySlot();
    chipLabel.textContent = slot != null ? `Guest · slot ${slot}` : "Guest · joining…";
    chip.style.display = "flex";
  } else {
    chip.style.display = "none";
  }
}

function renderPanel() {
  // Clear any armed inline-confirm so a re-render / reopen never lands on a
  // half-confirmed "Are you sure?".
  hoEndControl?.reset();
  offEndControl?.reset();
  guestLeaveControl?.reset();

  for (const view of Object.values(views)) {
    if (view) view.style.display = "none";
  }
  const role = getRuntimeRole();
  if (role === "host") {
    views.hostingOnline.style.display = "block";
    renderHostingOnlineView();
  } else if (role === "guest") {
    views.guest.style.display = "block";
    renderGuestView();
  } else if (isCoopMode() || isPvp()) {
    views.hostingOffline.style.display = "block";
    renderHostingOfflineView();
  } else {
    views.single.style.display = "block";
    renderSingleView();
  }
}

// Diff the rendered <ul> against the incoming peer list: keep existing
// rows in place (text-patch name/slot), append new rows for newcomers,
// remove rows whose playerId no longer appears. The empty-state row is
// added/removed independently. Preserves the Kick button's identity so
// an in-flight click on it doesn't get torn out by an unrelated
// peer.joined arriving mid-click.
function patchPeerList(peers) {
  const seen = new Set();
  for (const p of peers) {
    if (!p.playerId) continue;
    seen.add(p.playerId);
    const existing = peerRowsByPlayerId.get(p.playerId);
    if (existing) {
      const newName = p.name || p.playerId;
      if (existing.nameEl.textContent !== newName) existing.nameEl.textContent = newName;
      const newSlot = `slot ${p.slot}`;
      if (existing.slotEl.textContent !== newSlot) existing.slotEl.textContent = newSlot;
      continue;
    }
    const built = buildPeerRow(p);
    peerRowsByPlayerId.set(p.playerId, built);
    hoPeerList.appendChild(built.row);
  }
  for (const [pid, entry] of [...peerRowsByPlayerId]) {
    if (seen.has(pid)) continue;
    entry.row.remove();
    peerRowsByPlayerId.delete(pid);
  }
  if (peers.length === 0) {
    if (!peerEmptyRow) {
      peerEmptyRow = document.createElement("li");
      peerEmptyRow.className = "party-peer-empty";
      peerEmptyRow.textContent = "Waiting for friends…";
    }
    if (!peerEmptyRow.isConnected) hoPeerList.appendChild(peerEmptyRow);
  } else if (peerEmptyRow && peerEmptyRow.isConnected) {
    peerEmptyRow.remove();
  }
}

function buildPeerRow(peer) {
  const row = document.createElement("li");
  row.className = "party-peer";
  const nameEl = document.createElement("span");
  nameEl.className = "party-peer-name";
  nameEl.textContent = peer.name || peer.playerId || "Player";
  const slotEl = document.createElement("span");
  slotEl.className = "party-peer-slot";
  slotEl.textContent = `slot ${peer.slot}`;
  const kick = document.createElement("button");
  kick.textContent = "Kick";
  kick.className = "party-kick";
  // Capture playerId by value — the closure must not hold the whole peer
  // object since later patches mutate text under us; the kick target is
  // identified by playerId alone.
  const playerId = peer.playerId;
  kick.addEventListener("click", () => onKickClick({ playerId }));
  row.append(nameEl, slotEl, kick);
  return { row, nameEl, slotEl };
}

// — Click handlers ——————————————————————————————————————————————————————

function onJoinClick() {
  const raw = (spJoinInput?.value || "").trim().toUpperCase();
  if (!isValidJoinCode(raw)) {
    showToast("Code is 5 letters or digits.", "hint");
    return;
  }
  switchRole("guest", { code: raw }).catch((e) => console.error("[party] switchRole(guest)", e));
}

function onHostOnlineClick(mode) {
  if (isCreativeMode()) {
    showToast("Leave creative mode first.", "hint");
    return;
  }
  onlineHostMode = mode === "pvp" ? "pvp" : "coop";
  setPvpHostSetup(onlineHostMode === "pvp");
  switchRole("host").catch((e) => console.error("[party] switchRole(host)", e));
}

function onOfflineCoopClick() {
  // Enter local co-op at 2 players; the hosting-offline view's toggle bumps
  // to 3/4. Keep the panel open so the player can add more.
  setLocalPlayers(2);
  renderAll();
  showToast("Local co-op on — add players with the 2/3/4 toggle", "longHint");
}

function onOfflinePvpClick() {
  // Mirror onOfflineCoopClick: enter at 2 players and keep the panel open on
  // the hosting-offline view so PvP and co-op present the same 2/3/4 settings.
  // startPvpMatch sets the mode + player count synchronously before it awaits
  // the arena travel, so renderAll already sees the pvp view.
  startPvpMatch(2);
  renderAll();
  showToast("Local PvP on — change players with the 2/3/4 toggle", "longHint");
}

async function onCopyClick() {
  const code = getInviteCode();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    showToast("Code copied", "hint");
  } catch {
    // Fallback: write to a temporary textarea so even insecure-context
    // browsers (older Safari, http localhost) can copy.
    promptCopy(code);
  }
}

async function onShareClick() {
  const code = getInviteCode();
  if (!code) return;
  const url = buildShareUrl(code);
  // Only invoke navigator.share when canNativeShare() agrees — desktop
  // Chrome/Edge expose navigator.share since 2022 but pop a modal share
  // menu that the user has to dismiss to copy. The button is rendered
  // as "Copy link" on those platforms; clicking should just copy.
  if (canNativeShare()) {
    try { await navigator.share({ title: "Join my SneakBit session", url }); return; }
    catch { /* user dismissed; fall through to clipboard */ }
  }
  try {
    await navigator.clipboard.writeText(url);
    showToast("Link copied", "hint");
  } catch {
    promptCopy(url);
  }
}

function onLeaveCoopClick() {
  onlineHostMode = null;
  switchRole("offline").catch((e) => console.error("[party] switchRole(offline) from guest", e));
}

function onKickClick(peer) {
  const net = getNet();
  if (!net || !peer?.playerId) return;
  // Optimistic: relay will fan peer.left {reason: "kicked"} which the
  // bootstrap handler removes from knownPeers and re-renders us via
  // notifySessionState.
  net.send({ op: "host.kick", playerId: peer.playerId });
}

function canNativeShare() {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
    return navigator.userAgentData.mobile;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

function buildShareUrl(code) {
  if (typeof location === "undefined") return code;
  const u = new URL(location.href);
  u.searchParams.delete("host");
  u.searchParams.set("join", code);
  return u.toString();
}

// Last-resort copy: drop the value into a textarea, select it, and ask
// the browser to execCommand("copy"). Skips the clipboard API entirely.
function promptCopy(value) {
  if (typeof document === "undefined") return;
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); showToast("Copied", "hint"); }
  catch { showToast(value, "longHint"); }
  document.body.removeChild(ta);
}

function friendlyReason(reason) {
  switch (reason) {
    case "not_found": return "Code not found.";
    case "full": return "Session is full.";
    case "host_offline": return "Host isn't online right now.";
    case "host_quit": return "Host left.";
    case "host_timeout": return "Host disconnected.";
    case "server_restart": return "Server restarted.";
    case "invalid_code": return "Code is 5 letters or digits.";
    default: return "Couldn't connect.";
  }
}

function injectStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById("party-styles")) return;
  const style = document.createElement("style");
  style.id = "party-styles";
  style.textContent = `
    /* Positioned below the HP bar (top-left) instead of the top-right
       corner so it can't cover the ammo HUD. Styled to match the HP /
       ammo cards (same translucent background, border, radius, font) so
       the three pieces of the HUD read as one set. */
    #party-chip {
      position: fixed; top: 52px; left: 12px;
      display: none; align-items: center; gap: 8px;
      padding: 6px 10px;
      background: var(--sb-surface-bg);
      border: var(--sb-surface-border);
      border-radius: var(--sb-surface-radius);
      color: var(--sb-text);
      font-family: var(--sb-font);
      font-size: 12px;
      z-index: 13; cursor: pointer; user-select: none;
    }
    #party-chip:hover { background: var(--sb-surface-bg-active); }
    .party-chip-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #5fd16a; box-shadow: 0 0 6px #5fd16a;
    }
    #party-overlay {
      position: fixed; inset: 0;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.6);
      backdrop-filter: blur(2px);
      z-index: 21; color: #eee; font-family: monospace;
    }
    .party-card {
      background: var(--sb-card-bg);
      border: var(--sb-card-border);
      border-radius: var(--sb-card-radius);
      padding: 24px 28px; min-width: 320px; max-width: 420px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .party-card h1 { margin: 0 0 16px; font-size: 18px; letter-spacing: 1px; }
    .party-row { display: flex; align-items: center; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
    .party-controls { justify-content: flex-end; margin-top: 18px; }
    .party-hint { color: #888; font-size: 11px; margin: 12px 0 6px; }
    .party-error { color: #e88; font-size: 12px; margin: 8px 0 0; }
    .party-stack { display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
    .party-stack button { width: 100%; text-align: center; }
    .party-toggle { display: flex; gap: 6px; margin: 8px 0 4px; }
    .party-toggle button { flex: 1; text-align: center; }
    .party-toggle button.active { background: #2a3a55; border-color: #4a5a88; color: #fff; }
    .party-confirm { margin-top: 6px; }
    .party-confirm-row { margin: 6px 0 0; }
    .party-confirm-q { color: #e88; font-size: 12px; align-self: center; }
    .party-card button {
      background: #2a2a2a; color: #eee; border: 1px solid #444;
      padding: 8px 12px; border-radius: 4px; cursor: pointer;
      font-family: inherit; font-size: 12px;
    }
    .party-card button:hover:not(:disabled):not(.party-disabled) { background: #353535; }
    .party-card button:disabled, .party-card button.party-disabled {
      cursor: not-allowed; opacity: 0.5;
    }
    .party-card button.party-danger {
      background: #3a1f1f; border-color: #6b3434;
    }
    .party-card button.party-danger:hover { background: #4a2828; }
    .party-card input.party-code-input {
      flex: 1; min-width: 80px; background: #111; color: #eee;
      border: 1px solid #555; border-radius: 4px;
      padding: 6px 10px; font-family: monospace; font-size: 14px;
      text-transform: uppercase; letter-spacing: 2px;
    }
    .party-code-wrap { text-align: center; margin: 10px 0; }
    .party-code-label { color: #888; font-size: 11px; margin-bottom: 4px; }
    .party-code {
      font-size: 28px; letter-spacing: 6px; padding: 8px;
      background: #111; border: 1px dashed #555; border-radius: 4px;
    }
    .party-peer-list { list-style: none; padding: 0; margin: 4px 0 14px; }
    .party-peer {
      display: flex; align-items: center; gap: 8px;
      padding: 6px 10px; margin: 4px 0;
      background: #1f1f1f; border: 1px solid #2e2e2e; border-radius: 3px;
    }
    .party-peer-empty {
      padding: 8px 10px; color: #888; font-style: italic;
      background: transparent;
    }
    .party-peer-name { flex: 1; font-size: 12px; }
    .party-peer-slot { color: #aaa; font-size: 11px; min-width: 50px; }
    .party-kick {
      padding: 3px 10px !important; font-size: 11px !important;
      background: #3a1f1f !important; border-color: #6b3434 !important;
    }
    .party-kick:hover { background: #4a2828 !important; }
  `;
  document.head.appendChild(style);
}

// Test seam — reset the module-level singletons between unit tests.
export function _resetPartyPanelForTesting() {
  if (chip && chip.parentNode) chip.parentNode.removeChild(chip);
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  chip = null;
  chipLabel = null;
  overlay = null;
  card = null;
  installed = false;
  onlineHostMode = null;
  views = { single: null, hostingOnline: null, hostingOffline: null, guest: null };
  spJoinInput = null;
  spErrorEl = null;
  spOnlineHostBtns = null;
  hoDescEl = null;
  hoCodeEl = null;
  hoCopyBtn = null;
  hoShareBtn = null;
  hoPeerList = null;
  hoStartBtn = null;
  hoEndControl = null;
  offDescEl = null;
  offToggleBtns = null;
  offEndControl = null;
  guestDescEl = null;
  guestLeaveControl = null;
  peerRowsByPlayerId.clear();
  peerEmptyRow = null;
  guestAutoClosedForSlot = null;
  lastFocusedView = null;
}
