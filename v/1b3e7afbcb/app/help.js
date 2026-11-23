// "How it works": the help behind the "?" at the top bar's right end. Four pages on one strip that follows the finger and
// runs off the help's edges. On every page the app's name and ✕; under every page one row: Previous · the dots · Next.
//   1. About                              the maker in a desk globe's brass ring, a few words; at the foot the ways to
//                                         reach him and the coffee (no figure, no loop)
//   2. Every globe is frozen in time      Africa and Europe hold still while the years run 1886 → 2025, each year's borders
//   3. Date your own globe                three of the quiz's questions answered, the years closing in, then the result: 1962
//   4. Guess the year of a globe          a game on a 1985 globe: 1973 too early, 1996 too late, 1985 got it in 3; at its
//                                         foot "Map data" under a hairline, the help's credits, last as in a book
// Pages 2–4: a figure that plays in a loop, a title and two or three short points. The row: page 1 has no Previous and its
// Next reads "How to play" (where it fits); page 4 has only Previous.
//
// Phones: the app's sheet from the bottom edge (on its side: figure beside words). Upright tablets and laptops: a card in the
// middle. Paper veil behind. Out: ✕, Esc, a tap outside, a swipe down (sheet). Pages: a sideways swipe (the strip follows the
// finger 1:1), Previous / Next, the dots, ← / →. While it is open the rest of the app is inert and hears no keys and no presses.
//
// Motion: one clock (performance.now, requestAnimationFrame), one curve, CURVE = cubic-bezier(.2,.8,.2,1). Open 420 ms (card
// 320), close 300 (card 240), the strip glides to a page in 380. A figure's loop starts when its page arrives. Reduced
// motion: 200 ms cross-fades, every figure shown still at a telling moment (its `rest`).
//
// The rules that need no screen (where a release lands, the clocks of the figures) are in help-logic.js.

import { CURVE } from './lang-layout.js';
import { odometerHTML, setOdometer } from './odometer.js';
import { layout } from './viewport.js';
import { landing, rubber, unrubber, spring, startSpeed, glideMs, loopAlpha, FIRST, yearLoop, yearAt, Q0, QSEG, bandAt, borderOrder, nearestMade } from './help-logic.js';

// The help is a modal: while it is open no key and no press may reach the app (the dial's arrows, the game's Esc, the
// result's "skip the replay" and "tap outside" listeners all listen on window, some in the capture phase). These two
// listeners are added when this module loads, before any of the app's, so they run first and can stop the rest.
const guard = { key: null, down: null };
addEventListener('keydown', (e) => guard.key?.(e), true);
addEventListener('pointerdown', (e) => guard.down?.(e), true);

const d3 = window.d3, topojson = window.topojson;
const PW = 320, PH = 180; // a figure's own size; it is scaled to its room
const GAP = 48;           // between two pages on the strip
const T = { open: 420, openCard: 320, close: 300, closeCard: 240, reduced: 200 };
const MARK = { yes: 'M-3.4,0.2L-1.1,2.6L3.5,-2.8', no: 'M-2.8,-2.8L2.8,2.8M-2.8,2.8L2.8,-2.8' }; // the timeline's ✓ and ✗
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const band = (t, a, b) => clamp((t - a) / (b - a), 0, 1);
const ease = (t, a, b) => CURVE(band(t, a, b));
const curve = (k) => CURVE(k);
const mix = (a, b, k) => a + (b - a) * k;
const RMQ = matchMedia('(prefers-reduced-motion: reduce)'), reduced = () => RMQ.matches;
const f1 = (v) => v.toFixed(1);
// Each frame a figure says how it should look; only what changed is written (a style, an SVG, a wheel of the odometer),
// so a still moment costs nothing and a slow phone keeps its frames for the motion
const fade = (n, a, rise = 0) => { const k = `${a.toFixed(3)} ${rise}`; if (n.__fade === k) return; n.__fade = k; n.style.opacity = a.toFixed(3); n.style.transform = rise ? `translateY(${f1((1 - a) * rise)}px)` : ''; n.style.visibility = a > 0.001 ? '' : 'hidden'; };
const html = (n, h) => { if (n.__html !== h) { n.__html = h; n.innerHTML = h; } };
const css = (n, prop, v) => { const k = `__${prop}`; if (n[k] !== v) { n[k] = v; n.style[prop] = v; } };
const odo = (n, v) => { if (n.__value !== v) setOdometer(n, v); };

// ------------------------------------------------------------------ the words (all new; listed in the demo's notes)
const PAGES = [
  { title: "Hi, I'm Didier.", about: true },
  { title: 'Every globe is frozen in time.', points: ['Over the years countries can split, join together or take new names; capitals move and lakes dry up.', 'Every globe is a snapshot of the past. Its borders, countries and names tell the story of the world at the time it was made.'] },
  { title: 'Date your own globe.', points: ['With your own globe or map in front of you, answer a few questions about the world it shows.', 'Every answer narrows down the years in which it could have been made.', 'Through this we can discover the years your globe or map was most likely made in.'] },
  { title: 'Guess the year of a globe.', points: ['No globe or map at hand? Test your own dating skills.', 'Look at a globe from the past and guess when it was made.', 'You have five guesses, and every miss earns a new hint.'] },
];

