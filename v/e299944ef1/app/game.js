// "Guess the year": a globe from a year the app picks, five guesses to say which (rules: game-logic.js).
//
// One screen on every device, built from the quiz's own pieces: the gold tag and the question line, the globe in
// its lens, the result's year, the timeline's bar and its ✓ / ✗, the primary button. The pieces are placed by this
// file (as quiz-layout.js places the quiz on phones), so one clock moves them together:
//   phones           tag and title, the globe as large as the column allows, the year over the dial, Guess
//   upright tablets  the same column, wider (the tablet quiz column)
//   laptops, a phone on its side   the globe left, the words, year, dial and Guess right (the quiz's two columns)
//
// A guess's hint: the clue's subject and claim, and under the claim what it means for the year ("This means after 2008",
// "… between 1920 and 1950" once the guesses close both sides).
// A miss leaves its year on the dial, with the way to go beside it ("← Earlier than 2012").
//
// The end turns the screen into the result, on the same clock: the dial runs to the year and lands in brass, then
// the dial becomes the chart's axis. Where neighbouring years share one globe (game.lo–hi), the answer is that group:
// a right guess keeps the dial where it is, the year rolls to the group's first year and its rest opens beside it as
// it turns brass ("1977" + "–78"), and the labels say "Why 1977–78" and "The world in 1977–78". Over it, one timeline at a time under its gold label:
//   Your guesses   a row per guess: its tick and year, its ✓ / ✗, and the bar of the hint that guess earned
//   Why 1991       the clues that pin the year (knownHints, as edges) and the changes around it (nearbyClues), each
//                  with the year of its change beside its bar
// The circled (i) at the label's right end switches between them on one curve: the label and rows slide over, the
// axis moves to the new timeline's length and rescales to its years, the column follows, the story rides on the axis.
// Every row shows (the rows never scroll); the chosen row's story reads under the axis, fitted to its room
// (storyHeights / fitStory). The last guess arrives chosen, with "The world in 1991". The globe settles beside the
// verdict (phones, tablets, a phone on its side) or stays where it is (laptops), and can still be turned and zoomed.
// On an upright phone a tap on that small globe grows it, as wide as the column allows while every row and the axis
// still show: the verdict and the year go under it, the timeline moves down into the story's room and the story closes.
// A tap on the big globe (once the double tap's 320 ms have passed) or on the paper around it puts it back; a row's
// tap also chooses that row. One curve; resLayout's `big`, growAt / setBig.
//
// A friend's globe (?d=, start({ custom })): the globe the sender dated, rebuilt from their answers (custom-globe.js
// composes its borders, names, cities and layers; its game has the sender's answers as first hints and its own winning
// years). It is drawn and played with exactly this screen; only "Why 1991" becomes the sender's answers (CUSTOM).
//
//   createGame({ host, globe, topbar, load, endYear, onAgain, onInvalid }) -> { start({ year, seed, again, friend, custom }), stop(), isOn() }
//   onInvalid: a friend's globe's link that can't be read (app.js opens the landing with a notice)
//   onAgain: "Play again" on the result (app.js takes the player back to the landing page)

import { odometerHTML, setOdometer } from './odometer.js';
import { layout, isPage, onLayout } from './viewport.js';
import { markBusy } from './quiet.js';
import { medallionSlot } from './quiz-layout.js';
import { createShareModal } from './share-modal.js';
import { WORDS as SHARE, scoreMessage, gameLink, datedLink } from './share-logic.js';
import * as R from './game-logic.js';
import { createCustomGlobe, customGame, readLink } from './custom-globe.js';

const WORDS = {
  tag: 'Guess the year', question: 'When was this globe made?', guess: 'Guess', again: 'Play again', share: 'Share',
  earlier: (g) => `← Earlier than ${g}`, later: (g) => `Later than ${g} →`,
  guessN: (k) => `Guess ${k}`, world: (y) => `The world in ${y}`,
  // the result's two gold labels; the (i) at the line's right end switches to the second (still the user's call:
  // "Why 1991" or today's "How you could have known")
  guesses: 'Your guesses', why: (y) => `Why ${y}`,
};
// A friend who opened a dated globe sent as a game (?d=): the tag says whose globe it is, and the last button leads to
// dating their own. A shared game (?g=, from a game's score) plays as any game: no friend words
const FRIEND = { tag: 'A friend’s globe', again: 'Date your own globe' };
// The sender's own globe (custom-globe.js): the result's second timeline is all their answers, as the dating result draws
// them; past ROWS_MAX rows it scrolls in its own box (the other timelines never have more)
const CUSTOM = { why: () => 'Your friend’s globe', yes: 'Yes', no: 'No' };
const ROWS_MAX = 5;
const LEANS = /^(It|Its|They|There|This|The country|The region)\b/;
const START_YEAR = 1950;
// the globe's zoom steps: one unit is 1.55×; a double tap is 2×. ZMAX is the globe's own cap (globe.js flyTo), the deepest a
// hint's camera goes: a smaller one made the first pinch after a deep hint (49 of the clues fly in past 6) snap the view out
const ZMIN = 1, ZMAX = 8, STEP = Math.log(2) / Math.log(1.55);
const MARK = { yes: 'M-3.4,0.2L-1.1,2.6L3.5,-2.8', no: 'M-2.8,-2.8L2.8,2.8M-2.8,2.8L2.8,-2.8' }; // the timeline's ✓ and ✗
const SHARE_ICON = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2v9.5M5.8 5 9 1.9 12.2 5M6.5 7.5H4.5v8.5h9V7.5h-2"/></svg>'; // the quiz result's
// The end, in ms after the last guess: the words fade (0–180), the dial runs to the year (400–1600) and turns brass
// (500–900); the screen becomes the result (the move m0–m1, on the keyboard curve) and the verdict comes in. Then the
// brass column rises from the axis, the gold label comes in (6 px), the guesses drop in one by one (6 px), each ✓ / ✗
// pops and each hint's bar grows out of the answer. From the last bar's end (doneAt): the last guess is chosen (the
// others settle at 35%), its story and the (i) come in, then the buttons. switch: the (i)'s move between the timelines;
// pick / dim: choosing a row (the story's cross-fade, the others' dimming); reduced: every move as a cross-fade.
// grow: the result's globe growing on a phone, or going back (the story out over its first 40%, in over its last 40%;
// the verdict and the year out over the first 25% and in, at their new place, over the last 35%).
const T = { m0: 1700, m1: 2140, column: [2140, 2620], head: [2080, 2320], row0: 2200, rowStep: 130, mark: 220, bar: 420,
  switch: 420, pick: 260, dim: 200, reduced: 200, grow: 420 };
// what a story can do without, in turn: its then-line, its source, then (last) its date line (its kicker has the years)
const VARIANTS = [{ then: 1, src: 1, when: 1, text: 1 }, { then: 1, src: 0, when: 1, text: 1 }, { then: 0, src: 1, when: 1, text: 1 }, { then: 0, src: 0, when: 1, text: 1 }, { then: 0, src: 0, when: 0, text: 1 }];
// "The world in 1991" is a title and one paragraph: it only ever gives up type size
const WORLD = VARIANTS.map(() => ({ then: 1, src: 0, when: 0, text: 0 }));
// the order the variants are tried in: every font with the first three, then every font with the fourth, then the last
const LEVEL = [0, 0, 0, 1, 2];
const variantsOf = (p) => (p.world ? WORLD : VARIANTS);
const MIN_FONT = 12.5, MIN_FONT_TINY = 12;
const PX0 = 24; // the plot inside a rows' box: the ✓ / ✗ at 10, the track and the bars from 24 to the box's right end

/** A friend's globe's game seed, from its link: the same link plays the same hints. */
const codeSeed = (code) => { let h = 0x811c9dc5; for (const ch of code) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0; return h; };

