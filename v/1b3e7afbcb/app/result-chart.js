// The result's chart on phones (vp-compact): the quiz strip becomes the chart, the replay zooms in with the
// evidence, and the settled chart can be dragged through the years.
//
// The arrival is one clock from the tap on Next. The strip's axis rises from where the strip was to the
// chart's axis and zooms out to every year, while the strip's bars fade where they are; the flat belief curve
// rises out of the axis and the rows lay down faint full-width bars. Then the replay, with verdict.js's beats:
// each answer's mark appears, its bar contracts, the curve reshapes and leaves a ridge. New here: the view
// follows the belief (the strip's own rule, timeline-sheet.js viewFor), and every tween starts from where the
// last one is, so nothing snaps. Last the window opens from the peak.
//
// Settled, the chart is at most eight rows tall (more scroll natively, soft edges where rows hide). A sideways
// drag moves the curve, the rows and the axis together; let go and it glides like an iOS list, stretching past
// 1886 or today and springing back. A tap on a row opens a line under it, as in the quiz sheet: the claim, your
// tick or cross, the years it allows; the other rows and the window step back and the curve shows the belief
// right after that answer. Tapping the line asks that question again.
//
// The (i) names the chart's parts in place ("range on top"): the peak's year steps aside for a brass bracket
// over the window, "Likely range 1891 – 1896" above it; under the axis the agreement column opens with an ink
// bracket, "All 8 answers agree · Jan 1890 – Oct 1893". The space under the axis grows for it (the rows give
// up height when they must); nothing above the chart moves. A tap on a name lights its part until tapped again.
//
// On an upright phone (body.res-phone) the chart is one fixed block: the curve, at most eight rows, the axis and one
// caption line, 45 px under the axis at the 20 px margin. The line says "Tap an answer to review or change it.", or, with
// the (i) open, names the agreement, on the same baseline. Nothing inside changes the block's size: the (i) takes no
// rows and an opening row line scrolls the rows. app.js places the block with equal gaps above and below (chartDims).
//
// Everything is drawn by draw() from a plain description; nothing is measured while something moves.
//
//   show({ rows, frames, window, agree, peak }, { animate, from, onStep, onVerdict })
//     from: { strip: { rect, view }, segs } where the quiz strip was (viewport px) and its window, or null
//   skip()  hide()  showInfo(on)  relayout()
//   revealFoot(delay): the caption line's footnote rises `delay` ms from now (the verdict's last beat)
//   onInfo(false): the chart closed its names itself (a tap under it, Escape), for the (i) to follow

import { fitClaim } from './claim-fit.js';
import { markBusy } from './quiet.js';

const MAXROWS = 8, LINE = 50, AXH = 24, GHOST = 0.16, STRIP_ROW = 13;
const LINE_OPEN = 320, LINE_FOLD = 260, SPRING = 380;
const INFO_OPEN = 440, INFO_CLOSE = 380, INFO_RUN = 900, LIT_ON = 320, LIT_OFF = 260;
const BRACKET_Y = 12, INK_Y = 30;
const CAP_BASE = 45, FOOT_RISE = 400; // the caption line's baseline under the axis; the footnote's rise
const FOOT = 'Tap an answer to review or change it.'; // the brass bracket over the window (from the chart's top); the ink one under the axis
const BEAT = { chart: 1250, t0: 700 };
const MARK_PATH = { yes: 'M-3.4,0.2L-1.1,2.6L3.5,-2.8', no: 'M-2.8,-2.8L2.8,2.8M-2.8,2.8L2.8,-2.8' };

function bezier(x1, y1, x2, y2) {
  const B = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t) => { if (t <= 0) return 0; if (t >= 1) return 1; let lo = 0, hi = 1, s = t; for (let i = 0; i < 20; i++) { if (B(x1, x2, s) < t) lo = s; else hi = s; s = (lo + hi) / 2; } return B(y1, y2, s); };
}
const CURVE = bezier(0.2, 0.8, 0.2, 1); // the keyboard's curve: every spatial move
const EASE = bezier(0.25, 0.1, 0.25, 1); // CSS 'ease': fades
const mix = (a, b, e) => a + (b - a) * e;
const band = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const backOut = (t) => { const s = 1.70158; return --t * t * ((s + 1) * t + s) + 1; };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const mixView = (a, b, e) => [mix(a[0], b[0], e), mix(a[1], b[1], e)];
const mixArr = (a, b, e) => a.map((v, i) => mix(v, b[i], e));
const rubber = (over, dim) => (1 - 1 / ((over * 0.55) / dim + 1)) * dim; // UIScrollView's stretch

/** A chain of eases where each starts from wherever the last one is when it begins (no snaps). */
function chain(start, events, t, lerp, ease) {
  let v = start;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    if (t < ev.t0) break;
    const from = ev.from ?? v, next = events[i + 1]?.t0 ?? Infinity;
    v = lerp(from, ev.to, ease(band(Math.min(t, next), ev.t0, ev.t0 + ev.ms)));
    if (t < next) return { v, ev: { ...ev, from }, e: band(t, ev.t0, ev.t0 + ev.ms) };
  }
  return { v, ev: null, e: 1 };
}

/** The chart's curve height and row pitch at a viewport height (app.js lays out the fixed block with them). */
export function chartDims(vh) {
  return { curveH: vh >= 800 ? 120 : vh >= 640 ? 100 : 80, pitch: vh >= 800 ? 26 : vh >= 640 ? 24 : 21, maxRows: MAXROWS, caption: CAP_BASE + 3 };
}