// ------------------------------------------------------------------ page 1, the About
// The icons in the ✕'s line style; the coffee is a cup with a lid, after Buy Me a Coffee's own
const ICO = {
  github: '<path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.4 5.4 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/>',
  linkedin: '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
  x: '<path d="M4 4h4.6L20 20h-4.6z"/><path d="M4.2 20l6.9-7.5M19.8 4l-6.5 7.1"/>',
  mail: '<rect x="2.5" y="5" width="19" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  cup: '<path d="M6.6 8.2 8 21h8l1.4-12.8"/><path d="M5.2 8.2h13.6"/><path d="M6 8.2l.9-2.7h10.2l.9 2.7"/><path d="M8.6 3h6.8"/><path d="M7.3 12.6h9.4"/>',
};
const ico = (k) => `<svg class="ha-ico" viewBox="0 0 24 24" aria-hidden="true">${ICO[k]}</svg>`;
const ext = (href, inner, cls = '', label = '') => `<a class="${cls}" href="${href}" target="_blank" rel="noopener"${label ? ` aria-label="${label}"` : ''}>${inner}</a>`;
// the address is not in the page: it is joined on a tap, so scrapers find nothing to read
const MAIL = ['didier.merk', 'gmail.com'];
const ABOUT = `
  <div class="ha-top">
    <div class="ha-globe" aria-hidden="true"><svg viewBox="13 2 142 148"><g fill="none" stroke-linecap="round">
      <path d="M 84 4 A 69 69 0 1 1 83.9 4" vector-effect="non-scaling-stroke" stroke-width="1.6" transform="rotate(-24 84 73)" pathLength="100" stroke-dasharray="72 28" stroke-dashoffset="-14"/>
      <path d="M 84 142 V 146 M 62 148 H 106" vector-effect="non-scaling-stroke" stroke-width="1.8"/></g></svg>
      <img src="assets/avatar.jpg" alt="" width="64" height="64" decoding="async"></div>
    <div><h2 class="help-title">Hi, I'm Didier.</h2><p class="ha-sub">I really like maps (among other things).</p></div></div>
  <p class="ha-text">As a kid I used to look for hours at maps and globes before bed. When I recently found my old globe I was curious when exactly it was made. That's when the idea for this small app came about.</p>
  <p class="ha-text">My background is in AI and besides maps I really like machine- and deep learning, especially foundational forecasting and probability theory. Currently I work as a forward deployed AI engineer.</p>
  <p class="ha-text">The app can always use feedback, feel free to contact me. I hope you enjoy it!</p>
  <div class="ha-end">
    <div class="ha-row">${ext('https://didiermerk.github.io/', ico('github'), 'ha-icon', 'GitHub')}${ext('https://www.linkedin.com/in/didier-merk/', ico('linkedin'), 'ha-icon', 'LinkedIn')}${ext('https://x.com/hallometdidier', ico('x'), 'ha-icon', 'X')}<a class="ha-icon ha-mail" href="#" aria-label="Email">${ico('mail')}</a>
      ${ext('https://www.youtube.com/watch?v=dQw4w9WgXcQ', `${ico('cup')}<span>Buy me a coffee</span>`, 'ha-coffee')}</div>
  </div>`;
// the credits the data's licences ask for, at the foot of the last page; each name links to its source, read as plain text
const CREDITS = `<div class="hl-end"><p class="ha-credits"><b>Map data</b> ${ext('https://icr.ethz.ch/data/cshapes/', 'CShapes 2.0')} · ${ext('https://www.geoboundaries.org', 'geoBoundaries')} · ${ext('https://www.naturalearthdata.com', 'Natural Earth')}</p></div>`;

// ------------------------------------------------------------------ a small globe in its brass ring (globe.js's paint)
function smallGlobe(canvas, d) {
  // the colours are read once per size() (lay() on every open), not in every frame: reading a computed style after the
  // frame's writes would make the browser work out every style again
  let C = null; const read = () => { const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim(); C = { '--ocean': g('--ocean'), '--ocean-2': g('--ocean-2'), '--land': g('--land'), '--ink': g('--ink'), '--border': g('--border'), '--brass': g('--brass') }; };
  const col = (n) => C[n];
  let last = null; // the last drawing's input: the same again is not drawn again
  const ctx = canvas.getContext('2d'), proj = d3.geoOrthographic().clipAngle(90).precision(0.5), path = d3.geoPath(proj, ctx);
  const grat = d3.geoGraticule10();
  let px = 1;
  return {
    size(scale) { read(); last = null; px = Math.max(1, Math.min(3, (window.devicePixelRatio || 1) * scale)); canvas.width = Math.round(d * px); canvas.height = Math.round(d * px); canvas.style.width = canvas.style.height = `${d}px`; },
    /** { world, rot: [lon, lat], zoom, borders (a mesh), hl: [{ scene, a }] (brass) } */
    draw({ world, rot, zoom = 1, borders = null, hl = [] }) {
      const key = [world, rot[0], rot[1], zoom, borders, ...hl.flatMap((h) => [h.scene, h.a])];
      if (last && last.length === key.length && key.every((v, i) => v === last[i])) return;
      last = key; if (!C) read();
      const r = d / 2 - 1.5, c = d / 2;
      ctx.setTransform(px, 0, 0, px, 0, 0); ctx.clearRect(0, 0, d, d);
      if (!world) return;
      proj.scale(r * zoom).translate([c, c]).rotate([-rot[0], -rot[1], 0]);
      ctx.save(); ctx.beginPath(); ctx.arc(c, c, r, 0, 2 * Math.PI); ctx.clip();
      const g = ctx.createRadialGradient(c - r * 0.35, c - r * 0.4, r * 0.1, c, c, r * zoom);
      g.addColorStop(0, col('--ocean-2')); g.addColorStop(1, col('--ocean'));
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = g; ctx.fill();
      ctx.beginPath(); path(grat); ctx.strokeStyle = 'rgba(244,236,220,0.10)'; ctx.lineWidth = 0.5; ctx.stroke();
      ctx.beginPath(); path(world.land); ctx.fillStyle = col('--land'); ctx.fill();
      const brass = (stroke) => { for (const { scene, a } of hl) {
        if (!scene?.highlight?.length || a < 0.01) continue;
        ctx.globalAlpha = a; ctx.beginPath(); scene.highlight.forEach((f) => path(f));
        if (stroke) { ctx.strokeStyle = col('--ink'); ctx.lineWidth = 1.2; ctx.stroke(); } else { ctx.fillStyle = 'rgba(176,138,62,.55)'; ctx.fill(); }
        ctx.globalAlpha = 1;
      } };
      brass(false);
      ctx.beginPath(); path(borders ?? world.borders); ctx.strokeStyle = col('--border'); ctx.lineWidth = 0.6; ctx.stroke();
      brass(true);
      ctx.restore();
      ctx.beginPath(); ctx.arc(c, c, r, 0, 2 * Math.PI); ctx.strokeStyle = col('--brass'); ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8; ctx.stroke(); ctx.globalAlpha = 1;
    },
  };
}