function bezier(x1, y1, x2, y2) {
  const B = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t) => { if (t <= 0) return 0; if (t >= 1) return 1; let lo = 0, hi = 1, s = t; for (let i = 0; i < 24; i++) { if (B(x1, x2, s) < t) lo = s; else hi = s; s = (lo + hi) / 2; } return B(y1, y2, s); };
}
const CURVE = bezier(0.2, 0.8, 0.2, 1);   // the keyboard curve: every spatial move
const EASE = bezier(0.25, 0.1, 0.25, 1);  // text fades, with a 6 px rise
const mix = (a, b, e) => a + (b - a) * e;
const mixBox = (a, b, e) => ({ x: mix(a.x, b.x, e), y: mix(a.y, b.y, e), d: mix(a.d, b.d, e) });
const band = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rollEase = (t) => 1 - Math.pow(1 - t, 4);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export function createGame({ host, globe, topbar, load, endYear, onAgain, onInvalid = () => {}, debug = false }) {
  host.innerHTML = `
    <p class="q-context g-tag"></p><p class="q-context g-tag"></p>
    <svg class="g-marks" aria-hidden="true"></svg>
    <h2 class="q-title g-title" aria-live="polite"></h2><h2 class="q-title g-title" aria-hidden="true"></h2>
    <p class="a-kicker g-why"></p><p class="a-kicker g-why" aria-hidden="true"></p>
    <p class="a-kicker g-verdict" aria-live="polite"></p>
    <svg class="g-chart" aria-hidden="true"></svg>
    <div class="g-paper" aria-hidden="true"></div>
    <p class="q-context g-head" aria-hidden="true">${WORDS.guesses}</p><p class="q-context g-head" aria-hidden="true"></p>
    <button class="vd-info-btn g-info" type="button" aria-pressed="false"><span aria-hidden="true">i</span></button>
    <div class="g-rows" role="radiogroup" aria-label="${WORDS.guesses}"><div class="g-rows-in"></div></div>
    <div class="g-rows" role="radiogroup"><div class="g-rows-in"></div></div>
    <div class="g-story" aria-live="polite"></div>
    <div class="g-story g-measure" aria-hidden="true"></div>
    <div class="g-hit" tabindex="0" role="application" aria-label="The globe. Drag to turn it, pinch or scroll to zoom, double tap to step in."></div>
    <div class="vd-years g-year">${odometerHTML(START_YEAR)}<span class="g-year-rest" aria-hidden="true"><span></span></span></div>
    <svg class="g-dial" aria-hidden="true"></svg>
    <div class="g-dial-hit" tabindex="0" role="slider" aria-label="Year"></div>
    <button class="btn-share g-share" type="button">${SHARE_ICON}<span>${WORDS.share}</span></button>
    <button class="btn g-guess" type="button">${WORDS.guess}</button>`;
  const $ = (s) => host.querySelector(s), $$ = (s) => [...host.querySelectorAll(s)];
  const el = { tags: $$('.g-tag'), titles: $$('.g-title'), whys: $$('.g-why'), verdict: $('.g-verdict'), marks: $('.g-marks'), hit: $('.g-hit'),
    year: $('.g-year'), odo: $('.g-year .odo'), rest: $('.g-year-rest'), restIn: $('.g-year-rest > span'), dial: $('.g-dial'), dialHit: $('.g-dial-hit'), guess: $('.g-guess'), share: $('.g-share'),
    chart: $('.g-chart'), paper: $('.g-paper'), story: $('.g-story:not(.g-measure)'), measureBox: $('.g-measure'), info: $('.g-info'),
    // the result's two timelines, g (your guesses) and k (why that year): a gold label and a box of rows each
    heads: { g: $$('.g-head')[0], k: $$('.g-head')[1] }, rows: { g: $$('.g-rows')[0], k: $$('.g-rows')[1] }, rowsIn: { g: $$('.g-rows-in')[0], k: $$('.g-rows-in')[1] } };
  const VIEWS = ['g', 'k'];
  // Share: the dating result's share modal with one page of the game's own: the score message (share-logic.js)
  // While it is open the game under the veil draws nothing (its frame loop and the globe stop; they go on as it leaves)
  const sharer = createShareModal({ debug, name: '__gameShare', hold: (h) => {
    globe.hold(h); held = h;
    if (!h && on) { cancelAnimationFrame(raf); lastT = now(); raf = requestAnimationFrame(loop); }
  } });
  const canvas = document.getElementById('globe');
  let on = false, raf = 0, run = 0, held = false;
  let D = null;      // the data: { bundle, scenes, names, optionsFor }
  let G = null;      // where the pieces stand (place())
  let S = null;      // the game on screen
  const now = () => performance.now();
  // the dial's words are measured once, in their own font
  const measure = (() => { let c = null; return (text) => { c ??= document.createElement('canvas').getContext('2d'); c.font = `600 12px ${getComputedStyle(document.documentElement).getPropertyValue('--sans')}`; return c.measureText(text).width; }; })();

  // ------------------------------------------------------------------ where everything stands
  function place() {
    const W = innerWidth, H = innerHeight, cs = getComputedStyle(document.body);
    const sb = parseFloat(cs.paddingBottom) || 0, sl = parseFloat(cs.paddingLeft) || 0, sr = parseFloat(cs.paddingRight) || 0;
    const top = topbar.getBoundingClientRect().bottom, lay = layout(), page = isPage(), phone = lay.kind === 'stacked' && lay.compact;
    // the smallest phones (narrower than 360): the result's type one step smaller, with 16 px sides (style.css .g-tiny)
    const tiny = phone && W < 360;
    host.classList.toggle('g-tiny', tiny);
    for (const n of [...el.tags, ...el.titles, ...el.whys, el.verdict]) if (!n.textContent) n.textContent = ' ';
    el.year.style.fontSize = ''; // measured at the play screen's size; the result's may be smaller (render mixes them)
    const tagH = el.tags[0].offsetHeight || 17, LH = parseFloat(getComputedStyle(el.titles[0]).lineHeight) || 30, yearH = el.year.offsetHeight || 50;
    const whyH = el.whys[0].offsetHeight || 18; // the line under a hint's claim: why the guess was wrong
    const yearFont = parseFloat(getComputedStyle(el.year).fontSize) || 48, resYearFont = tiny ? 38 : yearFont, yearW = el.year.offsetWidth || 110;
    const g = { W, H, top, sb, sl, sr, phone, tiny, kind: lay.kind, tagH, LH, yearH, whyH, compact: lay.compact, page,
      yearFont, resYearFont, resYearH: (yearH * resYearFont) / yearFont, resYearW: (yearW * resYearFont) / yearFont, kickH: el.verdict.offsetHeight || 18, iw: el.info.offsetWidth || 22 };
    if (lay.kind === 'stacked') {
      // one column: the quiz stage's lines on a phone, the tablet's 680 column on an upright tablet. On a phone the globe
      // takes all the height the words, the dial and Guess leave, up to the column's width
      const side = page ? Math.max(48, 0.085 * W) : 20, cw = page ? Math.min(680, W - 2 * side) : W - 40, x0 = (W - cw) / 2;
      const tagY = top + (page ? 28 : H >= 700 ? 14 : H >= 600 ? 12 : 10), titleY = tagY + tagH + (page ? 10 : 6), titleBottom = titleY + 2 * LH + whyH;
      const btnH = H <= 600 ? 47 : 54, btnW = page ? Math.min(cw, 320) : cw, btnY = H - sb - (page ? 40 : 10) - btnH;
      const group = yearH + 28 + 27, minGap = page ? 32 : H >= 800 ? 22 : 16;
      const d = Math.max(120, Math.min(page ? Math.round(cw * 0.8) : W - 24, Math.floor(btnY - titleBottom - group - 3 * minGap)));
      const gap = (btnY - titleBottom - d - group) / 3, lensY = titleBottom + gap, yearTop = lensY + d + gap;
      Object.assign(g, { x0, cw, tagY, titleY, lens: { x: (W - d) / 2, y: lensY, d },
        yearX: W / 2, yearTop, dial: { x0: page ? x0 : 0, x1: page ? x0 + cw : W, y: yearTop + yearH + 28 }, btn: { x: (W - btnW) / 2, y: btnY, w: btnW, h: btnH }, gap });
    } else {
      // two columns, as the quiz: the globe left, the words and the dial right
      const short = lay.kind === 'short', padX = short ? 20 : 56, gapX = short ? 28 : 56, padB = short ? 8 : 40;
      const L = sl + padX, Rt = W - sr - padX, areaH = H - top - sb - padB, lw = (Rt - L - gapX) * (1.15 / 2.15);
      const d = Math.max(140, Math.floor(Math.min(lw, areaH - (short ? 0 : 16), 720)));
      const rx = L + lw + gapX, rw = Math.min(460, Rt - rx), btnH = short ? 44 : 46;
      const gA = short ? 6 : 18, gB = short ? 8 : 30, gC = short ? 10 : 34;
      const block = tagH + gA + 2 * LH + whyH + gB + yearH + 28 + 27 + gC + btnH, tagY = top + Math.max(0, (areaH - block) / 2);
      const titleY = tagY + tagH + gA, yearTop = titleY + 2 * LH + whyH + gB, dialY = yearTop + yearH + 28;
      const lens = { x: L + (lw - d) / 2, y: top + (areaH - d) / 2, d };
      Object.assign(g, { x0: rx, cw: rw, tagY, titleY, lens, yearX: rx + rw / 2, yearTop, dial: { x0: rx, x1: rx + rw, y: dialY }, btn: { x: rx, y: dialY + 27 + gC, w: null, h: btnH }, gap: gB, areaH, short });
    }
    g.ppy = clamp((g.dial.x1 - g.dial.x0) / 44, 7.2, 9.5); // the dial: about 44 years across
    el.marks.setAttribute('width', 80); el.marks.setAttribute('height', 16);
    g.marksAt = { x: g.x0 + g.cw - 80, y: g.tagY + g.tagH / 2 - 8, follow: 1 };
    G = g;
    g.res = S?.phase === 'reveal' && S.views ? chooseLayout(g) : null;
    if (S && !g.res?.big) { S.big = false; S.grow = null; } // no room to grow here (a phone turned on its side, a tablet)
    // the pieces that never move
    // The guesses' marks: at the gold tag line's right end on every layout (the top bar's right end holds the "?"). On
    // phones (upright or on their side) a long tag wraps in the room left of them; on a phone's result they fade with the move
    for (const n of el.tags) Object.assign(n.style, { left: `${g.x0}px`, width: g.compact ? `${g.cw - 96}px` : '', maxWidth: g.compact ? '' : `${g.cw - 96}px`, whiteSpace: g.compact ? 'normal' : 'nowrap' });
    for (const n of [...el.titles, ...el.whys]) Object.assign(n.style, { left: `${g.x0}px`, width: `${g.cw}px` });
    Object.assign(el.dial.style, { left: `${g.dial.x0}px`, top: `${g.dial.y - 30}px` });
    el.dial.setAttribute('width', g.dial.x1 - g.dial.x0); el.dial.setAttribute('height', 64);
    Object.assign(el.dialHit.style, { left: `${g.dial.x0}px`, top: `${g.dial.y - 26}px`, width: `${g.dial.x1 - g.dial.x0}px`, height: '62px' });
    Object.assign(el.chart.style, { left: '0px', top: '0px' });
    el.chart.setAttribute('width', W); el.chart.setAttribute('height', H);
    tagHeights.clear(); titleHeights.clear();
    last = {};
    if (g.res) layRows();
  }

  // ---- the result's places, fitted to its stories
  /**
   * How tall each story of both timelines is, at each font size and with each part it can do without, in a box of
   * this width (measured once per game and width): { base, fonts, g: [row][variant][font], k: … } in px.
   */
  function storyHeights(width) {
    const key = `${width}|${G.tiny}`;
    if (S.heights?.key === key) return S.heights;
    const box = el.measureBox; box.style.width = `${width}px`;
    box.innerHTML = '<p class="a-story">x</p>';
    const base = parseFloat(getComputedStyle(box.firstChild).fontSize) || 15.5, least = G.tiny ? MIN_FONT_TINY : MIN_FONT;
    const fonts = []; for (let f = base; f >= least - 1e-6; f -= 0.5) fonts.push(+f.toFixed(1));
    const table = (v) => S.views[v].map((r) => variantsOf(r.parts).map((vv) => fonts.map((f) => { box.innerHTML = storyHTML(r.parts, vv, f); return box.scrollHeight; })));
    box.innerHTML = '';
    return (S.heights = { key, base, least, fonts, g: table('g'), k: table('k') });
  }
  /** Row i's story in h px: the largest font and the most parts it can keep, the variants tried in their passes (LEVEL). */
  function fitStory(v, i, h) {
    const Hs = S.heights, t = Hs[v][i], F = Hs.fonts, p = S.views[v][i].parts, vs = variantsOf(p);
    for (const lv of [0, 1, 2]) for (let fi = 0; fi < F.length; fi++) for (let vi = 0; vi < vs.length; vi++) if (LEVEL[vi] === lv && t[vi][fi] <= h) return storyHTML(p, vs[vi], F[fi]);
    return storyHTML(p, vs[vs.length - 1], F[F.length - 1]); // still too tall: the story box scrolls (the rows never do)
  }
  /** The tallest story of a timeline, whole and at its size. */
  const needOf = (v) => Math.max(0, ...S.heights[v].map((t) => t[0][0]));
  /** The story's column: its width doesn't depend on the rows' height. */
  function resColumn(g) {
    if (g.kind === 'stacked') { const side = g.page ? Math.max(48, 0.085 * g.W) : g.tiny ? 16 : 20, cw = g.page ? Math.min(680, g.W - 2 * side) : g.W - 2 * side; return { x0: (g.W - cw) / 2, cw }; }
    if (g.kind === 'short') { const s = shortCols(g); return { x0: s.rx, cw: s.rw }; }
    return { x0: g.x0, cw: g.cw };
  }
  /** A phone on its side: the left column no wider than the globe (which the height limits) and the two buttons need. */
  function shortCols(g) {
    const btnH = g.btn.h, btnY = g.H - g.sb - 8 - btnH, yearTop = btnY - 10 - g.resYearH, kickY = yearTop - 2 - g.kickH, tall = kickY - 6 - (g.top + 4);
    const Lx = g.sl + 20, total = g.W - g.sl - g.sr - 40, lw = Math.max(250, Math.min(Math.round(total * 0.36), tall + 24)), rx = Lx + lw + 24;
    return { btnH, btnY, yearTop, kickY, tall, Lx, lw, rx, rw: g.W - g.sr - 20 - rx };
  }
  /**
   * The result's places with rows P px tall. A column (phones, upright tablets): the globe at the quiz result's medallion
   * place (on a tablet as large as the longer timeline and the longest story leave) with the verdict and the year beside
   * it, the gold label and its (i), the rows, the axis 4 px under the last row, the story, the buttons. A phone on its
   * side: the globe, verdict, year and buttons left; the label, rows, axis and story right. Laptops and tablets on their
   * side: the globe stays; the right column's block is centred for the longer timeline and the buttons stay put, so a
   * switch moves nothing above the axis or under the story. views[v]: each timeline's own height, axis and story room.
   */
  function resLayout(g, P) {
    const { W, H, sb, top, kickH } = g, yearH = g.resYearH, n = { g: Math.min(ROWS_MAX, S.views.g.length), k: Math.min(ROWS_MAX, S.views.k.length) }, nMax = Math.max(n.g, n.k);
    const HEAD = g.page ? 32 : g.kind === 'wide' || g.tiny ? 28 : 30, out = { P, HEAD, views: {} };
    if (g.kind === 'stacked') {
      const phone = g.compact, page = !phone, tiny = g.tiny, low = phone && H <= 600, { x0, cw } = resColumn(g), slot = medallionSlot(W, H);
      const btnH = tiny ? 44 : g.btn.h, btnY = H - sb - (page ? 40 : 10) - btnH, storyBottom = btnY - (page ? 28 : tiny ? 14 : low ? 12 : 16);
      const my = top + (page ? 28 : slot.qY), textH = kickH + 2 + yearH;
      const gapA = page ? 36 : H >= 800 ? 26 : H >= 640 ? 18 : tiny ? 12 : 8, AX = tiny ? 30 : low ? 28 : 32;
      const geo = (med) => { const ty = my + (med - textH) / 2, headY = Math.max(my + med, ty + textH) + gapA; return { ty, headY, rowsTop: headY + HEAD }; };
      let med = phone ? (tiny && H < 640 ? 76 : slot.med) : 200;
      if (page) { // a tablet: the globe grows into what the longer timeline and the longest story leave
        const need = Math.max(needOf('g'), needOf('k'));
        med = clamp(Math.floor(storyBottom - need - (geo(0).rowsTop + nMax * P + 4 + AX - my)), 180, Math.min(Math.round(cw * 0.55), 420));
      }
      const L = geo(med), tx = x0 + med + (phone ? 12 : 28), half = (cw - 10) / 2;
      Object.assign(out, { mode: 'column', lens: { x: x0 - 8, y: my - 8, d: med + 16 }, dy: 0, kick: { x: tx, y: L.ty, w: x0 + cw - tx, align: 'left' }, year: { x: tx + g.resYearW / 2, y: L.ty + kickH + 2 },
        head: { x: x0, y: L.headY, w: cw }, rows: { x: x0 - 6, w: cw + 6, top: L.rowsTop }, story: { x: x0, w: cw, bottom: storyBottom }, AX, btnY, btnH, gapA,
        ...(phone ? { share: { x: x0, w: half }, again: { x: x0 + half + 10, w: half } } : { share: { x: W / 2 - 206, w: 200 }, again: { x: W / 2 + 6, w: 200 } }) });
      if (phone) {
        // The globe, tapped: as wide as the column allows while the longer timeline's rows and its axis still show above the
        // buttons (the axis's years end where the story's room ended). Rows keep their height; the globe's top stays; the
        // verdict and the year go under it, centred; the label, the rows and the axis move down by dy.
        const axisB = storyBottom - AX + 6, headB = axisB - 4 - nMax * P - HEAD, gG = H >= 800 ? 14 : 10;
        let tyB = headB - gapA - textH, dB = Math.floor(tyB - gG - my);
        if (dB > cw) { dB = cw; tyB = my + dB + gG; } // the column is the limit: the words and the timeline stay under it
        const dy = Math.min(headB, tyB + textH + gapA) - L.headY;
        if (dB >= med + 24 && dy > 0) out.big = { lens: { x: x0 + (cw - dB) / 2 - 8, y: my - 8, d: dB + 16 }, kick: { x: x0, y: tyB, w: cw, align: 'center' }, year: { x: x0 + cw / 2, y: tyB + kickH + 2 }, dy, textH };
      }
    } else if (g.kind === 'short') {
      const s = shortCols(g), d = Math.max(90, Math.min(s.lw, s.tall)), half = (s.lw - 10) / 2;
      Object.assign(out, { mode: 'short', lens: { x: s.Lx + (s.lw - d) / 2, y: s.kickY - 6 - d, d }, dy: 0, kick: { x: s.Lx, y: s.kickY, w: s.lw, align: 'center' }, year: { x: s.Lx + s.lw / 2, y: s.yearTop },
        head: { x: s.rx, y: top + 2, w: s.rw }, rows: { x: s.rx - 6, w: s.rw + 6, top: top + 2 + HEAD }, story: { x: s.rx, w: s.rw, bottom: H - sb - 8 }, AX: 30, btnY: s.btnY, btnH: s.btnH,
        share: { x: s.Lx, w: half }, again: { x: s.Lx + half + 10, w: half } });
    } else {
      const rx = g.x0, rw = g.cw, gA = 18, gB = 20, gC = 26, AX = 32, btnH = g.btn.h;
      const head = g.tagH + gA + g.LH + 4 + yearH + gB, below = (k) => nMax * P + 4 + AX + k + gC + btnH;
      const room = g.areaH - head - HEAD - below(0), block = head + HEAD + below(Math.max(40, Math.min(Math.max(needOf('g'), needOf('k')), room)));
      const tagY = top + Math.max(0, (g.areaH - block) / 2), btnY = tagY + block - btnH, yearTop = tagY + g.tagH + gA + g.LH + 4;
      Object.assign(out, { mode: 'split', lens: g.lens, dy: tagY - g.tagY, kick: null, year: { x: rx + g.resYearW / 2, y: yearTop },
        head: { x: rx, y: tagY + head, w: rw }, rows: { x: rx - 6, w: rw + 6, top: tagY + head + HEAD }, story: { x: rx, w: rw, bottom: btnY - gC }, AX, btnY, btnH,
        again: { x: rx, w: null }, share: { x: null, w: null } });
    }
    for (const v of VIEWS) { const h = n[v] * P, axisY = out.rows.top + h + 4; out.views[v] = { rowsH: h, axisY, storyTop: axisY + out.AX, storyH: out.story.bottom - axisY - out.AX }; }
    return out;
  }
  /**
   * The rows' height: the app's, while every story of both timelines fits under its axis at a font at most 1, then 3 px
   * under its size; only then do the rows close up (to 20 px on a phone, 15 on its side, else 6 px under the app's),
   * then the stories go down to the smallest font, then they give up their last parts. Both timelines share it.
   */
  function chooseLayout(g) {
    const PMAX = g.phone ? (g.H >= 800 ? 28 : g.H >= 640 ? 26 : 23) : g.page ? 32 : g.kind === 'short' ? 17 : 28;
    const PMIN = g.phone ? 20 : g.kind === 'short' ? 15 : PMAX - 6;
    const Hs = storyHeights(resColumn(g).cw);
    const fits = (Lt, drop, lv) => VIEWS.every((v) => { const h = Lt.views[v].storyH;
      return Hs[v].every((t) => t.some((vv, vi) => LEVEL[vi] <= lv && vv.some((x, fi) => x <= h && Hs.fonts[fi] >= Hs.base - drop))); });
    const Ps = []; for (let p = PMAX; p >= PMIN; p--) Ps.push(p);
    const MIN = Hs.base - Hs.least;
    for (const [drop, lv, list] of [[1, 0, [PMAX]], [3, 0, [PMAX]], [3, 0, Ps], [MIN, 0, Ps], [MIN, 1, Ps], [MIN, 2, Ps]]) for (const p of list) { const Lt = resLayout(g, p); if (fits(Lt, drop, lv)) return Lt; }
    return resLayout(g, PMIN); // a story that still doesn't fit scrolls in its own box
  }

  // ------------------------------------------------------------------ the game on screen
  function fresh() {
    return { game: null, hist: [], phase: 'load', t0: 0, arriving: false, v: START_YEAR, anim: null, drag: null, world: null, answer: null,
      own: false, home: null, ptrs: new Map(), grab: null, pinch: null, coast: null, zoom: null, lastTap: null,
      hopped: true, settled: true, idleAt: 0, period: null, lensFrom: null, lz: null, rowScenes: null, rowCam: null,
      // the result: its two timelines (views.g, views.k: rows), the one on screen, each one's chosen row and whether it was
      // chosen (picked), the others' dimming as it eases (dim), the switch's move (sw), the story's cross-fade (swap)
      views: null, span: null, heights: null, view: 'g', sel: { g: 0, k: 0 }, picked: { g: false, k: false }, dim: { g: null, k: null }, sw: null, swap: null, storyKey: null,
      // the result's globe on a phone: big or not, and its move (growAt)
      big: false, grow: null,
      // a friend's globe (custom-globe.js compose) and its link, else null
      custom: null, code: null };
  }
  const clueOf = (k) => (k >= 1 ? S.hist[k - 1]?.next ?? null : null);   // the hint guess k + 1 shows (the miss before it chose it)
  let words = WORDS; // this game's: WORDS, or a friend's (start)
  let lookText0 = { tag: words.tag, title: WORDS.question, why: null };
  function lookText(k) {
    const c = clueOf(k);
    return c ? { tag: c.feature.subject, title: c.option.claim, why: R.clueWhy(c, S.hist[k - 1].g, S.hist.slice(0, k)) } : lookText0;
  }
  /**
   * A clue drawn into the globe's year (the quiz's picture, sceneFor with { at }); its country labels say what this globe
   * prints for that year (R.periodLabel), so a clue never names a country otherwise than the globe does.
   */
  function clueScene(c) {
    if (S.custom) return customScene(c);
    // (a dam's lake: only what the game's globe draws, the lake or nothing; R.AS_SEEN)
    const t = S.game.year + 0.5, sc = R.sceneAsSeen(c.feature.id, D.scenes.sceneFor(c.feature, c.option, 'en', { at: t }));
    // the globe's own layer stays under the clue (the clue's own feature draws itself)
    sc.overlays = [...R.layersAt(D.bundle, t, c.feature.id).overlays, ...sc.overlays];
    sc.labels = sc.labels.map((l) => {
      if (l.kind !== 'country') return l;
      const u = D.scenes.territoryAt(l.at, t);
      // on land no territory covers, the name the globe prints there ("Egyptian Sudan (Mahdist)"; globeFits keeps out a
      // clue whose label names anything else)
      if (!u) { const r = R.regionAt(D.names, l.at, t); return r && R.namesRegion(r, l.text) ? { ...l, text: R.regionText(r) } : l; }
      const text = R.periodLabel(D.names, u.g, D.scenes.namesOf(u.g), u.n, l.text, t);
      return text ? { ...l, text } : l;
    });
    return sc;
  }
  /**
   * A friend's globe: the clue drawn into it, from the date its region comes from; its countries as the globe draws them
   * (one shape for a group), the globe's borders and layer under it, its country labels as the globe prints them there.
   */
  function customScene(c) {
    const C = S.custom, sc = R.sceneAsSeen(c.feature.id, D.scenes.sceneFor(c.feature, c.option, 'en', { at: C.dateOfClue(c) }));
    const hl = R.AS_SEEN[c.feature.id] ? null : C.highlightOf(c.feature.id);
    if (hl) { sc.highlight = hl; sc.outlines = hl.length > 1 ? hl : []; }
    sc.borders = C.world.borders;
    sc.overlays = [...C.layer.overlays.filter((o) => o.feature !== c.feature.id), ...sc.overlays];
    // a label that names the territory it stands on says what this globe prints there; a region's own name ("Newfoundland"
    // on a globe where it is part of Canada) keeps the clue's words, as in every game (R.periodLabel)
    sc.labels = sc.labels.map((l) => {
      if (l.kind !== 'country') return l;
      const d = C.dateAt(l.at), u = D.scenes.territoryAt(l.at, d);
      if (!u) { const r = R.regionAt(D.names, l.at, d); return r && R.namesRegion(r, l.text) ? { ...l, text: R.regionText(r) } : l; }
      return u && R.periodLabel(D.names, u.g, D.scenes.namesOf(u.g), u.n, l.text, d) != null ? { ...l, text: C.printedAt(l.at) ?? l.text } : l;
    });
    return sc;
  }
  const clueCamera = (k) => { const c = clueOf(k); if (!c) return { lon: globe.camera().lon, lat: 15, zoom: 1 }; const m = c.feature.camera; return { lon: m.lon, lat: m.lat, zoom: Math.min(m.zoom, 8) }; };
  const liveBounds = () => (S.hist.length ? R.bounds(S.hist[S.hist.length - 1].s2) : R.bounds(S.game.full));
  const elapsed = () => now() - S.t0;
  function curV() {
    if (S.arriving) { const t = elapsed(); if (t > 1700 || reduced()) { S.arriving = false; S.v = START_YEAR; } else return START_YEAR + 30 * (1 - CURVE(band(t, 450, 1650))); }
    if (S.anim) { const A = S.anim, k = band(now() - A.t0 - (A.delay ?? 0), 0, A.dur), v = mix(A.from, A.to, (A.ease ?? CURVE)(k)); if (k >= 1) { S.v = A.to; S.anim = null; } return v; }
    return S.v;
  }
  function settleDial() { S.v = curV(); S.arriving = false; S.anim = null; }

  // ---- the globe in the hand
  /** The first touch of a guess: the camera is the player's from here; where it was is "home" (key 0). */
  function own() {
    if (S.own) return;
    const c = globe.camera();
    S.own = true; S.home = S.phase === 'play' && S.hist.length ? clueCamera(S.hist.length) : S.phase === 'reveal' ? S.rowCam ?? { lon: c.lon, lat: 15, zoom: 1 } : { ...c };
    globe.lookAt(c);
  }
  /** Turn the globe (north stays up) until the place g0 sits under the point p. */
  function pin(g0, p) {
    for (let i = 0; i < 3; i++) {
      const g = globe.geoAt(p.x, p.y); if (!g) return false;
      const c = globe.camera(), dl = ((g0[0] - g[0] + 540) % 360) - 180;
      globe.lookAt({ lon: c.lon + dl, lat: clamp(c.lat + g0[1] - g[1], -80, 80), zoom: c.zoom });
    }
    return true;
  }
  function zoomAt(p, z1) { own(); S.coast = null; const c = globe.camera(); S.zoom = { z0: c.zoom, z1: clamp(z1, ZMIN, ZMAX), g0: globe.geoAt(p.x, p.y), p, t0: now(), dur: 300 }; }
  function goHome() { if (!S.home) return; S.coast = null; S.zoom = null; globe.flyTo(S.home, 600, { mark: false }); }
  const grabbable = () => S.phase === 'play' ? (S.hist.length ? elapsed() >= 1520 : elapsed() > 700) : S.phase === 'reveal' && (reduced() || elapsed() > T.m1);
  function stepCamera(dt) {
    if (!S.own) return;
    if (S.zoom) {
      const Z = S.zoom, k = reduced() ? 1 : band(now() - Z.t0, 0, Z.dur), c = globe.camera();
      globe.lookAt({ ...c, zoom: mix(Z.z0, Z.z1, CURVE(k)) });
      if (Z.g0) pin(Z.g0, Z.p);
      if (k >= 1) S.zoom = null;
    } else if (S.coast && !S.ptrs.size) {
      const K = S.coast, c = globe.camera(), f = Math.exp(-dt / 325);
      globe.lookAt({ lon: c.lon + K.vlon * dt, lat: clamp(c.lat + K.vlat * dt, -80, 80), zoom: c.zoom });
      K.vlon *= f; K.vlat *= f;
      if (Math.hypot(K.vlon, K.vlat) * 1000 < 1.5 / Math.pow(1.55, c.zoom - 1)) S.coast = null;
    }
  }

  // ---- a guess
  function guess() {
    if (S.phase !== 'play' || (S.hist.length && elapsed() < 900) || (!S.hist.length && elapsed() < 400)) return; // the bar is still closing
    const [lo, hi] = liveBounds(), g = clamp(Math.round(S.anim ? S.anim.to : curV()), lo, hi);
    S.hist = R.play(S.game, [...S.hist.map((h) => h.g), g]);
    const last = S.hist[S.hist.length - 1];
    Object.assign(S, { arriving: false, drag: null, anim: null, v: g, t0: now(), own: false, home: null, coast: null, zoom: null, grab: null, pinch: null, lastTap: null, hopped: false, settled: false });
    S.ptrs.clear();
    markBusy(1600);
    if (R.isOver(S.game, S.hist)) { finish(g); return; }
    const [a, b] = R.bounds(last.s2), to = clamp(g, a, b);
    if (reduced()) S.v = to; else S.anim = { from: g, to, t0: now(), delay: 480, dur: 500 };
  }
  /** The last guess: the dial runs to the year, then the screen becomes the result (frame()). */
  function finish(g) {
    S.phase = 'reveal'; S.rowScenes = new Map(); S.rowCam = null;
    // the answer: the dial's landing (a right guess stays put), the number's (the group's first year), its words ("1977–78")
    const word = R.yearLabel(S.game);
    S.answer = { from: g, dial: R.landing(S.game, g), num: S.game.lo, word, rest: word.slice(String(S.game.lo).length) };
    S.anim = reduced() ? null : { from: g, to: S.answer.dial, t0: now(), delay: 400, dur: 1200, ease: rollEase };
    if (reduced()) S.v = S.answer.dial;
    el.restIn.textContent = S.answer.rest; el.odo.setAttribute('aria-label', word);
    const y = S.game.year, t = y + 0.5, earned = S.hist.map((h) => h.next).filter(Boolean);
    // why that year: the clues that pin it on their own (their edges; an earned hint where it takes one), then the changes
    // around it, five rows in all
    const known = R.knownHints(S.game, new Set(earned.map((c) => c.feature.id))), fence = known.hints, onScreen = [...known.hints.map((x) => x.clue), ...earned];
    const near = R.nearbyClues(S.game, { exclude: new Set(onScreen.map((c) => c.feature.id)), n: 5 - fence.length,
      regionsUsed: known.hints.map((x) => x.clue.feature.region), datesUsed: onScreen.flatMap((c) => [c.from, c.to]) });
    const clueRow = (c, from, to, line, years, edge) => {
      // the year a change shows beside its bar: the bar's end nearest the answer
      const ends = [from, to].filter((e) => e != null).sort((p, q) => Math.abs(p - t) - Math.abs(q - t)), at = ends[0];
      const st = R.edgeStory(c, edge), kicker = `${line} (${years})`;
      return { kind: 'clue', clue: c, from, to, at, side: at === from ? -1 : 1, parts: { kicker, when: st?.when, text: st?.text, src: st?.source }, label: kicker };
    };
    // the world that year, for a guess that earned no hint (the last): its era, and four things its globe shows that today's doesn't
    // (a friend's globe: only what it draws as that year's)
    const keep = S.custom ? (f, a) => { const x = S.custom.fact(f.id); return x ? x.state === a && ['base', 'won back'].includes(x.did) : S.custom.untouched(f, f.states[a]); } : null;
    const then = R.thenLine(y, R.worldPick(D.bundle, y, D.optionsFor, endYear, 4, keep), word), world = { title: WORDS.world(word), then: then ? `${R.eraOf(y)} ${then}` : R.eraOf(y), world: true };
    S.views = {
      g: S.hist.map((h, i) => {
        const c = h.next, st = c && R.clueStory(c, h.g, y), what = `${WORDS.guessN(i + 1)}: ${h.g}, ${h.win ? 'right' : 'wrong'}${c ? `. Hint: ${R.clueLine(c)}` : ''}`;
        return { kind: 'guess', i, h, clue: c, from: c?.from, to: c?.to, label: what,
          parts: c ? { kicker: `${R.clueLine(c)} (${R.clueYears(c)})`, when: st?.when, text: st?.text, src: st?.source } : world };
      }),
      k: [...fence.map((x) => clueRow(x.clue, x.clue.from, x.clue.to, R.clueLine(x.clue), R.clueYears(x.clue), x.edge)),
        ...near.map((x) => clueRow(x.clue, x.from, x.to, x.line, x.years, x.edge))],
    };
    // the column: the years every pinning clue on the screen allows, on the bars' own scale, so its edges meet them
    S.period = R.shownPeriod(S.game, onScreen);
    // a friend's globe: the second timeline is the sender's answers (✓ / ✗, the years each reply allows), the column the
    // winning years
    if (S.custom && S.game.rows.length) { S.views.k = S.game.rows.map(answerRow); S.period = [S.game.lo, S.game.hi + 1]; }
    // each timeline's years: the guesses (or the changes' near ends) and the column, with a margin
    const span = (vals, padK, padMin, min) => {
      let a = Math.min(...vals), b = Math.max(...vals); const pad = Math.max(padMin, (b - a) * padK); a -= pad; b += pad;
      if (b - a < min) { const m = (a + b) / 2; a = m - min / 2; b = m + min / 2; }
      return [Math.max(R.AXIS_START - 0.5, a), Math.min(endYear + 0.5, b)];
    };
    S.span = { g: span([...S.hist.map((h) => h.g + 0.5), ...S.period], 0.08, 3, 24), k: span([...S.views.k.map((r) => r.at), ...S.period], 0.12, 2.5, 20) };
    // the last guess arrives chosen ("The world in 1991"); why that year chooses its first row when it first opens
    S.view = 'g'; S.sel = { g: S.hist.length - 1, k: 0 }; S.picked = { g: true, k: false }; S.dim = { g: null, k: null }; S.sw = null; S.swap = null;
    S.heights = null; S.storyKey = null;
    buildRows();
    place();
    markBusy(settledAt());
    // the whole globe again, its names and borders, turning slowly once it has pulled back
    const c = globe.camera();
    globe.setScene(S.world);
    globe.flyTo({ lon: c.lon, lat: 15, zoom: 1 }, reduced() ? 0 : 1100, { mark: false });
    S.idleAt = now() + 1300;
  }
  /** Once per miss, 520 ms in: the camera hops to the next hint (the quiz's hop), or back to the whole globe. */
  function hop() {
    S.hopped = true;
    const k = S.hist.length, c = clueOf(k);
    if (c) globe.setScene(clueScene(c));
    else globe.setScene(S.world);
    globe.flyTo(clueCamera(k), 1000, { mark: false, via: c ? 'hop' : undefined });
  }

  // ------------------------------------------------------------------ the result's rows and stories
  /** When guess i drops in; the last bar's end (doneAt), from which the last guess is chosen and its story arrives. */
  const rowAt = (i) => T.row0 + i * T.rowStep;
  const doneAt = () => rowAt(S.hist.length - 1) + 80 + T.bar;
  const arrived = () => reduced() || elapsed() > doneAt() - 200;
  const settledAt = () => doneAt() + 700;

  /** A story: a kicker (the clue and its years) or a title ("The world in 1991"), its then-line, its date line, fun fact and source. */
  function storyHTML(p, v, font) {
    const fs = font ? ` style="font-size:${font}px"` : '';
    return `${p.title ? `<h3 class="q-title g-wtitle">${esc(p.title)}</h3>` : `<p class="a-kicker">${esc(p.kicker)}</p>`}${v.then && p.then ? `<p class="a-story"${fs}>${esc(p.then)}</p>` : ''}`
      + `${p.text && v.text ? `${v.when && p.when ? `<p class="a-when">${esc(p.when)}</p>` : ''}<p class="a-story"${fs}>${esc(p.text)}</p>` : ''}`
      + `${v.src && p.src?.url ? `<a class="a-source" href="${esc(p.src.url)}" target="_blank" rel="noopener">${esc(p.src.title)}</a>` : ''}`;
  }
  /** One of the sender's answers as a row: its bars, its ✓ / ✗, the year of its change nearest the answer, its story. */
  function answerRow(r) {
    const f = r.fact.feature, claim = LEANS.test(r.claim) ? `${f.subject}: ${r.claim.charAt(0).toLowerCase()}${r.claim.slice(1)}` : r.claim;
    const tr = (f.transitions ?? []).find((x) => Math.abs(x.t - r.at) < 1e-6), kicker = `${r.reply === 'yes' ? CUSTOM.yes : CUSTOM.no}: ${claim} (${r.years})`;
    return { kind: 'clue', clue: r.clue, from: r.spans[0][0], to: r.spans[r.spans.length - 1][1], spans: r.spans, reply: r.reply, at: r.at,
      side: r.spans.some(([a]) => a != null && Math.abs(a - r.at) < 1e-6) ? -1 : 1, label: kicker,
      parts: { kicker, when: tr?.funFact ? R.dateLabel(tr.date) : null, text: tr?.funFact ?? null, src: tr?.funFact ? tr.sources?.[0] ?? null : null } };
  }
  function buildRows() {
    for (const v of VIEWS) {
      el.rowsIn[v].innerHTML = S.views[v].map((r, i) => { const on = i === S.sel[v];
        return `<button class="g-row" type="button" role="radio" data-i="${i}" aria-checked="${on}" tabindex="${on ? 0 : -1}" aria-label="${esc(r.label)}"><svg aria-hidden="true"></svg></button>`; }).join('');
    }
    const why = (S.custom && S.game.rows.length ? CUSTOM.why : WORDS.why)(S.answer.word);
    // more rows than fit (a friend's globe's answers): the box scrolls, with the app's soft edges where rows hide
    for (const v of VIEWS) { const box = el.rows[v], more = S.views[v].length > ROWS_MAX; box.classList.toggle('g-scroll', more); box.scrollTop = 0; fades(v); }
    el.heads.k.textContent = why; el.rows.k.setAttribute('aria-label', why); el.info.setAttribute('aria-label', why); el.info.title = why;
    el.info.setAttribute('aria-pressed', 'false');
  }
  /** A scrolling box of rows: the soft edge above when rows hide above, below when they hide below (the timeline's). */
  function fades(v) {
    const b = el.rows[v], on = b.classList.contains('g-scroll');
    b.classList.toggle('more-above', on && b.scrollTop > 2);
    b.classList.toggle('more-below', on && b.scrollTop + b.clientHeight < b.scrollHeight - 2);
  }
  /** Places each timeline's rows (on each layout): every row, at the layout's height (past ROWS_MAX, in the scrolling box). */
  function layRows() {
    const RG = G.res, P = RG.P;
    for (const v of VIEWS) {
      el.rowsIn[v].style.height = `${S.views[v].length * P}px`;
      el.rowsIn[v].querySelectorAll('.g-row').forEach((b) => {
        Object.assign(b.style, { left: '0px', top: `${Number(b.dataset.i) * P}px`, width: `${RG.rows.w}px`, height: `${P}px` });
        const svg = b.firstElementChild; svg.setAttribute('width', RG.rows.w); svg.setAttribute('height', P); b.__s = null;
      });
    }
    S.storyKey = null;
  }
  /** A row's opacity: today's (once a row is chosen the others stand at 35%), eased over 200 ms from what it was. */
  const dimTo = (sel, picked, i) => (!picked || i === sel ? 1 : 0.35);
  function dimOf(v, i, t, arrive = 1) {
    const to = dimTo(S.sel[v], S.picked[v], i), dm = S.dim[v];
    if (!dm) return mix(1, to, arrive);
    return mix(dimTo(dm.sel, dm.picked, i), to, EASE(band(t - dm.t0, 0, reduced() ? T.reduced : T.dim)));
  }
  /** Choosing row i of timeline v: the others go to 35%, its story cross-fades in, the globe flies to its place. */
  function select(v, i, focus = false) {
    if (!S?.views || S.phase !== 'reveal' || !arrived() || i < 0 || i >= S.views[v].length) return;
    const t = now();
    if (S.sel[v] !== i || !S.picked[v]) {
      S.dim[v] = { t0: t, sel: S.sel[v], picked: S.picked[v] };
      if (S.sel[v] !== i) S.swap = { t0: t, dur: T.pick };
      S.sel[v] = i; S.picked[v] = true;
      el.rowsIn[v].querySelectorAll('.g-row').forEach((b) => { const on = Number(b.dataset.i) === i; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; });
    }
    if (focus) el.rowsIn[v].querySelector(`.g-row[data-i="${i}"]`)?.focus({ preventScroll: true });
    // a row chosen out of view (keys) scrolls in
    const box = el.rows[v], P = G.res.P, top = i * P;
    if (box.classList.contains('g-scroll') && (top < box.scrollTop || top + P > box.scrollTop + box.clientHeight)) box.scrollTo({ top: top < box.scrollTop ? top : top + P - box.clientHeight, behavior: reduced() ? 'auto' : 'smooth' });
    showPlace(v, i);
  }
  /** The (i): the other timeline, on one curve. Opened for the first time, it has its first row chosen. */
  function switchTo(v) {
    if (!S?.views || S.phase !== 'reveal' || !arrived()) return;
    el.info.setAttribute('aria-pressed', String(v === 'k'));
    if (S.view === v) return;
    const t = now(), cur = S.sw ? mix(S.sw.from, S.sw.to, CURVE(band(t - S.sw.t0, 0, T.switch))) : S.view === 'k' ? 1 : 0;
    S.sw = { t0: t, from: cur, to: v === 'k' ? 1 : 0 }; S.view = v; S.swap = { t0: t, dur: T.switch };
    if (!S.picked[v]) { S.dim[v] = { t0: t, sel: S.sel[v], picked: false }; S.picked[v] = true; }
    markBusy(reduced() ? T.reduced : T.switch);
    showPlace(v, S.sel[v]);
  }
  /**
   * The result's globe on an upright phone: the medallion (0) or big (1), on one curve (e), reversible mid-way. The
   * story fades out over the first 40% and in over the last 40%. The verdict and the year can't cross the globe on its
   * way: they fade where they are over the first quarter (the globe passing over them, masked; on the way back, pushed
   * up by the timeline) and come in at their new place over the last 35% (textSide: which place they are at). With
   * reduced motion, everything that moves fades out where it is and in at its new place (dip).
   */
  function growAt(t) {
    const G0 = S.grow;
    if (!G0) return { e: S.big ? 1 : 0, dip: 1, story: S.big ? 0 : 1, at: null, textA: 1, textSide: S.big ? 1 : 0, moving: false };
    const red = reduced(), dt = t - G0.t0, D = red ? T.reduced : T.grow, k = band(dt, 0, D);
    let e, dip = 1, story, textA = 1, textSide = G0.to;
    if (red) { e = k < 0.5 ? G0.from : G0.to; dip = Math.abs(2 * k - 1); story = G0.to ? G0.a0 * (1 - band(dt, 0, D / 2)) : band(dt, D / 2, D); textSide = k < 0.5 ? G0.side : G0.to; }
    else {
      e = mix(G0.from, G0.to, CURVE(k));
      story = G0.to ? G0.a0 * (1 - EASE(band(k, 0, 0.4))) : G0.a0 + (1 - G0.a0) * EASE(band(k, 0.6, 1));
      if (G0.side === G0.to) textA = G0.ta0 + (1 - G0.ta0) * EASE(band(k, 0, 0.4)); // turned back before they had gone: they stay
      else if (k < 0.25) { textA = G0.ta0 * (1 - EASE(band(k, 0, 0.25))); textSide = G0.side; }
      else textA = EASE(band(k, 0.65, 1));
    }
    if (dt >= D) S.grow = null;
    return { e, dip, story, at: dt, textA, textSide, moving: true };
  }
  /** Grow the result's globe (a tap on it) or put it back (a tap on the timeline). */
  function setBig(on) {
    if (!S?.views || S.phase !== 'reveal' || !G.res?.big || S.big === on) return;
    const t = now(), g = growAt(t);
    S.grow = { t0: t, from: g.e, to: on ? 1 : 0, a0: g.story, side: g.textSide, ta0: g.textA }; S.big = on;
    markBusy(reduced() ? T.reduced : T.grow);
  }
  /**
   * The globe goes to the row's place, as the quiz's camera hop (1000 ms), the clue drawn in brass into the world of the
   * globe's year; a row without a clue (the last guess: "The world in …") goes back to the whole globe.
   * It stays there: no idle turn. The player can turn it again at once (a touch ends the flight).
   */
  function showPlace(v, i) {
    const c = S.views[v][i].clue, key = `${v}${i}`;
    S.idleAt = 0; S.own = false; S.home = null; S.coast = null; S.zoom = null; S.grab = null; S.pinch = null;
    globe.setIdle(false);
    // on a phone the result's globe is a medallion, too small for the clue's own labels (as in the quiz's result)
    globe.setLabelsShown(!G.compact);
    if (c) {
      if (!S.rowScenes.has(key)) S.rowScenes.set(key, clueScene(c));
      const m = c.feature.camera;
      S.rowCam = { lon: m.lon, lat: m.lat, zoom: Math.min(m.zoom, 8) };
      globe.setScene(S.rowScenes.get(key));
      globe.flyTo(S.rowCam, 1000, { mark: false, via: 'hop' });
    } else {
      S.rowCam = null;
      globe.setScene(S.world);
      globe.flyTo({ lon: globe.camera().lon, lat: 15, zoom: 1 }, 1000, { mark: false });
    }
    markBusy(reduced() ? 0 : 1000);
  }

  // ------------------------------------------------------------------ one frame
  let last = {};
  const tagHeights = new Map(), titleHeights = new Map(); // a tag's / title's height at this width (a long one takes two lines)
  const put = (key, node, style) => { const s = Object.entries(style).map(([k, v]) => `${k}:${v}`).join(';'); if (last[key] !== s) { last[key] = s; Object.assign(node.style, style); } };
  const fade = (key, node, a, rise = true) => put(key, node, { opacity: a.toFixed(3), transform: rise ? `translateY(${((1 - a) * 6).toFixed(2)}px)` : 'none', visibility: a > 0.001 ? 'visible' : 'hidden' });
  const say = (key, nodes, list) => nodes.forEach((n, i) => { const it = list[i]; if (!it?.text) { fade(key + i, n, 0); return; } if (last[`${key}t${i}`] !== it.text) { last[`${key}t${i}`] = it.text; n.textContent = it.text; } fade(key + i, n, it.a); });

  function frame() {
    const t = S.phase === 'load' ? -1 : reduced() ? 1e9 : elapsed(), k = S.hist.length, r = (a, b) => EASE(band(t, a, b));
    const cur = S.game ? lookText(Math.min(k, R.LOOKS - 1)) : lookText0;
    const f = { v: S.game ? curV() : START_YEAR, brass: 0, tick: null, btn: WORDS.guess, landed: false, whys: [], said: null, past: [],
      box: G.lens, yearPos: { x: G.yearX, y: G.yearTop }, yearFont: null, dy: 0, dialShown: true, result: null, verdictA: 0, shareA: 0, btnBox: null, num: null, rest: 0 };
    const markItems = (curLook, m = 1) => Array.from({ length: R.LOOKS }, (_, i) => (i < k ? { kind: S.hist[i].win ? 'yes' : 'no', m: i === k - 1 ? m : 1 } : { kind: i === curLook ? 'now' : 'todo', m: 1 }));
    if (S.phase === 'load') return { ...f, tags: [], titles: [], marks: null, dialA: 0, guessA: 0, segs: null, grab: false };
    if (S.phase === 'play' && k === 0) {
      const a = r(450, 750), w = r(150, 550), b = r(1100, 1500); // the arrival: words, then the year and dial, then Guess
      return { ...f, tags: [{ text: cur.tag, a: w }], titles: [{ text: cur.title, a: w }], marks: { a: w, items: markItems(0) }, dialA: a, guessA: b, segs: S.game.full, grab: grabbable() };
    }
    const H = S.hist[k - 1];
    const past = S.hist.slice(0, k - 1).filter((h) => !h.win).map((h) => h.g);
    if (S.phase === 'play') {
      // a miss just happened: its year stays on the dial with the way to go, the bar closes (the guess, then the
      // hint's own years), the camera hops, the words swap
      const prev = lookText(k - 1), out = 1 - r(380, 560), inn = r(780, 1180);
      const segs = t < 480 ? R.lerpSet(H.s0, H.s1, CURVE(band(t, 80, 520))) : R.lerpSet(H.s1, H.s2, CURVE(band(t, 480, 980)));
      return { ...f, tags: [{ text: prev.tag, a: out }, { text: cur.tag, a: inn }], titles: [{ text: prev.title, a: out }, { text: cur.title, a: inn }],
        whys: [{ text: prev.why, a: out }, { text: cur.why, a: inn }], said: { g: H.g, dir: H.dir, a: r(240, 560) }, past,
        marks: { a: 1, items: markItems(t > 560 ? k : -1, band(t, 0, 300)) }, dialA: 1, guessA: 1, segs, grab: grabbable() };
    }
    // the end: the dial runs to the year and lands in brass, then the screen becomes the result
    const RG = G.res, moves = RG.mode !== 'split', shown = lookText(k - 1), out = 1 - r(0, 180), m = CURVE(band(t, T.m0, T.m1)), win = S.game.win;
    // the globe tapped (phones): the lens mixes to its big box; the year is at its rest place or under the big globe
    const B = RG.big, gr = B ? growAt(now()) : null, e2 = gr ? gr.e : 0, under = gr && gr.textSide === 1, drop = gr ? (1 - gr.textA) * 6 : 0;
    const yearTo = under ? { x: B.year.x, y: B.year.y + Math.min(0, RG.head.y + e2 * B.dy - RG.gapA - (B.kick.y + B.textH)) + drop, grow: 0 } : null; // on the way back the timeline pushes it up
    const done = doneAt(), bA = r(done + 60, done + 380); // the buttons follow the last guess's story
    const verdict = R.verdictLine(S.game, S.hist), gone = 1 - band(t, T.m0, T.m0 + 200);
    const tags = moves ? [{ text: k === 1 ? words.tag : shown.tag, a: (k === 1 ? 1 : out) * gone }]
      : k === 1 ? [{ text: words.tag, a: 1 }] : [{ text: shown.tag, a: out }, { text: words.tag, a: r(1700, 2100) }];
    const titles = moves ? [{ text: shown.title, a: out * gone }] : [{ text: shown.title, a: out }, { text: verdict, a: r(1700, 2100) }];
    const play = { x: G.yearX, y: G.yearTop };
    return { ...f, tags, titles, whys: [{ text: shown.why, a: out }], verdict, verdictA: moves ? r(T.m0 + 200, T.m0 + 520) : 0,
      marks: { a: 1, items: markItems(-1, band(t, 0, 300)) }, dialA: 1, guessA: t < 400 ? out : bA, btn: t < 400 ? WORDS.guess : words.again,
      btnBox: t < 400 ? null : RG.again, shareA: bA,
      segs: R.lerpSet(H.s0, win, CURVE(band(t, 200, 800))), brass: band(t, 500, 900), landed: t >= 1600,
      tick: H.g !== S.answer.dial ? { g: H.g, a: r(300, 600) * (1 - band(t, T.m0 - 200, T.m0)), label: !H.win, side: Math.abs(H.g - S.answer.dial) > 2 ? 0 : Math.sign(H.g - S.answer.dial) } : null, grab: grabbable(),
      // the number rolls with the dial (400–1600 ms) to the group's first year; the rest of a group opens beside it as it turns brass
      num: mix(S.answer.from, S.answer.num, reduced() ? 1 : rollEase(band(t, 400, 1600))), rest: S.answer.rest ? (reduced() ? 1 : CURVE(band(t, 900, 1300))) : 0,
      box: B ? mixBox(mixBox(G.lens, RG.lens, m), B.lens, e2) : mixBox(G.lens, RG.lens, m),
      yearPos: yearTo ?? { x: mix(play.x, RG.year.x, m), y: mix(play.y, RG.year.y, m) + drop, grow: RG.mode === 'short' ? 0 : m },
      yearFont: G.resYearFont !== G.yearFont ? mix(G.yearFont, G.resYearFont, m) : null, dy: RG.dy * m, gr,
      dialShown: t < T.m0, result: t >= T.m0 ? { m, t, gr } : null };
  }

  function render(f) {
    const g = G;
    // the lens: where this phase puts it; after Play again it glides back from where the result had it
    let Lz = f.box;
    if (S.lensFrom) { const e = reduced() ? 1 : CURVE(band(now() - S.lensFrom.t0, 0, 440)); Lz = mixBox(S.lensFrom.box, Lz, e); if (e >= 1) S.lensFrom = null; }
    S.lz = Lz;
    const lk = `${Lz.x.toFixed(2)}|${Lz.y.toFixed(2)}|${Lz.d.toFixed(2)}`;
    if (last.lens !== lk) { last.lens = lk; globe.setLensBox({ left: Lz.x, top: Lz.y, width: Lz.d, height: Lz.d }); }
    put('hit', el.hit, { left: `${Lz.x + 8}px`, top: `${Lz.y + 8}px`, width: `${Lz.d - 16}px`, height: `${Lz.d - 16}px`, display: f.grab ? 'block' : 'none' });
    const canGrow = !!(f.grab && f.gr && !S.big);
    if (last.canGrow !== canGrow) { last.canGrow = canGrow; el.hit.classList.toggle('can-grow', canGrow); }
    // reduced motion: the globe fades out where it was and in at its new size
    const gDip = f.gr && f.gr.dip < 1 ? f.gr.dip.toFixed(3) : '';
    if (last.gDip !== gDip && canvas) { last.gDip = gDip; canvas.style.opacity = gDip; }
    // the words and the marks
    say('tag', el.tags, f.tags); say('title', el.titles, f.titles); say('why', el.whys, f.whys);
    el.tags.forEach((n, i) => put(`tagTop${i}`, n, { top: `${(g.tagY + f.dy).toFixed(1)}px` }));
    // a title starts under its tag, however many lines the tag takes; the reason sits right under its title
    el.titles.forEach((n, i) => {
      const tg = f.tags[i] ? i : 0, text = f.tags[tg]?.text, tt = f.titles[i]?.text;
      const extra = text ? (tagHeights.has(text) ? tagHeights.get(text) : (tagHeights.set(text, el.tags[tg].offsetHeight), tagHeights.get(text))) - g.tagH : 0;
      const top = g.titleY + Math.max(0, extra) + f.dy;
      put(`titleTop${i}`, n, { top: `${top.toFixed(1)}px` });
      const wy = el.whys[i], wt = f.whys[i]?.text;
      if (wt && tt) {
        if (!titleHeights.has(tt)) titleHeights.set(tt, n.offsetHeight);
        put(`whyTop${i}`, wy, { top: `${(top + titleHeights.get(tt) + 2).toFixed(1)}px` });
      }
    });
    put('marksPos', el.marks, { left: `${g.marksAt.x}px`, top: `${(g.marksAt.y + g.marksAt.follow * f.dy).toFixed(1)}px` });
    const ms = f.marks ? marksSVG(g.compact && f.result ? { ...f.marks, a: f.marks.a * (1 - f.result.m) } : f.marks) : '';
    if (last.marks !== ms) { last.marks = ms; el.marks.innerHTML = ms; }
    // the year (over the dial while playing; beside the globe, or under the verdict, at the end)
    // (on the smallest phones the result's year is a step smaller: its size moves with it, on the same curve)
    // a group of years: its rest ("–78") opens beside the number, which keeps its left edge where the result writes it
    // left-aligned (beside the globe, under the verdict) and stays centred over the dial and on a phone on its side
    const rw = f.rest > 0 ? el.restIn.offsetWidth * f.rest : 0;
    put('yearRest', el.rest, { width: `${rw.toFixed(1)}px`, opacity: f.rest.toFixed(3) });
    const yx = f.yearPos.x + (rw / 2) * (f.yearPos.grow ?? 0);
    const ya = f.dialA * (f.gr ? f.gr.textA * f.gr.dip : 1);
    put('yearPos', el.year, { left: `${yx.toFixed(1)}px`, top: `${f.yearPos.y.toFixed(1)}px`, opacity: ya.toFixed(3), visibility: ya > 0.001 ? 'visible' : 'hidden', 'font-size': f.yearFont ? `${f.yearFont.toFixed(2)}px` : '' });
    const nv = f.num ?? f.v;
    if (last.num !== nv) { last.num = nv; setOdometer(el.odo, clamp(nv, 0, 9999)); }
    if (last.v !== f.v) { last.v = f.v; el.dialHit.setAttribute('aria-valuenow', Math.round(f.v)); el.dialHit.setAttribute('aria-valuetext', String(Math.round(f.v))); }
    if (last.landed !== f.landed) { last.landed = f.landed; el.year.classList.toggle('is-landed', f.landed); }
    const ds = f.segs && f.dialShown ? dialSVG(f) : '';
    if (last.dial !== ds) { last.dial = ds; el.dial.innerHTML = ds; }
    put('dialHit', el.dialHit, { display: S.phase === 'play' && f.dialA > 0.5 ? 'block' : 'none' });
    // the result: the verdict beside the globe, the gold label and its (i), the timelines, the axis, the story
    const RG = g.res;
    const kick = f.gr?.textSide === 1 ? RG.big.kick : RG?.kick, kickY = kick && f.gr?.textSide === 1 ? kick.y + Math.min(0, RG.head.y + f.gr.e * RG.big.dy - RG.gapA - (kick.y + RG.big.textH)) : kick?.y;
    if (kick) put('verdictPos', el.verdict, { left: `${kick.x}px`, top: `${kickY.toFixed(1)}px`, width: `${kick.w}px`, 'text-align': kick.align });
    const va = f.verdictA * (f.gr ? f.gr.textA * f.gr.dip : 1);
    say('verdict', [el.verdict], va ? [{ text: f.verdict, a: va }] : []);
    // while the globe grows or goes back it lies over the paper: the verdict and the year are masked by its disc
    const disc = f.gr?.moving ? (() => { const half = Lz.d / 2, z = globe.camera().zoom; return { cx: Lz.x + half, cy: Lz.y + half, r: Math.min((half - 14) * Math.pow(1.55, z - 1) + 6, half - 4) + 1.5 }; })() : null;
    maskOut('yearMask', el.year, disc, () => ({ x: yx - el.year.offsetWidth / 2, y: f.yearPos.y }));
    maskOut('verdictMask', el.verdict, disc && va ? disc : null, () => ({ x: kick.x, y: kickY + (1 - va) * 6 }));
    drawResult(f.result);
    // the buttons: Guess (Play again at the end) and Share beside it
    const bb = f.btnBox;
    const bx = bb ? bb.x : g.btn.x, by = bb ? RG.btnY : g.btn.y, bw = bb ? bb.w : g.btn.w, bh = bb ? RG.btnH : g.btn.h;
    put('guessPos', el.guess, { left: `${bx}px`, top: `${by}px`, width: bw ? `${bw}px` : '', height: `${bh}px` });
    fade('guess', el.guess, f.guessA);
    if (last.btn !== f.btn) { last.btn = f.btn; el.guess.textContent = f.btn; last.guessW = null; host.classList.toggle('g-res', f.btn === words.again); }
    // a longer label (a friend's "Date your own globe") on a narrow phone: its type a step smaller, until it fits
    if (last.fit !== `${f.btn}|${bw}`) {
      last.fit = `${f.btn}|${bw}`; el.guess.style.fontSize = ''; el.guess.style.paddingInline = '';
      if (bw && el.guess.scrollWidth > el.guess.clientWidth + 0.5) {
        el.guess.style.paddingInline = '6px';
        let px = parseFloat(getComputedStyle(el.guess).fontSize);
        while (el.guess.scrollWidth > el.guess.clientWidth + 0.5 && px > 12) el.guess.style.fontSize = `${(px -= 0.5)}px`;
      }
    }
    const off2 = f.guessA < 0.5 || S.phase === 'load';
    if (last.btnOff !== off2) { last.btnOff = off2; el.guess.disabled = off2; }
    if (RG && RG.share.x == null && last.guessW == null) last.guessW = el.guess.offsetWidth;
    const sx = RG ? RG.share.x ?? (bx + last.guessW + 12) : bx;
    put('sharePos', el.share, { left: `${sx}px`, top: `${RG ? RG.btnY : by}px`, width: RG?.share.w ? `${RG.share.w}px` : '', height: `${RG ? RG.btnH : bh}px` });
    fade('share', el.share, f.shareA);
    const shareOff = f.shareA < 0.5;
    if (last.shareOff !== shareOff) { last.shareOff = shareOff; el.share.disabled = shareOff; }
  }

  /** Hide what of a piece lies under the globe's disc ({ cx, cy, r } in the page; null: nothing). at(): the piece's top left. */
  function maskOut(key, node, disc, at) {
    let v = 'none';
    if (disc) { const o = at(); v = `radial-gradient(circle at ${(disc.cx - o.x).toFixed(1)}px ${(disc.cy - o.y).toFixed(1)}px, transparent ${disc.r.toFixed(1)}px, #000 ${(disc.r + 0.75).toFixed(1)}px)`; }
    if (last[key] !== v) { last[key] = v; node.style.webkitMaskImage = v; node.style.maskImage = v; }
  }

  function marksSVG({ a, items }) {
    let s = `<g opacity="${a.toFixed(3)}">`;
    items.forEach((it, i) => {
      const x = 75 - (items.length - 1 - i) * 16, y = 8;
      if (it.kind === 'yes' || it.kind === 'no') s += `<path class="row-mark ${it.kind}" opacity="${it.m.toFixed(3)}" transform="translate(${x},${y}) scale(${mix(0.2, 1, it.m).toFixed(3)})" d="${MARK[it.kind]}"/>`;
      else if (it.kind === 'now') s += `<circle class="g-now" cx="${x}" cy="${y}" r="2.6"/>`;
      else s += `<circle class="g-todo" cx="${x}" cy="${y}" r="2.6"/>`;
    });
    return `${s}</g>`;
  }

  /**
   * The dial: the timeline's axis under a fixed needle, about 9 px a year, with the bar of the years still possible
   * lying on it. Every missed year keeps a tick; the last one says which way to go, its words held inside the dial.
   */
  function dialSVG(f) {
    const g = G, w = g.dial.x1 - g.dial.x0, y = 30, cxm = w / 2, x = (yr) => cxm + (yr - f.v) * g.ppy, F = 40, a0 = f.dialA;
    const [first, lastYear] = R.bounds(S.game.full);
    const edge = (tx) => Math.max(0, Math.min(1, tx / F, (w - tx) / F));
    const live = (yr) => f.segs.some(([a, b]) => yr >= a - 0.5 && yr <= b + 0.5);
    let s = `<defs><linearGradient id="g-dl" x1="0" x2="${w}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#9c8a66" stop-opacity="0"/><stop offset="${(F / w).toFixed(4)}" stop-color="#9c8a66"/><stop offset="${(1 - F / w).toFixed(4)}" stop-color="#9c8a66"/><stop offset="1" stop-color="#9c8a66" stop-opacity="0"/></linearGradient>
      <linearGradient id="g-dw" x1="0" x2="${w}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="${(F / w).toFixed(4)}" stop-color="#fff"/><stop offset="${(1 - F / w).toFixed(4)}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
      <mask id="g-dm" maskUnits="userSpaceOnUse" x="0" y="0" width="${w}" height="64"><rect x="0" y="0" width="${w}" height="64" fill="url(#g-dw)"/></mask></defs>`;
    s += `<g opacity="${a0.toFixed(3)}"><g mask="url(#g-dm)">`;
    for (const [a, b] of f.segs) {
      const xa = Math.max(-8, x(a - 0.5)), xb = Math.min(w + 8, x(b + 0.5));
      if (xb > xa) s += `<rect class="g-bar" x="${xa.toFixed(1)}" y="${y - 8}" width="${(xb - xa).toFixed(1)}" height="5" rx="2.5"/>${f.brass > 0 ? `<rect class="g-bar is-win" opacity="${f.brass.toFixed(3)}" x="${xa.toFixed(1)}" y="${y - 8}" width="${(xb - xa).toFixed(1)}" height="5" rx="2.5"/>` : ''}`;
    }
    s += `</g><g class="g-axis"><line x1="0" x2="${w}" y1="${y}" y2="${y}" style="stroke:url(#g-dl)"/>`;
    const lo = Math.max(first, Math.floor(f.v - cxm / g.ppy) - 1), hi = Math.min(lastYear, Math.ceil(f.v + cxm / g.ppy) + 1);
    for (let yr = lo; yr <= hi; yr++) {
      const tx = x(yr), a = edge(tx) * (live(yr) ? 1 : 0.3); if (a < 0.01) continue;
      s += `<line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${y}" y2="${y + (yr % 10 === 0 ? 10 : yr % 5 === 0 ? 7 : 4)}" opacity="${(a * (yr % 5 ? 0.55 : 1)).toFixed(3)}"/>`;
      if (yr % 10 === 0) s += `<text x="${tx.toFixed(1)}" y="${y + 24}" opacity="${a.toFixed(3)}">${yr}</text>`;
    }
    s += '</g>';
    // the years already missed: a tick each, standing on the axis where the bar no longer reaches
    const missed = [...f.past, ...(f.said ? [f.said.g] : [])];
    missed.forEach((yr, i) => {
      const tx = x(yr), a = edge(tx) * (i === missed.length - 1 && f.said ? f.said.a : 0.6);
      if (a > 0.01) s += `<g class="g-said" opacity="${a.toFixed(3)}"><line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${y - 11}" y2="${y + 4}"/></g>`;
    });
    // the way to go, beside the last miss, over the bar's side; it stays on the dial while the year scrolls away
    if (f.said && f.said.a > 0.01) {
      const text = f.said.dir < 0 ? WORDS.earlier(f.said.g) : WORDS.later(f.said.g), tw = measure(text), gx = x(f.said.g);
      const end = f.said.dir < 0 ? clamp(gx + 4, tw + 6, w - 6) : clamp(gx - 4, 6, w - 6 - tw) + tw;
      s += `<text class="g-dir" x="${end.toFixed(1)}" y="${y - 18}" text-anchor="end" opacity="${f.said.a.toFixed(3)}">${esc(text)}</text>`;
    }
    if (f.tick && f.tick.a > 0.001) {
      const tx = x(f.tick.g), a = f.tick.a * edge(tx);
      if (a > 0.01) s += `<g class="g-said" opacity="${a.toFixed(3)}"><line x1="${tx.toFixed(1)}" x2="${tx.toFixed(1)}" y1="${y - 11}" y2="${y + 4}"/>${f.tick.label ? `<text x="${(tx + f.tick.side * 3).toFixed(1)}" y="${y - 16}" style="text-anchor:${f.tick.side < 0 ? 'end' : f.tick.side > 0 ? 'start' : 'middle'}">${f.tick.g}</text>` : ''}</g>`;
    }
    s += `<line class="g-needle${f.landed ? ' is-landed' : ''}" x1="${cxm}" x2="${cxm}" y1="${y - 14}" y2="${y + 12}"/></g>`;
    return s;
  }

  // ------------------------------------------------------------------ the result's timelines, on the frame's clock
  /** A timeline's years across its rows' box, in the box's own coordinates; e mixes your guesses (0) and why (1). */
  const xs = (v, yr) => { const [a, b] = S.span[v], x1 = G.res.rows.w; return PX0 + ((yr - a) / (b - a)) * (x1 - PX0); };
  const xAt = (e) => (yr) => mix(xs('g', yr), xs('k', yr), e);

  /**
   * The result's timelines. res: { m (the move into the result, 0 → 1), t (ms since the last guess) }, or null before it.
   * The gold label and its (i); the two timelines (the one leaving slides 24 px out, the other in from the side it lies on,
   * cross-fading as one); the axis, which moves to the new timeline's length and rescales to its years; the column; the
   * chosen row's story riding on the axis. With reduced motion every move is a 200 ms cross-fade in place.
   */
  function drawResult(res) {
    if (!res) {
      for (const v of VIEWS) { put(`head${v}`, el.heads[v], { visibility: 'hidden' }); put(`rows${v}`, el.rows[v], { display: 'none' }); }
      put('info', el.info, { visibility: 'hidden' }); put('paper', el.paper, { display: 'none' });
      put('storyPos', el.story, { visibility: 'hidden', 'pointer-events': 'none' });
      if (last.chart !== '') { last.chart = ''; el.chart.innerHTML = ''; }
      return;
    }
    const RG = G.res, { m, t, gr } = res, red = reduced(), tn = now(), r = (a, b) => (red ? 1 : EASE(band(t, a, b))), done = doneAt();
    // the globe tapped (phones): the label, the rows and the axis move down by OY on its curve; dip: reduced motion's fade
    const OY = gr ? gr.e * RG.big.dy : 0, dip = gr ? gr.dip : 1;
    // the switch: one curve for the label, the rows, the axis's place and years, the column and the (i)'s ink
    let sw = S.view === 'k' ? 1 : 0;
    if (S.sw) { const dt = tn - S.sw.t0, D = red ? T.reduced : T.switch; sw = mix(S.sw.from, S.sw.to, (red ? EASE : CURVE)(band(dt, 0, D))); if (dt >= D) S.sw = null; }
    const e = red ? (sw >= 0.5 ? 1 : 0) : sw, Vg = RG.views.g, Vk = RG.views.k, shift = 24;
    const axisY = mix(Vg.axisY, Vk.axisY, e) + OY, rowsH = mix(Vg.rowsH, Vk.rowsH, e), col = red ? 1 : CURVE(band(t, ...T.column));
    // the gold label slides with its rows, centred on the (i); the (i) stays at the line's right end and fills with ink
    const cA = r(...T.head), lift = (1 - cA) * 6, iw = G.iw, iTop = RG.head.y + OY + (G.kind === 'wide' ? 2 : G.page ? 0 : 1);
    for (const [v, on, dx] of [['g', 1 - sw, red ? 0 : -shift * sw], ['k', sw, red ? 0 : shift * (1 - sw)]]) {
      const a = on * cA * dip;
      put(`head${v}`, el.heads[v], { left: `${RG.head.x}px`, top: `${(iTop + iw / 2 - 8 + lift).toFixed(1)}px`, opacity: a.toFixed(3), transform: `translateX(${dx.toFixed(1)}px)`, visibility: a > 0.01 ? 'visible' : 'hidden' });
    }
    const iA = r(done - 100, done + 220) * dip, ink = (p, q) => `rgb(${p.map((c, j) => mix(c, q[j], sw).toFixed(0)).join(',')})`;
    put('info', el.info, { left: `${RG.head.x + RG.head.w - iw}px`, top: `${iTop.toFixed(1)}px`, opacity: iA.toFixed(3), visibility: iA > 0.01 ? 'visible' : 'hidden',
      background: sw > 0.001 ? `rgba(31,42,55,${sw.toFixed(3)})` : 'none', color: ink([74, 85, 101], [244, 236, 220]), 'border-color': ink([74, 85, 101], [31, 42, 55]) });
    // the axis (on arrival the dial turning into it); with reduced motion, mid-switch, both axes cross-fade in place
    const ax = red && S.sw ? axisSVG(m, col, 0, Vg.axisY + OY, Vg.rowsH, 1 - sw, OY) + axisSVG(m, col, 1, Vk.axisY + OY, Vk.rowsH, sw, OY) : axisSVG(m, col, e, axisY, rowsH, 1, OY);
    if (last.chart !== ax) { last.chart = ax; el.chart.innerHTML = ax; }
    put('chartA', el.chart, { opacity: dip < 1 ? dip.toFixed(3) : '' });
    // the two timelines
    for (const v of VIEWS) {
      const on = v === 'g' ? 1 - sw : sw, dx = red ? 0 : v === 'g' ? -shift * sw : shift * (1 - sw), V = RG.views[v];
      put(`rows${v}`, el.rows[v], { display: 'block', left: `${RG.rows.x}px`, top: `${(RG.rows.top + OY).toFixed(1)}px`, width: `${RG.rows.w}px`, height: `${V.rowsH}px`, opacity: (on * dip).toFixed(3),
        transform: `translateX(${dx.toFixed(1)}px)`, visibility: on > 0.01 && (m > 0.6 || red) ? 'visible' : 'hidden', 'pointer-events': on > 0.5 ? 'auto' : 'none' });
      if (on <= 0.01) continue;
      const x = xAt(red ? (v === 'g' ? 0 : 1) : e), arrive = v === 'g' ? r(done - 100, done + 180) : 1;
      el.rowsIn[v].querySelectorAll('.g-row').forEach((b) => {
        const i = Number(b.dataset.i), at = v === 'g' ? rowAt(i) : -1e9, still = red || v === 'k';
        const p = { a: still ? 1 : EASE(band(t, at, at + 220)), pop: still ? 1 : rollEase(band(t, at + 40, at + 40 + T.mark)), grow: still ? 1 : CURVE(band(t, at + 80, at + 80 + T.bar)) };
        // the column rises from the axis through the guesses, the bottom row first
        const colH = v === 'g' ? col * (V.rowsH + 4) - 4 - (V.rowsH - (i + 1) * RG.P) : RG.P;
        const sv = rowSVG(S.views[v][i], x, p, colH, dimOf(v, i, tn, arrive));
        if (b.__s !== sv) { b.__s = sv; b.firstElementChild.innerHTML = sv; }
      });
    }
    // the story: the chosen row's, of the timeline on screen, fitted to its room; it rides on the axis and cross-fades
    // when it changes (out over the first half, its words swap, in over the second)
    const view = sw > 0.5 ? 'k' : 'g', idx = S.sel[view], V = RG.views[view], key = `${view}|${idx}|${RG.story.w}|${V.storyH}`;
    let fadeK = 1, past = true;
    if (S.swap) { const dt = tn - S.swap.t0, D = red ? T.reduced : S.swap.dur, k = band(dt, 0, D); fadeK = Math.abs(k * 2 - 1); past = k >= 0.5; if (dt >= D) S.swap = null; }
    if (S.storyKey !== key && past) { S.storyKey = key; el.story.innerHTML = fitStory(view, idx, V.storyH); el.story.scrollTop = 0; }
    // (while the timeline moves down, the story's room closes from below: its box ends where that room ends)
    const sIn = r(done - 100, done + 220), sa = sIn * fadeK * (gr ? gr.story : 1), sTop = (red ? V.storyTop + OY : axisY + RG.AX) + (1 - sIn) * 6;
    put('storyPos', el.story, { left: `${RG.story.x}px`, top: `${sTop.toFixed(1)}px`, width: `${RG.story.w}px`, height: `${Math.max(0, Math.min(V.storyH, RG.story.bottom - sTop)).toFixed(1)}px`,
      opacity: sa.toFixed(3), visibility: sa > 0.01 ? 'visible' : 'hidden', 'pointer-events': sa > 0.5 ? 'auto' : 'none' });
    // while the globe is big, a tap on the paper puts it back: everything under the top bar, beneath the globe, the rows,
    // the (i) and the buttons, which keep their own taps
    if (RG.big && S.big) put('paper', el.paper, { display: 'block', left: '0px', top: `${G.top}px`, width: `${G.W}px`, height: `${G.H - G.top}px` });
    else put('paper', el.paper, { display: 'none' });
  }

  /**
   * The axis, in the page's coordinates. On arrival (m from 0 to 1) every tick goes from where the dial drew it to where
   * the chart draws it, the dial's brass bar fades as the needle does. Then each tick's place and weight mix between the
   * two timelines' years (e): game.js's label steps (the first that leaves 46 px between labels), minor ticks on whole
   * years only, and a year's label never depends on its tick; a year both timelines print stays, the others hand over
   * (out in the first half, in in the second). The column's foot runs from the rows' box down to the axis.
   */
  function axisSVG(m, col, e, Y1, rowsH, alpha, oy = 0) {
    if (alpha < 0.01) return '';
    const g = G, RG = g.res, ox = RG.rows.x, xr = xAt(e), xc = (yr) => ox + xr(yr), cx0 = ox + PX0, cx1 = ox + RG.rows.w, year = S.answer.dial;
    const dx0 = g.dial.x0, dw = g.dial.x1 - g.dial.x0, xd = (yr) => dx0 + dw / 2 + (yr - year) * g.ppy;
    const X = (yr) => mix(xd(yr), xc(yr), m), Y = mix(g.dial.y, Y1, m);
    const rule = (v) => { const [a, b] = S.span[v], pp = (RG.rows.w - PX0) / (b - a), step = [5, 10, 20, 25, 50].find((s) => s * pp >= 46) ?? 50;
      return { a, b, step, minor: [step / 5, step / 2, step].find((x) => Number.isInteger(x) && x * pp >= 5) ?? step }; };
    const Qg = rule('g'), Qk = rule('k'), wt = (Q, yr) => (yr >= Q.a && yr <= Q.b && yr % Q.minor === 0 ? (yr % Q.step === 0 ? 1 : 0.55) : 0), lab = (Q, yr) => (yr >= Q.a && yr <= Q.b && yr % Q.step === 0 ? 1 : 0);
    const edgeD = (px) => Math.max(0, Math.min(1, (px - dx0) / 40, (dx0 + dw - px) / 40));
    const fs = g.tiny ? ` style="font-size:${mix(11, 10, m).toFixed(2)}px"` : ''; // the smallest phones: the dial's 11 px years become the chart's 10
    let s = `<g opacity="${alpha.toFixed(3)}"><g class="g-axis"><line x1="${mix(dx0, cx0 - 10, m).toFixed(1)}" x2="${mix(g.dial.x1, cx1, m).toFixed(1)}" y1="${Y.toFixed(1)}" y2="${Y.toFixed(1)}"/>`;
    const lo = Math.max(R.AXIS_START, Math.floor(Math.min(Qg.a, Qk.a, year - dw / 2 / g.ppy))), hi = Math.min(endYear, Math.ceil(Math.max(Qg.b, Qk.b, year + dw / 2 / g.ppy)));
    for (let yr = lo; yr <= hi; yr++) {
      const px = X(yr), inPlot = m < 1 || (px >= cx0 - 0.5 && px <= cx1 + 0.5), dA = (1 - m) * edgeD(xd(yr)) * (yr % 5 ? 0.55 : 1);
      const a = dA + m * mix(wt(Qg, yr), wt(Qk, yr), e) * (inPlot ? 1 : 0), major = mix(yr % Qg.step === 0 ? 1 : 0, yr % Qk.step === 0 ? 1 : 0, e);
      if (a >= 0.01) s += `<line x1="${px.toFixed(1)}" x2="${px.toFixed(1)}" y1="${Y.toFixed(1)}" y2="${(Y + mix(yr % 10 === 0 ? 10 : yr % 5 === 0 ? 7 : 4, mix(4, 7, major), m)).toFixed(1)}" opacity="${a.toFixed(3)}"/>`;
      const lg = lab(Qg, yr), lk = lab(Qk, yr), lw = lg && lk ? 1 : lg * clamp(1 - 2 * e, 0, 1) + lk * clamp(2 * e - 1, 0, 1);
      const lA = (1 - m) * (yr % 10 === 0 ? edgeD(xd(yr)) : 0) + m * lw * (px > cx0 + 10 && px < cx1 - 10 ? 1 : 0);
      if (lA > 0.01) s += `<text x="${px.toFixed(1)}" y="${(Y + mix(24, 22, m)).toFixed(1)}" opacity="${lA.toFixed(3)}"${fs}>${yr}</text>`;
    }
    s += '</g>';
    const [p0, p1] = S.period, wx0 = mix(xd(S.game.lo - 0.5), xc(p0), m), wx1 = mix(xd(S.game.hi + 0.5), xc(p1), m), bottom = RG.rows.top + oy + rowsH;
    if (m < 1) s += `<rect class="g-bar is-win" x="${wx0.toFixed(1)}" y="${(Y - 8).toFixed(1)}" width="${(wx1 - wx0).toFixed(1)}" height="5" rx="2.5" opacity="${(1 - m).toFixed(3)}"/>`;
    const foot = clamp(col * (rowsH + (Y - bottom)), 0, Y - bottom);
    if (m >= 1 && foot > 0) s += `<rect class="g-band" x="${wx0.toFixed(1)}" y="${(Y - foot).toFixed(1)}" width="${(wx1 - wx0).toFixed(1)}" height="${foot.toFixed(1)}"/>`
      + [wx0, wx1].map((x) => `<line class="g-edge" x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="${(Y - foot).toFixed(1)}" y2="${Y.toFixed(1)}"/>`).join('');
    if (m < 0.99) s += `<line class="g-needle is-landed" opacity="${(1 - m).toFixed(3)}" x1="${X(year).toFixed(1)}" x2="${X(year).toFixed(1)}" y1="${(Y - 14).toFixed(1)}" y2="${(Y + 12).toFixed(1)}"/>`;
    return s + '</g>';
  }

  /**
   * One row, in its own box (P px tall): the column behind it (colH of it, rising from the axis), then, at its opacity, the
   * dotted track and the bar of its clue's years (grown out of the answer on arrival); a guess's tick, year and ✓ / ✗;
   * a change's year beside the end of its bar nearest the answer: outside the bar, in the ✓ / ✗ gutter where it must,
   * inside the bar where there is no room. p: its arrival (a, pop, grow); dim: today's 35% for the rows not chosen.
   */
  function rowSVG(row, x, p, colH, dim) {
    const P = G.res.P, X1 = G.res.rows.w, cy = P / 2, half = P / 2 - 4.5, [p0, p1] = S.period, ch = clamp(colH, 0, P);
    let s = ch > 0 ? `<rect class="g-band" x="${x(p0).toFixed(1)}" y="${(P - ch).toFixed(1)}" width="${(x(p1) - x(p0)).toFixed(1)}" height="${ch.toFixed(1)}"/>`
      + [p0, p1].map((ex) => `<line class="g-edge" x1="${x(ex).toFixed(1)}" x2="${x(ex).toFixed(1)}" y1="${(P - ch).toFixed(1)}" y2="${P}"/>`).join('') : '';
    s += `<g opacity="${(p.a * dim).toFixed(3)}"><line class="g-track" x1="${PX0}" x2="${X1}" y1="${cy}" y2="${cy}"/>`;
    if (row.clue) for (const [from, to] of row.spans ?? [[row.from, row.to]]) { // (a sender's answer may allow two stretches)
      const xa = Math.max(PX0, x(from ?? R.AXIS_START - 1)), xb = Math.min(X1, x(to ?? endYear + 1)), an = clamp(x(S.game.year + 0.5), xa, xb);
      const ga = mix(an, xa, p.grow), gb = mix(an, xb, p.grow);
      if (gb - ga > 0.5) s += `<rect class="g-bar" x="${ga.toFixed(1)}" y="${(cy - 3).toFixed(1)}" width="${(gb - ga).toFixed(1)}" height="6" rx="3"/>`;
    }
    if (row.reply) s += `<path class="row-mark ${row.reply === 'yes' ? 'yes' : 'no'}" transform="translate(10,${cy})" d="${MARK[row.reply === 'yes' ? 'yes' : 'no']}"/>`;
    if (row.kind === 'guess') {
      const gx = x(row.h.g + 0.5), right = gx > X1 - 34;
      if (gx > PX0 - 2 && gx < X1 + 2) s += `<g class="g-said g-guessed" transform="translate(0,${((1 - p.a) * -6).toFixed(1)})"><line x1="${gx.toFixed(1)}" x2="${gx.toFixed(1)}" y1="${(cy - half - 1).toFixed(1)}" y2="${(cy + half + 1).toFixed(1)}"/><text x="${(gx + (right ? -4 : 4)).toFixed(1)}" y="${(cy - 1.5).toFixed(1)}" style="text-anchor:${right ? 'end' : 'start'}">${row.h.g}</text></g>`;
      s += `<path class="row-mark ${row.h.win ? 'yes' : 'no'}" transform="translate(10,${cy}) scale(${mix(0.2, 1, p.pop).toFixed(3)})" opacity="${p.pop.toFixed(3)}" d="${MARK[row.h.win ? 'yes' : 'no']}"/>`;
    } else {
      const ex = x(row.at), out = row.side < 0 ? ex - 5 : ex + 5, room = row.side < 0 ? out - (row.reply ? PX0 : 2) : X1 - out, flip = room < 30, tx = flip ? (row.side < 0 ? ex + 5 : ex - 5) : out;
      if (ex > PX0 - 1 && ex < X1 + 1) s += `<text class="g-at" x="${tx.toFixed(1)}" y="${(cy + 3.8).toFixed(1)}" style="text-anchor:${(row.side < 0) !== flip ? 'end' : 'start'}">${Math.floor(row.at)}</text>`;
    }
    return s + '</g>';
  }

  let lastT = 0;
  function loop(time) {
    if (!on || held) return;
    raf = requestAnimationFrame(loop);
    const dt = Math.min(64, time - lastT); lastT = time;
    if (S.game) {
      if (S.phase === 'play' && S.hist.length && !S.hopped && (elapsed() >= 520 || reduced())) hop();
      if (S.phase === 'reveal') {
        if (S.idleAt && now() >= S.idleAt) { S.idleAt = 0; if (!S.own && !reduced()) globe.setIdle(true); }
      }
      stepCamera(dt);
    }
    render(frame());
  }

  // ------------------------------------------------------------------ hands
  const pt = (e) => ({ x: e.clientX, y: e.clientY });
  const startGrab = (p, moved = 0) => { const c = globe.camera(); S.grab = { g0: globe.geoAt(p.x, p.y), last: p, t0: now(), moved, samples: [{ t: now(), lon: c.lon, lat: c.lat }] }; };
  el.hit.addEventListener('pointerdown', (e) => {
    if (!S?.game || !grabbable() || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); try { el.hit.setPointerCapture(e.pointerId); } catch {}
    clearTimeout(shrinkSoon); // a second touch: a double tap, a drag or a pinch, not a tap that puts the big globe back
    // the first finger of a new touch: any finger still on record lifted where the globe didn't hear it (Safari drops the
    // pointerup when capture is lost); kept, it would pair with every later finger as a pinch about a phantom point
    if (e.isPrimary) { S.ptrs.clear(); S.pinch = null; S.grab = null; }
    own(); S.coast = null; S.zoom = null;
    const p = pt(e); S.ptrs.set(e.pointerId, p);
    if (S.ptrs.size === 1) startGrab(p);
    else if (S.ptrs.size === 2) { const [a, b] = [...S.ptrs.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; S.pinch = { d0: Math.max(8, Math.hypot(a.x - b.x, a.y - b.y)), z0: globe.camera().zoom, g0: globe.geoAt(m.x, m.y) }; S.grab = null; }
  });
  el.hit.addEventListener('pointermove', (e) => {
    if (!S?.ptrs.has(e.pointerId)) return;
    const p = pt(e); S.ptrs.set(e.pointerId, p);
    if (S.pinch && S.ptrs.size >= 2) {
      const [a, b] = [...S.ptrs.values()], m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, c = globe.camera();
      globe.lookAt({ ...c, zoom: clamp(S.pinch.z0 + Math.log(Math.hypot(a.x - b.x, a.y - b.y) / S.pinch.d0) / Math.log(1.55), ZMIN, ZMAX) });
      if (S.pinch.g0) pin(S.pinch.g0, m);
    } else if (S.grab) {
      const Gr = S.grab; Gr.moved += Math.hypot(p.x - Gr.last.x, p.y - Gr.last.y);
      if (Gr.moved >= 6) {
        if (!(Gr.g0 && pin(Gr.g0, p))) { // off the earth's edge: turn by the distance moved
          const c = globe.camera(), kk = 57.3 / globe.lens().earth;
          globe.lookAt({ lon: c.lon - (p.x - Gr.last.x) * kk, lat: clamp(c.lat + (p.y - Gr.last.y) * kk, -80, 80), zoom: c.zoom }); Gr.g0 = null;
        }
        const c = globe.camera(); Gr.samples.push({ t: now(), lon: c.lon, lat: c.lat }); Gr.samples = Gr.samples.filter((s) => now() - s.t < 90);
      }
      Gr.last = p;
    }
  });
  /** A double tap steps in. */
  const tap = (p) => {
    if (S.phase === 'reveal' && G.res?.big && !S.big) { setBig(true); S.lastTap = null; return; } // the medallion: it grows (no double tap here)
    const t = now();
    if (S.lastTap && t - S.lastTap.t < 320 && Math.hypot(p.x - S.lastTap.p.x, p.y - S.lastTap.p.y) < 34) { zoomAt(p, globe.camera().zoom + STEP); S.lastTap = null; }
    else {
      S.lastTap = { t, p };
      // the big globe: a single tap puts it back, once no second tap has come to step in (a touch in between cancels it)
      if (S.phase === 'reveal' && S.big) { const mine = S, tp = S.lastTap; clearTimeout(shrinkSoon); shrinkSoon = setTimeout(() => { if (S === mine && S.lastTap === tp && !S.ptrs.size) setBig(false); }, 320); }
    }
  };
  let shrinkSoon = 0;
  const release = (e) => {
    if (!S?.ptrs.has(e.pointerId)) return;
    const p = S.ptrs.get(e.pointerId); S.ptrs.delete(e.pointerId);
    if (S.pinch) { S.pinch = null; if (S.ptrs.size === 1) startGrab([...S.ptrs.values()][0], 99); return; }
    const Gr = S.grab; S.grab = null; if (!Gr) return;
    if (Gr.moved < 6 && now() - Gr.t0 < 300) { if (e.type === 'pointerup') tap(p); return; }
    const a = Gr.samples[0], b = Gr.samples[Gr.samples.length - 1];
    if (!reduced() && b.t - a.t > 12 && now() - b.t < 60) S.coast = { vlon: (((b.lon - a.lon + 540) % 360) - 180) / (b.t - a.t), vlat: (b.lat - a.lat) / (b.t - a.t) }; // the globe coasts on
  };
  el.hit.addEventListener('pointerup', release); el.hit.addEventListener('pointercancel', release); el.hit.addEventListener('lostpointercapture', release);
  el.hit.addEventListener('wheel', (e) => {
    if (!S?.game || !grabbable()) return;
    e.preventDefault(); own(); S.coast = null; S.zoom = null;
    const p = pt(e), g0 = globe.geoAt(p.x, p.y), c = globe.camera();
    globe.lookAt({ ...c, zoom: clamp(c.zoom - (e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (e.ctrlKey ? 0.012 : 0.0025)) / Math.log(1.55), ZMIN, ZMAX) });
    if (g0) pin(g0, p);
  }, { passive: false });
  el.hit.addEventListener('keydown', (e) => {
    if (!S?.game || !grabbable()) return;
    if (S.phase === 'reveal' && G.res?.big && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setBig(!S.big); return; }
    const c = globe.camera(), step = 14 / Math.pow(1.55, c.zoom - 1);
    const to = { ArrowLeft: { lon: c.lon - step }, ArrowRight: { lon: c.lon + step }, ArrowUp: { lat: clamp(c.lat + step, -80, 80) }, ArrowDown: { lat: clamp(c.lat - step, -80, 80) },
      '+': { zoom: clamp(c.zoom + 0.5, ZMIN, ZMAX) }, '=': { zoom: clamp(c.zoom + 0.5, ZMIN, ZMAX) }, '-': { zoom: clamp(c.zoom - 0.5, ZMIN, ZMAX) } }[e.key];
    if (e.key === '0' || e.key === 'Home') { e.preventDefault(); own(); goHome(); return; }
    if (!to) return;
    e.preventDefault(); own(); S.coast = null; S.zoom = null; globe.lookAt({ ...c, ...to });
  });

  // the result's rows: a tap (or Enter) chooses a row (its story, its place on the globe); the arrows move between them.
  // While the globe is big, a row's tap also puts it back
  for (const v of VIEWS) {
    el.rows[v].addEventListener('scroll', () => fades(v), { passive: true });
    new ResizeObserver(() => fades(v)).observe(el.rows[v]); // its height comes with the layout
    el.rows[v].addEventListener('click', (e) => { const b = e.target.closest('.g-row'); if (b && S?.views && arrived()) { setBig(false); select(v, Number(b.dataset.i)); } });
    el.rows[v].addEventListener('keydown', (e) => {
      const d = { ArrowDown: 1, ArrowUp: -1 }[e.key]; if (!d || !S?.views || !arrived()) return;
      e.preventDefault(); setBig(false); select(v, clamp(S.sel[v] + d, 0, S.views[v].length - 1), true);
    });
  }
  // the paper puts the big globe back: a tap anywhere around it, the timeline's label and axis too (held by pointer
  // capture: the timeline may still be moving under the finger); Esc anywhere does too
  let paperDown = null;
  el.paper.addEventListener('pointerdown', (e) => { if (e.pointerType === 'mouse' && e.button !== 0) return; paperDown = { id: e.pointerId, x: e.clientX, y: e.clientY, t: now() }; try { el.paper.setPointerCapture(e.pointerId); } catch {} });
  el.paper.addEventListener('pointerup', (e) => { const d = paperDown; paperDown = null; if (d && d.id === e.pointerId && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 10 && now() - d.t < 500) setBig(false); });
  el.paper.addEventListener('pointercancel', () => { paperDown = null; });
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && on && S?.big) setBig(false); });
  // the (i): your guesses ↔ why that year (a button: Enter and Space too)
  el.info.addEventListener('click', () => { if (S?.views) switchTo(S.view === 'g' ? 'k' : 'g'); });

  // the dial: it follows the finger, glides on, lands on a whole year; the bar's ends hold it like a rubber band
  el.dialHit.addEventListener('pointerdown', (e) => {
    if (!S?.game || S.phase !== 'play' || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); el.dialHit.setPointerCapture(e.pointerId);
    settleDial(); S.drag = { id: e.pointerId, x: e.clientX, v0: S.v, samples: [{ t: now(), x: e.clientX }] };
  });
  el.dialHit.addEventListener('pointermove', (e) => {
    if (!S?.drag || S.drag.id !== e.pointerId) return;
    let v = S.drag.v0 - (e.clientX - S.drag.x) / G.ppy;
    const [lo, hi] = liveBounds(); if (v < lo) v = lo - (lo - v) * 0.55; if (v > hi) v = hi + (v - hi) * 0.55;
    S.v = v; S.drag.samples.push({ t: now(), x: e.clientX }); S.drag.samples = S.drag.samples.filter((s) => now() - s.t < 90);
  });
  const dialUp = (e) => {
    if (!S?.drag || S.drag.id !== e.pointerId) return;
    const Sm = S.drag.samples, a = Sm[0], b = Sm[Sm.length - 1], vel = b.t > a.t && now() - b.t < 60 ? -((b.x - a.x) / (b.t - a.t)) / G.ppy : 0; // years per ms
    S.drag = null; glideDial(S.v + vel * 500, vel);
  };
  el.dialHit.addEventListener('pointerup', dialUp); el.dialHit.addEventListener('pointercancel', dialUp);
  /** Momentum (×0.998 a ms) says where it would stop; it lands on that whole year on the keyboard curve. */
  function glideDial(target, vel = 0) {
    const from = S.v, [lo, hi] = liveBounds(), to = Math.round(clamp(target, lo, hi)), dist = Math.abs(to - from);
    const dur = from < lo || from > hi ? 380 : clamp(Math.abs(vel) > 1e-4 ? (4 * dist) / Math.abs(vel) : 220, 220, 1800);
    if (reduced() || dist < 0.01) { S.v = to; S.anim = null; } else S.anim = { from, to, t0: now(), dur };
  }
  el.dialHit.addEventListener('wheel', (e) => {
    if (!S?.game || S.phase !== 'play') return;
    e.preventDefault(); settleDial();
    const [lo, hi] = liveBounds(), d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    S.v = clamp(S.v + (d * (e.deltaMode === 1 ? 16 : 1)) / G.ppy / 2, lo, hi);
    clearTimeout(wheelRest); wheelRest = setTimeout(() => { if (S?.game && S.phase === 'play' && !S.drag) glideDial(S.v); }, 140);
  }, { passive: false });
  let wheelRest = 0;
  el.dialHit.addEventListener('keydown', (e) => {
    if (!S?.game || S.phase !== 'play') return;
    const [lo, hi] = liveBounds(), base = Math.round(S.anim ? S.anim.to : curV());
    const to = { ArrowLeft: base - 1, ArrowDown: base - 1, ArrowRight: base + 1, ArrowUp: base + 1, PageDown: base - 10, PageUp: base + 10, Home: lo, End: hi }[e.key];
    if (e.key === 'Enter') { e.preventDefault(); guess(); return; }
    if (to == null) return;
    e.preventDefault(); settleDial(); S.v = clamp(to, lo, hi);
  });
  el.guess.addEventListener('click', () => {
    if (!S?.game) return;
    if (S.phase !== 'reveal') { guess(); return; }
    // Play again: back to the landing page (app.js), where either part can be chosen
    sharer.close();
    onAgain();
  });
  el.share.addEventListener('click', () => {
    if (!S?.game || S.phase !== 'reveal') return;
    // a friend's globe is shared as itself (the same ?d= link); any other game as its ?g= code
    const code = S.code ?? R.gameCode(S.game.year, S.game.seed);
    sharer.open({ button: el.share, code, pages: [{ ...SHARE.game, text: scoreMessage(S.game, S.hist, S.code ? datedLink(code) : gameLink(code)) }] });
  });

  // ------------------------------------------------------------------ in and out
  /**
   * year / seed: a given game (links, tests); again: the screen is already up (Play again); friend: opened from a shared
   * link; custom: a friend's globe's code (?d=; one that can't be read goes back to the app: onInvalid).
   */
  async function start({ year = null, seed = undefined, again = false, friend = false, custom = null } = {}) {
    const mine = ++run;
    words = friend ? { ...WORDS, ...FRIEND } : WORDS; lookText0 = { tag: words.tag, title: WORDS.question, why: null };
    on = true; host.hidden = false;
    sharer.close();
    S = fresh();
    for (const v of VIEWS) el.rowsIn[v].innerHTML = ''; el.story.innerHTML = ''; el.info.setAttribute('aria-pressed', 'false');
    place();
    render(frame());
    cancelAnimationFrame(raf); lastT = now(); raf = requestAnimationFrame(loop);
    D ??= await load();
    if (!on || mine !== run) return;
    // a clue's label on land no territory covers must name what the globe prints there (globeFits): the globe's coastline
    D.land ??= D.world && window.topojson.feature(D.world, D.world.objects.land);
    D.fits ??= R.globeFits(D.names, { ...D.scenes, onLand: (p) => !!D.land && window.d3.geoContains(D.land, p) });
    D.seen ??= R.seenFrom(D.names);
    // a friend's globe: the sender's answers in its link, composed into their globe (custom-globe.js); a link that can't
    // be read (cut short, mistyped, made with data this app no longer has) goes back to the app
    let cg = null, game = null;
    if (custom) {
      const spec = readLink(custom, D.bundle);
      if (spec.error) { console.warn(`?d= link not read (${spec.error}):`, custom); stop(); onInvalid(spec.error); return; }
      const overlaps = await D.overlaps();
      if (!on || mine !== run) return;
      D.composer ??= createCustomGlobe({ topo: D.scenes.topo, overlaps, names: D.names, bundle: D.bundle, topojson: window.topojson, d3: window.d3, optionsFor: D.optionsFor, endYear });
      cg = D.composer.compose(spec);
      game = customGame(D.bundle, D.optionsFor, cg, { agree: spec.agree, seed: codeSeed(custom), endYear, fits: D.fits, seen: D.seen });
      if (debug) { console.table(cg.report); console.info('custom globe', { base: cg.base, win: game.win, pool: game.pool.length, answers: game.pool.filter((c) => c.fact).length, gap: cg.gap, overlap: cg.overlap }); }
    }
    S.custom = cg; S.code = cg ? custom : null;
    game ??= R.newGame(D.bundle, D.optionsFor, { year, seed, endYear, fits: D.fits, seen: D.seen });
    const t = game.year + 0.5;
    // the world that year: its borders, and the globe's own layer (lakes, the Date Line, the Canal Zone, …)
    const layer = cg ? cg.layer : R.layersAt(D.bundle, t);
    S.game = game; S.world = cg ? cg.world : { ...D.scenes.worldAt(t), overlays: layer.overlays };
    el.dialHit.setAttribute('aria-valuemin', R.AXIS_START); el.dialHit.setAttribute('aria-valuemax', endYear);
    globe.setScene(S.world); globe.setLabelsShown(true);
    // a place the layer prints with its ruler ("Hong Kong (Br.)") is not printed again as a plain city
    if (cg) globe.setNames(cg.names);
    else {
      const named = R.placesAt(D.names, D.scenes.countriesAt(t), t), own = new Set(layer.places.map((p) => p[0]));
      globe.setNames({ ...named, cities: named.cities.filter((c) => !own.has(c[0])), places: layer.places, peaks: layer.peaks });
    }
    if (again) { const c = globe.camera(); globe.flyTo({ lon: c.lon + 40, lat: 15, zoom: 1 }, reduced() ? 0 : 900, { mark: false }); setTimeout(() => { if (on && mine === run && !S.own && !S.hist.length && !reduced()) globe.setIdle(true); }, 950); }
    else globe.setIdle(!reduced()); // reduced motion: the globe waits for a hand
    S.phase = 'play'; S.arriving = !reduced(); S.t0 = now(); S.v = START_YEAR;
    el.restIn.textContent = ''; el.odo.setAttribute('aria-label', String(START_YEAR));
    markBusy(1700);
  }
  function stop() {
    if (!on) return;
    on = false; run++; cancelAnimationFrame(raf);
    sharer.close();
    host.hidden = true; S = null; last = {}; if (canvas) canvas.style.opacity = '';
    globe.setNames(null); globe.setLensBox(null); globe.setLabelsShown(true);
  }
  const relayout = () => { if (on) place(); };
  addEventListener('resize', relayout);
  onLayout(() => requestAnimationFrame(relayout));
  if (debug) window.__gameStart = (o) => start({ again: true, ...o });
  if (debug) window.__gameLook = (cam) => { if (!S?.game) return; own(); S.coast = null; S.zoom = null; globe.setIdle(false); globe.lookAt(cam); }; // tests: point the camera
  if (debug) window.__gameNames = () => globe.namesNow(); // tests: what the globe prints now
  if (debug) window.__custom = () => S?.custom && { base: S.custom.base, report: S.custom.report, gap: S.custom.gap, overlap: S.custom.overlap, groups: S.custom.groups, win: S.game.win, pool: S.game.pool.map((c) => [c.feature.id, !!c.fact]), rows: S.game.rows.map((r) => r.claim), names: S.custom.names };
  if (debug) window.__game = () => ({ S, G, on, year: S?.game?.year, clues: S?.hist.map((h) => h.next?.feature.id ?? null), cam: globe.camera(), flying: globe.isFlying(), arrived: S?.views ? arrived() : false, doneAt: S?.views ? doneAt() : null, big: S?.big ?? false, growing: !!S?.grow });

  return { start, stop, isOn: () => on };
}
