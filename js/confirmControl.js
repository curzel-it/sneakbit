// Inline-confirm control: a danger button that, on first click, swaps
// itself for an "Are you sure? [Cancel] [Yes]" row instead of popping a
// native confirm(). Keeps confirmation inside a styled dialog so it reads
// as part of the surface, not a browser chrome interruption.
//
// `onConfirm` is read at click time, so callers can branch on live state
// (co-op vs pvp, etc.) rather than capturing a decision up front.
//
// Returns { root, reset }: `root` is the wrapper to mount; `reset()`
// disarms it back to the single danger button — call it before a
// re-render / reopen so the control never lands half-confirmed.
//
// Styling rides on the `party-*` classes (defined by the party panel's
// stylesheet) since that's its only caller today; lift those into a
// shared sheet if a second surface adopts it.
//
// opts.shouldFocus: () => boolean — when arming, move keyboard/controller
// focus onto the just-revealed confirm row only if this returns true, so
// a closed/hidden surface doesn't steal focus. Defaults to always.

import { el } from "./dom.js";
import { focusFirstIn } from "./menuNav.js";

export function makeConfirmControl(label, onConfirm, { shouldFocus = () => true } = {}) {
  const danger = el("button", {
    class: "party-danger", text: label,
    on: { click: () => arm(true) },
  });
  const confirmRow = el("div", {
    class: "party-row party-confirm-row",
    style: { display: "none" },
  }, [
    el("span", { class: "party-confirm-q", text: "Are you sure?" }),
    el("button", { text: "Cancel", on: { click: () => arm(false) } }),
    el("button", { class: "party-danger", text: "Yes", on: { click: () => { arm(false); onConfirm(); } } }),
  ]);
  const root = el("div", { class: "party-confirm" }, [danger, confirmRow]);
  function arm(on) {
    danger.style.display = on ? "none" : "";
    confirmRow.style.display = on ? "flex" : "none";
    // Move the keyboard/controller highlight onto the just-revealed row so
    // the hidden danger button isn't left as the focused (invisible) item.
    if (on && shouldFocus()) focusFirstIn(confirmRow);
  }
  return { root, reset: () => arm(false) };
}