let uidSeq = 0;
export function createResultChart(wrapEl, startYear, endYear, { onSelect, onInfo } = {}) {
  const START = startYear, UNTIL = endYear + 1, FULL = [START, UNTIL];
  const uid = `rc${++uidSeq}`;
  const root = document.createElement('div');
  root.className = 'rc';
  root.hidden = true;
  root.innerHTML = `<svg class="rc-top" aria-hidden="true"></svg>
    <div class="rc-rows"><svg class="rc-rowsvg" aria-hidden="true"></svg><div class="rc-hits" role="list" aria-label="Your answers, in the order given. ${FOOT}"></div></div>
    <svg class="rc-over" aria-hidden="true"></svg>
    <div class="rc-labels" hidden><button type="button" class="rc-label" data-k="1" aria-pressed="false"></button><button type="button" class="rc-label" data-k="2" aria-pressed="false"></button></div>`;
  wrapEl.appendChild(root);
  const topSvg = root.querySelector('.rc-top'), rowsBox = root.querySelector('.rc-rows'), rowSvg = root.querySelector('.rc-rowsvg');
  const hits = root.querySelector('.rc-hits'), over = root.querySelector('.rc-over');
  const labelsEl = root.querySelector('.rc-labels'), labelBtns = [...labelsEl.children];

  // --- State --------------------------------------------------------------------------
  let data = null, G = null, T = null;
  let mode = 'off';             // 'arrive' | 'settled'
  let t0 = 0, fired = 0, pendingVerdict = null, onStepCb = null, from = null;
  let o = 0, vo = 0, spring = null, drag = null, suppressClick = false, lastT = 0;
  let lines = [];               // [{ i, from, to, t0, dur }]
  let info = { target: false, from: 0, to: 0, t0: 0, dur: 0, instant: false }; // the names, opened by the (i)
  let lit = [];                 // [{ k, from, to, t0, dur }]: a tapped name's part, lit (1 the window, 2 the agreement)
  let raf = 0;
  let footT0 = null;            // when the footnote rises (null: already shown)
  const now = () => performance.now();

  // --- Geometry: measured on show and on resize only ---------------------------------------
  function measure() {
    const W = wrapEl.clientWidth, H = wrapEl.clientHeight, { curveH, pitch } = chartDims(innerHeight);
    // The fixed block (upright phones) keeps one 20 px margin: the marks' left edge and the axis's end (the wrap sits 14 px in)
    const fixed = document.body.classList.contains('res-phone');
    const n = data.rows.length, x0 = fixed ? 21.5 : 30, x1 = fixed ? W - 6 : W - 16;
    const room = fixed ? 0 : clamp(H - (curveH + Math.min(n, MAXROWS) * pitch + AXH + 2), 0, LINE);
    G = { W, H, curveH, pitch, n, x0, x1, room, fixed, barH: clamp(pitch * 0.32, 5, 8) };
  }
  /**
   * Where the parts are this frame, with row lines open (lineSum px) and `below` px kept free under the axis
   * (the names). Short of room: the rows give up height first, down to three; then the curve, down to 56 px;
   * then the rows again. The axis's labels always end above the buttons.
   */
  function geom(lineSum = 0, below = 0) {
    const base = Math.min(G.n, MAXROWS) * G.pitch, content = G.n * G.pitch + lineSum;
    const want = Math.min(content, base + Math.min(G.room, lineSum));
    const limit = G.fixed ? Infinity : G.H - below, keep = Math.min(want, 3 * G.pitch);
    let curveH = G.curveH, rowsMax = limit - (curveH + AXH + 2);
    if (rowsMax < keep) { curveH = Math.max(56, curveH - (keep - rowsMax)); rowsMax = limit - (curveH + AXH + 2); }
    const regionH = Math.max(Math.min(G.pitch, want), Math.min(want, rowsMax));
    return { curveH, regionH, content, axisY: curveH + regionH + 2 };
  }
  /** The view for a window: × 2.4, at least 30 years, on 5-year marks; held while the window stays in its middle. */
  function viewFor(w, prev) {
    if (!w) return FULL.slice();
    const width = w.hi - w.lo, want = Math.max(30, width * 2.4);
    if (want >= (UNTIL - START) * 0.75) return FULL.slice();
    if (prev && prev[1] - prev[0] < UNTIL - START) { const ps = prev[1] - prev[0], m = ps * 0.15; if (w.lo >= prev[0] + m && w.hi <= prev[1] - m && ps <= want * 1.6) return prev; }
    const c = (w.lo + w.hi) / 2; let a = c - want / 2, b = c + want / 2;
    if (a < START) { b += START - a; a = START; }
    if (b > UNTIL) { a -= b - UNTIL; b = UNTIL; }
    return [Math.max(START, Math.floor(a / 5) * 5), Math.min(UNTIL, Math.ceil(b / 5) * 5)];
  }

  /** The replay's beats, in ms from the tap on Next. */
  function timing() {
    const n = data.rows.length, stepMs = clamp(6500 / n, 300, 750), first = BEAT.chart + BEAT.t0;
    const steps = data.rows.map((_, k) => first + k * stepMs);
    const verdict = first + n * stepMs + 700;
    const zooms = [{ t0: 0, ms: 600, to: FULL.slice() }];
    for (let k = 0; k < n; k++) { const a = data.views[k], b = data.views[k + 1]; if (a[0] !== b[0] || a[1] !== b[1]) zooms.push({ t0: steps[k] + 300, ms: 600, to: b }); }
    return { stepMs, steps, verdict, zooms, end: verdict + 1600 };
  }

  // --- The clock ---------------------------------------------------------------------------
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0;
    if (mode === 'off' || !G) return;
    if (frame(now())) kick();
  }
  const lineH = (l, t) => (l.dur ? mix(l.from, l.to, CURVE(band(t - l.t0, 0, l.dur))) : l.to);
  const litH = (l, t) => (l.dur ? mix(l.from, l.to, CURVE(band(t - l.t0, 0, l.dur))) : l.to);
  const infoP = (t) => (info.dur ? mix(info.from, info.to, CURVE(band(t - info.t0, 0, info.dur))) : info.to);
  /**
   * The names as a pure function of their clock: null while closed. Opening, each part keeps its own beat from the
   * tap on the (i); closing, every part folds with the close's progress from wherever it was, so a reversal never jumps.
   */
  const PARTS = ['hide', 'brW', 'brWA', 'agreeK', 'inkA'];
  function shownParts(t) {
    if (!info.target) { const k = info.from > 0 ? infoP(t) / info.from : 0; return Object.fromEntries(PARTS.map((n) => [n, (info.fold?.[n] ?? 0) * k])); }
    const at = info.instant || reduced() ? Infinity : t - info.t0, A = !!data.agree, fl = info.floor ?? {};
    const timed = {
      hide: EASE(band(at, 0, 200)),                   // the peak's year steps aside
      brW: CURVE(band(at, 120, 570)), brWA: EASE(band(at, 230, 530)), // the brass bracket draws out from the window's middle; its name rises
      agreeK: A ? inOut(band(at, 300, 900)) : 0, inkA: A ? EASE(band(at, 600, 900)) : 0, // the agreement column opens; its name rises
    };
    return Object.fromEntries(PARTS.map((n) => [n, Math.max(fl[n] ?? 0, timed[n])]));
  }
  function infoFrame(t) {
    const p = infoP(t);
    if (!info.target && p <= 0.0005) return null;
    const v = shownParts(t), fold = info.target ? 1 : p;
    const litK = (k) => { const l = lit.find((x) => x.k === k); return (l ? litH(l, t) : 0) * fold; };
    return { below: G.fixed ? 0 : (data.agree ? 52 : 22) * p, peakYear: 1 - v.hide, brW: v.brW, brWA: v.brWA, agreeK: v.agreeK, inkA: v.inkA, litB: litK(1), litA: litK(2) };
  }

  /** One frame; returns whether anything still moves. */
  function frame(t) {
    let moving = false, d;
    if (mode === 'arrive') {
      const at = t - t0;
      // the beats the app follows: each answer as it lands, then the verdict
      while (fired < T.steps.length && at >= T.steps[fired]) onStepCb?.(fired++);
      if (pendingVerdict && at >= T.verdict) { const cb = pendingVerdict; pendingVerdict = null; cb(); }
      if (at >= T.end) settle();
      else { d = arriveFrame(at); moving = true; }
    }
    if (mode === 'settled') {
      const dt = Math.min(48, t - (lastT || t));
      if (!drag) {
        const m = omax();
        if (spring) { const e = reduced() ? 1 : CURVE(band(t - spring.t0, 0, SPRING)); o = mix(spring.from, spring.to, e); if (e >= 1) spring = null; else moving = true; }
        else if (Math.abs(vo) > 0.02) {
          o += vo * dt; vo *= Math.pow(0.998, dt);
          if (o < 0 || o > m) vo *= Math.pow(0.9, dt / 4); // past the end the glide dies fast, then springs back
          moving = true;
        } else {
          vo = 0;
          if (o < 0 || o > m) { spring = { from: o, to: clamp(o, 0, m), t0: t }; moving = true; }
        }
      }
      const ex = lines.map((l) => ({ i: l.i, h: lineH(l, t) }));
      lines = lines.filter((l) => !(l.to === 0 && t - l.t0 >= l.dur));
      if (lines.some((l) => t - l.t0 < l.dur)) moving = true;
      const inf = infoFrame(t);
      lit = lit.filter((l) => !(l.to === 0 && t - l.t0 >= l.dur));
      if (t - info.t0 < (info.target ? INFO_RUN : info.dur) || lit.some((l) => t - l.t0 < l.dur)) moving = true;
      d = settledFrame({ view: liveView(), ex, info: inf });
      if (drag) moving = true;
    }
    if (footT0 != null && t < footT0 + FOOT_RISE) moving = true;
    lastT = t;
    if (d) draw(d);
    return moving;
  }

  // --- The pan --------------------------------------------------------------------------------
  const span = () => data.finalView[1] - data.finalView[0];
  const ppy = () => (G.x1 - G.x0) / span();
  const omax = () => Math.max(0, (UNTIL - START - span()) * ppy());
  function shownO() { const m = omax(), dim = G.x1 - G.x0; return o < 0 ? -rubber(-o, dim) : o > m ? m + rubber(o - m, dim) : o; }
  function liveView() { const v0 = START + shownO() / ppy(); return [v0, v0 + span()]; }

  // --- Frames ---------------------------------------------------------------------------------
  function arriveFrame(t) {
    const z = chain(from?.strip?.view ?? FULL, T.zooms, t, mixView, CURVE);
    const zf = z.ev && z.e < 1 ? { from: z.ev.from, to: z.ev.to, e: CURVE(z.e) } : null;
    // the axis: from the strip's to the chart's
    const end = { y: geom().axisY, x0: G.x0, x1: G.x1 };
    let axis = end;
    const S = from?.strip;
    if (S) {
      const e = CURVE(band(t, 0, 440)), w = from.wrap;
      const sy = S.rect.top - w.top + S.rect.height - 22, sx0 = S.rect.left - w.left + 6, sx1 = S.rect.left - w.left + S.rect.width - 6;
      axis = { y: mix(sy, end.y, e), x0: mix(sx0, end.x0, e), x1: mix(sx1, end.x1, e) };
    }
    const curveEvents = T.steps.map((s, k) => ({ t0: s, ms: T.stepMs * 1.3, to: data.frames[k + 1].p }));
    const ps = chain(data.frames[0].p, curveEvents, t, mixArr, inOut).v;
    const ghosts = T.steps.filter((s) => t >= s).map((s, k) => ({ ps: data.frames[k].p, a: mix(0.5, GHOST, band(t, s, s + 1100)) }));
    const rows = data.rows.map((_, i) => {
      const s = T.steps[i];
      return { a: S ? band(t, 400 + i * 25, 700 + i * 25) : 1, e: inOut(band(t, s, s + 950)), op: mix(0.12, 0.5, EASE(band(t, s, s + 500))), mark: band(t, s, s + 380) };
    });
    // keep the landing row in view on long quizzes; back to the top at the verdict
    const vis = Math.min(G.n, MAXROWS) * G.pitch, maxS = Math.max(0, G.n * G.pitch - vis), ev = [];
    let target = 0;
    T.steps.forEach((s, k) => { const y = k * G.pitch; if (y < target || y > target + vis - G.pitch) { target = clamp(y - vis / 2, 0, maxS); ev.push({ t0: s, ms: 400, to: target }); } });
    if (target) ev.push({ t0: T.verdict, ms: 500, to: 0 });
    return {
      view: z.v, zf, axis, stripA: S ? 1 - band(t, 0, 200) : 0,
      curve: { ps, rise: S ? CURVE(band(t, 350, 850)) : 1, a: S ? band(t, 300, 600) : 1, ghosts },
      rows, scrollY: chain(0, ev, t, mix, CURVE).v, win: inOut(band(t, T.verdict, T.verdict + 1200)),
      peakA: EASE(band(t, T.verdict + 1500, T.verdict + 2000)), ex: [], info: null, live: false, foot: footFrame(now(), 0),
    };
  }
  function settledFrame({ view, ex = [], info: inf = infoFrame(now()) }) {
    return {
      view, zf: null, axis: null, stripA: 0,
      curve: { ps: data.frames.at(-1).p, rise: 1, a: 1, ghosts: data.frames.slice(0, -1).map((f) => ({ ps: f.p, a: GHOST })) },
      rows: data.rows.map(() => ({ a: 1, e: 1, op: 0.5, mark: 1 })), scrollY: null, win: 1, peakA: 1, ex, info: inf, live: true,
      foot: footFrame(now(), Math.max(0, ...ex.map((v) => v.h))),
    };
  }
  /** The footnote: it rises once (the verdict's last beat), then steps aside while the (i) or a row's line is open. */
  function footFrame(t, F) {
    if (!G.fixed) return null;
    const r = footT0 == null || reduced() ? 1 : EASE(band(t - footT0, 0, FOOT_RISE));
    return { a: r * (1 - infoP(t)) * (1 - Math.min(1, F * 2)), rise: r };
  }

  // --- Drawing ----------------------------------------------------------------------------------
  function ticksAt(view, w) {
    const ppy2 = w / (view[1] - view[0]), st = [5, 10, 20, 40].find((s) => s * ppy2 >= 46) ?? 40, out = [];
    for (let v = Math.ceil(view[0] / st) * st; v < view[1]; v += st) out.push(v);
    return out;
  }
  function ticks(view, zf, w) {
    if (!zf) return ticksAt(view, w).map((v) => ({ v, a: 1 }));
    const A = new Set(ticksAt(zf.from, w)), B = new Set(ticksAt(zf.to, w));
    return [...new Set([...A, ...B])].map((v) => ({ v, a: A.has(v) && B.has(v) ? 1 : A.has(v) ? 1 - band(zf.e, 0, 0.5) : band(zf.e, 0.4, 1) }));
  }
  const fadeDefs = (id, x0, x1, l, r) => `<linearGradient id="${id}g" x1="${x0}" x2="${x1}" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff" stop-opacity="${1 - l}"/><stop offset="${14 / (x1 - x0)}" stop-color="#fff"/><stop offset="${1 - 14 / (x1 - x0)}" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="${1 - r}"/></linearGradient>`;

  function draw(d) {
    const { W, pitch, barH, n } = G, x0 = G.x0, x1 = G.x1, view = d.view, I = d.info;
    const x = (yr) => x0 + ((yr - view[0]) / (view[1] - view[0])) * (x1 - x0);
    const ex = d.ex, exH = (i) => ex.find((v) => v.i === i)?.h ?? 0;
    const lineSum = ex.reduce((s, v) => s + LINE * v.h, 0);
    const g = geom(lineSum, I?.below ?? 0), { content, regionH, curveH } = g;
    const F = Math.max(0, ...ex.map((v) => v.h)), focusI = ex.length ? ex.reduce((b, v) => (v.h > b.h ? v : b)).i : -1;
    const moreL = view[0] > START + 0.05 ? 1 : 0, moreR = view[1] < UNTIL - 0.05 ? 1 : 0;
    const bandA = 1 - 0.6 * F, curveDim = mix(1, 0.3, F);
    // a lit name's part: the window's fill .10 -> .24, the agreement's .045 -> .12 (inline: the classes set them too)
    const bandFill = I ? ` style="fill-opacity:${mix(0.1, 0.24, I.litB).toFixed(3)}"` : '';
    const agreeFill = I ? ` style="fill-opacity:${mix(0.045, 0.12, I.litA).toFixed(3)}"` : '';
    const wx0 = x(data.window.from), wx1 = x(data.window.to), pk = x(data.peak + 0.5);
    const wa = mix(pk, wx0, d.win), wb = mix(pk, wx1, d.win);
    const mask = `<mask id="${uid}m" maskUnits="userSpaceOnUse" x="0" y="-10000" width="${W}" height="20000"><rect x="${x0}" y="-10000" width="${x1 - x0}" height="20000" fill="url(#${uid}g)"/></mask>`;

    // --- the curve, the window and the peak (above the rows)
    const c = d.curve, cTop = 24, cBot = curveH - 1;
    const yv = (p, mx) => cBot - (p / (mx || 1)) * (cBot - cTop) * c.rise;
    // Only the years in view (and a few past each edge, under the soft fade) are drawn: a zoomed view shows ~30 of 141
    const i0 = Math.max(0, Math.floor(view[0] - START) - 3), i1 = Math.min(UNTIL - START, Math.ceil(view[1] - START) + 3);
    const lineD = (ps) => { const mx = Math.max(...ps); return d3.line().x((p, k) => x(START + i0 + k + 0.5)).y((p) => yv(p, mx)).curve(d3.curveMonotoneX)(ps.slice(i0, i1)); };
    const areaD = (ps) => { const mx = Math.max(...ps); return d3.area().x((p, k) => x(START + i0 + k + 0.5)).y0(cBot).y1((p) => yv(p, mx)).curve(d3.curveMonotoneX)(ps.slice(i0, i1)); };
    let s = `<defs>${fadeDefs(uid, x0, x1, moreL, moreR)}${mask}<clipPath id="${uid}w"><rect x="${wa}" y="0" width="${Math.max(0, wb - wa)}" height="${curveH}"/></clipPath></defs>`;
    if (c.a > 0.001) {
      s += `<g mask="url(#${uid}m)" opacity="${c.a.toFixed(3)}">`;
      if (d.win > 0.001) s += `<rect class="vd-band"${bandFill} opacity="${bandA}" x="${wa}" y="18" width="${Math.max(0, wb - wa)}" height="${curveH - 18}"/>`;
      s += `<g class="rc-ghosts" opacity="${mix(1, 0.5, F)}">${c.ghosts.map((g) => `<path opacity="${g.a.toFixed(3)}" d="${lineD(g.ps)}"/>`).join('')}</g>`;
      const area = areaD(c.ps);
      s += `<g opacity="${curveDim}"><path class="vd-area" d="${area}"/><path class="vd-area-hi" clip-path="url(#${uid}w)" d="${area}"/><path class="vd-line" d="${lineD(c.ps)}"/></g>`;
      if (F > 0.001 && focusI >= 0) s += `<path class="vd-ridge-on" opacity="${F.toFixed(3)}" d="${lineD(data.frames[focusI + 1].p)}"/>`;
      if (d.win > 0.02) s += `<g opacity="${bandA}"><line class="vd-edge" x1="${wa}" x2="${wa}" y1="18" y2="${curveH}"/><line class="vd-edge" x1="${wb}" x2="${wb}" y1="18" y2="${curveH}"/></g>`;
      const yearA = I ? I.peakYear : 1;
      if (d.peakA > 0.001) s += `<g class="rc-peak" opacity="${(d.peakA * curveDim).toFixed(3)}"><line x1="${pk}" x2="${pk}" y1="16" y2="21"/><circle cx="${pk}" cy="24" r="3.2"/>${yearA > 0.001 ? `<text x="${pk}" y="11" text-anchor="middle"${yearA < 1 ? ` opacity="${yearA.toFixed(3)}"` : ''}>${data.peak}</text>` : ''}</g>`;
      s += '</g>';
    }
    // The names: the window's, in brass, over the band where the peak's year was
    const boxes = [];
    if (I && I.brW > 0.001) s += bracket(1, 'brass', wx0, wx1, BRACKET_Y, 1, I.brW, I.brWA, rangeLabel(), boxes);
    topSvg.setAttribute('width', W); topSvg.setAttribute('height', curveH);
    topSvg.innerHTML = s;

    // --- the rows: bars in the chart's width, marks in their column, lines across
    const rowY = (i) => { let y = i * pitch; for (const v of ex) if (v.i < i) y += LINE * v.h; return y; };
    const H2 = Math.max(regionH, content);
    rowsBox.style.top = `${curveH}px`;
    rowsBox.style.height = `${regionH}px`;
    rowSvg.setAttribute('width', W); rowSvg.setAttribute('height', H2);
    if (d.scrollY != null) rowsBox.scrollTop = d.scrollY;
    const ak = I?.agreeK ?? 0, A = data.agree && ak > 0.001 ? (() => {
      const a = x(data.agree.from ?? START), b = x(data.agree.to ?? UNTIL), mid = (a + b) / 2, w = Math.max(4, b - a) * ak;
      return { a: mid - w / 2, b: mid + w / 2 };
    })() : null;
    let r = `<defs>${mask}${A ? `<clipPath id="${uid}a"><rect x="${A.a}" y="0" width="${A.b - A.a}" height="${H2}"/></clipPath>` : ''}</defs>`;
    let bars = '', marks = '', lns = '';
    if (d.win > 0.001) bars += `<rect class="vd-band"${bandFill} opacity="${bandA}" x="${wa}" y="0" width="${Math.max(0, wb - wa)}" height="${H2}"/>`
      + (d.win > 0.02 ? `<g opacity="${bandA}"><line class="vd-edge" x1="${wa}" x2="${wa}" y1="0" y2="${H2}"/><line class="vd-edge" x1="${wb}" x2="${wb}" y1="0" y2="${H2}"/></g>` : '');
    if (A) bars += `<g class="vd-agree-col"><rect class="vd-agree-fill"${agreeFill} x="${A.a}" y="0" width="${A.b - A.a}" height="${n * pitch + lineSum}"/><line class="vd-agree-edge" x1="${A.a}" x2="${A.a}" y1="0" y2="${H2}"/><line class="vd-agree-edge" x1="${A.b}" x2="${A.b}" y1="0" y2="${H2}"/></g>`;
    const maxW = W + 28 - 40 - 18; // the line spans the screen (the wrap sits 14 px in): 20 px margins and the mark
    data.rows.forEach((row, i) => {
      const y = rowY(i), own = exH(i), rr = d.rows[i];
      const alpha = rr.a * (1 - 0.65 * F * (1 - own)), cy = y + pitch / 2;
      bars += `<g opacity="${alpha.toFixed(3)}"><line class="rc-track" x1="${x(START)}" x2="${x(UNTIL)}" y1="${cy}" y2="${cy}"/>`;
      for (const sp of row.spans) {
        const a = x(mix(START, sp.from ?? START, rr.e)), b = x(mix(UNTIL, sp.to ?? UNTIL, rr.e));
        if (b < x0 - 20 || a > x1 + 20) continue;
        const rect = (cls, extra = '') => `<rect class="${cls}"${extra} x="${a.toFixed(1)}" y="${(cy - barH / 2).toFixed(1)}" width="${Math.max(2, b - a).toFixed(1)}" height="${barH.toFixed(1)}" rx="${(barH / 2).toFixed(1)}"/>`;
        bars += rect('rc-bar', ` fill-opacity="${rr.op.toFixed(3)}"`);
        if (A) bars += rect('rc-bar-agree', ` clip-path="url(#${uid}a)"`);
      }
      bars += '</g>';
      if (rr.mark > 0.001) marks += `<path class="row-mark ${row.reply === 'yes' ? 'yes' : 'no'}" opacity="${(rr.mark * alpha).toFixed(3)}" transform="translate(${x0 - 12},${cy}) scale(${mix(0.2, 1, backOut(rr.mark)).toFixed(3)})" d="${MARK_PATH[row.reply === 'yes' ? 'yes' : 'no']}"/>`;
      if (own > 0.001) {
        // the open line, on its own paper so the band passes behind it; it spans the screen like the quiz sheet's
        const y0 = y + pitch, dh = LINE * own, tA = band(own, 0.45, 1);
        lns += `<rect class="rc-line-paper" x="-14" y="${y0}" width="${W + 28}" height="${dh}"/>
          <svg x="-14" y="${y0}" width="${W + 28}" height="${dh}" overflow="hidden"><g opacity="${tA.toFixed(3)}" transform="translate(0,${((1 - tA) * 6).toFixed(2)})">
            <text class="row-claim" x="20" y="9" dy="0.34em">${esc(fitClaim(row.claim ?? '', maxW, textW).text)}</text>
            <path class="row-mark ${row.reply === 'yes' ? 'yes' : 'no'}" transform="translate(${W + 28 - 24},9)" d="${MARK_PATH[row.reply === 'yes' ? 'yes' : 'no']}"/>
            <text class="row-range" x="20" y="30" dy="0.34em">${esc(row.rangeText)}</text></g></svg>`;
      }
    });
    r += `<g mask="url(#${uid}m)">${bars}</g>${lns}${marks}`;
    rowSvg.innerHTML = r;

    // --- the axis, and the strip fading where it was
    let a = '';
    const ax = d.axis ?? { y: g.axisY, x0, x1 }, axx = (yr) => ax.x0 + ((yr - view[0]) / (view[1] - view[0])) * (ax.x1 - ax.x0);
    if (d.stripA > 0.001) a += stripSVG(d.stripA);
    a += `<g class="tl-axis"><path class="domain" d="M${ax.x0},${ax.y}H${ax.x1}"/>`;
    for (const tk of ticks(view, d.zf, ax.x1 - ax.x0)) {
      const tx = axx(tk.v);
      if (tx < ax.x0 - 0.5 || tx > ax.x1 + 0.5) continue;
      const edge = Math.max(0, Math.min(1, (tx - ax.x0) / 14, (ax.x1 - tx) / 14));
      a += `<g opacity="${(tk.a * edge).toFixed(3)}"><line x1="${tx}" x2="${tx}" y1="${ax.y}" y2="${ax.y + 4}"/><text x="${tx}" y="${ax.y + 16}">${tk.v}</text></g>`;
    }
    a += '</g>';
    // The caption line: the footnote, at the 20 px margin (the wrap sits 14 px in)
    const fo = d.foot;
    if (fo && fo.a > 0.001) a += `<text class="rc-foot" x="6" y="${(ax.y + CAP_BASE + (1 - fo.rise) * 6).toFixed(2)}" opacity="${fo.a.toFixed(3)}">${FOOT}</text>`;
    // Under the axis, only the agreement, in ink (on a phone, its name on the caption line)
    if (I && I.agreeK > 0.001 && data.agree) a += bracket(2, 'ink', x(data.agree.from ?? START), x(data.agree.to ?? UNTIL), ax.y + INK_Y, -1, I.agreeK, I.inkA, agreeLabel(), boxes, G.fixed ? { x: 6, y: ax.y + CAP_BASE } : null);
    over.setAttribute('width', W); over.setAttribute('height', G.H);
    over.innerHTML = a;

    updateFades();
    hits.hidden = !d.live;
    if (d.live) placeHits(rowY, ex);
    placeLabels(boxes, I);
  }

  // --- The names ---------------------------------------------------------------------------------
  const rangeLabel = () => `Likely range ${Math.floor(data.window.from)} – ${Math.floor(data.window.to)}`;
  const agreeLabel = () => { const A = data.agree; return `${A.count === A.n ? `All ${A.n} answers agree` : `${A.count} of ${A.n} agree`} · ${A.rangeText}`; };
  /**
   * A bracket from its middle (e: 0..1 open) over a..b at y, its feet 5 px towards the chart (dir 1: down to the
   * band, under its name; -1: up to the axis, over its name). The name rises 4 px as it fades in (la) and stays
   * inside the chart's width. Its 32 px tall target goes into boxes.
   */
  function bracket(k, cls, a, b, y, dir, e, la, label, boxes, at = null) {
    const mid = (a + b) / 2, l = mid - (mid - a) * e, r = mid + (b - mid) * e;
    // Inside the chart's width; a name wider than the chart (a long agreement on a 320 px phone) centres on the
    // screen (the wrap sits 14 px in), and only one wider than the screen less 16 px a side is set smaller.
    // `at`: the name starts there instead (the caption line, at the 20 px margin), set smaller only past the margins.
    const room = G.W + 28 - (at ? 40 : 32), w0 = annW(label), size = w0 > room ? Math.floor((10 * room) / w0 * 10) / 10 : 10, w = (w0 * size) / 10;
    const lx = at ? at.x + w / 2 : w <= G.x1 - G.x0 ? clamp(mid, G.x0 + w / 2, G.x1 - w / 2) : G.W / 2, ty = at ? at.y : dir > 0 ? y - 6 : y + 14;
    // panned partly out of view, the bracket stops at the chart's edge (its foot there goes with the part out of view)
    const cl = Math.max(l, G.x0), cr = Math.min(r, G.x1), foot = (xx, v) => (Math.abs(xx - v) < 0.5 ? `V${y + 5 * dir}` : '');
    let out = e > 0.01 && cr > cl - 1 ? `<path class="rc-ann-b ${cls}" d="M${cl},${y + (cl === l ? 5 * dir : 0)}V${y}H${Math.max(cl + 1, cr)}${foot(cr, r)}"/>` : '';
    if (la > 0.001) out += `<text class="rc-ann-k ${cls}" x="${lx}" y="${ty + (1 - la) * 4}" text-anchor="middle" opacity="${la.toFixed(3)}"${size < 10 ? ` style="font-size:${size}px"` : ''}>${esc(label)}</text>`;
    const fa = Math.min(a, lx - w / 2) - 8, fb = Math.max(b, lx + w / 2) + 8;
    boxes.push({ k, label, x: fa, y: dir > 0 ? y - 22 : y - 10, w: fb - fa, h: 32 });
    return out;
  }
  let annCtx = null, annFont = null;
  function annW(str) {
    annCtx ??= document.createElement('canvas').getContext('2d');
    annFont ??= `600 10px ${getComputedStyle(document.documentElement).getPropertyValue('--sans')}`;
    annCtx.font = annFont;
    return annCtx.measureText(str.toUpperCase()).width + str.length; // letter-spacing .1em
  }
  /** The names' targets: real buttons, for touch, keyboard and VoiceOver, where the names are drawn. */
  function placeLabels(boxes, I) {
    const on = !!I && info.target;
    labelsEl.hidden = !on;
    if (!on) return;
    for (const btn of labelBtns) {
      const b = boxes.find((v) => v.k === Number(btn.dataset.k));
      btn.hidden = !b;
      if (!b) continue;
      btn.style.left = `${b.x}px`; btn.style.top = `${b.y}px`; btn.style.width = `${b.w}px`; btn.style.height = `${b.h}px`;
      if (btn.getAttribute('aria-label') !== b.label) btn.setAttribute('aria-label', b.label);
      const pressed = String(lit.some((l) => l.k === b.k && l.to === 1));
      if (btn.getAttribute('aria-pressed') !== pressed) btn.setAttribute('aria-pressed', pressed);
    }
  }
  /** A tapped name lights its part and keeps it lit; tapped again it clears. One at a time. */
  function toggleLit(k) {
    const t = now(), was = lit.find((l) => l.to === 1)?.k, cur = lit.find((l) => l.k === k), h0 = cur ? litH(cur, t) : 0;
    lit = lit.filter((l) => l.k !== k).map((l) => ({ k: l.k, from: litH(l, t), to: 0, t0: t, dur: reduced() ? 0 : LIT_OFF }));
    lit.push(was !== k ? { k, from: h0, to: 1, t0: t, dur: reduced() ? 0 : LIT_ON } : { k, from: h0, to: 0, t0: t, dur: reduced() ? 0 : LIT_OFF });
    kick();
  }

  /** The quiz strip as it was (timeline-sheet.js, closed), fading where it is. */
  function stripSVG(alpha) {
    const S = from.strip, w = from.wrap, n = data.rows.length;
    const left = S.rect.left - w.left, top = S.rect.top - w.top;
    const sx0 = left + 6, sx1 = left + S.rect.width - 6, sv = S.view;
    const sx = (yr) => sx0 + ((yr - sv[0]) / (sv[1] - sv[0])) * (sx1 - sx0);
    const footTop = top + S.rect.height - 30, axisY = footTop + 8, regS = top + 22, regHS = S.rect.height - 52;
    let s = `<g opacity="${alpha.toFixed(3)}"><clipPath id="${uid}s"><rect x="${sx0}" y="${regS}" width="${sx1 - sx0}" height="${regHS}"/></clipPath>`;
    const feet = regS + Math.max(0, regHS - n * STRIP_ROW) - 3;
    const segs = from.segs ?? [];
    for (const g of segs) {
      const a = clamp(sx(g.from), sx0, sx1), b = clamp(sx(g.to), sx0, sx1);
      s += `<g class="tl-band"><rect class="win-fill" x="${a}" y="${feet}" width="${Math.max(2, b - a)}" height="${axisY - feet}"/><path class="win-bracket" d="M${a},${feet}V${feet - 5}H${Math.max(a + 2, b)}V${feet}"/></g>`;
    }
    if (segs.length) {
      const g = segs.reduce((b, x) => (x.to - x.from > b.to - b.from ? x : b)), lx = clamp((sx(g.from) + sx(g.to)) / 2, sx0 + 80, sx1 - 80);
      const yf = Math.floor(g.from), yt = Math.floor(g.to);
      s += `<text class="win-label rc-win-label" x="${lx}" y="${feet - 9}">Most likely ${yf}${yt > yf ? ` – ${yt}` : ''}</text>`;
    }
    s += `<g clip-path="url(#${uid}s)">`;
    data.rows.forEach((row, i) => {
      const k = n - 1 - i, cy = regS + Math.max(0, regHS - n * STRIP_ROW) + k * STRIP_ROW + STRIP_ROW / 2;
      s += `<line class="rc-track" x1="${sx0}" x2="${sx1}" y1="${cy}" y2="${cy}"/>`;
      for (const sp of row.spans) {
        const a = clamp(sx(sp.from ?? START), sx0 - 5, sx1 + 5), b = clamp(sx(sp.to ?? UNTIL), sx0 - 5, sx1 + 5);
        if (b - a > 0.5) s += `<rect class="rc-bar" fill-opacity=".55" x="${a}" y="${cy - 3}" width="${b - a}" height="6" rx="3"/>`;
      }
    });
    s += '</g><g class="tl-heat">';
    for (let yr = Math.floor(sv[0]); yr < sv[1]; yr++) {
      const c = data.rows.filter((r) => r.spans.some((sp) => yr + 0.5 >= (sp.from ?? START) && yr + 0.5 < (sp.to ?? UNTIL))).length / n;
      if (!c) continue;
      const a = Math.max(sx0, sx(yr)), b = Math.min(sx1, sx(yr + 1) + 0.6);
      if (b > a) s += `<rect x="${a}" y="${axisY - 7}" width="${b - a}" height="6" fill-opacity="${c >= 1 ? 1 : (Math.pow(c, 2.2) * 0.75).toFixed(3)}"/>`;
    }
    return `${s}</g></g>`;
  }

  let canvasFont = null, ctx2d = null;
  function textW(str) {
    ctx2d ??= document.createElement('canvas').getContext('2d');
    canvasFont ??= `14px ${getComputedStyle(document.documentElement).getPropertyValue('--serif')}`;
    ctx2d.font = canvasFont;
    return ctx2d.measureText(str).width;
  }

  /** Soft edges where rows hide (CSS masks on the scroll box; nothing is redrawn while it scrolls). */
  function updateFades() {
    const st = rowsBox.scrollTop, h = rowsBox.clientHeight, c = rowSvg.height.baseVal.value;
    rowsBox.classList.toggle('more-above', st > 2);
    rowsBox.classList.toggle('more-below', st + h < c - 2);
  }
  rowsBox.addEventListener('scroll', updateFades, { passive: true });

  // Buttons over the rows: real targets for touch, keyboard and VoiceOver. A row opens its line; the line asks again.
  let hitKey = '';
  function placeHits(rowY, ex) {
    const key = data.rows.map((r) => r.id).join('|');
    if (key !== hitKey) {
      hitKey = key;
      hits.innerHTML = data.rows.map((row, i) => `<button type="button" class="rc-hit" role="listitem" data-i="${i}"
          aria-label="${esc(`${row.claim}: you said ${row.reply === 'yes' ? 'yes' : 'no'}. ${row.rangeText}.`)}" aria-expanded="false"></button>
        <button type="button" class="rc-hit rc-again" data-again="${i}" aria-label="${esc(`Answer again: ${row.claim}`)}" hidden></button>`).join('');
    }
    for (const b of hits.children) {
      const i = Number(b.dataset.i ?? b.dataset.again), h = ex.find((v) => v.i === i)?.h ?? 0;
      if (b.dataset.again != null) {
        b.hidden = h < 0.6;
        if (!b.hidden) { b.style.top = `${rowY(i) + G.pitch}px`; b.style.height = `${LINE * h}px`; }
      } else {
        b.style.top = `${rowY(i)}px`; b.style.height = `${G.pitch}px`;
        b.setAttribute('aria-expanded', String(lines.some((l) => l.i === i && l.to === 1)));
      }
    }
  }

  // --- Lines -----------------------------------------------------------------------------------
  function foldLines(dur = LINE_FOLD) { const t = now(); lines = lines.map((l) => ({ i: l.i, from: lineH(l, t), to: 0, t0: t, dur: reduced() ? 0 : dur })); }
  function toggleLine(i) {
    const t = now(), was = lines.find((l) => l.to === 1)?.i, cur = lines.find((l) => l.i === i), h0 = cur ? lineH(cur, t) : 0;
    // switching rows, the old line folds on the new one's clock: together they stay one line tall
    foldLines(was != null && was !== i ? LINE_OPEN : LINE_FOLD);
    lines = lines.filter((l) => l.i !== i);
    if (was !== i) { lines.push({ i, from: h0, to: 1, t0: t, dur: reduced() ? 0 : LINE_OPEN }); keepInView(i); }
    else lines.push({ i, from: h0, to: 0, t0: t, dur: reduced() ? 0 : LINE_FOLD });
    markBusy(LINE_OPEN);
    kick();
  }
  // An opening line that would end under the axis (no room to grow): the rows scroll with it, so it opens in view
  function keepInView(i) {
    const s0 = rowsBox.scrollTop, cap = Math.min(G.n, MAXROWS) * G.pitch + G.room;
    const top = i * G.pitch, bottom = top + G.pitch + LINE;
    const want = bottom > s0 + cap ? bottom - cap : top < s0 ? top : null;
    if (want == null) return;
    const ts = now();
    const step = () => {
      const k = reduced() ? 1 : CURVE(band(now() - ts, 0, LINE_OPEN));
      rowsBox.scrollTop = mix(s0, want, k);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // --- Input -------------------------------------------------------------------------------------
  // Sideways drags are ours (touch-action: pan-y leaves up and down to the rows' native scrolling).
  root.addEventListener('pointerdown', (e) => {
    if (mode !== 'settled' || e.button > 0) return;
    const gliding = Math.abs(vo) > 0.05 || !!spring;
    vo = 0;
    if (spring) { o = shownO(); spring = null; }
    drag = { x0: e.clientX, y0: e.clientY, o0: o, lock: null, hist: [[now(), e.clientX]], gliding, id: e.pointerId };
    suppressClick = gliding; // a touch that stops a glide isn't a tap
  });
  root.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
    if (!drag.lock && Math.hypot(dx, dy) > 8) {
      drag.lock = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      if (drag.lock === 'x') { suppressClick = true; root.setPointerCapture?.(e.pointerId); }
    }
    drag.hist.push([now(), e.clientX]); if (drag.hist.length > 6) drag.hist.shift();
    if (drag.lock === 'x') { o = drag.o0 - dx; kick(); }
  });
  const up = (e) => {
    const d = drag; drag = null;
    if (!d || d.lock !== 'x') { kick(); return; }
    const [ta, xa] = d.hist[0], v = -(e.clientX - xa) / Math.max(1, now() - ta);
    vo = Math.abs(v) > 0.05 ? v : 0;
    markBusy(1500);
    kick();
  };
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', () => { drag = null; kick(); }); // the browser took it: a vertical scroll
  root.addEventListener('click', (e) => {
    // Every click on the chart stops here: the quiz strip's sheet, in the same wrap, must never see it
    e.stopPropagation();
    if (suppressClick) { suppressClick = false; return; }
    if (mode !== 'settled') return;
    const name = e.target.closest?.('.rc-label');
    if (name) { toggleLit(Number(name.dataset.k)); return; }
    // With the names open, a tap under the chart (not on a name) closes them
    if (info.target && !e.target.closest?.('.rc-hit')) {
      const y = e.clientY - wrapEl.getBoundingClientRect().top, g = geom(0, infoFrame(now())?.below ?? 0);
      if (y > g.axisY + 20) { onInfo?.(false); return; }
    }
    const again = e.target.closest?.('[data-again]'), hit = e.target.closest?.('.rc-hit');
    if (again) { const row = data.rows[Number(again.dataset.again)]; if (row) onSelect?.(row); return; }
    if (hit) { toggleLine(Number(hit.dataset.i)); return; }
    if (lines.some((l) => l.to === 1)) { foldLines(); kick(); }
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && lines.some((l) => l.to === 1)) { e.stopPropagation(); foldLines(); kick(); return; }
    if (e.key === 'Escape' && info.target) { e.stopPropagation(); onInfo?.(false); }
  });
  // A tap elsewhere on the page folds an open line
  addEventListener('pointerdown', (e) => {
    if (mode !== 'settled' || !lines.some((l) => l.to === 1) || root.contains(e.target) || e.target.closest?.('.vd-info, .vd-info-btn')) return;
    foldLines(); kick();
  }, true);

  // --- API ---------------------------------------------------------------------------------------
  function settle() {
    mode = 'settled';
    o = (data.finalView[0] - START) * ppy(); vo = 0; spring = null;
    if (pendingVerdict) { const cb = pendingVerdict; pendingVerdict = null; cb(); }
    rowsBox.classList.add('is-scrolling');
    rowsBox.scrollTop = 0;
    kick();
  }
  function show(next, { animate = true, from: f = null, onStep = null, onVerdict = null } = {}) {
    // The view after each answer, as the strip would have chosen it
    const views = [FULL.slice()];
    next.frames.forEach((fr, k) => { if (k) views.push(viewFor({ lo: fr.from, hi: fr.to }, views[k - 1])); });
    data = { ...next, frames: next.frames.map((fr) => ({ ...fr, p: fr.density.map((x) => x.p) })), views, finalView: views.at(-1) };
    root.hidden = false;
    lines = []; info = { target: false, from: 0, to: 0, t0: 0, dur: 0, instant: false }; lit = []; hitKey = ''; drag = null;
    measure();
    T = timing();
    onStepCb = onStep; fired = 0;
    // The footnote rises as the verdict's last beat (app.js revealFoot times it to the buttons; this is the fallback)
    footT0 = animate && !reduced() && data.rows.length ? now() + T.verdict + 1150 : null;
    from = f ? { ...f, wrap: wrapEl.getBoundingClientRect() } : null;
    rowsBox.classList.remove('is-scrolling');
    if (!animate || reduced() || !data.rows.length) { pendingVerdict = onVerdict; settle(); return; }
    pendingVerdict = onVerdict;
    mode = 'arrive'; t0 = now(); lastT = 0;
    markBusy(T.end);
    kick();
  }
  function skip() { if (mode === 'arrive') settle(); }
  function revealFoot(delay = 0) { if (!data || footT0 == null) return; footT0 = now() + (reduced() ? 0 : delay); markBusy(delay + FOOT_RISE); kick(); }
  function hide() {
    mode = 'off'; root.hidden = true; data = null; pendingVerdict = null; onStepCb = null; lines = [];
    cancelAnimationFrame(raf); raf = 0;
  }
  /** The (i): open or close the names. Before the chart has settled they appear at once. */
  function showInfo(on) {
    if (!data || on === info.target) return;
    const t = now(), p = infoP(t), shown = info.target || p > 0.0005 ? shownParts(t) : null;
    const instant = reduced() || mode !== 'settled';
    // a reversal partway takes only the rest of the way, but never less than a third of the time
    const dur = instant ? 0 : (on ? INFO_OPEN : INFO_CLOSE) * Math.max(0.35, Math.abs((on ? 1 : 0) - p));
    info = on ? { target: true, from: p, to: 1, t0: t, dur, instant, floor: shown } : { target: false, from: p, to: 0, t0: t, dur, fold: shown };
    markBusy(on ? INFO_RUN : INFO_CLOSE);
    kick();
  }
  function relayout() {
    if (mode === 'off' || !data) return;
    const v0 = mode === 'settled' ? liveView()[0] : null;
    measure();
    if (v0 != null) o = (v0 - START) * ppy();
    kick();
  }
  new ResizeObserver(relayout).observe(wrapEl);
  return { show, skip, hide, showInfo, relayout, revealFoot, active: () => mode !== 'off' };
}
