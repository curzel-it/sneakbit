// First-visit onboarding. We default to muted on every platform so the
// game never blasts audio out of the gate; the toast points the player at
// the menu icon (or M key on desktop) where they can re-enable sound.

import { isFirstLaunch, saveSettings } from "./settings.js";
import { showToast } from "./toast.js";

export function applyFirstLaunch() {
  if (!isFirstLaunch()) return;
  saveSettings({ muted: true });
  const isTouch = matchMedia("(pointer: coarse)").matches;
  const hint = isTouch
    ? "Audio muted by default\nTap ☰ to adjust"
    : "Audio muted by default\nPress M or open the menu (Esc) to adjust";
  setTimeout(() => showToast(hint, "longHint"), 500);
}