const mark = (kind, x, y, k = 1) => (k > 0.01 ? `<path class="hp-mark ${kind}" transform="translate(${f1(x)},${f1(y)}) scale(${mix(0.2, 1, k).toFixed(3)})" opacity="${k.toFixed(3)}" d="${MARK[kind]}"/>` : '');
/** The game's dial (game.js dialSVG look): the axis slides under a fixed needle; the bar of the years still possible. */
function dialSVG({ v, y, ppy, from = 1886, to = 2035, said = [], dir = null, landed = 0 }) {
  const cx = 160, x = (yr) => cx + (yr - v) * ppy, lo = v - 160 / ppy - 1, hi = v + 160 / ppy + 1;
  let s = `<g class="hp-axis"><line x1="0" x2="320" y1="${y}" y2="${y}"/>`;
  for (let yr = Math.ceil(lo); yr <= hi; yr++) {
    const X = x(yr), edge = clamp(Math.min(X, 320 - X) / 40, 0, 1); if (edge <= 0) continue;
    const big = yr % 10 === 0;
    s += `<line x1="${f1(X)}" x2="${f1(X)}" y1="${y}" y2="${y + (big ? 6 : yr % 5 ? 2.5 : 4)}" opacity="${f1(edge)}"/>`;
    if (big) s += `<text x="${f1(X)}" y="${y + 17}" opacity="${f1(edge)}">${yr}</text>`;
  }
  s += '</g>';
  const a = Math.max(-10, x(from)), b = Math.min(330, x(to));
  s += `<rect class="hp-dialbar" x="${f1(a)}" width="${f1(Math.max(0, b - a))}" y="${y - 5}" height="5" rx="2.5"/>`;
  for (const g of [].concat(said ?? [])) if (g && g.a > 0.01) { const X = x(g.g + 0.5); s += `<line class="hp-said" x1="${f1(X)}" x2="${f1(X)}" y1="${y - 9}" y2="${y + 6}" opacity="${f1(g.a)}"/>`; }
  if (dir && dir.a > 0.01) s += `<text class="hp-dir" x="${cx}" y="${y - 13}" opacity="${f1(dir.a)}">${dir.text}</text>`;
  s += `<line class="hp-needle" x1="${cx}" x2="${cx}" y1="${y - (dir && dir.a > 0.01 ? 8 : 12)}" y2="${y + 8}" style="stroke:color-mix(in srgb, var(--brass) ${Math.round(landed * 100)}%, var(--ink))"/>`;
  return s;
}
/** The guesses' marks (game.js marksSVG): ✗ / ✓ as they come, a dot for the guess now, rings for the rest. */
function marksSVG(items, x0, y) {
  let s = '';
  items.forEach((it, i) => {
    const X = x0 + 11 + i * 16, Y = y + 8;
    if (it.kind === 'yes' || it.kind === 'no') s += mark(it.kind, X, Y, it.k ?? 1);
    else if (it.kind === 'now') s += `<circle class="hp-now" cx="${X}" cy="${Y}" r="2.6"/>`;
    else s += `<circle class="hp-todo" cx="${X}" cy="${Y}" r="2.6"/>`;
  });
  return s;
}

