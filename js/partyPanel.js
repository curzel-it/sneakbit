// Party / co-op UI: a small status chip pinned to the top-right while a
// session is live, plus a dedicated panel (reachable from the pause menu
// or by clicking the chip) with three role-aware views. The chip stays
// hidden offline; the panel works in every role.
//
// State sources:
//   onlineMode.getRuntimeRole / onRoleChange — which view to show
//   onlineBootstrap getters + onSessionState — code, peers, slot, etc.
//   creativeMode.isCreativeMode — disables "Start hosting" while editing
//
// Actions are all switchRole(...) calls or net.send({op: "host.kick"}).
// No location.replace anywhere — role transitions stay in-page.

import { getRuntimeRole, onRoleChange } from "./onlineMode.js?v=20260527b";
import {
  getInviteCode,
  getKnownPeers,
  getMySlot,
  getHostPlayerId,
  getLastJoinError,
  getNameForPlayerId,
  getNet,
  onSessionState,
} from "./onlineBootstrap.js?v=20260527b";
import { switchRole } from "./switchRole.js?v=20260527b";
import { showToast } from "./toast.js?v=20260527b";
import { isCreativeMode } from "./creativeMode.js?v=20260527b";

let chip = null;
let chipLabel = null;
let overlay = null;
let card = null;
let installed = false;
// Latch so the auto-close-on-join behavior only fires once per session.
// Without it a stray render after closing could re-close the panel if the
// user re-opens it before leaving the session.
let guestAutoClosedForSlot = null;

// View subtrees — built once, toggled by display.
let views = { offline: null, hosting: null, guest: null };
// Hosting view widgets we mutate on session-state updates.
let hostingCodeEl = null;
let hostingPeerList = null;
let hostingCopyBtn = null;
let hostingShareBtn = null;
let hostingEndBtn = null;
// playerId → { row, nameEl, slotEl } so we can patch peer rows in place
// instead of tearing out the entire <ul> on every session-state update.
// Preserves the hover/active state of the Kick button when a different
// peer joins or leaves mid-click. Cleared when the view rebuilds.
const peerRowsByPlayerId = new Map();
let peerEmptyRow = null;
// Guest view widgets we mutate on session-state updates.
let guestTitleEl = null;
let guestSlotEl = null;
let guestLeaveBtn = null;
// Offline view widgets — the start button gates on creative mode.
let offlineStartBtn = null;
let offlineJoinInput = null;
let offlineJoinBtn = null;
let offlineErrorEl = null;

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
  window.addEventListener("keydown", (e) => {
    if (e.code !== "Escape") return;
    if (!isPartyPanelOpen()) return;
    e.preventDefault();
    // installPartyPanel registers before installMenu, so this listener
    // fires first. Without stopImmediatePropagation the menu's keydown
    // listener still runs after, sees the panel already closed, and pops
    // the pause overlay on top — defeating the dismissal.
    e.stopImmediatePropagation();
    closePartyPanel();
  });
  renderAll();
}

export function openPartyPanel() {
  if (!installed) installPartyPanel();
  if (!overlay) return;
  overlay.style.display = "flex";
  renderAll();
  // Focus the most-likely-clicked control for keyboard users.
  const role = getRuntimeRole();
  if (role === "offline") offlineJoinInput?.focus();
}

export function closePartyPanel() {
  if (overlay) overlay.style.display = "none";
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
  views.offline = buildOfflineView();
  views.hosting = buildHostingView();
  views.guest = buildGuestView();
  card.appendChild(views.offline);
  card.appendChild(views.hosting);
  card.appendChild(views.guest);
  card.appendChild(buildCloseRow());
  // Click outside the card dismisses the overlay (offline play is one
  // tap from re-opening anyway).
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closePartyPanel();
  });
}

function buildCloseRow() {
  const row = document.createElement("div");
  row.className = "party-row party-controls";
  const btn = document.createElement("button");
  btn.textContent = "Close";
  btn.addEventListener("click", closePartyPanel);
  row.appendChild(btn);
  return row;
}

