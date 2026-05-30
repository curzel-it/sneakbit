// High-level e2e fixture: brings up two Chrome instances, navigates one
// to the game in host mode and one in guest mode (deep-link by default,
// menu-driven via opts.entry === "menu"), and waits for both sides to
// be ready before yielding control to the test.
//
// Tests construct a session, drive it, then call `.stop()` in t.after.
// Everything the test wants to observe — predicted self samples, RTC
// stats, latency — lives in `window.__sb_*` globals seeded on the
// guest. Helpers below expose the most common reads.

import { launchChrome, getTargets, connectSession, evalExpr, navigate, waitFor } from "./chrome.mjs";

function uuidv4() {
  return ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
    (c ^ (Math.random() * 16 >> (c / 4))).toString(16));
}

// Pre-document script: wraps RTCPeerConnection so tests can count
// constructor calls and later call getStats() on the live pc(s). The
// wrap is no-op-safe if rtc is already disabled in the page.
const WRAP_PC_SCRIPT = `
  (() => {
    window.__sb_wrap_log = [];
    const Orig = window.RTCPeerConnection;
    if (!Orig) { window.__sb_wrap_log.push('no RTCPeerConnection'); return; }
    if (Orig.__sb_wrapped) return;
    const pcs = [];
    const Wrapped = function(...args) {
      window.__sb_wrap_log.push('pc constructed at ' + Date.now());
      const pc = new Orig(...args);
      pcs.push(pc);
      return pc;
    };
    Wrapped.prototype = Orig.prototype;
    Wrapped.__sb_wrapped = true;
    Object.defineProperty(window, 'RTCPeerConnection', { value: Wrapped, configurable: true, writable: true });
    window.__sb_pcs = pcs;
    window.__sb_wrap_log.push('wrap installed');
  })();
`;

// Strips RTCPeerConnection from window so the app's webrtcTransport
// early-returns and the WS-relay is used for all game traffic. Used by
// the WS-only comparison runs.
const DISABLE_WEBRTC_SCRIPT = `
  Object.defineProperty(window, 'RTCPeerConnection', { value: undefined, configurable: true });
  Object.defineProperty(window, 'RTCSessionDescription', { value: undefined, configurable: true });
  Object.defineProperty(window, 'RTCIceCandidate', { value: undefined, configurable: true });
`;

