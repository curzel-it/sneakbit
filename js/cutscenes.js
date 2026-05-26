// One-shot scripted sprite animations triggered by stepping onto a
// specific tile. Persisted via a storage key so they only play once
// per save. When the play-sprite cycles all the way through, the
// `on_end` entities are inserted into the zone (typically dialogues
// or a credits hint).
//
// Rendering degrades gracefully: cutscene sheet IDs are not in the
// asset map (the PNGs aren't shipped with the HTML port yet), so when
// the lookup fails we still tick the logic but skip painting.

import { TILE_SIZE, ANIMATIONS_FPS } from "./constants.js";
import { getValue, setValue } from "./storage.js";
import { getSprite } from "./assets.js";

const CUTSCENE_Z = 20_000_000; // mirrors Rust's 2_000_000_000 / 100 bucket

export function setupCutscenes(zone) {
  const raw = zone?._cutscenesRaw;
  if (!raw || raw.length === 0) {
    zone.cutscenes = [];
    return;
  }
  zone.cutscenes = raw.map((c) => ({
    key: c.key || "",
    idleSprite: normaliseSprite(c.idle_sprite),
    playSprite: normaliseSprite(c.play_sprite),
    frame: { ...c.frame },
    triggerX: c.trigger_position?.[0] ?? 0,
    triggerY: c.trigger_position?.[1] ?? 0,
    onEnd: Array.isArray(c.on_end) ? c.on_end : [],
    _isPlaying: false,
    _frameTimer: 0,
    _frameIndex: 0,
    _hidden: getValue(c.key) === 1,
  }));
}

function normaliseSprite(s) {
  if (!s) return null;
  return {
    frame: { ...s.frame },
    frames: s.number_of_frames ?? 1,
    sheetId: s.sheet_id ?? 0,
  };
}

export function tickCutscenes(zone, player, dt) {
  if (!zone?.cutscenes?.length) return;
  for (const c of zone.cutscenes) {
    if (c._hidden) continue;
    if (c._isPlaying) {
      const s = c.playSprite;
      if (!s) { finishCutscene(zone, c); continue; }
      c._frameTimer += dt;
      const period = 1 / ANIMATIONS_FPS;
      while (c._frameTimer >= period) {
        c._frameTimer -= period;
        c._frameIndex++;
        if (c._frameIndex >= s.frames) {
          finishCutscene(zone, c);
          break;
        }
      }
    } else if (player && player.tileX === c.triggerX && player.tileY === c.triggerY) {
      c._isPlaying = true;
      c._frameTimer = 0;
      c._frameIndex = 0;
    }
  }
}

function finishCutscene(zone, c) {
  c._isPlaying = false;
  c._hidden = true;
  if (c.key) setValue(c.key, 1);
  if (c.onEnd?.length) {
    for (const e of c.onEnd) zone.entities.push(clone(e));
  }
}

function clone(e) {
  // Shallow clone is fine for the on_end shape: nested dialogue arrays
  // are read-only after insertion.
  return { ...e, frame: e.frame ? { ...e.frame } : null };
}

export function drawCutscenes(ctx, zone, camera) {
  if (!zone?.cutscenes?.length) return;
  for (const c of zone.cutscenes) {
    if (c._hidden) continue;
    const sprite = c._isPlaying ? c.playSprite : c.idleSprite;
    if (!sprite) continue;
    const sheet = sheetForId(sprite.sheetId);
    if (!sheet) continue;
    const idx = c._isPlaying ? Math.min(c._frameIndex, sprite.frames - 1) : 0;
    const sx = (sprite.frame.x + idx * sprite.frame.w) * TILE_SIZE;
    const sy = sprite.frame.y * TILE_SIZE;
    const sw = sprite.frame.w * TILE_SIZE;
    const sh = sprite.frame.h * TILE_SIZE;
    const px = Math.round((c.frame.x - camera.x) * TILE_SIZE);
    const py = Math.round((c.frame.y - camera.y) * TILE_SIZE);
    ctx.drawImage(sheet, sx, sy, sw, sh, px, py, sw, sh);
  }
}

// Cutscene sprite sheets aren't part of assets.js (the demon-lord-defeat
// PNG isn't shipped with the HTML port yet). When that changes, name the
// asset here. For now anything we don't recognise returns null and the
// renderer no-ops.
const CUTSCENE_SHEETS = {
  // 1020: "demon_lord_defeat",
};

function sheetForId(id) {
  const name = CUTSCENE_SHEETS[id];
  if (!name) return null;
  try { return getSprite(name); } catch { return null; }
}

export { CUTSCENE_Z };
