// The result's year counter: a mechanical odometer that runs through history to the answer.
//
// Four wheels, each a strip 0-9 plus a second 0, so 9 can roll on into 0. Like a real
// odometer, a wheel only turns while the wheel to its right rolls over, which keeps every
// frame a readable year on its way to the answer.

/** Markup for a counter showing `year`; the wheels are hidden from screen readers, the label says the year. */
export function odometerHTML(year) {
  const strip = [...'01234567890'].map((d) => `<span>${d}</span>`).join('');
  return `<span class="odo" role="img" aria-label="${year}">${[0, 1, 2, 3].map(() => `<span class="odo-wheel" aria-hidden="true"><span class="odo-strip">${strip}</span></span>`).join('')}</span>`;
}

/** Show a (possibly fractional) year on the wheels. */
export function setOdometer(el, value) {
  const strips = el.querySelectorAll('.odo-strip');
  const n = strips.length;
  el.__value = value;
  strips.forEach((s, i) => {
    const place = 10 ** (n - 1 - i);
    const whole = Math.floor(value / place) % 10;
    // Turns only during the last unit of everything to its right; the units wheel turns all the time
    const below = value % place;
    const turn = place === 1 ? value % 1 : Math.max(0, below - (place - 1));
    s.style.transform = `translateY(${(-(whole + turn) / 11) * 100}%)`;
  });
}

/**
 * Roll from one year to another, fast through the middle and slowing into the answer. Resolves
 * true when it lands, false when cut off (the counter left the page, or a newer roll took over).
 * `from` null rolls on from wherever the wheels are now.
 */
export function rollOdometer(el, from, to, ms) {
  from ??= el.__value ?? to;
  const token = (el.__roll = (el.__roll ?? 0) + 1);
  return new Promise((resolve) => {
    const start = performance.now();
    const tick = (now) => {
      if (!el.isConnected || el.__roll !== token) return resolve(false);
      const t = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - t, 4);
      setOdometer(el, from + (to - from) * e);
      if (t < 1) requestAnimationFrame(tick);
      else { setOdometer(el, to); resolve(true); }
    };
    setOdometer(el, from);
    requestAnimationFrame(tick);
  });
}
