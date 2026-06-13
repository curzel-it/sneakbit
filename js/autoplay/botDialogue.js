// Overlay janitor for the autoplay bot. The sim FREEZES while any modal is
// open (main.js localPause), so the bot's own ticker drives this — a
// synthesized keydown dismisses the modal through its existing window keydown
// listener. Most modals (dialogue, message, game-over) advance/close on Space;
// the shop (popped by a clerk once the greeting dialogue closes) ignores Space
// and only backs out on Escape — pressing Space there could focus-click a buy
// button. So the janitor picks the right key per open modal. Paced so the
// stream can read each line rather than blinking through them.

import { isDialogueOpen } from "../dialogue.js";
import { isMessageOpen } from "../message.js";
import { isGameOverOpen } from "../gameOver.js";
import { isShopOpen } from "../shop.js";

// ms between synthesized advances — a readable cadence per §7 watchability.
export const ADVANCE_INTERVAL_MS = 1200;

let lastPressTs = 0;

// Modals advanced/closed by Space. The shop is handled separately (Escape).
function spaceModalOpen() {
  return isDialogueOpen() || isMessageOpen() || isGameOverOpen();
}

export function anyOverlayOpen() {
  return spaceModalOpen() || isShopOpen();
}

// Run on the bot ticker. If a modal is open and enough time has passed since
// the last advance, synthesize the key that dismisses it. Returns true while
// a modal is open (the sim is frozen — the orchestrator should yield to us).
export function tickJanitor(nowMs) {
  if (!anyOverlayOpen()) return false;
  if (nowMs - lastPressTs >= ADVANCE_INTERVAL_MS) {
    lastPressTs = nowMs;
    // A clerk's greeting dialogue closes first (Space), THEN the shop pops —
    // so advance any Space-modal before falling through to Escape the shop.
    if (spaceModalOpen()) press("Space", " ");
    else if (isShopOpen()) press("Escape", "Escape");
  }
  return true;
}

function press(code, key) {
  try {
    window.dispatchEvent(new KeyboardEvent("keydown", { code, key, bubbles: true }));
  } catch (e) {
    console.error("[autoplay] janitor keydown failed", e);
  }
}