export async function startCoopSession({
  appUrl,
  relayWs,
  zone,
  entry = "deeplink",      // "deeplink" or "menu"
  disableWebrtc = false,   // force WS-only path
  hostSeedKv = null,       // { "item_collected.123": 1 } seeded into the host's storage.js KV before its boot
  hostPort = 9223,
  guestPort = 9224,
  hostDir = "/tmp/sb-e2e-host",
  guestDir = "/tmp/sb-e2e-guest",
} = {}) {
  const hostChrome = await launchChrome({ port: hostPort, dataDir: hostDir });
  const guestChrome = await launchChrome({ port: guestPort, dataDir: guestDir });

  const [hostT, guestT] = await Promise.all([
    getTargets(hostPort).then((ts) => ts.find((t) => t.type === "page")),
    getTargets(guestPort).then((ts) => ts.find((t) => t.type === "page")),
  ]);
  if (!hostT || !guestT) throw new Error("missing page targets");

  const host = await connectSession(hostT.webSocketDebuggerUrl);
  const guest = await connectSession(guestT.webSocketDebuggerUrl);

  // Pre-document scripts: PC wrap, plus optionally a hard rtc disable.
  await guest.send("Page.addScriptToEvaluateOnNewDocument", {
    source: disableWebrtc ? (DISABLE_WEBRTC_SCRIPT + WRAP_PC_SCRIPT) : WRAP_PC_SCRIPT,
  });
  if (disableWebrtc) {
    await host.send("Page.addScriptToEvaluateOnNewDocument", { source: DISABLE_WEBRTC_SCRIPT });
  }

  const hostUuid = uuidv4();
  const guestUuid = uuidv4();

  // Host: seed UUID on the right origin, then navigate to the deep-link
  // host URL (zone optional). Menu-mode doesn't apply on the host side —
  // it'd be redundant; the user's question was specifically about the
  // *guest* deep-link vs menu paths.
  await navigate(host, `${appUrl}/`);
  await evalExpr(host, `localStorage.setItem("sneakbit.online.uuid", ${JSON.stringify(hostUuid)})`);
  // Seed the host's persistent KV (storage.js) before the host boot so
  // initOfflineState's buildZone hydrates with these flags already set —
  // e.g. item_collected.<id>=1 models "the host picked this up in an
  // earlier single-player session, then started hosting". storage.js
  // namespaces every key under the "sneakbit.kv.v1." prefix.
  if (hostSeedKv) {
    for (const [k, v] of Object.entries(hostSeedKv)) {
      await evalExpr(host, `localStorage.setItem(${JSON.stringify("sneakbit.kv.v1." + k)}, ${JSON.stringify(String(v))})`);
    }
  }
  const hostUrl = zone != null
    ? `${appUrl}/?host=1&zone=${zone}&server=${encodeURIComponent(relayWs)}`
    : `${appUrl}/?host=1&server=${encodeURIComponent(relayWs)}`;
  await navigate(host, hostUrl);

  // Pick up the host's invite code via the existing getter.
  const inviteCode = await waitFor(host, `
    (async () => {
      const o = await import('./js/onlineBootstrap.js?v=20260530c');
      return o.getInviteCode && o.getInviteCode();
    })()
  `, { timeoutMs: 30000 });

  // Guest navigation, deep-link or menu-driven.
  await navigate(guest, `${appUrl}/`);
  await evalExpr(guest, `localStorage.setItem("sneakbit.online.uuid", ${JSON.stringify(guestUuid)})`);
  if (entry === "deeplink") {
    await navigate(guest, `${appUrl}/?join=${encodeURIComponent(inviteCode)}&server=${encodeURIComponent(relayWs)}`);
  } else if (entry === "menu") {
    // Boot offline, then drive a switchRole("guest", { code }) in-page —
    // the same call the party-panel "Join" button makes. This exercises
    // the menu code path (offline → guest at runtime) without having to
    // simulate clicks.
    await navigate(guest, `${appUrl}/?server=${encodeURIComponent(relayWs)}`);
    await waitFor(guest, `(typeof window !== 'undefined' && !!document.querySelector('#game'))`, { timeoutMs: 10000 });
    await evalExpr(guest, `
      (async () => {
        const sr = await import('./js/switchRole.js?v=20260530c');
        await sr.switchRole('guest', { code: ${JSON.stringify(inviteCode)} });
        return true;
      })()
    `);
  } else {
    throw new Error(`unknown entry mode: ${entry}`);
  }

  // Wait until the guest's mirror and predicted-self both exist.
  await waitFor(guest, `
    (async () => {
      const m = await import('./js/mirrorWorld.js?v=20260530c');
      const p = await import('./js/predictedSelf.js?v=20260530c');
      const o = await import('./js/onlineBootstrap.js?v=20260530c');
      window.__sb = { m, p, o };
      const selfId = o.getSelfPlayerId && o.getSelfPlayerId();
      const mp = selfId && m.getMirrorPlayerById(selfId);
      const ps = p.getPredictedSelf && p.getPredictedSelf();
      return !!(selfId && mp && ps) || null;
    })()
  `, { timeoutMs: 30000 });

  return {
    host, guest,
    inviteCode,
    appUrl, relayWs,
    stop: () => {
      try { host.close(); } catch { /* ignore */ }
      try { guest.close(); } catch { /* ignore */ }
      hostChrome.kill();
      guestChrome.kill();
    },
  };
}

// Read the live RTCPeerConnection stats from the guest's wrapped pcs.
// Returns one entry per pc with the data-channel + transport rows.
export async function readGuestRtcStats(guest) {
  return evalExpr(guest, `
    (async () => {
      const pcs = window.__sb_pcs || [];
      const out = [];
      for (const pc of pcs) {
        const info = {
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          channels: [],
          transport: null,
        };
        try {
          const stats = await pc.getStats();
          for (const r of stats.values()) {
            if (r.type === 'data-channel') {
              info.channels.push({
                label: r.label, state: r.state,
                msgSent: r.messagesSent, msgRecv: r.messagesReceived,
                bytesSent: r.bytesSent, bytesRecv: r.bytesReceived,
              });
            } else if (r.type === 'transport') {
              info.transport = {
                bytesSent: r.bytesSent, bytesRecv: r.bytesReceived,
                packetsSent: r.packetsSent, packetsRecv: r.packetsReceived,
                dtlsState: r.dtlsState,
              };
            }
          }
        } catch (e) { info.statsErr = e.message; }
        out.push(info);
      }
      return out;
    })()
  `);
}

export function dispatchKey(type, key, code, vk) {
  return `
    window.dispatchEvent(new KeyboardEvent('${type}', { key: '${key}', code: '${code}', keyCode: ${vk}, bubbles: true })) || true
  `;
}

