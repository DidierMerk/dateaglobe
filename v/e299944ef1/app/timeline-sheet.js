// The evidence timeline on phones (vp-compact): a strip of bars at the bottom edge that unfolds into a sheet.
//
// The strip and the sheet are one chart at two heights. Both share the x scale, so opening is a vertical
// unfold: the axis stays where it is, the paper rises, and the rows spread up from their strip positions
// to their sheet positions while the bars thicken. In the sheet each row is only its bar; a tap opens a
// line under it that says what the question claimed ("The city is called Canton") with the user's tick or
// cross and the years that answer allows. Tapping that line asks the question again. While a line is open,
// the other rows and the brass band step back.
//
// The axis zooms to the evidence: once the engine's most-likely window is narrower than half the timeline,
// the view eases to about 2.4 times that window (at least 30 years, on whole 5-year marks), and holds still
// while the window stays in its middle. Bars that run past the view end square at its edge.
//
// Everything on screen is drawn by frame() from plain state, so every move (a new answer, the zoom,
// opening, a drag, a line unfolding) is one clock. Nothing is measured while something moves.
//
//   update({ rows, window }, { animate })   rows: [{ id, claim, reply, spans, rangeText }], window: { segments } | null
//   select(id | null)                       the row whose question is back on screen
//   close()                                 folds the sheet away
//   callbacks: onSelect(row) when a row's line is tapped

import { fitClaim } from './claim-fit.js';
import { layout } from './viewport.js';

const HEAD = 54;        // the sheet's header: grabber, title, close
const WINH = 22;        // "Most likely" and its bracket
const FOOT = 30;        // overlap strip + axis
const STRIP_ROW = 13;   // a row in the strip
const PITCH = 36;       // a row in the sheet
const LINE = 50;        // an open row's line
const CAP = 0.62;       // the sheet is at most this much of the visible height
const OPEN_MS = 440, CLOSE_MS = 380, LINE_OPEN = 320, LINE_FOLD = 260, ZOOM_DELAY = 600, ZOOM_MS = 600;
const MARK_PATH = { yes: 'M-3.4,0.2L-1.1,2.6L3.5,-2.8', no: 'M-2.8,-2.8L2.8,2.8M-2.8,2.8L2.8,-2.8' };

