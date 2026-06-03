// First-sign-in save-conflict prompt. Shown only when a device that has never
// synced this account holds genuine local progress (see saveBlob's
// hasMeaningfulProgress) that differs from the account's cloud save — the one
// case cloudSave can't resolve automatically without risking data loss.
//
// DOM-only (per CLAUDE.md the UI never lives on the canvas). askCloudConflict()
// returns a Promise resolving to "local" (keep this device, push it up) or
// "cloud" (adopt the account, pull it down). It resolves to null when there's
// no DOM (tests / headless) so the caller can fall back to the safe default.

import { el } from "./dom.js";

let overlay = null;
let resolveCurrent = null;

// Returns Promise<"local" | "cloud" | null>. null = no UI available; caller
// should take its safe default (adopt the account).
export function askCloudConflict() {
  if (typeof document === "undefined" || !document.body) return Promise.resolve(null);
  // A second conflict while one is already open shouldn't stack modals; reuse
  // the in-flight promise by resolving the old one to null (safe default) and
  // showing fresh. In practice reconcile is single-flighted, so this is just
  // defensive.
  if (overlay) { close("cloud"); }
  return new Promise((resolve) => {
    resolveCurrent = resolve;
    overlay = buildOverlay();
    document.body.appendChild(overlay);
  });
}

function buildOverlay() {
  const card = el("div", {
    style: {
      maxWidth: "min(440px, 88vw)",
      padding: "20px 22px",
      background: "rgba(14, 14, 16, 0.98)",
      border: "1px solid #444",
      borderRadius: "8px",
      color: "#eee",
      fontFamily: "monospace",
      boxShadow: "0 12px 40px rgba(0,0,0,0.6)",
    },
  }, [
    el("h1", { text: "Save conflict", style: { fontSize: "18px", margin: "0 0 12px" } }),
    el("p", {
      text: "This device has unsynced progress, and your account already has a "
        + "different save. Which one do you want to keep?",
      style: { fontSize: "14px", lineHeight: "1.5", margin: "0 0 18px", color: "#cfcfcf" },
    }),
    el("div", { style: { display: "flex", gap: "10px", flexWrap: "wrap" } }, [
      button("Keep this device", "local", "#34466a"),
      button("Use account save", "cloud", "#3a3a3a"),
    ]),
  ]);
  return el("div", {
    id: "cloud-conflict-overlay",
    style: {
      position: "fixed",
      inset: "0",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      background: "rgba(0,0,0,0.6)",
      backdropFilter: "blur(2px)",
      zIndex: "30",
    },
  }, [card]);
}

function button(label, choice, bg) {
  return el("button", {
    text: label,
    style: {
      flex: "1 1 auto",
      minWidth: "150px",
      padding: "10px 14px",
      fontFamily: "monospace",
      fontSize: "14px",
      color: "#eee",
      background: bg,
      border: "1px solid #555",
      borderRadius: "6px",
      cursor: "pointer",
    },
    on: { click: () => close(choice) },
  });
}

function close(choice) {
  if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);
  overlay = null;
  const r = resolveCurrent;
  resolveCurrent = null;
  if (r) r(choice);
}
