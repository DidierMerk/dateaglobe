// Moves mark the time they will end; heavy one-off work (parsing a large file, preparing the detailed
// coastline) waits until nothing has moved for a moment, so it never lands in the middle of an animation.
// Safari has no requestIdleCallback, so this is a plain timer.

let busyUntil = 0;

/** Something is moving for the next `ms` milliseconds. */
export function markBusy(ms) {
  busyUntil = Math.max(busyUntil, performance.now() + ms);
}

/** Run fn once nothing has moved for `settle` ms (or after `maxWait` ms at the latest). */
export function whenQuiet(fn, { settle = 150, maxWait = 8000 } = {}) {
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      const now = performance.now();
      if (now >= busyUntil + settle || now - start >= maxWait) {
        try { resolve(fn()); } catch (e) { reject(e); }
      } else setTimeout(check, Math.max(16, busyUntil + settle - now));
    };
    check();
  });
}
