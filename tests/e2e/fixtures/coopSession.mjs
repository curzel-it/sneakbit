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
  const hostUrl = zone != null
    ? `${appUrl}/?host=1&zone=${zone}&server=${encodeURIComponent(relayWs)}`
    : `${appUrl}/?host=1&server=${encodeURIComponent(relayWs)}`;
  await navigate(host, hostUrl);

  // Pick up the host's invite code via the existing getter.
  const inviteCode = await waitFor(host, `
    (async () => {
      const o = await import('/js/onlineBootstrap.js?v=20260528b');
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
        const sr = await import('/js/switchRole.js?v=20260528b');
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
      const m = await import('/js/mirrorWorld.js?v=20260528b');
      const p = await import('/js/predictedSelf.js?v=20260528b');
      const o = await import('/js/onlineBootstrap.js?v=20260528b');
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
