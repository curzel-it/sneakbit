// The desktop half of the pause menu's "Exit game" (js/exitGame.js).
//
// Quitting is deferred by a beat rather than done inline: app.quit() closes
// every window, and a protocol response still travelling to a renderer that no
// longer exists is simply dropped. The renderer awaits that response, so
// tearing down first would leave the menu sitting on a fetch that never
// settles — right up until the process died under it. A few milliseconds buys
// the 204 a clean landing.
//
// `app` comes in as an argument (rather than imported from electron) so the
// scheduling is testable from plain node — same trick as electron/linuxSandbox.js.

export const QUIT_DELAY_MS = 30;

export function scheduleQuit(app, schedule = setTimeout) {
  schedule(() => {
    try {
      app.quit();
    } catch (err) {
      console.error("[quitApp] quit failed", err);
    }
  }, QUIT_DELAY_MS);
}