export const KEYS = {
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  ArrowLeft:  { key: "ArrowLeft",  code: "ArrowLeft",  vk: 37 },
  ArrowUp:    { key: "ArrowUp",    code: "ArrowUp",    vk: 38 },
  ArrowDown:  { key: "ArrowDown",  code: "ArrowDown",  vk: 40 },
};

// Variant of runStutterWorkload tuned for hunting the residual
// jitter-driven stutter we still see on production after the
// shouldSnap fix shipped. Runs longer (default ~90 s), mixes
// continuous holds with short bursts to exercise the grace-window
// boundary, and dumps a small ring of context samples around each
// snap so we can read the pattern post-hoc instead of having to
// re-instrument every time.
export async function runStutterLongWorkload(session, { totalMs = 90_000, jumpThreshold = 0.15, contextFrames = 30 } = {}) {
  await evalExpr(session.guest, dispatchKey("keydown", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 400));
  await evalExpr(session.guest, dispatchKey("keyup", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 400));

  await evalExpr(session.guest, `
    (() => {
      const ps_mod = window.__sb.p;
      const m = window.__sb.m;
      const o = window.__sb.o;
      const selfId = o.getSelfPlayerId();
      const ring = []; const ringCap = ${contextFrames * 2 + 1};
      const snaps = [];
      let prev = null;
      let counter = 0;
      window.__sb_stutter_long = { ring, snaps, running: true, totalFrames: 0 };
      const thresh = ${jumpThreshold};
      const tick = () => {
        if (!window.__sb_stutter_long.running) return;
        const ps = ps_mod.getPredictedSelf();
        const mp = m.getMirrorPlayerById(selfId);
        if (ps) {
          window.__sb_stutter_long.totalFrames++;
          const t = performance.now();
          const sample = {
            t, fi: counter++,
            x: +ps.x.toFixed(3), y: +ps.y.toFixed(3),
            tx: ps.tileX, ty: ps.tileY,
            step: !!ps.step,
            dir: ps.direction,
            aTx: mp ? mp.tileX : null,
            aTy: mp ? mp.tileY : null,
            aX: mp ? +(mp.x ?? 0).toFixed(3) : null,
            aY: mp ? +(mp.y ?? 0).toFixed(3) : null,
            aMoving: mp ? !!mp.moving : null,
          };
          ring.push(sample);
          if (ring.length > ringCap) ring.shift();
          if (prev) {
            const dx = ps.x - prev.x;
            const dy = ps.y - prev.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > thresh) {
              snaps.push({
                t, fi: sample.fi, dist: +dist.toFixed(3),
                dx: +dx.toFixed(3), dy: +dy.toFixed(3),
                from: { x: prev.x, y: prev.y, tx: prev.tx, ty: prev.ty, step: prev.step, dir: prev.dir },
                to: { x: sample.x, y: sample.y, tx: sample.tx, ty: sample.ty, step: sample.step, dir: sample.dir },
                auth: { tx: sample.aTx, ty: sample.aTy, x: sample.aX, y: sample.aY, moving: sample.aMoving },
                contextBefore: ring.slice(-${contextFrames + 1}, -1).map((s) => ({ fi: s.fi, x: s.x, y: s.y, tx: s.tx, ty: s.ty, step: s.step, dir: s.dir, aTx: s.aTx, aTy: s.aTy, aMoving: s.aMoving })),
              });
            }
          }
          prev = { x: ps.x, y: ps.y, tx: ps.tileX, ty: ps.tileY, step: !!ps.step, dir: ps.direction };
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()
  `);

  // Workload schedule. Mix of:
  //   - long holds (10 s each) to exercise steady-state chaining
  //   - shorter alternations (1.5-2 s) to exercise direction changes
  //   - 800 ms pauses (longer than LATENCY_GRACE_MS=500) to exercise
  //     the post-grace path
  const start = Date.now();
  let cycle = 0;
  while (Date.now() - start < totalMs) {
    const c = cycle++;
    const dir = c % 2 === 0 ? KEYS.ArrowDown : KEYS.ArrowUp;
    // Alternate between long and short holds.
    const hold = (c % 4 < 2) ? 1800 : 4000;
    const pause = (c % 3 === 2) ? 800 : 250;
    await evalExpr(session.guest, dispatchKey("keydown", dir.key, dir.code, dir.vk));
    await new Promise((r) => setTimeout(r, hold));
    await evalExpr(session.guest, dispatchKey("keyup", dir.key, dir.code, dir.vk));
    await new Promise((r) => setTimeout(r, pause));
  }
  await new Promise((r) => setTimeout(r, 500));

  return evalExpr(session.guest, `
    (() => {
      window.__sb_stutter_long.running = false;
      return {
        snaps: window.__sb_stutter_long.snaps,
        totalFrames: window.__sb_stutter_long.totalFrames,
      };
    })()
  `);
}

