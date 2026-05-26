// First-visit onboarding. iOS Safari doesn't honour the hardware silent
// switch for <audio>, so on touch devices we default to muted to avoid
// blasting from a quiet pocket, then nudge the player to the menu icon
// where they can re-enable sound.

import { isFirstLaunch, saveSettings } from "./settings.js";
import { showToast } from "./toast.js";

export function applyFirstLaunch() {
  if (!isFirstLaunch()) return;
  if (!matchMedia("(pointer: coarse)").matches) return;
  saveSettings({ muted: true });
  setTimeout(() => {
    showToast("Audio muted by default\nTap ☰ to adjust", "longHint");
  }, 500);
}