function buildOfflineView() {
  const root = document.createElement("div");
  root.className = "party-view";
  root.dataset.view = "offline";
  const title = document.createElement("h1");
  title.textContent = "Play co-op";
  root.appendChild(title);

  offlineStartBtn = document.createElement("button");
  offlineStartBtn.id = "party-start-hosting";
  offlineStartBtn.textContent = "Start hosting";
  offlineStartBtn.addEventListener("click", onStartHostingClick);
  root.appendChild(offlineStartBtn);

  const joinLabel = document.createElement("p");
  joinLabel.className = "party-hint";
  joinLabel.textContent = "Or join with an invite code:";
  root.appendChild(joinLabel);

  const joinRow = document.createElement("div");
  joinRow.className = "party-row";
  offlineJoinInput = document.createElement("input");
  offlineJoinInput.maxLength = 5;
  offlineJoinInput.placeholder = "ABC12";
  offlineJoinInput.className = "party-code-input";
  offlineJoinInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onJoinClick(); }
  });
  offlineJoinBtn = document.createElement("button");
  offlineJoinBtn.textContent = "Join";
  offlineJoinBtn.addEventListener("click", onJoinClick);
  joinRow.appendChild(offlineJoinInput);
  joinRow.appendChild(offlineJoinBtn);
  root.appendChild(joinRow);

  offlineErrorEl = document.createElement("p");
  offlineErrorEl.className = "party-error";
  offlineErrorEl.style.display = "none";
  root.appendChild(offlineErrorEl);

  return root;
}

function buildHostingView() {
  const root = document.createElement("div");
  root.className = "party-view";
  root.dataset.view = "hosting";

  const title = document.createElement("h1");
  title.textContent = "Hosting";
  root.appendChild(title);

  const codeWrap = document.createElement("div");
  codeWrap.className = "party-code-wrap";
  const codeLabel = document.createElement("div");
  codeLabel.className = "party-code-label";
  codeLabel.textContent = "Invite code";
  hostingCodeEl = document.createElement("div");
  hostingCodeEl.className = "party-code";
  hostingCodeEl.textContent = "…";
  codeWrap.appendChild(codeLabel);
  codeWrap.appendChild(hostingCodeEl);
  root.appendChild(codeWrap);

  const codeBtns = document.createElement("div");
  codeBtns.className = "party-row";
  hostingCopyBtn = document.createElement("button");
  hostingCopyBtn.textContent = "Copy code";
  hostingCopyBtn.addEventListener("click", onCopyClick);
  hostingShareBtn = document.createElement("button");
  // Desktop has no native share sheet, so the button just copies the
  // join URL to the clipboard. Calling it "Share link" there suggests an
  // action the browser can't actually take — keep the label honest.
  hostingShareBtn.textContent = canNativeShare() ? "Share link" : "Copy link";
  hostingShareBtn.addEventListener("click", onShareClick);
  codeBtns.appendChild(hostingCopyBtn);
  codeBtns.appendChild(hostingShareBtn);
  root.appendChild(codeBtns);

  const peersTitle = document.createElement("p");
  peersTitle.className = "party-hint";
  peersTitle.textContent = "Friends in your session:";
  root.appendChild(peersTitle);

  hostingPeerList = document.createElement("ul");
  hostingPeerList.className = "party-peer-list";
  root.appendChild(hostingPeerList);

  hostingEndBtn = document.createElement("button");
  hostingEndBtn.textContent = "End co-op";
  hostingEndBtn.className = "party-danger";
  hostingEndBtn.addEventListener("click", onEndCoopClick);
  root.appendChild(hostingEndBtn);

  return root;
}

function buildGuestView() {
  const root = document.createElement("div");
  root.className = "party-view";
  root.dataset.view = "guest";

  guestTitleEl = document.createElement("h1");
  guestTitleEl.textContent = "Guest";
  root.appendChild(guestTitleEl);

  guestSlotEl = document.createElement("p");
  guestSlotEl.className = "party-hint";
  guestSlotEl.textContent = "";
  root.appendChild(guestSlotEl);

  guestLeaveBtn = document.createElement("button");
  guestLeaveBtn.textContent = "Leave co-op";
  guestLeaveBtn.className = "party-danger";
  guestLeaveBtn.addEventListener("click", onLeaveCoopClick);
  root.appendChild(guestLeaveBtn);

  return root;
}

function renderAll() {
  renderChip();
  // Always patch the panel so opening is instant — the per-view render
  // routines diff against last-rendered state and skip work when nothing
  // has changed (peer list patches in place, etc.).
  renderPanel();
  maybeAutoCloseAfterGuestJoin();
}

// Once a guest has been assigned a slot, the "In session with…" view has
// nothing actionable on it — the player just wants to start playing. Drop
// the overlay so they're not stuck on the dialog. Latched per-slot so we
// don't fight a user re-opening the panel after we closed it.
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
    chipLabel.textContent = `Hosting · ${peers.length + 1}/4`;
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
  const role = getRuntimeRole();
  for (const view of Object.values(views)) {
    if (view) view.style.display = "none";
  }
  if (role === "host") {
    views.hosting.style.display = "block";
    renderHostingView();
  } else if (role === "guest") {
    views.guest.style.display = "block";
    renderGuestView();
  } else {
    views.offline.style.display = "block";
    renderOfflineView();
  }
}