// ------------------------------------------------------------------ the figures: build(box) once, draw(t, D) at t ms in the loop
const PICS = [
  null, // page 1, the About: no figure
  // 1. The globe holds still on Africa and Europe (where the map changed most) while the years run on, 8 a second; the borders are each year's own
  {
    loop: yearLoop, rest: 9500, peek: 400, // 17.5 s; at rest: 1962
    build(box) {
      box.innerHTML = `<canvas class="hp-globe" style="left:14px;top:2px"></canvas>
        <div class="hp-when" style="left:206px;top:58px"><p class="hp-label">The world in</p><div class="hp-big">${odometerHTML(FIRST)}</div></div>`;
      this.g = smallGlobe(box.querySelector('canvas'), 176); this.odo = box.querySelector('.odo');
    },
    draw(t, D) {
      const y = yearAt(t);
      odo(this.odo, y);
      this.g.draw({ world: D.world, rot: [17, 14], zoom: 1.08, borders: D.bordersAt?.(y) });
    },
  },
  // 2. Three picture questions answered one by one, the years closing in under them, then the result. In a loop
  {
    loop: 12000, rest: 10000, peek: 900,
    build(box) {
      box.innerHTML = `<div class="hp-q-group"><canvas class="hp-globe" style="left:0;top:0"></canvas>
          <div class="hp-words" style="left:122px;top:4px;width:198px"><p class="hp-label"></p><p class="hp-q"></p><div class="hp-yn"><span class="hp-yes">Yes</span><span class="hp-no">No</span></div></div></div>
        <div class="hp-r-group"><canvas class="hp-globe" style="left:8px;top:6px"></canvas>
          <div class="hp-res" style="left:122px;top:14px"><p class="hp-kicker">Your map was most likely printed in</p><div class="hp-big">${odometerHTML(1990)}</div><p class="hp-range"><span class="hp-range-k">Likely range</span>1961 – 1963</p></div></div>
        <svg class="hp-svg" viewBox="0 0 320 180"></svg>`;
      const cv = box.querySelectorAll('canvas');
      this.g = smallGlobe(cv[0], 108); this.r = smallGlobe(cv[1], 100);
      Object.assign(this, { q: box.querySelector('.hp-q-group'), res: box.querySelector('.hp-r-group'), label: box.querySelector('.hp-label'), text: box.querySelector('.hp-q'),
        yes: box.querySelector('.hp-yes'), no: box.querySelector('.hp-no'), odo: box.querySelector('.hp-res .odo'), big: box.querySelector('.hp-res .hp-big'), range: box.querySelector('.hp-range'), svg: box.querySelector('svg'), shown: -1 });
      this.x = (y) => 14 + ((y - 1890) / (2030 - 1890)) * 292;
    },
    draw(t, D) {
      const Q = D.questions ?? [], S0 = Q0, SEG = QSEG, R0 = S0 + 3 * SEG; // three questions, then the result at 7800
      const k = clamp(Math.floor((t - S0) / SEG), 0, 2), u = t - S0 - k * SEG, q = Q[k];
      if (q && this.shown !== k) { this.shown = k; this.label.textContent = q.subject; this.text.textContent = q.question; }
      // the question: in over 400 ms (6 px rise), its answer pressed at 1100, out over 2100–2400 (the last one at the result)
      const qa = t >= R0 ? 1 - ease(t, R0, R0 + 300) : ease(u, 0, 400) * (k < 2 ? 1 - ease(u, 2100, 2400) : 1);
      fade(this.q, t < S0 ? 0 : qa, 6);
      const press = ease(u, 1100, 1250) - ease(u, 1300, 1450), on = q?.reply === 'yes' ? this.yes : this.no, off = on === this.yes ? this.no : this.yes;
      css(on, 'transform', press > 0 ? `scale(${f1(1 - 0.04 * press)})` : ''); css(off, 'transform', '');
      on.classList.toggle('is-picked', u >= 1150); off.classList.remove('is-picked');
      if (q) this.g.draw({ world: D.world, rot: [q.camera.lon, q.camera.lat], zoom: q.camera.zoom * 0.7, borders: q.scene.borders, hl: [{ scene: q.scene, a: 1 }] });
      // the result: in from 8100, the year rolling from 1990 to 1962 and turning brass, then its likely range
      const ra = ease(t, R0 + 300, R0 + 700);
      fade(this.res, ra, 6);
      if (ra > 0) this.r.draw({ world: D.world, rot: [-30, 12], borders: D.bordersAt?.(1962) });
      odo(this.odo, Math.round(mix(1990, 1962, ease(t, R0 + 300, R0 + 1300))));
      css(this.big, 'color', `color-mix(in srgb, var(--brass) ${Math.round(ease(t, R0 + 900, R0 + 1400) * 100)}%, var(--ink-soft))`);
      fade(this.range, ease(t, R0 + 1100, R0 + 1500), 6);
      // the years still possible: all, then 1949–1990, 1960–1990, 1960–1963; back to all as the loop ends
      const A = bandAt(t, curve);
      const x = this.x, y = 160;
      let s = `<g class="hp-axis"><line x1="${x(1890)}" x2="${x(2030)}" y1="${y}" y2="${y}"/>`;
      for (let v = 1900; v <= 2020; v += 10) s += `<line x1="${f1(x(v))}" x2="${f1(x(v))}" y1="${y}" y2="${y + (v % 20 ? 3 : 5)}"/>` + (v % 40 === 20 || v === 1900 ? `<text x="${f1(x(v))}" y="${y + 16}">${v}</text>` : '');
      s += `</g><rect class="hp-band" x="${f1(x(A[0]))}" width="${f1(Math.max(3, x(A[1]) - x(A[0])))}" y="${y - 14}" height="14"/><path class="hp-bracket" d="M${f1(x(A[0]))},${y - 14}V${y - 18}H${f1(x(A[1]))}V${y - 14}"/>`;
      html(this.svg, s);
    },
  },
  // 3. A globe from 1985 turns. Guess 1973: ✗, "Later than 1973 →", a hint about Southern Africa (the globe hops there).
  //    Guess 1996: ✗, "← Earlier than 1996", a hint about the Western Balkans. Guess 1985: ✓, got it in 3. In a loop
  {
    loop: 15500, rest: 13000, peek: 500,
    build(box) {
      box.innerHTML = `<canvas class="hp-globe" style="left:0;top:0"></canvas>
        <div class="hp-words hp-small" style="left:124px;top:8px;width:196px"><p class="hp-label">Guess the year</p><p class="hp-q">When was this globe made?</p></div>
        <div class="hp-words hp-small" style="left:124px;top:8px;width:196px"><p class="hp-label">Southern Africa</p><p class="hp-q">Angola and Mozambique are independent</p><p class="hp-kicker">This means after 1973</p></div>
        <div class="hp-words hp-small" style="left:124px;top:8px;width:196px"><p class="hp-label">Western Balkans</p><p class="hp-q">Yugoslavia is one big country</p><p class="hp-kicker">This means between 1973 and 1996</p></div>
        <div class="hp-words hp-small" style="left:124px;top:8px;width:196px"><p class="hp-label">Guess the year</p><p class="hp-q">Got it in 3 guesses</p></div>
        <div class="hp-gyear" style="left:156px;top:103px">${odometerHTML(1950)}</div>
        <svg class="hp-svg" viewBox="0 0 320 180"></svg>`;
      this.g = smallGlobe(box.querySelector('canvas'), 112);
      Object.assign(this, { w: [...box.querySelectorAll('.hp-words')], odo: box.querySelector('.odo'), year: box.querySelector('.hp-gyear'), svg: box.querySelector('svg') });
    },
    draw(t, D) {
      if (!Number.isFinite(t)) t = this.rest;
      // the globe turns slowly; for each hint it hops to its place and back
      const h1 = ease(t, 2300, 3300) * (1 - ease(t, 4600, 5600)), h2 = ease(t, 6700, 7700) * (1 - ease(t, 9000, 10000)), spin = -20 + t * 0.006;
      let rot = [spin, 15], zoom = 1;
      if (h1 > 0) { rot = [mix(spin, 26, h1), mix(15, -14, h1)]; zoom = mix(1, 2.3, h1); }
      if (h2 > 0) { rot = [mix(spin, 18.6, h2), mix(15, 43.8, h2)]; zoom = mix(1, 3.2, h2); }
      this.g.draw({ world: D.world, rot, zoom, borders: D.bordersAt?.(1985) });
      // the words: the question; the first hint; the second; the verdict
      fade(this.w[0], ease(t, 0, 400) * (1 - ease(t, 2000, 2200)), 6);
      fade(this.w[1], ease(t, 2300, 2700) * (1 - ease(t, 6300, 6500)), 6);
      fade(this.w[2], ease(t, 6700, 7100) * (1 - ease(t, 10700, 10900)), 6);
      fade(this.w[3], ease(t, 11000, 11400), 6);
      // the dial: 1950 → 1973 (600–1600), guess at 1900; → 1996 (4800–6000), guess at 6300; → 1985 (9200–10400), guess at 10700
      const v = t < 4800 ? mix(1950, 1973, ease(t, 600, 1600)) : t < 9200 ? mix(1973, 1996, ease(t, 4800, 6000)) : mix(1996, 1985, ease(t, 9200, 10400));
      odo(this.odo, Math.round(v));
      const m1 = ease(t, 1900, 2200), m2 = ease(t, 6300, 6600), hit = ease(t, 10700, 11000), brass = ease(t, 10800, 11300);
      css(this.year, 'color', `color-mix(in srgb, var(--brass) ${Math.round(brass * 100)}%, var(--ink))`);
      const d1 = ease(t, 2100, 2400) * (1 - ease(t, 4800, 5100)), d2 = ease(t, 6500, 6800) * (1 - ease(t, 9200, 9500));
      const dir = d1 > 0 ? { text: 'Later than 1973 →', a: d1 } : { text: '← Earlier than 1996', a: d2 };
      html(this.svg, dialSVG({ v, y: 160, ppy: 7.2, from: mix(1886, 1974, ease(t, 2000, 2400)), to: mix(2035, 1996, ease(t, 6400, 6800)),
        said: [{ g: 1973, a: m1 }, { g: 1996, a: m2 }], dir, landed: brass })
        + marksSVG([m1 > 0 ? { kind: 'no', k: m1 } : { kind: 'now' }, m2 > 0 ? { kind: 'no', k: m2 } : { kind: m1 > 0 ? 'now' : 'todo' }, hit > 0 ? { kind: 'yes', k: hit } : { kind: m2 > 0 ? 'now' : 'todo' }, { kind: 'todo' }, { kind: 'todo' }], 238, 116));
    },
  },
];

