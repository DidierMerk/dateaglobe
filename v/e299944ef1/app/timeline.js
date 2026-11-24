// The evidence timeline: one bar per answered question, showing the years that
// answer allows. Rows stack upward from the axis, newest on top. Where they pile
// up, the overlap strip above the axis turns brass, and the engine's most-likely
// window is drawn as a band through every row (bar sections inside it turn brass).
//
// Three layers share one x scale:
//   scroll (scrolls)    the rows: ten visible, older ones further down (no visible
//                       scrollbar; soft fades show where more rows hide)
//   foot   (fixed)      the overlap strip and the year axis
//   head   (overlay)    the "Most likely" label and bracket: it rides just above the
//                       top row, rising with each answer until the ten rows are full
//
// Clicking a row (or Enter on it) asks the app to put that question back on screen.
//
// Compact (phones, viewport.js isCompact): timeline-sheet.js draws a strip of bars at the bottom edge that
// unfolds into a sheet; this file's layers step aside (style.css) and every call is passed on to it.
//
//   update({ rows: [{ id, index, subject, question, reply, rangeText, spans: [{from, to}] }],
//            window: { segments: [{ from, to }], label } | null })
//   select(id | null)   marks the row whose question is being asked again
//   close()             folds the sheet away (compact only)
//   callbacks: onSelect(row) when a row is clicked or chosen with Enter
//   options:   compact() says whether the strip-and-sheet form is in use

import { createSheet } from './timeline-sheet.js';

const d3 = window.d3;

export const ROW_H = 13;      // a readable row
/** An upright tablet (vp-page) gives the rows real height: 18 px, 20 on the widest (style.css sets --tl-h to match). */
const pageRow = () => (document.documentElement.classList.contains('vp-page') ? (innerWidth >= 1000 ? 20 : 18) : 0);
export const VISIBLE_ROWS = 10;
const HEAD_H = 22;
const FOOT_H = 30;           // overlap strip + axis

// Yes / no marks as strokes, crisper than text glyphs at this size
const MARK_PATH = { yes: 'M-3.4,0.2L-1.1,2.6L3.5,-2.8', no: 'M-2.8,-2.8L2.8,2.8M-2.8,2.8L2.8,-2.8' };