function renderOfflineView() {
  const creative = isCreativeMode();
  offlineStartBtn.disabled = creative;
  offlineStartBtn.title = creative ? "Leave creative mode first." : "";
  offlineStartBtn.classList.toggle("party-disabled", creative);
  const err = getLastJoinError();
  if (err) {
    offlineErrorEl.textContent = friendlyReason(err);
    offlineErrorEl.style.display = "block";
  } else {
    offlineErrorEl.textContent = "";
    offlineErrorEl.style.display = "none";
  }
}

function renderHostingView() {
  const code = getInviteCode();
  hostingCodeEl.textContent = code || "…";
  const hasCode = !!code;
  hostingCopyBtn.disabled = !hasCode;
  hostingShareBtn.disabled = !hasCode;
  patchPeerList(getKnownPeers());
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
    hostingPeerList.appendChild(built.row);
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
    if (!peerEmptyRow.isConnected) hostingPeerList.appendChild(peerEmptyRow);
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
  row.appendChild(nameEl);
  row.appendChild(slotEl);
  row.appendChild(kick);
  return { row, nameEl, slotEl };
}

function renderGuestView() {
  const hostPid = getHostPlayerId();
  const hostName = (hostPid && getNameForPlayerId(hostPid)) || "Host";
  guestTitleEl.textContent = `In session with ${hostName}`;
  const slot = getMySlot();
  guestSlotEl.textContent = slot != null ? `You are slot ${slot}.` : "Joining…";
}

// — Click handlers ——————————————————————————————————————————————————————

function onStartHostingClick() {
  if (isCreativeMode()) {
    showToast("Leave creative mode first.", "hint");
    return;
  }
  switchRole("host").catch((e) => console.error("[party] switchRole(host)", e));
}

function onJoinClick() {
  const raw = (offlineJoinInput?.value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{5}$/.test(raw)) {
    showToast("Code is 5 letters or digits.", "hint");
    return;
  }
  switchRole("guest", { code: raw }).catch((e) => console.error("[party] switchRole(guest)", e));
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
  if (typeof navigator !== "undefined" && navigator.share) {
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

function onEndCoopClick() {
  switchRole("offline")
    .then(() => showToast("Co-op ended", "hint"))
    .catch((e) => console.error("[party] switchRole(offline) from host", e));
}

function onLeaveCoopClick() {
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
      background: rgba(10, 10, 10, 0.7);
      border: 1px solid #333; border-radius: 6px;
      color: #eee; font-family: monospace; font-size: 12px;
      z-index: 13; cursor: pointer; user-select: none;
    }
    #party-chip:hover { background: rgba(30, 30, 30, 0.85); }
    .party-chip-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #5fd16a; box-shadow: 0 0 6px #5fd16a;
    }
    #party-overlay {
      position: fixed; inset: 0;
      display: none; align-items: center; justify-content: center;
      background: rgba(0,0,0,0.6);
      z-index: 21; color: #eee; font-family: monospace;
    }
    .party-card {
      background: #181818; border: 1px solid #333; border-radius: 8px;
      padding: 24px 28px; min-width: 320px; max-width: 420px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.5);
    }
    .party-card h1 { margin: 0 0 16px; font-size: 18px; letter-spacing: 1px; }
    .party-row { display: flex; align-items: center; gap: 8px; margin: 10px 0; flex-wrap: wrap; }
    .party-controls { justify-content: flex-end; margin-top: 18px; }
    .party-hint { color: #888; font-size: 11px; margin: 12px 0 6px; }
    .party-error { color: #e88; font-size: 12px; margin: 8px 0 0; }
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
  views = { offline: null, hosting: null, guest: null };
  hostingCodeEl = null;
  hostingPeerList = null;
  hostingCopyBtn = null;
  hostingShareBtn = null;
  hostingEndBtn = null;
  guestTitleEl = null;
  guestSlotEl = null;
  guestLeaveBtn = null;
  offlineStartBtn = null;
  offlineJoinInput = null;
  offlineJoinBtn = null;
  offlineErrorEl = null;
  peerRowsByPlayerId.clear();
  peerEmptyRow = null;
  guestAutoClosedForSlot = null;
}