function bezier(x1, y1, x2, y2) {
  const B = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t) => { if (t <= 0) return 0; if (t >= 1) return 1; let lo = 0, hi = 1, s = t; for (let i = 0; i < 20; i++) { if (B(x1, x2, s) < t) lo = s; else hi = s; s = (lo + hi) / 2; } return B(y1, y2, s); };
}
const CURVE = bezier(0.2, 0.8, 0.2, 1); // the keyboard's curve: every spatial move
const mix = (a, b, e) => a + (b - a) * e;
const band = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const cubicOut = (t) => 1 - Math.pow(1 - t, 3);
const inOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function createSheet(wrapEl, startYear, endYear, { onSelect, active } = {}) {
  const START = startYear, UNTIL = endYear + 1, FULL = [START, UNTIL];
  const root = document.createElement('div');
  root.className = 'tlc';
  root.innerHTML = `
    <div class="tlc-paper"></div>
    <svg class="tlc-svg" aria-hidden="true"></svg>
    <div class="tlc-rows" role="list" aria-label="Your answers"><svg class="tlc-rowsvg" aria-hidden="true"></svg><div class="tlc-hits"></div></div>
    <div class="tlc-head"><span class="tlc-grab" aria-hidden="true"></span><span class="tlc-title">Your answers</span>
      <button type="button" class="tlc-close" aria-label="Close"><svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="15"/><path d="M11.25 11.25l7.5 7.5M18.75 11.25l-7.5 7.5"/></svg></button></div>`;
  wrapEl.appendChild(root);
  const $ = (s) => root.querySelector(s);
  const paper = $('.tlc-paper'), svg = $('.tlc-svg'), rowsBox = $('.tlc-rows'), rowSvg = $('.tlc-rowsvg'), hits = $('.tlc-hits'), head = $('.tlc-head'), grab = $('.tlc-grab'), closeBtn = $('.tlc-close');
  const catcher = document.createElement('div');
  catcher.className = 'tl-catcher';

  // --- State ---------------------------------------------------------------------
  let rows = [];
  let segs = [], segsFrom = [], winT0 = -1e9, label = '';
  let addId = null, addT0 = -1e9;
  let view = FULL.slice(), zoom = null;   // zoom: { from, to, t0 } (t0 may be in the future: the bar grows first)
  let p = 0, target = false, anim = null; // open progress, where it's heading, and its tween
  let lines = [];                         // [{ id, from, to, t0, dur }]: the open line and any still folding
  let sel = null;                         // the row whose question is back on screen
  let scroll0 = 0;                        // the sheet's scroll when it began to fold
  let drag = null, suppressClick = false;
  let G = null;                           // the measured geometry (layout() below)
  let fades = null;                       // what the soft edges need: { open, regH, contentH, stripMore }
  let raf = 0;

  // --- Geometry: measured on layout changes only ------------------------------------------
  const probe = document.createElement('div');
  probe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;top:0;left:0;padding:env(safe-area-inset-top,0px) 0 env(safe-area-inset-bottom,0px);';
  function measure() {
    document.body.appendChild(probe);
    const safeT = parseFloat(getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    const vh = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-h')) || innerHeight;
    const short = layout().kind === 'short';
    const W = wrapEl.clientWidth, Hs = wrapEl.clientHeight;
    // The strip is pinned to the bottom edge (its slide while arriving or stepping aside is a transform)
    const below = parseFloat(getComputedStyle(wrapEl).bottom) || 0;
    // The sheet may reach this high above the strip's bottom edge
    const cap = short ? vh - safeT - 12 - below : (vh - safeT) * CAP - below + 4;
    G = { W, Hs, short, cap, off: Math.ceil(innerHeight) };
    canvasFont = null;
  }

  // --- Scales ---------------------------------------------------------------------
  /** The view for a window: × 2.4, at least 30 years, rounded out to 5 years; it holds while the window stays in its middle. */
  function viewFor(w, prev) {
    if (!w) return FULL.slice();
    const width = w.hi - w.lo, want = Math.max(30, width * 2.4);
    if (want >= (UNTIL - START) * 0.75) return FULL.slice();
    if (prev && prev[1] - prev[0] < UNTIL - START) {
      const ps = prev[1] - prev[0], m = ps * 0.15;
      if (w.lo >= prev[0] + m && w.hi <= prev[1] - m && ps <= want * 1.6) return prev;
    }
    const c = (w.lo + w.hi) / 2; let a = c - want / 2, b = c + want / 2;
    if (a < START) { b += START - a; a = START; }
    if (b > UNTIL) { a -= b - UNTIL; b = UNTIL; }
    return [Math.max(START, Math.floor(a / 5) * 5), Math.min(UNTIL, Math.ceil(b / 5) * 5)];
  }
  const stepFor = (v, w) => [5, 10, 20, 40].find((s) => (s * w) / (v[1] - v[0]) >= 46) ?? 40;
  const ticksAt = (v, w) => { const st = stepFor(v, w), out = []; for (let y = Math.ceil(v[0] / st) * st; y < v[1]; y += st) out.push(y); return out; };
  let canvasFont = null, ctx2d = null;
  function textW(s) {
    ctx2d ??= document.createElement('canvas').getContext('2d');
    canvasFont ??= `14px ${getComputedStyle(document.documentElement).getPropertyValue('--serif')}`;
    ctx2d.font = canvasFont;
    return ctx2d.measureText(s).width;
  }

  // --- The clock ---------------------------------------------------------------------
  const now = () => performance.now();
  function kick() { if (!raf) raf = requestAnimationFrame(tick); }
  function tick() {
    raf = 0;
    const busy = frame(now());
    if (busy) kick();
  }
  const lineH = (l, t) => (l.dur ? mix(l.from, l.to, CURVE(band(t - l.t0, 0, l.dur))) : l.to);

  /** Draw one frame. Returns whether anything is still moving. */
  function frame(t) {
    if (!G || !active() || !G.W) return false;
    let moving = false;
    // open progress
    if (anim) {
      const k = anim.dur ? band(t - anim.t0, 0, anim.dur) : 1;
      p = mix(anim.from, anim.to, CURVE(k));
      if (k >= 1) { p = anim.to; anim = null; if (!target) scroll0 = 0; } else moving = true;
    }
    // the zoom
    let zf = null;
    if (zoom) {
      const raw = reduced() ? 1 : band(t - zoom.t0, 0, ZOOM_MS), k = CURVE(raw);
      view = [mix(zoom.from[0], zoom.to[0], k), mix(zoom.from[1], zoom.to[1], k)];
      zf = { from: zoom.from, to: zoom.to, e: k };
      if (raw >= 1) { view = zoom.to.slice(); zoom = null; zf = null; } else moving = true;
    }
    // a new row: it slides in on top while its bar grows from the middle
    const addT = t - addT0;
    const a = reduced() ? 1 : cubicOut(band(addT, 0, 650)), g = reduced() ? 1 : inOut(band(addT, 120, 920));
    if (addT < 920 && !reduced()) moving = true;
    // the window: from the last answer's to this one's
    const wk = reduced() ? 1 : cubicOut(band(t - winT0, 0, 650));
    if (wk < 1) moving = true;
    // open lines
    const ex = lines.map((l) => ({ id: l.id, h: lineH(l, t) }));
    lines = lines.filter((l) => !(l.to === 0 && t - l.t0 >= l.dur));
    if (lines.some((l) => t - l.t0 < l.dur)) moving = true;

    draw({ e: p, a, g, wk, ex, zf });
    return moving || !!drag;
  }

  // --- Drawing ---------------------------------------------------------------------
  function draw({ e, a, g, wk, ex, zf }) {
    const { W, Hs, short, off } = G;
    const n = rows.length;
    const footTop = Hs - FOOT, axisY = footTop + 8;
    const idx = new Map(rows.map((r, i) => [r.id, i]));
    const isAdd = (r) => r.id === addId;
    // rank from the top (newest = 0); while a row arrives the older ones ease down one place
    const added = addId != null && idx.has(addId) && a < 1;
    const kOf = (i) => { const k = n - 1 - i; return added ? (rows[i].id === addId ? 0 : k - 1 + a) : k; };
    const nEff = added ? n - 1 + a : n;
    const exs = ex.filter((x) => idx.has(x.id) && x.h > 0.001);
    const extra = exs.reduce((s, x) => s + LINE * x.h, 0);
    const offset = (i) => exs.reduce((s, x) => s + (x.id !== rows[i].id && kOf(idx.get(x.id)) < kOf(i) ? LINE * x.h : 0), 0);
    // the sheet's height: its rows (and an open line), up to the cap, stopping at a half row when they don't fit
    const avail = Math.max(PITCH, G.cap - HEAD - WINH - FOOT);
    const limit = n * PITCH <= avail ? avail : (Math.floor(avail / PITCH - 0.5) + 0.5) * PITCH;
    const sheetH = HEAD + WINH + Math.min(n * PITCH + extra, limit) + FOOT;
    const topO = Hs - sheetH, regS = WINH, regO = topO + HEAD + WINH, regHS = footTop - regS;
    const regTop = mix(regS, regO, e), regH = footTop - regTop;
    const paperTop = mix(-6, topO - 6, e);
    // the strip keeps the selected row in view
    const selI = sel != null ? idx.get(sel) : undefined;
    const stripShift = selI != null ? Math.max(0, kOf(selI) * STRIP_ROW - (regHS - STRIP_ROW) / 2) : 0;
    const scrollNow = e >= 1 && !anim ? 0 : scroll0 * e; // folding from a scrolled sheet, the rows start where they were
    const yIn = (i) => mix(Math.max(0, regHS - nEff * STRIP_ROW) + kOf(i) * STRIP_ROW - stripShift, kOf(i) * PITCH + offset(i) - scrollNow, e);
    const pitch = mix(STRIP_ROW, PITCH, e), barCy = mix(STRIP_ROW / 2, PITCH / 2, e), barH = mix(6, 8, e);
    // x: the chart runs between the 20 px margins; a phone on its side keeps the marks in its strip
    const cx0 = short ? mix(26, 6, e) : 6, cx1 = W - 6;
    const markA = short ? 1 - band(e, 0, 0.5) : 0;
    const x = (yr) => cx0 + ((yr - view[0]) / (view[1] - view[0])) * (cx1 - cx0);
    const F = Math.max(0, ...exs.map((s) => s.h)) * e; // focus: while a line is open the rest steps back

    // the paper, the header and the box the rows live in
    paper.style.top = `${paperTop}px`;
    paper.style.boxShadow = e > 0.001 ? `0 -18px 44px -26px rgba(31, 42, 55, ${0.5 * e})` : 'none';
    paper.style.borderTopColor = `rgba(226, 212, 182, ${e})`;
    grab.style.top = `${mix(-4, 4, e)}px`;
    head.style.top = `${paperTop + 6}px`;
    const headA = band(e, 0.5, 1);
    head.style.opacity = headA;
    head.style.visibility = headA > 0.01 ? 'visible' : 'hidden';
    for (const el of head.children) if (el !== grab) el.style.transform = `translateY(${(1 - headA) * 6}px)`;
    rowsBox.style.top = `${regTop}px`;
    rowsBox.style.height = `${Math.max(0, regH)}px`;
    const open = e >= 1 && !anim && !drag?.sheet;
    const contentH = open ? n * PITCH + extra : regH;
    rowsBox.classList.toggle('is-scrolling', open);
    if (!open && rowsBox.scrollTop) rowsBox.scrollTop = 0;
    const lastBottom = n ? yIn(0) + pitch + (exs.find((s) => s.id === rows[0].id)?.h ?? 0) * LINE * e : 0;
    fades = { open, regH, contentH, stripMore: lastBottom > regH + 2 && e < 0.01 };
    updateFades();
    svg.style.top = `${-off}px`;
    svg.setAttribute('width', W); svg.setAttribute('height', off + Hs);
    rowSvg.setAttribute('width', W); rowSvg.setAttribute('height', Math.max(regH, contentH));

    // --- the window: band, bracket and label
    const wl = segs.map((s, i) => { const f = segsFrom.length === segs.length ? segsFrom[i] : null; return f ? { from: mix(f.from, s.from, wk), to: mix(f.to, s.to, wk), a: 1 } : { ...s, a: wk }; });
    const fading = segsFrom.length !== segs.length ? segsFrom.map((s) => ({ ...s, a: 1 - wk })) : [];
    const wAll = [...wl, ...fading].filter((s) => s.a > 0.01);
    const sx = (s) => [clamp(x(s.from), cx0, cx1), clamp(x(s.to), cx0, cx1)];
    const bandA = 1 - 0.6 * F;
    const topRow = n ? Math.min(...rows.map((r, i) => yIn(i))) : regH;
    const feetS = regS + Math.max(0, regHS - nEff * STRIP_ROW) - 3, feetO = regO - 3;
    const feet = paperTop + mix(feetS + 6, feetO - topO + 6, e); // rides with the paper's edge
    const Y = (y) => y + off; // main svg coordinates

    let s = `<defs><clipPath id="tlc-cx"><rect x="${cx0}" y="0" width="${Math.max(0, cx1 - cx0)}" height="${off + Hs}"/></clipPath></defs>`;
    // overlap strip
    const cover = coverage(added ? a : 1);
    s += '<g class="tl-heat">';
    for (let yr = Math.floor(view[0]); yr < view[1]; yr++) {
      const c = cover.get(yr) ?? 0; if (!c) continue;
      const xa = Math.max(cx0, x(yr)), xb = Math.min(cx1, x(yr + 1) + 0.6);
      if (xb > xa) s += `<rect x="${xa.toFixed(1)}" y="${Y(axisY - 7)}" width="${(xb - xa).toFixed(1)}" height="6" fill-opacity="${c >= 1 ? 1 : (Math.pow(c, 2.2) * 0.75).toFixed(3)}"/>`;
    }
    s += '</g><g class="tl-band">';
    let widest = null;
    for (const w of wAll) {
      const [x0, x1] = sx(w);
      if (!widest || x1 - x0 > widest.x1 - widest.x0) widest = { x0, x1, w };
      s += `<g opacity="${(w.a * bandA).toFixed(3)}"><rect class="win-fill" x="${x0}" y="${Y(footTop)}" width="${Math.max(2, x1 - x0)}" height="${axisY - footTop}"/>
        <path class="win-bracket" d="M${x0},${Y(feet)}V${Y(feet - 5)}H${Math.max(x0 + 2, x1)}V${Y(feet)}"/></g>`;
    }
    if (widest && label) {
      const lx = clamp((widest.x0 + widest.x1) / 2, cx0 + 80, cx1 - 80);
      s += `<text class="win-label" x="${lx}" y="${Y(feet - 9)}" opacity="${(Math.min(1, wAll.reduce((m, w) => Math.max(m, w.a), 0)) * bandA).toFixed(3)}">${esc(label)}</text>`;
    }
    s += '</g>';
    // axis
    s += `<g class="tl-axis"><path class="domain" d="M${cx0},${Y(axisY)}H${cx1}"/>`;
    for (const tk of ticks(zf, cx1 - cx0)) {
      const tx = x(tk.v); if (tx < cx0 - 0.5 || tx > cx1 + 0.5) continue;
      const edge = Math.max(0, Math.min(1, (tx - cx0) / 14, (cx1 - tx) / 14));
      s += `<g opacity="${(tk.a * edge).toFixed(3)}"><line x1="${tx}" x2="${tx}" y1="${Y(axisY)}" y2="${Y(axisY + 4)}"/>${tx - cx0 > 12 && cx1 - tx > 12 ? `<text x="${tx}" y="${Y(axisY + 16)}">${tk.v}</text>` : ''}</g>`;
    }
    s += '</g>';
    svg.innerHTML = s;

    // --- the rows (in their own box, which scrolls once the sheet is open)
    let r = `<defs><clipPath id="tlc-rx"><rect x="${cx0}" y="0" width="${Math.max(0, cx1 - cx0)}" height="${Math.max(regH, contentH) + 10}"/></clipPath>`;
    wAll.forEach((w, i) => { const [x0, x1] = sx(w); r += `<clipPath id="tlc-w${i}"><rect x="${x0}" y="0" width="${Math.max(0, x1 - x0)}" height="${Math.max(regH, contentH) + 10}"/></clipPath>`; });
    r += '</defs><g class="tl-band">';
    for (const w of wAll) { const [x0, x1] = sx(w); r += `<rect class="win-fill" x="${x0}" y="${Math.max(0, topRow - 3)}" width="${Math.max(2, x1 - x0)}" height="${Math.max(regH, contentH) + 10}" opacity="${(w.a * bandA).toFixed(3)}"/>`; }
    r += '</g>';
    const maxW = cx1 - cx0 - 18;
    rows.forEach((row, i) => {
      const y = yIn(i), own = exs.find((s2) => s2.id === row.id)?.h ?? 0, dh = LINE * own * e;
      if (y > Math.max(regH, contentH) + 4 || y + pitch + dh < -4) return;
      const alpha = (isAdd(row) && added ? a : 1) * (sel != null && sel !== row.id ? 0.25 : 1) * (1 - 0.65 * F * (1 - own));
      const cy = y + barCy;
      r += `<g opacity="${alpha.toFixed(3)}">`;
      if (sel === row.id) r += `<rect class="row-hit on" x="0" y="${y}" width="${W}" height="${pitch}"/>`;
      if (dh > 0.5) {
        // the open line: on its own paper, so the band passes behind it without crossing the words
        const y0 = y + pitch, tA = band(own, 0.45, 1) * e, fit = fitClaim(row.claim ?? '', maxW, textW);
        r += `<rect class="tlc-line-paper" x="${-W}" y="${y0}" width="${W * 3}" height="${dh}"/>
          <svg x="0" y="${y0}" width="${W}" height="${dh}" overflow="hidden"><g opacity="${tA.toFixed(3)}" transform="translate(0,${((1 - tA) * 6).toFixed(2)})">
            <text class="row-claim" x="${cx0}" y="9" dy="0.34em">${esc(fit.text)}</text>
            <path class="row-mark ${row.reply}" transform="translate(${cx1 - 4},9)" d="${MARK_PATH[row.reply === 'yes' ? 'yes' : 'no']}"/>
            <text class="row-range" x="${cx0}" y="30" dy="0.34em">${esc(row.rangeText)}</text></g></svg>`;
      }
      r += `<line class="row-track" x1="${cx0}" x2="${cx1}" y1="${cy}" y2="${cy}"/>`;
      if (markA > 0.01) r += `<path class="row-mark ${row.reply}" opacity="${markA}" transform="translate(${cx0 - 12},${cy})" d="${MARK_PATH[row.reply === 'yes' ? 'yes' : 'no']}"/>`;
      const gi = isAdd(row) ? g : 1;
      for (const sp of row.spans) {
        let x0 = x(sp.from ?? START), x1 = x(sp.to ?? UNTIL);
        if (x1 < cx0) { x0 = cx0 - 5; x1 = cx0 + 5; } else if (x0 > cx1) { x0 = cx1 - 5; x1 = cx1 + 5; } // a stub at the edge on its side
        const m = (x0 + x1) / 2; x0 = mix(m, x0, gi); x1 = mix(m, x1, gi);
        const rect = (cls) => `<rect class="${cls}" x="${x0.toFixed(1)}" y="${(cy - barH / 2).toFixed(2)}" width="${Math.max(gi > 0 ? 2 : 0, x1 - x0).toFixed(1)}" height="${barH.toFixed(2)}" rx="${(barH / 2).toFixed(2)}"/>`;
        r += `<g clip-path="url(#tlc-rx)">${rect(sel === row.id ? 'bar on' : 'bar')}`;
        if (sel !== row.id) wAll.forEach((w, wi) => { r += `<g clip-path="url(#tlc-w${wi})" opacity="${w.a.toFixed(3)}">${rect('bar-hi')}</g>`; });
        r += '</g>';
      }
      r += '</g>';
    });
    rowSvg.innerHTML = r;

    // --- tap targets (only in the open sheet): a row opens its line; the line asks again
    hits.hidden = !open;
    if (open) placeHits(yIn, exs);
  }

  /** Soft edges where rows hide: above once the sheet is scrolled, below while more rows wait. */
  function updateFades() {
    if (!fades) return;
    const { open, regH, contentH, stripMore } = fades, st = open ? rowsBox.scrollTop : 0;
    rowsBox.classList.toggle('more-above', open && st > 2);
    rowsBox.classList.toggle('more-below', open ? st + regH < contentH - 2 : stripMore);
  }

  /** How many answers allow each year (for the overlap strip under the bars). */
  function coverage(newA) {
    const out = new Map(), n = rows.length;
    if (!n) return out;
    const list = rows.filter((r) => r.id !== addId || newA > 0.5);
    for (let yr = START; yr < UNTIL; yr++) {
      const c = list.filter((r) => r.spans.some((sp) => yr + 0.5 >= (sp.from ?? START) && yr + 0.5 < (sp.to ?? UNTIL))).length / n;
      if (c) out.set(yr, c);
    }
    return out;
  }
  function ticks(zf, w) {
    if (!zf) return ticksAt(view, w).map((v) => ({ v, a: 1 }));
    const A = new Set(ticksAt(zf.from, w)), B = new Set(ticksAt(zf.to, w));
    return [...new Set([...A, ...B])].map((v) => ({ v, a: A.has(v) && B.has(v) ? 1 : A.has(v) ? 1 - band(zf.e, 0, 0.5) : band(zf.e, 0.4, 1) }));
  }

  // Buttons over the rows: real targets for touch, keyboard and VoiceOver
  let hitKey = '';
  function placeHits(yIn, exs) {
    const key = rows.map((r) => r.id).join('|') + '#' + exs.map((x) => x.id).join('|');
    if (key !== hitKey) {
      hitKey = key;
      hits.innerHTML = rows.map((row) => `<button type="button" class="tlc-hit" role="listitem" data-id="${esc(row.id)}"
          aria-label="${esc(`${row.claim}: you said ${row.reply === 'yes' ? 'yes' : 'no'}. ${row.rangeText}.`)}" aria-expanded="false"></button>
        <button type="button" class="tlc-hit tlc-again" data-again="${esc(row.id)}" aria-label="${esc(`Answer again: ${row.claim}`)}" hidden></button>`).join('');
    }
    const idx = new Map(rows.map((r, i) => [r.id, i]));
    for (const b of hits.children) {
      const id = b.dataset.id ?? b.dataset.again, i = idx.get(id); if (i == null) continue;
      const h = exs.find((x) => x.id === id)?.h ?? 0;
      if (b.dataset.again != null) {
        b.hidden = h < 0.6;
        if (!b.hidden) { b.style.top = `${yIn(i) + PITCH}px`; b.style.height = `${LINE * h}px`; }
      } else {
        b.style.top = `${yIn(i)}px`; b.style.height = `${PITCH}px`;
        b.setAttribute('aria-expanded', String(lines.some((l) => l.id === id && l.to === 1)));
      }
    }
  }

  // --- Opening, closing, lines ------------------------------------------------------------
  function setOpen(next, { from = p, velocity = 0 } = {}) {
    next = !!next && active() && rows.length > 0;
    if (!next && !target && !anim && p === 0) return;
    const d = Math.abs((next ? 1 : 0) - from);
    const dur = reduced() ? 0 : (next ? OPEN_MS : CLOSE_MS) * Math.max(0.35, Math.min(1, d + Math.abs(velocity) * 0.05));
    if (!next) { scroll0 = rowsBox.scrollTop || scroll0; foldLines(); }
    else { rowsBox.scrollTop = 0; scroll0 = 0; }
    const was = target;
    target = next;
    anim = { from, to: next ? 1 : 0, t0: now(), dur };
    if (next !== was) {
      wrapEl.classList.toggle('tlc-open', next);
      wrapEl.setAttribute('aria-expanded', String(next));
      if (next) { wrapEl.before(catcher); closeBtn.focus({ preventScroll: true }); } else catcher.remove();
      syncRole();
    }
    kick();
  }
  function foldLines(dur = LINE_FOLD) { const t = now(); lines = lines.map((l) => ({ id: l.id, from: lineH(l, t), to: 0, t0: t, dur: reduced() ? 0 : dur })); }
  function toggleLine(id) {
    const t = now(), wasOpen = lines.find((l) => l.to === 1)?.id;
    const cur = lines.find((l) => l.id === id), h0 = cur ? lineH(cur, t) : 0;
    // Switching rows, the old line folds on the new one's clock: together they stay one line tall, so the sheet holds still
    foldLines(wasOpen != null && wasOpen !== id ? LINE_OPEN : LINE_FOLD);
    lines = lines.filter((l) => l.id !== id);
    if (wasOpen !== id) { lines.push({ id, from: h0, to: 1, t0: t, dur: reduced() ? 0 : LINE_OPEN }); keepInView(id); }
    else lines.push({ id, from: h0, to: 0, t0: t, dur: reduced() ? 0 : LINE_FOLD });
    kick();
  }
  // An opening line that would end under the axis: the rows scroll with it, so it opens in view
  function keepInView(id) {
    const i = rows.findIndex((r) => r.id === id); if (i < 0) return;
    const k = rows.length - 1 - i, box = rowsBox, s0 = box.scrollTop, view = box.clientHeight;
    const top = k * PITCH, bottom = top + PITCH + LINE;
    const want = bottom > s0 + view ? bottom - view : top < s0 ? top : null;
    if (want == null) return;
    const t0 = now();
    const step = () => {
      const k2 = reduced() ? 1 : CURVE(band(now() - t0, 0, LINE_OPEN));
      box.scrollTop = mix(s0, want, k2);
      if (k2 < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // --- Input -------------------------------------------------------------------------
  // The strip as a whole is one button: tap or Enter opens it; a drag up brings the sheet with the finger
  wrapEl.addEventListener('click', (e) => {
    if (!active()) return;
    if (suppressClick) { suppressClick = false; e.stopPropagation(); return; }
    const again = e.target.closest?.('[data-again]'), hit = e.target.closest?.('.tlc-hit');
    if (again) { e.stopPropagation(); const row = rows.find((r) => r.id === again.dataset.again); if (row) { setOpen(false); onSelect?.(row); } return; }
    if (hit) { e.stopPropagation(); toggleLine(hit.dataset.id); return; }
    if (e.target.closest?.('.tlc-close')) { e.stopPropagation(); setOpen(false); return; }
    if (!target && rows.length) { e.stopPropagation(); setOpen(true); }
  });
  wrapEl.addEventListener('keydown', (e) => {
    if (!active()) return;
    if (target && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(false); wrapEl.focus({ preventScroll: true }); }
    else if (!target && e.target === wrapEl && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(true); }
  });
  catcher.addEventListener('click', () => setOpen(false));

  const travel = () => {
    const n = rows.length, avail = Math.max(PITCH, G.cap - HEAD - WINH - FOOT);
    const limit = n * PITCH <= avail ? avail : (Math.floor(avail / PITCH - 0.5) + 0.5) * PITCH;
    return Math.max(40, HEAD + WINH + Math.min(n * PITCH, limit) + FOOT - G.Hs);
  };
  function startDrag(y, from) { drag = { y0: y, p0: from, hist: [[now(), y]], sheet: false }; }
  function moveDrag(y) {
    if (!drag) return false;
    drag.hist.push([now(), y]); if (drag.hist.length > 6) drag.hist.shift();
    const dy = y - drag.y0;
    if (!drag.sheet && Math.abs(dy) < 6) return false;
    if (!drag.sheet) { drag.sheet = true; anim = null; if (!target) { target = true; wrapEl.classList.add('tlc-open'); wrapEl.before(catcher); } foldLines(); }
    p = clamp(drag.p0 - dy / travel(), 0, 1);
    kick();
    return true;
  }
  function endDrag(y) {
    const d = drag; drag = null;
    if (!d) return;
    if (!d.sheet) { kick(); return; }
    suppressClick = true; setTimeout(() => { suppressClick = false; }, 0);
    const [t0, y0] = d.hist[0], v = (y - y0) / Math.max(1, now() - t0); // px per ms, + is down
    const open = v < -0.35 ? true : v > 0.35 ? false : p > 0.5;
    target = !open; // let setOpen see a change, so the catcher and focus follow
    setOpen(open, { from: p, velocity: v });
  }
  // Pointer drags: on the strip (closed) and on the sheet's header (open)
  wrapEl.addEventListener('pointerdown', (e) => {
    if (!active() || e.button > 0 || e.target.closest?.('.tlc-close')) return;
    if (target && !e.target.closest?.('.tlc-head') && !e.target.closest?.('.tlc-paper')) return;
    if (!target && !rows.length) return;
    startDrag(e.clientY, p);
    wrapEl.setPointerCapture?.(e.pointerId);
  });
  wrapEl.addEventListener('pointermove', (e) => { if (drag && !drag.touchRows) moveDrag(e.clientY); });
  const up = (e) => { if (drag && !drag.touchRows) endDrag(e.clientY); };
  wrapEl.addEventListener('pointerup', up);
  wrapEl.addEventListener('pointercancel', up);
  // Pulling the rows down once they're scrolled to the top folds the sheet (touch: the rows scroll natively)
  // Pulling the rows down folds the sheet only when the gesture starts with the rows at the top: scrolling up to
  // read the first answers stops at the top and never closes the sheet by accident
  let touch = null;
  rowsBox.addEventListener('touchstart', (e) => { touch = target && !anim && rowsBox.scrollTop <= 0 ? { y: e.touches[0].clientY } : null; }, { passive: true });
  rowsBox.addEventListener('touchmove', (e) => {
    if (!touch) return;
    const y = e.touches[0].clientY;
    if (!drag) {
      if (y < touch.y - 6 || rowsBox.scrollTop > 0) { touch = null; return; } // a scroll down the list
      if (y - touch.y > 6) { startDrag(touch.y, 1); drag.touchRows = true; }
    }
    if (drag?.touchRows) { if (e.cancelable) e.preventDefault(); moveDrag(y); }
  }, { passive: false });
  rowsBox.addEventListener('touchend', (e) => { if (drag?.touchRows) endDrag(e.changedTouches[0].clientY); touch = null; });
  rowsBox.addEventListener('touchcancel', () => { if (drag?.touchRows) endDrag(drag.hist.at(-1)[1]); touch = null; });
  // Scrolling moves only the rows box: nothing is redrawn (a redraw during iOS momentum scrolling waits until it
  // stops, and would stop the momentum); only the soft edges follow
  rowsBox.addEventListener('scroll', updateFades, { passive: true });

  function syncRole() {
    const c = active();
    if (!c) return;
    wrapEl.setAttribute('role', target ? 'region' : 'button');
    wrapEl.tabIndex = target ? -1 : 0;
    wrapEl.setAttribute('aria-label', target ? 'Your answers' : 'Your answers. Open to change one');
  }

  // --- API ---------------------------------------------------------------------------
  function update({ rows: next, window: w }, { animate = true } = {}) {
    const prevIds = rows.map((r) => r.id);
    const nextIds = next.map((r) => r.id);
    const t = now(), anim2 = animate && !reduced();
    // a new answer on top (the older rows unchanged)
    const grew = nextIds.length === prevIds.length + 1 && prevIds.every((id, i) => nextIds[i] === id);
    if (grew && anim2) { addId = nextIds.at(-1); addT0 = t; } else if (!grew) { addId = null; addT0 = -1e9; }
    rows = next;
    if (!rows.length) { if (target || p) { target = false; anim = null; p = 0; wrapEl.classList.remove('tlc-open'); catcher.remove(); } lines = []; }
    lines = lines.filter((l) => rows.some((r) => r.id === l.id));
    if (sel != null && !rows.some((r) => r.id === sel)) sel = null;
    // the window and the view
    const nextSegs = w?.segments?.map((s) => ({ from: s.from, to: s.to })) ?? [];
    const same = nextSegs.length === segs.length && nextSegs.every((s, i) => s.from === segs[i].from && s.to === segs[i].to);
    if (!same) { segsFrom = anim2 ? segs : nextSegs; segs = nextSegs; winT0 = anim2 ? t : -1e9; }
    const best = nextSegs.reduce((b, s) => (!b || s.to - s.from > b.to - b.from ? s : b), null);
    label = best ? `Most likely ${Math.floor(best.from)}${Math.floor(best.to) > Math.floor(best.from) ? ` – ${Math.floor(best.to)}` : ''}` : '';
    const ext = nextSegs.length ? { lo: Math.min(...nextSegs.map((s) => s.from)), hi: Math.max(...nextSegs.map((s) => s.to)) } : null;
    const to = viewFor(ext, zoom ? zoom.to : view);
    const cur = view.slice();
    if (to[0] !== (zoom ? zoom.to : view)[0] || to[1] !== (zoom ? zoom.to : view)[1]) {
      if (anim2) zoom = { from: cur, to, t0: t + (grew ? ZOOM_DELAY : 0) }; else { view = to; zoom = null; }
    }
    if (!G) measure();
    kick();
  }
  function select(id) { sel = id; kick(); }
  function close() { if (target || p > 0) setOpen(false); }

  const relayout = () => { if (!active()) return; measure(); syncRole(); kick(); };
  new ResizeObserver(relayout).observe(wrapEl);
  addEventListener('resize', relayout);
  /** What the strip shows now (the result's chart starts from it): its view, and where it sits on screen. */
  function snapshot() {
    if (!active() || !G?.W || target || p > 0) return null;
    const r = wrapEl.getBoundingClientRect();
    return { view: (zoom ? zoom.to : view).slice(), rect: { left: r.left, top: r.top, width: r.width, height: r.height } };
  }
  return { update, select, close, relayout, snapshot, isOpen: () => target };
}
