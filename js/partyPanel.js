// Online-mode HUD: a small HTML overlay anchored to the top-right that
// shows the session state for whichever role this tab is running as.
// Per CLAUDE.md, UI is HTML — not in-canvas — so this is just a styled
// <div> we mutate as net events arrive.
//
// Offline tab:   "Host a session" / "Join with code …" form
// Host tab:      the 5-char invite code + a peer count
// Guest tab:     "Connecting…" → host name + slot once joined

import { getMode, getJoinCode } from "./onlineMode.js";
import {
  getNet,
  getInviteCode,
  getKnownPeers,
  getNetRole,
} from "./onlineBootstrap.js";
import { showToast } from "./toast.js";

let root = null;
let body = null;

const PANEL_STYLE = {
  position: "fixed",
  top: "12px",
  right: "12px",
  padding: "10px 14px",
  background: "rgba(10, 10, 10, 0.92)",
  border: "1px solid #444",
  borderRadius: "6px",
  color: "#eee",
  fontFamily: "monospace",
  fontSize: "12px",
  lineHeight: "1.5",
  zIndex: "13",
  minWidth: "200px",
  maxWidth: "260px",
  boxShadow: "0 4px 16px rgba(0,0,0,0.6)",
  pointerEvents: "auto",
};

export function installPartyPanel() {
  if (typeof document === "undefined") return null;
  if (root) return root;
  root = document.createElement("div");
  root.id = "party-panel";
  Object.assign(root.style, PANEL_STYLE);
  body = document.createElement("div");
  root.appendChild(body);
  document.body.appendChild(root);

  const mode = getMode();
  if (mode === "offline") renderOfflineLobby();
  else if (mode === "host") renderHostWaiting();
  else if (mode === "guest") renderGuestConnecting();

  if (mode !== "offline") wireNetUpdates();
  return root;
}

function renderOfflineLobby() {
  body.innerHTML = "";
  const title = headerLine("SneakBit Online");
  const hostBtn = makeButton("Host a session", () => {
    const url = new URL(location.href);
    url.searchParams.set("host", "1");
    url.searchParams.delete("join");
    location.href = url.toString();
  });
  const joinRow = document.createElement("div");
  joinRow.style.marginTop = "8px";
  joinRow.style.display = "flex";
  joinRow.style.gap = "6px";
  const input = document.createElement("input");
  input.maxLength = 5;
  input.placeholder = "code";
  input.style.textTransform = "uppercase";
  input.style.width = "70px";
  input.style.background = "#111";
  input.style.color = "#eee";
  input.style.border = "1px solid #555";
  input.style.padding = "3px 6px";
  input.style.fontFamily = "monospace";
  const joinBtn = makeButton("Join", () => {
    const code = (input.value || "").trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(code)) {
      showToast("Code is 5 letters/digits.", "hint");
      return;
    }
    const url = new URL(location.href);
    url.searchParams.set("join", code);
    url.searchParams.delete("host");
    location.href = url.toString();
  });
  joinRow.appendChild(input);
  joinRow.appendChild(joinBtn);
  body.appendChild(title);
  body.appendChild(hostBtn);
  body.appendChild(joinRow);
}

function renderHostWaiting() {
  body.innerHTML = "";
  body.appendChild(headerLine("Hosting"));
  const codeDiv = document.createElement("div");
  codeDiv.id = "party-code";
  codeDiv.style.marginTop = "4px";
  codeDiv.innerHTML = `Code: <span style="font-size:18px;letter-spacing:3px">…</span>`;
  body.appendChild(codeDiv);
  const peers = document.createElement("div");
  peers.id = "party-peers";
  peers.style.marginTop = "6px";
  peers.style.fontSize = "11px";
  peers.style.opacity = "0.8";
  peers.textContent = "Waiting for friends…";
  body.appendChild(peers);
}

function renderGuestConnecting() {
  body.innerHTML = "";
  body.appendChild(headerLine("Joining…"));
  const sub = document.createElement("div");
  sub.style.fontSize = "11px";
  sub.style.opacity = "0.8";
  sub.textContent = `Code: ${getJoinCode() || ""}`;
  body.appendChild(sub);
}