// Drives the guest's predicted self through `cycles` of alternating
// down/up holds (each `holdMs`) and captures every animation frame's
// predicted position. Returns the raw samples plus a list of "snap"
// events — frames where predicted x/y jumped more than `jumpThreshold`
// tiles in a single frame. That's the signature of
// `predictedSelf.shouldSnap` killing an in-flight step: normal step
// motion is ~0.07 tile/frame at 60 fps, so a jump of >0.15 tile is at
// least 2 frames of motion happening at once. Visually it's the
// "avatar teleports to the next tile, skipping the walk animation"
// symptom the user has been reporting on their guest client.
//
// Caller is responsible for ensuring the avatar is on a long open
// stretch of road (zone 1001's spawn → one tile east → south road
// works fine). The helper jogs east one tile first.
export async function runStutterWorkload(session, { cycles = 4, holdMs = 2000, jumpThreshold = 0.15 } = {}) {
  await evalExpr(session.guest, dispatchKey("keydown", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 400));
  await evalExpr(session.guest, dispatchKey("keyup", KEYS.ArrowRight.key, KEYS.ArrowRight.code, KEYS.ArrowRight.vk));
  await new Promise((r) => setTimeout(r, 400));

  await evalExpr(session.guest, `
    (() => {
      const ps_mod = window.__sb.p;
      const m = window.__sb.m;
      const o = window.__sb.o;
      const selfId = o.getSelfPlayerId();
      const samples = [];
      const snaps = [];
      let prev = null;
      window.__sb_stutter = { samples, snaps, running: true };
      const thresh = ${jumpThreshold};
      const tick = () => {
        if (!window.__sb_stutter.running) return;
        const ps = ps_mod.getPredictedSelf();
        const mp = m.getMirrorPlayerById(selfId);
        if (ps) {
          const t = performance.now();
          const sample = {
            t,
            x: +ps.x.toFixed(3), y: +ps.y.toFixed(3),
            tx: ps.tileX, ty: ps.tileY,
            step: !!ps.step,
            dir: ps.direction,
            aTx: mp ? mp.tileX : null,
            aTy: mp ? mp.tileY : null,
            aMoving: mp ? !!mp.moving : null,
          };
          samples.push(sample);
          if (prev) {
            const dx = ps.x - prev.x;
            const dy = ps.y - prev.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > thresh) {
              snaps.push({
                t, dist: +dist.toFixed(3),
                dx: +dx.toFixed(3), dy: +dy.toFixed(3),
                from: { x: prev.x, y: prev.y, tx: prev.tx, ty: prev.ty, step: prev.step, dir: prev.dir },
                to: { x: sample.x, y: sample.y, tx: sample.tx, ty: sample.ty, step: sample.step, dir: sample.dir },
                auth: { tx: sample.aTx, ty: sample.aTy, moving: sample.aMoving },
              });
            }
          }
          prev = { x: ps.x, y: ps.y, tx: ps.tileX, ty: ps.tileY, step: !!ps.step, dir: ps.direction };
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      return true;
    })()
  `);

  for (let i = 0; i < cycles; i++) {
    await evalExpr(session.guest, dispatchKey("keydown", KEYS.ArrowDown.key, KEYS.ArrowDown.code, KEYS.ArrowDown.vk));
    await new Promise((r) => setTimeout(r, holdMs));
    await evalExpr(session.guest, dispatchKey("keyup", KEYS.ArrowDown.key, KEYS.ArrowDown.code, KEYS.ArrowDown.vk));
    await new Promise((r) => setTimeout(r, 300));
    await evalExpr(session.guest, dispatchKey("keydown", KEYS.ArrowUp.key, KEYS.ArrowUp.code, KEYS.ArrowUp.vk));
    await new Promise((r) => setTimeout(r, holdMs));
    await evalExpr(session.guest, dispatchKey("keyup", KEYS.ArrowUp.key, KEYS.ArrowUp.code, KEYS.ArrowUp.vk));
    await new Promise((r) => setTimeout(r, 300));
  }

  await new Promise((r) => setTimeout(r, 500));

  return evalExpr(session.guest, `
    (() => {
      window.__sb_stutter.running = false;
      return {
        samples: window.__sb_stutter.samples,
        snaps: window.__sb_stutter.snaps,
      };
    })()
  `);
}
