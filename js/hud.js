// HTML/DOM HUD overlay. Lives outside the canvas so we can style with CSS
// and add interactive widgets without re-implementing UI in pixel space.

let _fpsEMA = 0;

export function installHud() {
  const el = document.getElementById("hud");
  if (!el) throw new Error("missing #hud");
  el.innerHTML = `
    <div class="hud-row" id="hud-controls"></div>
    <div class="hud-row" id="hud-meta"></div>
  `;
  return { el, controls: el.querySelector("#hud-controls"), meta: el.querySelector("#hud-meta") };
}

export function updateHud(hud, { zoneId, fps, showFps = true, player = null }) {
  if (!hud) return;
  if (player && Number.isFinite(player.x) && Number.isFinite(player.y)) {
    hud.controls.textContent = `x ${Math.round(player.x)} · y ${Math.round(player.y)}`;
  }
  if (Number.isFinite(fps)) {
    _fpsEMA = _fpsEMA ? _fpsEMA * 0.95 + fps * 0.05 : fps;
  }
  // Touch shows the frame rate alone. The zone id is a developer readout and
  // has no business in the corner of a shipped phone build, but the fps does:
  // without a number on the device there's no way to tell a pacing problem
  // (30 vs 60) from input latency. Same "Show FPS" toggle as desktop — off
  // leaves the row empty, which is what the touch CSS expects.
  if (isTouchMode()) {
    hud.meta.textContent = showFps && _fpsEMA ? `${_fpsEMA.toFixed(0)} fps` : "";
    return;
  }
  hud.meta.textContent = showFps && _fpsEMA
    ? `Zone ${zoneId} · ${_fpsEMA.toFixed(0)} fps`
    : `Zone ${zoneId}`;
}

// touch.js owns the body class; this only reads it.
function isTouchMode() {
  return typeof document !== "undefined" && !!document.body?.classList.contains("touch-mode");
}