export function createTimeline(wrapEl, startYear, endYear, { onSelect, compact = () => false } = {}) {
  const until = endYear + 1;
  const wrap = d3.select(wrapEl);
  // Phones: the strip and its sheet (timeline-sheet.js)
  const sheet = createSheet(wrapEl, startYear, endYear, { onSelect, active: compact });
  const scroller = wrap.append('div').attr('class', 'tl-scroll');
  const body = scroller.append('svg').attr('class', 'tl-body').attr('role', 'list').attr('aria-label', 'Your answers');
  const foot = wrap.append('svg').attr('class', 'tl-foot').attr('aria-hidden', 'true');
  const head = wrap.append('svg').attr('class', 'tl-head').attr('aria-hidden', 'true');
  const tip = wrap.append('div').attr('class', 'tl-tip').attr('hidden', true);

  // Bar sections inside the most-likely window are redrawn in brass through this clip
  const clipPath = body.append('defs').append('clipPath').attr('id', 'tl-window');
  const gBandBody = body.append('g').attr('class', 'tl-band');
  const gRows = body.append('g').attr('class', 'tl-rows');
  const gBandHead = head.append('g').attr('class', 'tl-band');
  const gBandFoot = foot.append('g').attr('class', 'tl-band');
  const gHeat = foot.append('g').attr('class', 'tl-heat');
  const gAxis = foot.append('g').attr('class', 'tl-axis');

  let last = { rows: [], window: null };
  let selectedId = null; // the row whose question is back on screen
  let prevCount = 0;
  let headroom = 0; // px the question screen needs free at the top (an open hint's buttons slide in there)

  const clampSpans = (spans) => spans.map(({ from, to }) => ({ from: from ?? startYear, to: to ?? until }));

  function layout() {
    const width = scroller.node().clientWidth; // the scrollbar is hidden, so all layers line up
    const narrow = width < 640;
    const left = narrow ? 26 : 176;
    const page = pageRow();
    return { width, narrow, labels: !narrow, left, right: 14, rowH: page || ROW_H, page: !!page, viewH: scroller.node().clientHeight };
  }

  function update({ rows, window }, { animate = true, ms = 650 } = {}) {
    last = { rows, window };
    wrapEl.style.setProperty('--tl-n', String(rows.length)); // the sheet is as tall as its rows (up to a limit)
    sheet.update({ rows, window }, { animate });
    const L = layout();
    if (!L.width || !L.viewH) return; // hidden (landing / setup): drawn on the next resize
    const x = d3.scaleLinear().domain([startYear, until]).range([L.left, L.width - L.right]);
    const n = rows.length;
    const ROW = L.rowH;
    const bodyH = Math.max(L.viewH, n * ROW);
    // Under an open hint the rows keep their size and step down as one block, only as far as the room it needs:
    // the oldest slip under the axis (as when more than ten are scrolled) and come back when the hint closes.
    // Rows, band and bracket move together through one CSS transition (style.css .tl-shift)
    const shift = headroom && n ? Math.max(0, headroom - 11 - Math.max(0, L.viewH - n * ROW)) : 0;
    for (const g of [body, gBandHead]) g.classed('tl-shift', true).style('transform', shift ? `translateY(${shift}px)` : null);
    wrap.classed('is-stepped', shift > 0);
    // Oldest row sits on the axis (bottom); newest on top
    const rowY = (i) => bodyH - (i + 1) * ROW;
    const barH = L.page ? 7 : 6;
    const dur = animate ? ms : 0;
    const ease = d3.easeCubicOut;

    body.attr('width', L.width).attr('height', bodyH);
    foot.attr('width', L.width).attr('height', FOOT_H);
    head.attr('width', L.width).attr('height', HEAD_H + L.viewH);

    // --- Axis and overlap strip (foot) -----------------------------------------
    const axisY = FOOT_H - 22;
    const chartW = L.width - L.left - L.right; // a year label every 10, 20 or 40 years: as many as fit
    const step = chartW < 300 ? 40 : chartW < 560 ? 20 : 10;
    gAxis.attr('transform', `translate(0,${axisY})`)
      .call(d3.axisBottom(x).tickValues(d3.range(Math.ceil(startYear / step) * step, until, step)).tickFormat(d3.format('d')).tickSize(4).tickSizeOuter(0));
    const years = d3.range(startYear, until);
    const spansByRow = rows.map((r) => clampSpans(r.spans));
    const cover = years.map((yr) => (n ? spansByRow.filter((sp) => sp.some((s) => yr + 0.5 >= s.from && yr + 0.5 < s.to)).length / n : 0));
    const cells = gHeat.selectAll('rect').data(years);
    cells.enter().append('rect').merge(cells)
      .attr('x', (yr) => x(yr)).attr('width', (yr) => x(yr + 1) - x(yr) + 0.6)
      .attr('y', axisY - 7).attr('height', 6)
      .transition().duration(dur).ease(ease)
      .attr('fill-opacity', (yr, i) => (cover[i] >= 1 ? 1 : Math.pow(cover[i], 2.2) * 0.75));

    // --- Most likely window: band through rows (body) and strip (foot), label riding on top
    const segs = window && n ? window.segments : [];
    const widest = segs.reduce((b, g, i) => (g.to - g.from > (segs[b] ? segs[b].to - segs[b].from : -1) ? i : b), 0);
    const sx = (g) => [x(Math.max(startYear, g.from)), x(Math.min(until, g.to))];
    const rowsTop = n ? Math.max(0, rowY(n - 1) - 3) : bodyH;
    // Where the top row shows on screen (in head coordinates): the bracket's feet rest there.
    // Once the ten rows are full it stays at the top of the scroll area.
    const feet = HEAD_H + Math.max(0, L.viewH - n * ROW - 3);

    /** Join one window shape per segment; new shapes appear in place, then follow the stack. */
    const joinBand = (g, cls, make, place) => {
      const sel = g.selectAll(`.${cls}`).data(segs, (s, i) => i);
      sel.exit().transition().duration(dur).style('opacity', 0).remove();
      const enter = sel.enter().append(make).attr('class', cls).style('opacity', 0).call(place);
      enter.merge(sel).transition().duration(dur).ease(ease).style('opacity', 1).call(place);
    };
    joinBand(gBandBody, 'win-fill', 'rect', (t) => t
      .attr('x', (s) => sx(s)[0]).attr('width', (s) => Math.max(2, sx(s)[1] - sx(s)[0])).attr('y', rowsTop).attr('height', bodyH - rowsTop));
    joinBand(gBandFoot, 'win-fill', 'rect', (t) => t
      .attr('x', (s) => sx(s)[0]).attr('width', (s) => Math.max(2, sx(s)[1] - sx(s)[0])).attr('y', 0).attr('height', axisY));
    joinBand(gBandHead, 'win-bracket', 'path', (t) => t
      .attr('d', (s) => { const [x0, x1] = sx(s); return `M${x0},${feet}V${feet - 5}H${x1}V${feet}`; }));
    const labelX = (s) => Math.min(Math.max((sx(s)[0] + sx(s)[1]) / 2, L.left + 80), L.width - L.right - 80);
    const label = gBandHead.selectAll('.win-label').data(segs.length ? [segs[widest]] : []);
    label.exit().remove();
    label.enter().append('text').attr('class', 'win-label').attr('x', labelX).attr('y', feet - 9).style('opacity', 0)
      .merge(label)
      .text((s) => `Most likely ${Math.floor(s.from)}${Math.floor(s.to) > Math.floor(s.from) ? ` – ${Math.floor(s.to)}` : ''}`)
      .transition().duration(dur).ease(ease)
      .style('opacity', 1).attr('x', labelX).attr('y', feet - 9);
    const clips = clipPath.selectAll('rect').data(segs, (s, i) => i);
    clips.exit().remove();
    clips.enter().append('rect').attr('y', 0).attr('x', (s) => (sx(s)[0] + sx(s)[1]) / 2).attr('width', 0)
      .merge(clips).attr('height', bodyH)
      .transition().duration(dur).ease(ease)
      .attr('x', (s) => sx(s)[0]).attr('width', (s) => Math.max(0, sx(s)[1] - sx(s)[0]));

    // --- Rows ----------------------------------------------------------------------
    const sel = gRows.selectAll('g.row').data(rows, (d) => d.id);
    sel.exit().transition().duration(dur * 0.6).style('opacity', 0).remove();
    const enter = sel.enter().append('g').attr('class', 'row').attr('role', 'listitem').attr('tabindex', 0)
      .attr('transform', (d) => `translate(0,${rowY(rows.indexOf(d)) - 8})`).style('opacity', 0);
    enter.append('rect').attr('class', 'row-hit');
    enter.append('line').attr('class', 'row-track');
    enter.append('text').attr('class', 'row-label');
    enter.append('path').attr('class', 'row-mark');

    const all = enter.merge(sel);
    all.attr('aria-label', (d) => `${d.subject}: ${d.question} ${d.reply === 'yes' ? 'Yes' : 'No'}. ${d.rangeText}. Press Enter to change.`);
    all.transition().duration(dur).ease(ease)
      .attr('transform', (d) => `translate(0,${rowY(rows.indexOf(d))})`).style('opacity', 1);
    all.select('.row-hit').attr('x', 0).attr('y', 0).attr('width', L.width).attr('height', ROW);
    all.select('.row-track').attr('x1', x(startYear)).attr('x2', x(until)).attr('y1', ROW / 2).attr('y2', ROW / 2);
    all.select('.row-label')
      .attr('x', L.left - 26).attr('y', ROW / 2).attr('dy', '0.34em').attr('text-anchor', 'end')
      .style('display', L.labels ? null : 'none')
      .text((d) => (L.narrow ? clip(d.subject, L.left - 34, 12) : d.subject));
    all.select('.row-mark')
      .attr('transform', `translate(${L.left - 12},${ROW / 2})`)
      .attr('class', (d) => `row-mark ${d.reply}`)
      .attr('d', (d) => MARK_PATH[d.reply === 'yes' ? 'yes' : 'no']);

    // Bars: one per allowed span, drawn in ink and again in brass clipped to the window.
    // A new bar grows out from its centre; a changed answer morphs into its new spans.
    all.each(function (d) {
      const spans = clampSpans(d.spans);
      const groups = d3.select(this).selectAll('g.span').data(spans, (sp, i) => i);
      groups.exit().transition().duration(dur * 0.5).style('opacity', 0).remove();
      const gIn = groups.enter().append('g').attr('class', 'span');
      gIn.append('rect').attr('class', 'bar');
      gIn.append('rect').attr('class', 'bar-hi').attr('clip-path', 'url(#tl-window)');
      gIn.selectAll('rect').attr('rx', barH / 2).attr('y', (ROW - barH) / 2).attr('height', barH)
        .attr('x', function () { const sp = d3.select(this.parentNode).datum(); return (x(sp.from) + x(sp.to)) / 2; })
        .attr('width', 0);
      gIn.merge(groups).each(function (sp) {
        d3.select(this).selectAll('rect').attr('rx', barH / 2).attr('y', (ROW - barH) / 2).attr('height', barH)
          .transition().duration(animate ? 800 : 0).delay(animate ? 120 : 0).ease(d3.easeCubicInOut)
          .attr('x', x(sp.from)).attr('width', Math.max(2, x(sp.to) - x(sp.from)));
      });
    });

    // Hover: a quick reminder; click or Enter: ask that question again on the main screen
    all.on('pointerenter', function (e, d) {
      if (selectedId || e.pointerType === 'touch' || compact()) return;
      gRows.classed('focus', true); d3.select(this).classed('on', true);
      showTip(d, this, e);
    }).on('pointerleave', function () {
      if (selectedId) return;
      gRows.classed('focus', false); d3.select(this).classed('on', false);
      tip.attr('hidden', true);
    }).on('click', function (e, d) { e.stopPropagation(); choose(d); })
      .on('keydown', function (e, d) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(d); } });

    // A new answer: bring the top of the stack into view
    if (n > prevCount && scroller.node().scrollTop > 0) scroller.node().scrollTo({ top: 0, behavior: animate ? 'smooth' : 'auto' });
    prevCount = n;
    updateFades();
    if (selectedId && !rows.some((r) => r.id === selectedId)) select(null); else applySelection();
  }

  function choose(d) {
    tip.attr('hidden', true);
    onSelect?.(d);
  }

  // On phones the strip is one button that opens the sheet (timeline-sheet.js keeps its role while open)
  const syncRole = () => {
    if (compact()) { sheet.relayout(); return; }
    sheet.close();
    wrapEl.setAttribute('role', 'region');
    wrapEl.tabIndex = -1;
    wrapEl.setAttribute('aria-label', 'Timeline of your answers');
    wrapEl.removeAttribute('aria-expanded');
  };
  syncRole();

  /** Mark the row whose question is back on screen (null clears it). */
  function select(id) {
    selectedId = id;
    sheet.select(id);
    tip.attr('hidden', true);
    applySelection();
    // Centre the row in the ten-row window, clear of the edge fades
    const i = last.rows.findIndex((r) => r.id === id);
    if (id && i >= 0) {
      const el = scroller.node(), ROW = layout().rowH;
      const bodyH = Math.max(el.clientHeight, last.rows.length * ROW);
      const y = bodyH - (i + 1) * ROW;
      el.scrollTo({ top: Math.max(0, y - (el.clientHeight - ROW) / 2), behavior: 'smooth' });
    }
  }

  function applySelection() {
    gRows.classed('focus', !!selectedId);
    gRows.selectAll('g.row').classed('on', (r) => r.id === selectedId).classed('open', (r) => r.id === selectedId);
  }

  // --- Tooltip -----------------------------------------------------------------------
  function showTip(d, rowEl, e) {
    tip.attr('hidden', null).html(
      `<div class="tl-tip-subject">${esc(d.subject)}</div>` +
      `<div class="tl-tip-q">${esc(d.question)} <strong>${d.reply === 'yes' ? 'Yes' : 'No'}</strong></div>` +
      `<div class="tl-tip-range">${esc(d.rangeText)} · click to change</div>`);
    const w = wrapEl.getBoundingClientRect();
    const r = rowEl.getBoundingClientRect();
    const width = tip.node().offsetWidth;
    tip.style('left', `${Math.min(Math.max(8, e.clientX - w.left - width / 2), w.width - width - 8)}px`)
      .style('bottom', `${w.bottom - r.top + 6}px`);
  }

  // --- Scroll affordance: soft fades where more rows hide ----------------------------
  function updateFades() {
    const el = scroller.node();
    wrap.classed('more-above', el.scrollTop > 2);
    wrap.classed('more-below', wrap.classed('is-stepped') || el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }
  scroller.on('scroll', () => { updateFades(); tip.attr('hidden', true); });

  new ResizeObserver(() => { syncRole(); update(last, { animate: false }); }).observe(wrapEl);
  /** The question screen's hint is open and its buttons need `px` at the top of the timeline (0: closed). */
  function setHeadroom(px) {
    px = Math.max(0, Math.round(px));
    if (px === headroom) return;
    headroom = px;
    if (!compact()) update(last, { animate: false });
  }

  return { update, select, setHeadroom, close: () => sheet.close(), snapshot: () => sheet.snapshot() };
}

/** A subject cut to fit maxW (an ellipsis when it doesn't). */
function clip(s, maxW, size) {
  if (maxW <= 0) return '';
  if (textWidth(s, size) <= maxW) return s;
  while (s.length > 1 && textWidth(`${s}…`, size) > maxW) s = s.slice(0, -1).trimEnd();
  return `${s}…`;
}
let measure = null;
function textWidth(text, size) {
  measure ??= document.createElement('canvas').getContext('2d');
  measure.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--serif')}`;
  return measure.measureText(text).width;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