// ------------------------------------------------------------------ the modal
export function createHelp({ button, data = async () => ({}), debug = false }) {
  const veil = document.createElement('div'); veil.className = 'help-veil';
  const dlg = document.createElement('div');
  dlg.className = 'help'; dlg.id = 'help'; dlg.hidden = veil.hidden = true; dlg.tabIndex = -1;
  dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'How it works');
  dlg.innerHTML = `
    <div class="help-head"><p class="help-brand"><span class="brand-mark" aria-hidden="true">◍</span> Date a Globe</p>
      <button type="button" class="help-close" aria-label="Close"><svg viewBox="-8 -8 16 16" aria-hidden="true"><path d="M-5,-5L5,5M-5,5L5,-5"/></svg></button></div>
    <div class="help-view"><div class="help-track">${PAGES.map((p, i) => `
      <section class="help-page${i === PAGES.length - 1 ? ' has-end' : ''}" data-i="${i}" role="group" aria-roledescription="page" aria-label="${i + 1} of ${PAGES.length}">
        ${p.about ? `<div class="help-about">${ABOUT}</div>` : `<div class="help-pics" aria-hidden="true"><div class="help-stage"></div></div>
        <div class="help-words"><h2 class="help-title">${p.title}</h2><ul class="help-points">${p.points.map((x) => `<li>${x}</li>`).join('')}</ul>${i === PAGES.length - 1 ? CREDITS : ''}</div>`}
      </section>`).join('')}</div></div>
    <div class="help-nav">
      <button type="button" class="hn-prev"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 6-6 6 6 6"/></svg><span>Previous</span></button>
      <div class="help-dots" role="group" aria-label="Pages">${PAGES.map((p, i) => `<button type="button" aria-label="Page ${i + 1} of ${PAGES.length}"><svg viewBox="-5 -5 10 10" aria-hidden="true"><circle r="3"/></svg></button>`).join('')}</div>
      <button type="button" class="hn-next"><span class="hn-word">Next</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9.5 6 6 6-6 6"/></svg></button></div>
    <p class="vd-sr" aria-live="polite" id="help-live"></p>`;
  document.body.append(veil, dlg);
  const $ = (s) => dlg.querySelector(s), $$ = (s) => [...dlg.querySelectorAll(s)];
  const view = $('.help-view'), track = $('.help-track'), pages = $$('.help-page'), stages = $$('.help-page').map((pg) => pg.querySelector('.help-stage')), boxes = $$('.help-pics'), dots = $$('.help-dots button'), dotsBox = $('.help-dots'), live = $('#help-live');
  const P = PICS.map((p) => (p ? Object.create(p) : null));
  let D = { world: null }, built = false, making = 0;
  const held = [], drawn = []; // per page: the frame it holds while not in view; the frame last drawn
  // x: the strip's offset in pages (0 = page 1, 1.4 = between 2 and 3); glide: its move to a page; t0[i]: when page i's loop began
  const S = { open: false, i: 0, x: 0, glide: null, sheet: null, raf: 0, drag: null, mode: 'sheet', freeze: null, t0: [0, 0, 0, 0], step: 0 };
  const card = () => S.mode === 'card', N = PAGES.length;

  // ------------------------------------------------ layout: card or sheet, the page width, the figure's scale
  function lay() {
    const W = innerWidth, H = innerHeight, kind = layout().kind, page = document.documentElement.classList.contains('vp-page');
    S.mode = kind === 'wide' || page ? 'card' : 'sheet';
    S.side = kind === 'short';
    dlg.classList.toggle('is-card', card()); dlg.classList.toggle('is-sheet', !card()); dlg.classList.toggle('is-side', S.side);
    dlg.classList.toggle('is-tiny', W < 360 || H < 600);
    const w = view.clientWidth;
    S.step = w + GAP;
    pages.forEach((p) => { p.style.width = `${w}px`; });
    track.style.gap = `${GAP}px`;
    let s = S.side ? clamp(Math.min((H - 44 - 12 - 56 - 30) / PH, (w * 0.46) / PW), 0.6, 1.1) : clamp(w / PW, 0.6, card() ? 1.25 : 1.15);
    const apply = () => { boxes.forEach((b) => { b.style.height = `${Math.round(PH * s)}px`; b.style.width = S.side ? `${Math.round(PW * s)}px` : ''; }); stages.forEach((st) => { if (st) st.style.transform = `scale(${s})`; }); };
    apply();
    // all of it fits the screen: a short screen gives from the figure first
    if (!S.side) { const chrome = dlg.offsetHeight - boxes[0].offsetHeight; s = clamp(Math.min(s, (H - (card() ? 48 : 12) - chrome) / PH), 0.5, s); apply(); }
    S.scale = s;
    fitNav();
    // page 4: its icons and the coffee always share one line; --k (1 → 0.6) shrinks them together until the row fits
    const row = $('.ha-row');
    if (row) { let k = 1; row.style.setProperty('--k', '1'); while (row.scrollWidth > row.clientWidth + 0.5 && k > 0.6) { k -= 0.02; row.style.setProperty('--k', k.toFixed(2)); } }
    P.forEach((p) => { p?.g?.size(s); p?.r?.size(s); });
    drawn.length = 0; // a resized canvas is blank: draw every page again
    S.h = dlg.offsetHeight; // the sheet's height, read here once (not in every frame of its slide)
    place();
  }
  // every move of the strip (a finger, a trackpad, a glide) also lights the dot of the page nearest to it, so the dots follow
  // the strip as it goes; the page it settles on (inert, the live region, aria-current) waits for go()
  const place = () => { track.style.transform = `translateX(${f1(-S.x * S.step)}px)`; showDot(clamp(Math.round(S.x), 0, N - 1)); vh.push(performance.now(), S.x); if (vh.length > 24) vh.splice(0, 2); };
  // the strip's speed (pages per ms) over its last 80 ms of places: what a swipe hands on to the spring that lands it. A
  // finger that stood still before it let go (no move in the last 50 ms) hands on nothing
  const vh = [];
  function vel(now = performance.now()) {
    const i = vh.length - 2; if (i < 2 || now - vh[i] > 50) return 0;
    let j = i; while (j >= 2 && vh[i] - vh[j - 2] <= 80) j -= 2;
    const dt = vh[i] - vh[j]; return dt > 4 ? (vh[i + 1] - vh[j + 1]) / dt : 0;
  }
  let lit = -1;
  function showDot(j) { if (j === lit) return; lit = j; dots.forEach((b, k) => b.classList.toggle('on', k === j)); navFor(j); }
  // Previous / Next follow the strip like the dots: none before page 1, none after the last; page 1's Next says where it goes
  const nav = $('.help-nav'), prevB = $('.hn-prev'), nextB = $('.hn-next'), nextWord = $('.hn-word'), navFit = { first: true };
  function navFor(j) {
    prevB.classList.toggle('is-off', j === 0); prevB.tabIndex = j === 0 ? -1 : 0;
    nextB.classList.toggle('is-off', j === N - 1); nextB.tabIndex = j === N - 1 ? -1 : 0;
    nextWord.textContent = j === 0 && navFit.first ? 'How to play' : 'Next';
  }
  // the words' size: 15 px, smaller (to 12) until Previous and Next each fit their half beside the centred dots; one size
  // on every page. "How to play" only where it fits at that size, else "Next". Only if even 12 px is too wide: Previous
  // keeps just its arrow (its word stays for screen readers).
  function fitNav() {
    const half = () => (nav.clientWidth - dotsBox.offsetWidth) / 2 - 4;
    const fits = (b, extra = 0) => b.offsetWidth + extra <= half();
    nav.classList.remove('is-icon'); nextWord.textContent = 'Next';
    let f = 15; nav.style.setProperty('--nf', `${f}px`);
    while ((!fits(prevB, -8) || !fits(nextB)) && f > 12) { f -= 0.5; nav.style.setProperty('--nf', `${f}px`); }
    if (!fits(prevB, -8)) nav.classList.add('is-icon');
    nextWord.textContent = 'How to play'; navFit.first = fits(nextB);
    lit = -1; // the next place() sets the buttons and the word again
  }

  // ------------------------------------------------ one clock
  function frame(now) {
    S.raf = 0;
    let busy = !!S.drag;
    // Every move starts its clock on the frame that first shows it, as if one frame had already passed: work done before
    // that frame (a layout, a tap's own handling) never shows as a jump at the start. The open goes one frame further: its
    // first frame shows the help still away (so the browser makes its layers while nothing can be seen), then it moves
    if (S.sheet) {
      const Sh = S.sheet;
      if (Sh.prime) { Sh.prime = false; setSheet(Sh.from); busy = true; }
      else {
        Sh.t0 ??= now - 16;
        const k = band(now - Sh.t0, 0, Sh.ms), e = reduced() ? k : CURVE(k);
        setSheet(k >= 1 ? Sh.to : mix(Sh.from, Sh.to, e)); busy = busy || k < 1; // lands exactly (CURVE(1) is 1 − 1e-14)
        if (k >= 1) { S.sheet = null; Sh.done?.(); }
      }
    }
    if (S.glide) {
      const G = S.glide; G.t0 ??= now - 16;
      const t = now - G.t0;
      let end = false;
      if (reduced()) { const k = band(t, 0, G.ms); view.style.opacity = (k < 0.5 ? 1 - 2 * k : 2 * k - 1).toFixed(3); S.x = k >= 0.5 ? G.to : G.from; end = k >= 1; }
      else if (G.spring) { const [d, v] = spring(G.d, G.v0, t); end = (Math.abs(d) < 4e-4 && Math.abs(v) < 6e-5) || t > 1600; S.x = end ? G.to : G.to + d; }
      else { const k = band(t, 0, G.ms); S.x = k >= 1 ? G.to : mix(G.from, G.to, CURVE(k)); end = k >= 1; }
      place(); busy = busy || !end;
      if (end) { S.glide = null; view.style.opacity = ''; }
    }
    // the figures on screen: the page in view, and its neighbour while the strip is between two. While the help closes they
    // hold still: the slide away gets the whole frame
    // While the strip moves (a finger, a trackpad, a glide), the page in view holds its frame too and plays on from it once
    // the strip rests: the move is then only the strip's slide, which costs a slow phone next to nothing
    const moving = !!(S.glide || S.drag?.axis === 'x' || (wheel?.follow && !wheel.coast));
    if (!moving && S.hold != null) { S.t0[S.i] = now - S.hold; S.hold = null; }
    if (built && !S.closing) for (let i = 0; i < N; i++) {
      if (Math.abs(i - S.x) >= 1 || !P[i]) continue; // page 1 (the About) has no figure
      // the page in view plays its loop; any other page holds still: on the frame it showed when it was left (so a page
      // going away doesn't jump), or its opening frame (peek) if it hasn't played yet; it goes on from there when it arrives
      const p = P[i];
      if (moving && i === S.i && S.hold == null && !reduced()) S.hold = (now - S.t0[i]) % p.loop;
      const t = S.freeze != null && i === S.i ? S.freeze : reduced() ? p.rest : i === S.i ? S.hold ?? (now - S.t0[i]) % p.loop : held[i] ?? p.peek;
      if (i === S.i && !reduced() && S.freeze == null && !moving) busy = true; // a loop never rests (asked before the skip below: the frame it resumes on is the one it held)
      if (t === drawn[i]) continue; // a page that holds still is not drawn again
      drawn[i] = t;
      stages[i].style.opacity = reduced() || S.freeze != null ? '1' : loopAlpha(t, p.loop, curve).toFixed(3);
      p.draw(t, D);
    }
    if (S.open && busy) S.raf = requestAnimationFrame(frame);
  }
  const kick = () => { if (!S.raf) S.raf = requestAnimationFrame(frame); };
  function setSheet(v) {
    // v: 0 = open, 1 = away. The sheet slides its own height; the card fades and rises 12 px; the veil fades with either
    if (card()) { dlg.style.opacity = (1 - v).toFixed(3); dlg.style.transform = reduced() ? 'translate(-50%, -50%)' : `translate(-50%, calc(-50% + ${f1(12 * v)}px)) scale(${f1(1 - 0.02 * v)})`; }
    else if (reduced()) { dlg.style.opacity = (1 - v).toFixed(3); dlg.style.transform = 'none'; }
    else { dlg.style.opacity = '1'; dlg.style.transform = `translateY(${f1(v * ((S.h || dlg.offsetHeight) + 24))}px)`; }
    veil.style.opacity = (0.6 * (1 - v)).toFixed(3);
    // the "?" fills with ink as the help comes and empties as it goes, on this same value (help.css mixes by --on)
    button.style.setProperty('--on', (1 - v).toFixed(3)); button.classList.toggle('is-on', v < 1);
    S.v = v;
  }

  // ------------------------------------------------ pages
  function chrome() {
    dots.forEach((b, j) => { if (j === S.i) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); });
    showDot(clamp(Math.round(S.x), 0, N - 1));
    pages.forEach((p, j) => { p.inert = j !== S.i; });
    live.textContent = S.open ? `Page ${S.i + 1} of ${N}: ${PAGES[S.i].title}` : '';
  }
  /** Glide the strip to page i (from wherever it is: a drag can leave it between pages); its loop starts from the top.
   *  After a swipe (swiped): a spring that starts at the strip's own speed, so the page carries on as the finger or the
   *  trackpad let go of it. A button, a dot or a key: the glide on CURVE. */
  function go(i, swiped = false) {
    i = clamp(i, 0, N - 1); build();
    if (i !== S.i) {
      const now = performance.now(), o = S.i;
      if (P[o]) held[o] = S.freeze ?? S.hold ?? (reduced() ? P[o].rest : (now - S.t0[o]) % P[o].loop); // the page left holds its frame
      if (P[i]) S.t0[i] = now - (held[i] ?? P[i].peek); // the page arriving goes on from the frame it holds
    }
    S.i = i; S.freeze = null; S.hold = null;
    const d = S.x - i;
    S.glide = reduced() ? { from: S.x, to: i, t0: null, ms: T.reduced }
      : swiped ? { spring: true, to: i, d, v0: startSpeed(d, vel()), t0: null }
      : { from: S.x, to: i, t0: null, ms: glideMs(i - S.x) };
    chrome(); kick();
  }

  // ------------------------------------------------ open / close
  function open(at = 0) {
    if (S.open) return;
    S.open = true;
    if (built) make(); else if (P[Number.isInteger(at) ? clamp(at, 0, N - 1) : 0]) build(); // the About (page 1) has no figure: build after the open
    veil.hidden = dlg.hidden = false;
    S.i = Number.isInteger(at) ? clamp(at, 0, N - 1) : 0; S.x = S.i; S.glide = null; S.freeze = null;
    held.length = 0; drawn.length = 0;
    const now = performance.now(); S.t0 = PICS.map((p) => !p ? 0 : now - p.peek + (reduced() ? 0 : T.open * 0.5));
    lay(); chrome();
    for (const el of document.body.children) if (el !== dlg && el !== veil && !el.matches('script')) { el.dataset.helpInert = el.inert ? '1' : ''; el.inert = true; }
    button.setAttribute('aria-expanded', 'true');
    setSheet(1);
    S.sheet = { from: 1, to: 0, t0: null, prime: true, ms: reduced() ? T.reduced : card() ? T.openCard : T.open, done: () => idle(build) };
    dlg.focus({ preventScroll: true });
    guard.key = onKey; guard.down = onDown;
    kick();
  }
  // the figures and their data: built once, in the first quiet moment after the open's slide (the About needs none), or at
  // once when a page with a figure is wanted sooner (a drag, a page turn)
  const idle = (f) => (window.requestIdleCallback ? requestIdleCallback(() => f(), { timeout: 300 }) : setTimeout(f, 50));
  function build() {
    if (built) return;
    built = true; P.forEach((p, i) => p?.build(stages[i]));
    P.forEach((p) => { p?.g?.size(S.scale ?? 1); p?.r?.size(S.scale ?? 1); }); // sharp at once: lay() ran before the canvases existed
    data().then((d) => { D = { ...D, ...d }; drawn.length = 0; kick(); make(); }).catch(() => {});
  }
  // page 2's borders: one year per task (never inside a frame), only while the help is open, and only while nothing moves:
  // a year takes a slow phone tens of ms, which in a swipe, a glide, the open or the close would cost frames. The nearest
  // year made stands in meanwhile
  function make() {
    if (making || !D.makeNext) return;
    making = 1;
    const calm = () => !S.drag && !S.glide && !S.sheet && !wheel;
    const later = (ms) => setTimeout(next, ms);
    function next() { if (window.requestIdleCallback) requestIdleCallback(tick, { timeout: 1000 }); else setTimeout(tick, 16); }
    function tick() {
      if (!S.open || S.closing) { making = 0; return; }
      if (!calm()) { later(150); return; }
      if (D.makeNext()) next(); else making = 0;
    }
    next();
  }
  function close() {
    if (!S.open || S.closing) return;
    S.closing = true;
    button.setAttribute('aria-expanded', 'false'); // as the close starts; the fill empties with the sheet
    const from = S.v ?? 0;
    S.sheet = { from, to: 1, t0: null, ms: reduced() ? T.reduced : (card() ? T.closeCard : T.close) * (1 - from * 0.6), done: finish };
    kick();
  }
  function finish() {
    S.open = false; S.closing = false; S.glide = null; S.drag = null;
    veil.hidden = dlg.hidden = true;
    for (const el of document.body.children) if (el.dataset && 'helpInert' in el.dataset) { el.inert = el.dataset.helpInert === '1'; delete el.dataset.helpInert; }
    button.classList.remove('is-on'); button.style.removeProperty('--on'); // already empty: the last frame set --on 0
    guard.key = guard.down = null;
    live.textContent = '';
    button.focus({ preventScroll: true });
  }

  // ------------------------------------------------ input
  function onKey(e) {
    if (!S.open) return;
    S.swallow = false;
    e.stopImmediatePropagation(); // the app's own keys (the dial's arrows, the game's Esc) wait while the help is open
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = [...dlg.querySelectorAll('button:not(.is-off), .help-page:not([inert]) a')].filter((n) => n.offsetParent);
      const i = f.indexOf(document.activeElement);
      if (i < 0) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); go(S.i + (e.key === 'ArrowRight' ? 1 : -1)); }
  }
  button.addEventListener('click', () => (S.open ? close() : open()));
  $('.help-close').addEventListener('click', close);
  veil.addEventListener('click', close);
  dots.forEach((b, j) => b.addEventListener('click', () => go(j)));
  dlg.addEventListener('dragstart', (e) => e.preventDefault()); // a mouse drag on the photo or a link pages, as anywhere else
  prevB.addEventListener('click', () => go(S.i - 1)); nextB.addEventListener('click', () => go(S.i + 1));
  $('.ha-mail').addEventListener('click', (e) => { e.preventDefault(); location.href = `mailto:${MAIL.join('@')}`; });

  // a press while open: the app hears nothing of it (its click still comes: the veil, ✕ and the dots act on click)
  function onDown(e) {
    if (!S.open) return;
    e.stopImmediatePropagation();
    if (!dlg.contains(e.target)) return;
    // a swipe: sideways the strip follows the finger 1:1 (a rubber band past the ends); down closes the sheet. Axis after 8 px.
    // It may start anywhere in the help, on a button or a link too: a press that becomes a swipe is not a click (swallow)
    S.swallow = false;
    if (e.button > 0 || S.closing) return;
    S.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sx: S.x, axis: null, dx: 0, dy: 0, hist: [[performance.now(), e.clientX, e.clientY]] };
  }
  addEventListener('pointermove', (e) => {
    const g = S.drag; if (!g || g.id !== e.pointerId) return;
    g.dx = e.clientX - g.x0; g.dy = e.clientY - g.y0;
    g.hist.push([performance.now(), e.clientX, e.clientY]); if (g.hist.length > 6) g.hist.shift();
    if (!g.axis && Math.hypot(g.dx, g.dy) > 8) {
      g.axis = Math.abs(g.dx) >= Math.abs(g.dy) * 0.75 ? 'x' : g.dy > 0 && !card() ? 'y' : 'none'; // sideways wins unless clearly down
      if (g.axis !== 'none') { try { dlg.setPointerCapture(e.pointerId); } catch {} S.swallow = true; S.glide = null; g.sx = unrubber(S.x, N); /* caught mid-bounce: picked up where it is */ g.x0 =e.clientX - Math.sign(g.dx) * Math.max(0, Math.abs(g.dx) - 8); g.dx = e.clientX - g.x0; build(); }
    }
    if (g.axis === 'x') {
      S.x = rubber(g.sx - g.dx / S.step, N); place(); kick();
    } else if (g.axis === 'y' && !reduced()) { S.sheet = null; setSheet(Math.max(0, g.dy) / ((S.h || dlg.offsetHeight) + 24)); }
  });
  const endDrag = (e) => {
    const g = S.drag; if (!g || g.id !== e.pointerId) return;
    S.drag = null;
    if (S.swallow) setTimeout(() => { S.swallow = false; }, 50); // the click of this release, if one comes, comes before
    const [t0, x0, y0] = g.hist[0], dt = Math.max(1, performance.now() - t0), vx = (e.clientX - x0) / dt, vy = (e.clientY - y0) / dt;
    if (g.axis === 'x') {
      go(landing(S.x, vx, N), true); // the nearest page, or the next one along a flick, on a spring at the finger's speed
    } else if (g.axis === 'y') {
      if (g.dy > 90 || vy > 0.6) close(); else { S.sheet = { from: S.v, to: 0, t0: null, ms: 300 }; kick(); }
    }
  };
  // 2. moves and releases are heard on the window, not only on the help: a press released outside it (before the strip
  // took the pointer, or an up / down drag on the card, which never takes it) still ends the drag, so nothing stays stuck
  addEventListener('pointerup', endDrag); addEventListener('pointercancel', endDrag);
  addEventListener('blur', () => { if (S.drag) { S.drag = null; if (S.open) go(clamp(Math.round(S.x), 0, N - 1), true); } });
  dlg.addEventListener('click', (e) => { if (S.swallow) { S.swallow = false; e.preventDefault(); e.stopImmediatePropagation(); } }, true);

  // a sideways scroll (two fingers on a trackpad, a tilting or Shift + wheel). One swipe turns one page: the strip follows it
  // 1:1 like a finger (or, during a glide, the swipe only counts) and the page turns as soon as it passes a quarter page,
  // on the spring at the swipe's own speed. After that the swipe coasts: the trackpad's momentum, which runs on for a
  // second after the fingers lift, is let go by. A new swipe ends the coast at once: its deltas rise again after the
  // momentum began to fall, or turn the other way. 140 ms without events: a swipe that turned nothing goes to the page it
  // was heading for (past 15%), else back.
  // Past the first or the last page there is nothing to turn to: the strip gives like a rubber band, and as soon as the
  // fingers lift (the deltas fall three times in a row, below 80% of the swipe's peak: the momentum has begun) it springs
  // back and the rest of the momentum coasts by. Without this the strip stayed pulled out until the momentum ended.
  let wheel = null;
  const QUIET = 140, TURN = 0.25, BACK = 0.15;
  dlg.addEventListener('wheel', (e) => {
    if (!S.open || S.closing || S.drag) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? S.step : 1;
    const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
    if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY * unit)) return; // an up / down scroll is not a page turn
    e.preventDefault();
    const a = Math.abs(dx), sg = Math.sign(dx);
    if (wheel?.coast) {
      if (a < wheel.last) wheel.fell = true;
      if ((!wheel.fell || a <= wheel.last + 6) && sg === wheel.sg) { wheel.last = a; clearTimeout(wheel.t); wheel.t = setTimeout(() => { wheel = null; kick(); }, QUIET); return; }
      clearTimeout(wheel.t); wheel = null; // a new swipe
    }
    if (!wheel) { wheel = { base: S.i, x: S.x, acc: 0, follow: !S.glide, coast: false, t: 0, last: 0, peak: 0, falls: 0 }; if (wheel.follow) view.style.opacity = ''; }
    if (sg === wheel.sg && a < wheel.last - 0.01) wheel.falls++; else if (a > wheel.last + 0.01 || sg !== wheel.sg) wheel.falls = 0;
    wheel.last = a; wheel.sg = sg; wheel.peak = Math.max(wheel.peak, a);
    clearTimeout(wheel.t);
    wheel.acc += dx / S.step;
    const to = wheel.base + Math.sign(wheel.acc), edge = to < 0 || to >= N;
    const coast = () => { wheel.coast = true; wheel.t = setTimeout(() => { wheel = null; kick(); }, QUIET); };
    if (!edge && Math.abs(wheel.acc) > TURN) { go(to, true); coast(); return; }
    if (wheel.follow) { S.glide = null; S.x = rubber(clamp(wheel.x + wheel.acc, wheel.base - 1, wheel.base + 1), N); place(); kick(); }
    if (edge && wheel.falls >= 3 && a < wheel.peak * 0.8) { go(wheel.base, true); coast(); return; } // the fingers lifted: back at once
    wheel.t = setTimeout(() => {
      const w = wheel; wheel = null;
      if (S.open && w.follow) go(Math.abs(w.acc) > BACK && !edge ? w.base + Math.sign(w.acc) : w.base, true);
    }, QUIET);
  }, { passive: false });
  addEventListener('resize', () => { if (S.open) { lay(); kick(); } });

  // tests (?debug, as the game's hooks): open on a page, replay, hold a figure at a time, state
  if (debug) window.__help = {
    open: (i = 0) => open(i), close, go: (i) => go(i),
    replay: () => { S.freeze = null; S.t0[S.i] = performance.now(); kick(); },
    freeze: (t) => { S.freeze = t; kick(); },
    state: () => ({ pt: S.freeze ?? (performance.now() - S.t0[S.i]) % (PICS[S.i]?.loop ?? 1), open: S.open, i: S.i, x: S.x, n: N, mode: S.mode, side: S.side, scale: S.scale, v: S.v, dataReady: !!D.world, made: D.made?.size ?? 0, drag: !!S.drag, wheel: !!wheel, glide: !!S.glide }),
  };
  return { open, close, isOpen: () => S.open };
}

