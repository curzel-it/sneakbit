// requestAnimationFrame loop with a clamped delta-time. Calls the
// provided step function once per frame with the elapsed seconds.

export function startGameLoop(step) {
  let last = performance.now();

  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1; // avoid huge jumps after a tab switch
    step(dt);
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}