function renderHostCodeUpdate() {
  const code = getInviteCode() || "…";
  const codeEl = document.getElementById("party-code");
  if (codeEl) {
    codeEl.innerHTML = `Code: <span style="font-size:18px;letter-spacing:3px">${code}</span>`;
  }
}

function renderPeerList() {
  const el = document.getElementById("party-peers");
  if (!el) return;
  const peers = getKnownPeers();
  if (!peers.length) {
    el.textContent = "Waiting for friends…";
    return;
  }
  el.innerHTML = peers.map((p) => `· ${escapeHtml(p.name)} (slot ${p.slot})`).join("<br>");
}

function wireNetUpdates() {
  const net = getNet();
  if (!net) return;
  net.on("host.opened", () => renderHostCodeUpdate());
  net.on("peer.joined", (m) => {
    renderPeerList();
    showToast(`${m.name} joined`, "hint");
  });
  net.on("peer.rejoined", (m) => {
    renderPeerList();
    showToast(`${m.name} reconnected`, "hint");
  });
  net.on("peer.left", (m) => {
    renderPeerList();
    showToast(`${shortPlayerId(m.playerId)} left (${m.reason})`, "hint");
  });
  net.on("peer.ghosted", (m) => {
    showToast(`${shortPlayerId(m.playerId)} lagging…`, "hint");
  });
  net.on("guest.joined", (m) => {
    body.innerHTML = "";
    body.appendChild(headerLine(`In session with ${m.hostName}`));
    const sub = document.createElement("div");
    sub.style.fontSize = "11px";
    sub.style.opacity = "0.8";
    sub.textContent = `Slot ${m.slot}`;
    body.appendChild(sub);
  });
  net.on("guest.joinFailed", (m) => {
    body.innerHTML = "";
    body.appendChild(headerLine("Couldn't join"));
    const sub = document.createElement("div");
    sub.style.fontSize = "11px";
    sub.style.opacity = "0.85";
    sub.textContent = friendlyReason(m.reason);
    body.appendChild(sub);
    showToast(friendlyReason(m.reason), "longHint");
  });
  net.on("host.ghosted", () => {
    showToast("Host lagging…", "longHint");
  });
  net.on("host.resumed", () => {
    showToast("Host back", "hint");
  });
  net.on("session.closed", (m) => {
    body.innerHTML = "";
    body.appendChild(headerLine("Session ended"));
    const sub = document.createElement("div");
    sub.style.fontSize = "11px";
    sub.style.opacity = "0.85";
    sub.textContent = friendlyReason(m.reason);
    body.appendChild(sub);
    showToast("Session ended — back to offline", "longHint");
    if (getNetRole() === "guest") {
      setTimeout(() => {
        const url = new URL(location.href);
        url.searchParams.delete("host");
        url.searchParams.delete("join");
        location.replace(url.toString());
      }, 1500);
    }
  });
}

function friendlyReason(reason) {
  switch (reason) {
    case "not_found": return "Code not found";
    case "full": return "Session is full";
    case "host_offline": return "Host isn't online";
    case "host_quit": return "Host left";
    case "host_timeout": return "Host disconnected";
    case "server_restart": return "Server restarted";
    default: return reason || "unknown error";
  }
}

function shortPlayerId(pid) { return pid ? pid.replace(/^p_/, "") : "Someone"; }

function headerLine(text) {
  const el = document.createElement("div");
  el.textContent = text;
  el.style.fontWeight = "bold";
  el.style.marginBottom = "4px";
  return el;
}

function makeButton(label, onClick) {
  const b = document.createElement("button");
  b.textContent = label;
  Object.assign(b.style, {
    background: "#222",
    color: "#eee",
    border: "1px solid #555",
    borderRadius: "4px",
    padding: "4px 10px",
    fontFamily: "monospace",
    fontSize: "12px",
    cursor: "pointer",
  });
  b.addEventListener("click", onClick);
  return b;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}
