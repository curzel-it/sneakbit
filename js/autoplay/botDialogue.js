// Overlay janitor for the autoplay bot. The sim FREEZES while any modal is
// open (main.js localPause), so the bot's own ticker drives this — a
// synthesized Space keydown advances dialogues and dismisses the message /
// game-over modals through their existing window keydown listeners
// (dialogue.js, message.js, gameOver.js all accept Space). Paced so the
// stream can read each line rather than blinking through them.

import { isDialogueOpen } from "../dialogue.js";
import { isMessageOpen } from "../message.js";
import { isGameOverOpen } from "../gameOver.js";

// ms between synthesized advances — a readable cadence per §7 watchability.
export const ADVANCE_INTERVAL_MS = 1200;

let lastPressTs = 0;

export function anyOverlayOpen() {
  return isDialogueOpen() || isMessageOpen() || isGameOverOpen();
}

// Run on the bot ticker. If a modal is open and enough time has passed since
// the last advance, synthesize one Space keydown. Returns true while a modal
// is open (the sim is frozen — the orchestrator should yield to the janitor).
export function tickJanitor(nowMs) {
  if (!anyOverlayOpen()) return false;
  if (nowMs - lastPressTs >= ADVANCE_INTERVAL_MS) {
    lastPressTs = nowMs;
    pressSpace();
  }
  return true;
}

function pressSpace() {
  try {
    window.dispatchEvent(new KeyboardEvent("keydown", {
      code: "Space",
      key: " ",
      bubbles: true,
    }));
  } catch (e) {
    console.error("[autoplay] janitor keydown failed", e);
  }
}
