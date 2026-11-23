// "How it works" (help.js): the rules that need no screen, so they can be tested in Node. The strip's landing page after
// a drag, its give past the ends, the glide's length, and the figures' clocks (page 1's year, page 2's band, each loop's
// fade). Curves are passed in (help.js passes lang-layout.js CURVE), so nothing here touches the DOM.

export const N_PAGES = 3;
export const FLICK = 0.35;  // px per ms: a release faster than this carries on to the next page along the flick
export const GLIDE_MS = 380;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const band = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const mix = (a, b, k) => a + (b - a) * k;

/** Where the strip lands after a release at offset x (in pages: 1.4 = between pages 2 and 3), moving vx px/ms (+ = finger
 *  to the right, so towards the page before): the nearest page, or the next one along a flick. */
export function landing(x, vx, n = N_PAGES) {
  let to = Math.round(x);
  if (vx < -FLICK) to = Math.ceil(x - 0.05);
  else if (vx > FLICK) to = Math.floor(x + 0.05);
  return clamp(to, 0, n - 1);
}

/** The strip under the finger: 1:1 between the first and last page; past either end it gives like a rubber band, half
 *  the finger's move at first and ever less, never more than EDGE of a page (as a phone's own lists do). */
export const EDGE = 0.3, GIVE = 0.5;
const over = (o) => EDGE * (1 - 1 / (1 + (o * GIVE) / EDGE));          // o ≥ 0 pages past the end → the strip's way past it
const back = (u) => (EDGE * Math.min(u, EDGE * 0.999)) / (EDGE - Math.min(u, EDGE * 0.999)) / GIVE; // its inverse
export function rubber(x, n = N_PAGES) {
  if (x < 0) return -over(-x);
  if (x > n - 1) return n - 1 + over(x - (n - 1));
  return x;
}
/** The finger's place that puts the strip at x: a drag that starts while the strip is past an end (bouncing back) picks it up there. */
export function unrubber(x, n = N_PAGES) {
  if (x < 0) return -back(-x);
  if (x > n - 1) return n - 1 + back(x - (n - 1));
  return x;
}

/** After a swipe: a critically damped spring to the page, starting at the strip's own speed (v0, pages per ms), so the
 *  page carries on as the finger let go of it instead of starting over. d = where it starts − the page. Returns
 *  [the way still left, the speed] at t ms. W: its stiffness (per ms); 99.9% of the way by about 9 / W ms. */
export const W = 0.021;
export function spring(d, v0, t, w = W) {
  const e = Math.exp(-w * t), b = v0 + w * d;
  return [(d + b * t) * e, (b - w * (d + b * t)) * e];
}
/** The start speed a spring may take: towards the page at most w × the way (so it never overshoots onto the next page),
 *  away from it (a release while still pulling past an end) at most MAXV. */
export const MAXV = 0.004;
export function startSpeed(d, v0, w = W) {
  if (!Number.isFinite(v0)) return 0;
  if (d === 0 || Math.sign(v0) === -Math.sign(d)) return Math.sign(v0) * Math.min(Math.abs(v0), w * Math.abs(d)); // towards the page
  return Math.sign(v0) * Math.min(Math.abs(v0), MAXV);
}

/** The glide's length for the way left, in pages: 380 ms × 1.4 × the way, at least half and at most 1.4 × of 380. */
export const glideMs = (dist) => GLIDE_MS * clamp(Math.abs(dist) * 1.4, 0.5, 1.4);

/** A loop's fade: in over its first 300 ms, out over its last 500 (to 60 ms before its end). Not a number: shown whole. */
export const loopAlpha = (t, loop, curve) => (Number.isFinite(t) ? curve(band(t, 0, 300)) * (1 - curve(band(t, loop - 500, loop - 60))) : 1);

// Page 1: the years 1886 → 2025, 8 a second
export const FIRST = 1886, LAST = 2025, YPS = 8;
export const yearLoop = ((LAST - FIRST + 1) / YPS) * 1000;
export const yearAt = (t) => FIRST + (Math.floor((t / 1000) * YPS) % (LAST - FIRST + 1));

// Page 2: three questions, 2.5 s each from 300 ms; each closes the band of years still possible over 1400–2100 ms of its turn
export const Q0 = 300, QSEG = 2500;
export const BANDS = [[1886, 2026], [1949.8, 1990.8], [1960.3, 1990.8], [1960.3, 1963.9]];
export function bandAt(t, curve) {
  let A = BANDS[0];
  for (let i = 0; i < 3; i++) {
    const e = curve(band(t, Q0 + i * QSEG + 1400, Q0 + i * QSEG + 2100));
    if (e <= 0) break;
    A = [mix(BANDS[i][0], BANDS[i + 1][0], e), mix(BANDS[i][1], BANDS[i + 1][1], e)];
  }
  return A;
}

/** The order page 1's borders are made in: the two years the other figures need, then the loop's years in order. */
export function borderOrder(first = [1962, 1985]) {
  const out = [...first];
  for (let y = FIRST; y <= LAST; y++) if (!out.includes(y)) out.push(y);
  return out;
}
/** Of the years made so far (a Map year → borders), the one nearest y stands in for it. */
export function nearestMade(made, y) {
  if (made.has(y)) return made.get(y);
  let best = null, bd = Infinity;
  for (const [k, v] of made) if (Math.abs(k - y) < bd) { bd = Math.abs(k - y); best = v; }
  return best;
}
