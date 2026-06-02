// Electron entry point. Registers the custom `app://` scheme, then opens a
// single window pointed at the built site served from host
// `sneakbit.curzel.it` (see electron/appProtocol.js for why the host matters).
//
// Desktop wrapper only — no game logic lives here. The renderer runs the same
// _site/ bundle that ships to the web; all Electron concerns stay in electron/.

import { app, BrowserWindow, Menu, protocol } from "electron";
import { handleAppRequest } from "./appProtocol.js";

const APP_URL = "app://sneakbit.curzel.it/index.html";

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
    },
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
