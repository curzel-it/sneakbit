// Electron entry point. Registers the custom `app://` scheme, then opens a
// single window pointed at the built site served from host
// `sneakbit.curzel.it` (see electron/appProtocol.js for why the host matters).
//
// Desktop wrapper only — no game logic lives here. The renderer runs the same
// _site/ bundle that ships to the web; all Electron concerns stay in electron/.

import { app, BrowserWindow, Menu, protocol } from "electron";
import { handleAppRequest } from "./appProtocol.js";

// The game shell now lives at /play/ (root index.html is the marketing landing,
// which the desktop build never shows). Load the shell file directly; its
// <base href="/"> keeps asset/data loads resolving to the app:// root.
const APP_URL = "app://sneakbit.curzel.it/play/index.html";

// Must run before app is ready. `standard` makes Chromium parse the host (so
// location.hostname === "sneakbit.curzel.it"); `secure` lets it run in a
// secure context (WebRTC, crypto); `supportFetchAPI` lets the page fetch() its
// own data/assets.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "app",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    minWidth: 640,
    minHeight: 360,
    backgroundColor: "#000000",
    title: "SneakBit",
    fullscreenable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Run the renderer in the OS sandbox. There's no preload bridge and no
      // node usage in the page, so nothing here needs the unsandboxed context.
      sandbox: true,
    },
  });

  // The renderer is a game, not a browser: it never legitimately opens new
  // windows, and it should only ever navigate within the bundled app:// origin.
  // Deny window.open outright and block any navigation that would leave app://
  // (e.g. an injected link), so an XSS can't pivot the privileged shell.
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("app://")) event.preventDefault();
  });

  win.loadURL(APP_URL);
  return win;
}

app.whenReady().then(() => {
  protocol.handle("app", handleAppRequest);

  // It's a game — no application menu. Keep a couple of accelerators alive via
  // a minimal menu so quit and fullscreen still work on every platform.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: "SneakBit",
        submenu: [
          {
            label: "Toggle Fullscreen",
            accelerator: process.platform === "darwin" ? "Ctrl+Cmd+F" : "F11",
            click: (_item, win) => win && win.setFullScreen(!win.isFullScreen()),
          },
          { type: "separator" },
          { role: "quit" },
        ],
      },
    ])
  );

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