/** The figures' data: the base map, each year's borders (made when first needed), the three questions' own pictures. */
export function helpData({ world, scenes, bundle, optionsFor }) {
  const out = { world: { land: topojson.feature(world, world.objects.land), borders: topojson.mesh(world, world.objects.countries, (a, b) => a !== b) } };
  if (!scenes) return out;
  // a year's borders (CShapes on 1 July), made by makeNext() one year per call (help.js calls it once per task while the
  // help is open): the two years the other figures need first, then the loop's years in order; until a year is made, the
  // nearest one made stands in
  const made = new Map(), order = borderOrder();
  out.made = made;
  out.makeNext = () => { const y = order.shift(); if (y == null) return false; made.set(y, scenes.worldAt(y + 0.5).borders); return order.length > 0; };
  out.bordersAt = (y) => nearestMade(made, y);
  const Q = [['germany-borders', 'divided', 'yes'], ['brazil-capital', 'brasilia', 'yes'], ['british-east-africa', 'independent', 'no']];
  out.questions = Q.map(([id, state, reply]) => {
    const f = bundle?.features.find((x) => x.id === id);
    const opt = f && optionsFor(f, 'en').find((o) => o.members.some((m) => f.states[m.state].id === state));
    return opt ? { subject: f.subject, question: f.states[opt.members[0].state].question, camera: f.camera, scene: scenes.sceneFor(f, opt, 'en'), reply } : null;
  }).filter(Boolean);
  return out;
}
