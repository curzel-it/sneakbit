// Clipboard + Web Share helpers. Framework-free and DOM-guarded so the
// pure predicates (canNativeShare, buildShareUrl) import cleanly in the
// node tests without a browser.

import { el } from "./dom.js";
import { showToast } from "./toast.js";

// True only where navigator.share is both present AND likely a real
// share sheet (mobile). Desktop Chrome/Edge expose navigator.share since
// 2022 but pop a modal the user must dismiss to copy, so we treat them
// as "no native share" and just copy to the clipboard instead.
export function canNativeShare() {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  if (navigator.userAgentData && typeof navigator.userAgentData.mobile === "boolean") {
    return navigator.userAgentData.mobile;
  }
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
}

// Build a deep-link to the current page that joins a session by code:
// strips any ?host= and sets ?join=<code>. Returns the bare code when
// there's no location (non-browser).
export function buildShareUrl(code) {
  if (typeof location === "undefined") return code;
  const u = new URL(location.href);
  u.searchParams.delete("host");
  u.searchParams.set("join", code);
  return u.toString();
}

// Last-resort copy: drop the value into a hidden textarea, select it, and
// ask the browser to execCommand("copy"). Skips the clipboard API
// entirely so insecure-context browsers (older Safari, http localhost)
// can still copy. Toasts "Copied" on success or the raw value (so the
// user can copy it by hand) on failure.
export function promptCopy(value) {
  if (typeof document === "undefined") return;
  const ta = el("textarea", { value, style: { position: "fixed", opacity: "0" } });
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand("copy"); showToast("Copied", "hint"); }
  catch { showToast(value, "longHint"); }
  document.body.removeChild(ta);
}
