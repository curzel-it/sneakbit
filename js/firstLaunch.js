// First-visit onboarding. We default to muted on every platform so the
// game never blasts audio out of the gate; the toast points the player at
// the menu (Esc, or the on-screen ☰ button on touch) where they can
// re-enable sound.

import { isFirstLaunch, saveSettings, getSettings } from "./settings.js";
import { showToast } from "./toast.js";
import { playJoystickHint } from "./touchJoystick.js";

export function applyFirstLaunch() {
  if (!isFirstLaunch()) return;
  saveSettings({ muted: true });
  const isTouch = matchMedia("(pointer: coarse)").matches;
  const hint = isTouch
    ? "Audio muted by default\nTap ☰ to adjust"
    : "Audio muted by default\nOpen the menu (Esc) to adjust";
  setTimeout(() => showToast(hint, "longHint"), 500);
  // On touch, the joystick is the default control. Advertise it once with a
  // self-fading demo so a first-time player knows it's there and draggable.
  if (isTouch && getSettings().touchControls === "joystick") {
    setTimeout(() => playJoystickHint(), 700);
  }
}
