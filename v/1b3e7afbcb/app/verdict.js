// The verdict chart: the result screen's timeline, grown to fill the page and replayed.
//
// It starts where the user started, with every year possible: each answer's row is a
// full-width bar and the belief curve is flat. Then the answers land in the order given,
// slowly enough to follow. Each bar contracts to the years its answer allows, and the curve
// (the engine's own probability per year) reshapes, leaving a faint ridge of its earlier
// self, so the layered ridges show the guess narrowing. Last, the 80% window opens from the
// peak, the most likely year is pinned on it, and the stretch where the answers agree
// opens with it: an ink column through the rows, the bar sections inside it in solid ink,
// and its months under the axis. Brass is the verdict (curve, window); ink is the evidence.
//
// Hovering an answer lights its ridge in brass: the belief right after that answer, with
// every earlier answer in it. The last answer's ridge is the final curve itself.
//
// Three layers share one x scale: top (the curve and the peak's year), a scroll area
// (the rows, scrollbar hidden) and the axis.
//
//   show({ rows, frames, window, agree, peak }, { animate, onStep, onVerdict })
//     onStep(k)   called as answer k lands in the replay;  onVerdict() as the window opens
//   skip()        a running replay jumps to its settled end (onVerdict still fires)
//     rows    as for the timeline: [{ id, subject, question, reply, rangeText, spans }]
//     frames  [{ density: [{ year, p }], from, to }]: the belief before any answer, then after each row
//     window  { from, to }: the final 80% window;  peak: the most likely calendar year
//     agree   where the answers agree (agreement.js): { from, to, rangeText }, or null
//   hide()

import { VISIBLE_ROWS } from './timeline.js';
import { createResultChart } from './result-chart.js';
import { fitClaim } from './claim-fit.js';

const d3 = window.d3;
const GHOST = 0.16; // opacity of the ridges earlier answers leave behind
// The label column has one width for every result, so the chart never shifts or squeezes; a
// long subject wraps onto two lines (the result page's band lines up with this column too)
export const GUTTER = 200;
const MARK_PATH = { yes: 'M-3.4,0.2L-1.1,2.6L3.5,-2.8', no: 'M-2.8,-2.8L2.8,2.8M-2.8,2.8L2.8,-2.8' };

export function createVerdict(wrapEl, startYear, endYear, { onSelect, onInfo, compact = () => false, sizes = () => null, rowLine = () => false } = {}) {
  // Phones: the strip becomes the chart, zoomed and dragged sideways (result-chart.js); every call is passed on to it
  const phone = createResultChart(wrapEl, startYear, endYear, { onSelect, onInfo });
  const until = endYear + 1;
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const root = d3.select(wrapEl).append('div').attr('class', 'vd').attr('hidden', true);
  const top = root.append('svg').attr('class', 'vd-top').attr('aria-hidden', 'true');
  const scroller = root.append('div').attr('class', 'vd-scroll');
  const body = scroller.append('svg').attr('class', 'vd-rows').attr('role', 'list').attr('aria-label', 'Your answers, in the order given');
  const axisSvg = root.append('svg').attr('class', 'vd-axis').attr('aria-hidden', 'true');
  const tip = d3.select(wrapEl).append('div').attr('class', 'tl-tip').attr('hidden', true);

  const clipTop = top.append('defs').append('clipPath').attr('id', 'vd-clip-top').append('rect');
  const clipAgree = body.append('defs').append('clipPath').attr('id', 'vd-clip-agree').append('rect');
  const gBandTop = top.append('g');
  const gGhosts = top.append('g').attr('class', 'vd-ghosts');
  const curveArea = top.append('path').attr('class', 'vd-area');
  const curveHi = top.append('path').attr('class', 'vd-area-hi').attr('clip-path', 'url(#vd-clip-top)');
  const curveLine = top.append('path').attr('class', 'vd-line');
  const ridgeLine = top.append('path').attr('class', 'vd-ridge-on');
  const gEdgesTop = top.append('g');
  const gPeak = top.append('g').attr('class', 'vd-peak');
  const gBandRows = body.append('g');
  const gAgree = body.append('g').attr('class', 'vd-agree-col');
  const gRows = body.append('g').attr('class', 'vd-rowset');
  const gEdgesRows = body.append('g');
  const gLine = body.append('g').attr('class', 'vd-rowline'); // an upright tablet's open row (openLine)
  const gAxis = axisSvg.append('g').attr('class', 'tl-axis');
  const gAgreeAxis = axisSvg.append('g').attr('class', 'vd-agree-axis');

  let data = null;
  let run = 0; // bumps on every show/hide, so a stale replay stops scheduling itself

  function geometry() {
    const W = root.node().clientWidth, H = root.node().clientHeight;
    const narrow = W < 640;
    const n = data.rows.length;
    // An upright tablet's page sets the curve and the rows itself (app.js placeResultPage): the chart is as tall as its rows
    const page = sizes();
    const curveH = page ? page.curveH : Math.round(Math.max(64, Math.min(130, H * 0.28)));
    const axisH = data.agree ? 50 : 24; // room under the ticks for the agreement's months
    const viewH = Math.max(40, H - curveH - axisH);
    // At most VISIBLE_ROWS rows in view, as on the evidence timeline; any more scroll (scrollbar hidden)
    const rowH = page ? page.rowH : Math.max(15, Math.min(30, viewH / Math.max(1, Math.min(n, VISIBLE_ROWS))));
    const gutter = narrow ? 30 : GUTTER;
    const x = d3.scaleLinear().domain([startYear, until]).range([gutter, W - 16]);
    return { W, H, narrow, n, curveH, axisH, viewH, rowH, x, rowsH: Math.max(viewH, n * rowH) };
  }

  /** Lay everything out in its final positions, or in its starting positions when `fresh`. */
  function layout(G, fresh) {
    const { W, curveH, axisH, rowH, rowsH, x, narrow } = G;
    top.attr('width', W).attr('height', curveH);
    body.attr('width', W).attr('height', rowsH);
    axisSvg.attr('width', W).attr('height', axisH);
    scroller.style('height', `${G.viewH}px`);

    const chartW = x.range()[1] - x.range()[0];
    const step = chartW < 300 ? 40 : chartW < 560 ? 20 : 10;
    gAxis.attr('transform', 'translate(0,2)')
      .call(d3.axisBottom(x).tickValues(d3.range(Math.ceil(startYear / step) * step, until, step)).tickFormat(d3.format('d')).tickSize(4).tickSizeOuter(0));

    // Rows: oldest answer at the top, the replay reads downwards
    const rows = gRows.selectAll('g.vd-row').data(data.rows, (d) => d.id).join((enter) => {
      const g = enter.append('g').attr('class', 'vd-row').attr('role', 'listitem').attr('tabindex', 0);
      g.append('rect').attr('class', 'row-hit');
      g.append('line').attr('class', 'row-track');
      g.append('text').attr('class', 'row-label');
      g.append('path').attr('class', 'row-mark');
      return g;
    });
    rows.attr('transform', (d, i) => `translate(0,${i * rowH})`)
      .attr('aria-label', (d) => `${d.subject}: ${d.question} ${d.reply === 'yes' ? 'Yes' : 'No'}. ${d.rangeText}. ${rowLine() ? 'Press Enter to open it.' : 'Press Enter to change.'}`)
      .attr('aria-expanded', rowLine() ? 'false' : null);
    rows.select('.row-hit').attr('width', W).attr('height', rowH);
    rows.select('.row-track').attr('x1', x(startYear)).attr('x2', x(until)).attr('y1', rowH / 2).attr('y2', rowH / 2);
    rows.select('.row-label').attr('x', x(startYear) - 26).attr('y', rowH / 2)
      .style('display', narrow ? 'none' : null).each(function (d) { fitLabel(d3.select(this), d.subject, x(startYear) - 30, rowH); });
    rows.select('.row-mark').attr('class', (d) => `row-mark ${d.reply}`).attr('d', (d) => MARK_PATH[d.reply === 'yes' ? 'yes' : 'no'])
      .attr('transform', `translate(${x(startYear) - 12},${rowH / 2})`).style('opacity', fresh ? 0 : 1);

    const barH = Math.min(8, Math.max(5, rowH * 0.32));
    rows.each(function (d) {
      const spans = d.spans.map(({ from, to }) => ({ from: from ?? startYear, to: to ?? until }));
      const g = d3.select(this).selectAll('g.span').data(spans).join((e) => {
        const s = e.append('g').attr('class', 'span');
        s.append('rect').attr('class', 'bar');
        s.append('rect').attr('class', 'bar-agree').attr('clip-path', 'url(#vd-clip-agree)');
        return s;
      });
      g.selectAll('rect').attr('rx', barH / 2).attr('y', (rowH - barH) / 2).attr('height', barH)
        .attr('x', function () { return fresh ? x(startYear) : x(d3.select(this.parentNode).datum().from); })
        .attr('width', function () { const sp = d3.select(this.parentNode).datum(); return fresh ? x(until) - x(startYear) : Math.max(2, x(sp.to) - x(sp.from)); });
      g.select('.bar').classed('is-open', fresh);
    });

    // Laptops: hovering a row lights it and shows its note; a click asks it again. An upright tablet: a tap opens the row's
    // line first (openLine), and the line asks it again
    rows.on('pointerenter', function (e, d) { if (rowLine()) return; gRows.classed('focus', true); d3.select(this).classed('on', true); showTip(d, this, e); showRidge(G, d); })
      .on('pointerleave', function () { if (rowLine()) return; gRows.classed('focus', false); d3.select(this).classed('on', false); tip.attr('hidden', true); showRidge(G, null); })
      .on('click', (e, d) => { e.stopPropagation(); tip.attr('hidden', true); if (rowLine()) toggleLine(d); else onSelect?.(d); })
      .on('keydown', (e, d) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault(); tip.attr('hidden', true);
        if (!rowLine()) return onSelect?.(d);
        toggleLine(d);
        if (opened) gLine.select('.vd-rowline-g').node()?.focus({ preventScroll: true });
      });

    // The window: band and edge lines (final positions; the opening animates the clip)
    const [wx0, wx1] = [x(data.window.from), x(data.window.to)];
    gBandTop.selectAll('rect').data([0]).join('rect').attr('class', 'vd-band').attr('x', wx0).attr('width', Math.max(2, wx1 - wx0)).attr('y', 18).attr('height', curveH - 18);
    gBandRows.selectAll('rect').data([0]).join('rect').attr('class', 'vd-band').attr('x', wx0).attr('width', Math.max(2, wx1 - wx0)).attr('y', 0).attr('height', rowsH);
    gEdgesTop.selectAll('line').data([wx0, wx1]).join('line').attr('class', 'vd-edge').attr('x1', (v) => v).attr('x2', (v) => v).attr('y1', 18).attr('y2', curveH);
    gEdgesRows.selectAll('line').data([wx0, wx1]).join('line').attr('class', 'vd-edge').attr('x1', (v) => v).attr('x2', (v) => v).attr('y1', 0).attr('y2', rowsH);
    // The most likely year, pinned on the curve's peak
    const px = x(data.peak + 0.5);
    gPeak.selectAll('line').data([0]).join('line').attr('x1', px).attr('x2', px).attr('y1', 16).attr('y2', 21);
    gPeak.selectAll('circle').data([0]).join('circle').attr('cx', px).attr('cy', 24).attr('r', 3.2);
    // Only the peak is labelled: the panel already says the range
    gPeak.selectAll('text').data([data.peak]).join('text').attr('x', px).attr('y', 11).attr('text-anchor', 'middle').text((d) => d);

    // Where the answers agree: a column through the rows, its months under the axis (a short stretch keeps a visible width)
    const A = agreeGeometry(G);
    gAgree.selectAll('rect').data(A ? [0] : []).join('rect').attr('class', 'vd-agree-fill').attr('y', 0).attr('height', G.n * rowH);
    gAgree.selectAll('line').data(A ? [0, 1] : []).join('line').attr('class', 'vd-agree-edge').attr('y1', 0).attr('y2', rowsH);
    gAgreeAxis.selectAll('line').data(A ? [0, 1] : []).join('line').attr('class', 'vd-agree-edge').attr('y1', 0).attr('y2', 30);
    gAgreeAxis.selectAll('path').data(A ? [0] : []).join('path').attr('class', 'vd-agree-bracket');
    const label = gAgreeAxis.selectAll('text').data(A ? [data.agree.rangeText] : []).join('text').attr('class', 'vd-agree-label')
      .attr('y', 43).attr('text-anchor', 'middle').text((d) => d);
    if (A) {
      const half = label.node().getComputedTextLength() / 2;
      label.attr('x', Math.min(Math.max(A.mid, x(startYear) + half), W - 16 - half));
    }

    return { barH };
  }

  // --- The belief curve -------------------------------------------------------------
  function curveFns(G) {
    const y = (max) => d3.scaleLinear().domain([0, max || 1]).range([G.curveH - 1, 24]);
    const area = (ps) => { const yy = y(d3.max(ps)); return d3.area().x((p, i) => G.x(startYear + i + 0.5)).y0(G.curveH - 1).y1((p) => yy(p)).curve(d3.curveMonotoneX)(ps); };
    const line = (ps) => { const yy = y(d3.max(ps)); return d3.line().x((p, i) => G.x(startYear + i + 0.5)).y((p) => yy(p)).curve(d3.curveMonotoneX)(ps); };
    return { area, line };
  }
  const ps = (frame) => frame.density.map((d) => d.p);

  /** Light one answer's ridge (the belief right after it) over the faded rest, or clear it. */
  function showRidge(G, d) {
    const i = d && !root.classed('is-playing') ? data.rows.indexOf(d) : -1;
    root.classed('ridge-on', i >= 0);
    ridgeLine.attr('d', i >= 0 ? curveFns(G).line(ps(data.frames[i + 1])) : null);
  }

  function setCurve(G, frame) {
    const { area, line } = curveFns(G);
    curveArea.attr('d', area(ps(frame)));
    curveHi.attr('d', area(ps(frame)));
    curveLine.attr('d', line(ps(frame)));
  }

  function setWindowOpen(G, k) {
    // k: 0 = closed at the peak, 1 = open to the window's edges
    const m = G.x(data.peak + 0.5), x0 = G.x(data.window.from), x1 = G.x(data.window.to);
    const a = m + (x0 - m) * k, b = m + (x1 - m) * k;
    clipTop.attr('x', a).attr('width', Math.max(0, b - a)).attr('y', 0).attr('height', G.curveH);
    gBandTop.selectAll('rect').attr('x', a).attr('width', Math.max(0, b - a));
    gBandRows.selectAll('rect').attr('x', a).attr('width', Math.max(0, b - a));
    gEdgesTop.selectAll('line').attr('x1', (v, i) => (i ? b : a)).attr('x2', (v, i) => (i ? b : a)).style('opacity', k > 0.02 ? 1 : 0);
    gEdgesRows.selectAll('line').attr('x1', (v, i) => (i ? b : a)).attr('x2', (v, i) => (i ? b : a)).style('opacity', k > 0.02 ? 1 : 0);
  }

  /** The agreement column's edges in pixels, at least 4 px apart, or null when there is none. */
  function agreeGeometry(G) {
    if (!data?.agree) return null; // (also when the result was taken down while the column was still opening)
    const a = G.x(data.agree.from ?? startYear), b = G.x(data.agree.to ?? until), mid = (a + b) / 2;
    const w = Math.max(4, b - a);
    return { x0: mid - w / 2, x1: mid + w / 2, mid };
  }

  function setAgreeOpen(G, k) {
    // k: 0 = closed at its middle, 1 = open to its edges
    const A = agreeGeometry(G);
    if (!A) return;
    const a = A.mid + (A.x0 - A.mid) * k, b = A.mid + (A.x1 - A.mid) * k;
    clipAgree.attr('x', a).attr('width', Math.max(0, b - a)).attr('y', 0).attr('height', G.rowsH + lineH);
    gAgree.selectAll('rect').attr('x', a).attr('width', Math.max(0, b - a));
    for (const g of [gAgree, gAgreeAxis]) g.selectAll('line').attr('x1', (v, i) => (i ? b : a)).attr('x2', (v, i) => (i ? b : a)).style('opacity', k > 0.02 ? null : 0);
    gAgreeAxis.selectAll('path').attr('d', `M${a},26V30H${b}V26`).style('opacity', k > 0.02 ? null : 0);
  }

  // --- Show ---------------------------------------------------------------------------
  let pendingVerdict = null; // the running replay's onVerdict, so skip() can still deliver it
  function show(next, { animate = true, onStep = null, onVerdict = null } = {}) {
    const reopen = !animate && opened ? opened.id : null;
    dropLine();
    data = next;
    const id = ++run;
    pendingVerdict = null;
    root.attr('hidden', null);
    const G = geometry();
    lastG = G;
    const play = animate && !REDUCED && G.n > 0;
    layout(G, play);
    gGhosts.selectAll('*').remove();
    ridgeLine.attr('d', null);
    root.classed('ridge-on', false);
    const { area, line } = curveFns(G);
    root.classed('is-final', false).classed('is-playing', play);
    if (!play) {
      // Settled: every ridge the replay would have left behind, under the final curve
      for (const f of data.frames.slice(0, -1)) gGhosts.append('path').attr('d', line(ps(f))).style('opacity', GHOST);
      gRows.selectAll('.row-mark').style('opacity', 1);
      setCurve(G, data.frames[data.frames.length - 1]);
      setWindowOpen(G, 1);
      setAgreeOpen(G, 1);
      root.classed('is-final', true).classed('is-playing', false);
      const again = reopen && rowLine() && data.rows.find((r) => r.id === reopen);
      if (again) openLine(again, { instant: true });
      onVerdict?.();
      return;
    }
    pendingVerdict = onVerdict;

    // The replay: one answer per step, unhurried; a long session speeds up so it stays under about ten seconds
    setCurve(G, data.frames[0]);
    setWindowOpen(G, 0);
    setAgreeOpen(G, 0);
    const stepMs = Math.max(300, Math.min(750, 6500 / G.n));
    const t0 = 700;
    data.rows.forEach((row, k) => {
      d3.timeout(() => {
        if (id !== run) return;
        onStep?.(k);
        const rowSel = gRows.selectAll('g.vd-row').filter((d) => d.id === row.id).classed('is-now', true);
        rowSel.select('.row-mark').style('opacity', 0).attr('transform', `translate(${G.x(startYear) - 12},${G.rowH / 2}) scale(0.2)`)
          .transition().duration(380).ease(d3.easeBackOut).style('opacity', 1).attr('transform', `translate(${G.x(startYear) - 12},${G.rowH / 2}) scale(1)`);
        rowSel.selectAll('g.span').each(function (sp) {
          d3.select(this).selectAll('rect').transition().duration(950).ease(d3.easeCubicInOut)
            .attr('x', G.x(sp.from)).attr('width', Math.max(2, G.x(sp.to) - G.x(sp.from)));
          d3.select(this).select('.bar').classed('is-open', false);
        });
        d3.timeout(() => rowSel.classed('is-now', false), stepMs * 1.8);
        // The previous curve stays behind as a ridge
        const before = ps(data.frames[k]), after = ps(data.frames[k + 1]);
        gGhosts.append('path').attr('d', line(before)).style('opacity', 0.5).transition().duration(1100).style('opacity', GHOST);
        const tween = d3.interpolateArray(before, after);
        const ms = stepMs * 1.3;
        curveArea.transition('c').duration(ms).ease(d3.easeCubicInOut).attrTween('d', () => (t) => area(tween(t)));
        curveHi.transition('c').duration(ms).ease(d3.easeCubicInOut).attrTween('d', () => (t) => area(tween(t)));
        curveLine.transition('c').duration(ms).ease(d3.easeCubicInOut).attrTween('d', () => (t) => line(tween(t)));
        // Keep the landing row in view on long sessions
        const el = scroller.node(), y = k * G.rowH;
        if (y < el.scrollTop || y > el.scrollTop + el.clientHeight - G.rowH) el.scrollTo({ top: Math.max(0, y - el.clientHeight / 2), behavior: 'smooth' });
      }, t0 + k * stepMs);
    });

    // The verdict: the window and the agreement column open, then the labels settle in
    const verdictAt = t0 + G.n * stepMs + 700;
    d3.timeout(() => {
      if (id !== run) return;
      pendingVerdict = null;
      onVerdict?.();
      scroller.node().scrollTo({ top: 0, behavior: 'smooth' });
      d3.transition('open').duration(1200).ease(d3.easeCubicInOut).tween('open', () => (t) => { setWindowOpen(G, t); setAgreeOpen(G, t); });
      d3.timeout(() => {
        if (id !== run) return;
        root.classed('is-playing', false);
        root.classed('is-final', true);
      }, 1200);
    }, verdictAt);
  }

  /** The agreement column is drawn only on request (the panel's info button); it opens from its middle. */
  let lastG = null;
  function showAgree(on) {
    root.classed('show-agree', on);
    if (on && lastG && root.classed('is-final')) d3.transition('agree').duration(700).ease(d3.easeCubicInOut).tween('agree', () => (t) => setAgreeOpen(lastG, t));
  }

  /** Light one part of the chart while its line in "Reading the chart" is hovered. */
  function emphasize(part, { slow = false } = {}) {
    root.classed('emph-slow', slow);
    for (const p of ['curve', 'band', 'agree']) root.classed(`emph-${p}`, part === p);
  }

  /** Cut a running replay short: the chart settles at once and the verdict is delivered. */
  function skip() {
    if (!data || !root.classed('is-playing')) return;
    const cb = pendingVerdict;
    gRows.selectAll('*').interrupt();
    for (const el of [curveArea, curveHi, curveLine]) el.interrupt('c');
    show(data, { animate: false, onVerdict: cb });
  }

  function hide() {
    run++;
    pendingVerdict = null;
    dropLine();
    root.attr('hidden', true).classed('is-final', false);
    emphasize(null);
    tip.attr('hidden', true);
    data = null;
  }


  // --- An upright tablet: a tap on a row opens a line under it, as on the phone (result-chart.js) ---------------------
  // The line holds the claim, the tick or cross at its right and the years the answer allows; the rows below step down
  // to make room, the other rows step back and the curve shows the belief right after that answer (the laptop's hover).
  // A tap on the line asks the question again. The same row, a tap outside the chart or Escape closes it; another row
  // moves it there. Moves on the app's curve (.2, .8, .2, 1), the words fade in with a 6 px rise once the room is half open.
  const LINE = 58, LINE_MS = 320, WORDS_MS = 260;
  const MOVE = cubicBezier(0.2, 0.8, 0.2, 1), FADE = cubicBezier(0.25, 0.1, 0.25, 1);
  let opened = null, lineH = 0, lineToken = 0;
  const claimCanvas = document.createElement('canvas').getContext('2d');

  /** Room for the line under the rows: the scrolled rows, the window's band and edges and the agreement column grow with it. */
  function setLineRoom(G, h) {
    lineH = h;
    body.attr('height', G.rowsH + h);
    gBandRows.selectAll('rect').attr('height', G.rowsH + h);
    gEdgesRows.selectAll('line').attr('y2', G.rowsH + h);
    gAgree.selectAll('rect').attr('height', G.n * G.rowH + h);
    gAgree.selectAll('line').attr('y2', G.rowsH + h);
    clipAgree.attr('height', G.rowsH + h);
  }
  /** Every row in its place, with the rows under row k stepped down by the line (k = -1: none). */
  function placeRows(G, k, ms) {
    const rows = gRows.selectAll('g.vd-row');
    const at = (d, i) => `translate(0,${i * G.rowH + (k >= 0 && i > k ? LINE : 0)})`;
    rows.interrupt('line');
    if (!ms) { rows.attr('transform', at); return null; }
    return rows.transition('line').duration(ms).ease(MOVE).attr('transform', at);
  }
  function lightRow(G, d) {
    gRows.classed('focus', !!d);
    gRows.selectAll('g.vd-row').classed('on', (x) => !!d && x.id === d.id).attr('aria-expanded', (x) => String(!!d && x.id === d.id));
    showRidge(G, d);
  }
  function toggleLine(d) {
    if (root.classed('is-playing')) return;
    if (opened?.id === d.id) closeLine(); else openLine(d);
  }
  /** The old line folds away where it is (its paper to nothing, its words out). */
  function foldLines(ms) {
    gLine.selectAll('g.vd-rowline-g').attr('class', 'vd-rowline-old').attr('role', null).attr('tabindex', null).on('click', null).on('keydown', null)
      .each(function () {
        const g = d3.select(this);
        if (!ms) return g.remove();
        g.select('.vd-line-words').interrupt().transition().duration(ms * 0.4).ease(FADE).style('opacity', 0);
        g.select('.vd-line-paper').interrupt().transition().duration(ms).ease(MOVE).attr('height', 0).on('end', () => g.remove());
      });
  }
  function openLine(d, { instant = false } = {}) {
    const G = lastG, k = data.rows.indexOf(d);
    if (!G || k < 0) return;
    const ms = instant || REDUCED ? 0 : LINE_MS;
    lineToken++; // a pending close no longer takes the room away
    opened = d;
    lightRow(G, d);
    setLineRoom(G, LINE);
    placeRows(G, k, ms);
    foldLines(ms);
    const y0 = (k + 1) * G.rowH, W = G.W, mark = d.reply === 'yes' ? 'yes' : 'no';
    const g = gLine.append('g').attr('class', 'vd-rowline-g').attr('transform', `translate(0,${y0})`)
      .attr('role', 'button').attr('tabindex', 0).attr('aria-label', `Answer again: ${d.claim}`);
    const paper = g.append('rect').attr('class', 'vd-line-paper').attr('x', 0).attr('width', W).attr('height', ms ? 0 : LINE);
    if (ms) paper.transition().duration(ms).ease(MOVE).attr('height', LINE);
    const words = g.append('g').attr('class', 'vd-line-words');
    claimCanvas.font = `14px ${getComputedStyle(document.body).getPropertyValue('--serif')}`;
    const claim = fitClaim(d.claim ?? '', W - 6 - 40, (t) => claimCanvas.measureText(t).width).text;
    words.append('text').attr('class', 'row-claim').attr('x', 6).attr('y', 19).attr('dy', '0.34em').text(claim);
    words.append('text').attr('class', 'row-range').attr('x', 6).attr('y', 40).attr('dy', '0.34em').text(`${d.rangeText} · tap to answer again`);
    words.append('path').attr('class', `row-mark ${mark}`).attr('d', MARK_PATH[mark]).attr('transform', `translate(${W - 14},19)`);
    if (REDUCED && !instant) words.style('opacity', 0).transition().duration(200).ease(FADE).style('opacity', 1);
    else if (ms) words.style('opacity', 0).attr('transform', 'translate(0,6)').transition().delay(ms * 0.45).duration(WORDS_MS).ease(FADE).style('opacity', 1).attr('transform', 'translate(0,0)');
    const again = (e) => { e.stopPropagation(); e.preventDefault?.(); const row = opened; closeLine({ instant: true }); onSelect?.(row); };
    g.on('click', again).on('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') again(e); });
    // The line in view inside the rows' scroll box, with its row
    const el = scroller.node(), bottom = y0 + LINE;
    if (bottom > el.scrollTop + el.clientHeight) el.scrollTo({ top: bottom - el.clientHeight + 4, behavior: ms ? 'smooth' : 'auto' });
    else if (y0 - G.rowH < el.scrollTop) el.scrollTo({ top: Math.max(0, y0 - G.rowH - 4), behavior: ms ? 'smooth' : 'auto' });
  }
  function closeLine({ instant = false } = {}) {
    const G = lastG;
    if (!opened || !G) return;
    const ms = instant || REDUCED ? 0 : LINE_MS, token = ++lineToken;
    opened = null;
    lightRow(G, null);
    const moving = placeRows(G, -1, ms);
    foldLines(ms);
    // the room goes once the rows have stepped back up (not if a line opened again meanwhile)
    const done = () => { if (token === lineToken && lastG === G) setLineRoom(G, 0); };
    if (moving) moving.end().then(done, () => {}); else done();
  }
  /** Drops an open line at once (a redraw, the result taken down); the redraw sets the rows and heights itself. */
  function dropLine() {
    lineToken++;
    opened = null; lineH = 0;
    gLine.selectAll('*').interrupt().remove();
    gRows.selectAll('g.vd-row').interrupt('line');
    gRows.classed('focus', false);
  }
  // A tap outside the rows and the line closes it; so does Escape (focus back on its row)
  addEventListener('pointerdown', (e) => { if (opened && !e.target.closest?.('.vd-row, .vd-rowline')) closeLine(); }, true);
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !opened) return;
    const id = opened.id;
    closeLine();
    gRows.selectAll('g.vd-row').filter((x) => x.id === id).node()?.focus({ preventScroll: true });
  });

  function showTip(d, rowEl, e) {
    tip.attr('hidden', null).html(
      `<div class="tl-tip-subject">${esc(d.subject)}</div>` +
      `<div class="tl-tip-q">${esc(d.question)} <strong>${d.reply === 'yes' ? 'Yes' : 'No'}</strong></div>` +
      `<div class="tl-tip-range">${esc(d.rangeText)} · click to change</div>`);
    const w = wrapEl.getBoundingClientRect(), r = rowEl.getBoundingClientRect();
    const width = tip.node().offsetWidth;
    tip.style('left', `${Math.min(Math.max(8, e.clientX - w.left - width / 2), w.width - width - 8)}px`);
    // Below the row, so the lit ridge above stays in view; above it only when there is no room below
    if (r.bottom + 6 + tip.node().offsetHeight < w.bottom) tip.style('bottom', null).style('top', `${r.bottom - w.top + 6}px`);
    else tip.style('top', null).style('bottom', `${w.bottom - r.top + 6}px`);
  }
  scroller.on('scroll', () => tip.attr('hidden', true));

  // A resize redraws the final picture (a running replay is cut short)
  new ResizeObserver(() => { if (data && !root.classed('is-playing') && !phone.active()) show(data, { animate: false }); }).observe(wrapEl);

  return {
    show(next, opts = {}) {
      if (compact()) { hide(); phone.show(next, opts); return; }
      phone.hide(); show(next, opts);
    },
    hide() { phone.hide(); hide(); },
    skip() { if (phone.active()) phone.skip(); else skip(); },
    showAgree(on) { if (phone.active()) phone.showInfo(on); else showAgree(on); }, // on a phone the (i) names the chart's parts
    emphasize(part, o) { if (!phone.active()) emphasize(part, o); },
    revealFoot(ms) { if (phone.active()) phone.revealFoot(ms); }, // a phone's footnote, the verdict's last beat
  };
}

/** A row's label within maxW: one line, else two balanced lines when the row is tall enough, else cut with an ellipsis. */
function fitLabel(text, subject, maxW, rowH) {
  text.selectAll('tspan').remove();
  text.text(null).attr('class', 'row-label');
  const line = (s, dy) => text.append('tspan').attr('x', text.attr('x')).attr('dy', dy).text(s);
  if (textWidth(subject) <= maxW) { line(subject, '0.34em'); return; }
  const words = subject.split(' ');
  if (rowH >= 20 && words.length > 1) {
    // The break that makes the longer line shortest
    let best = null;
    for (let i = 1; i < words.length; i++) {
      const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ');
      const w = Math.max(textWidth(a, 12), textWidth(b, 12));
      if (!best || w < best.w) best = { a, b, w };
    }
    text.classed('is-wrapped', true);
    const roomy = rowH >= 26;
    line(clip(best.a, maxW, 12), roomy ? '-0.21em' : '-0.14em');
    line(clip(best.b, maxW, 12), roomy ? '1.1em' : '0.98em');
    return;
  }
  line(clip(subject, maxW), '0.34em');
}

function clip(s, maxW, size = 13) {
  if (textWidth(s, size) <= maxW) return s;
  while (s.length > 1 && textWidth(`${s}…`, size) > maxW) s = s.slice(0, -1).trimEnd();
  return `${s}…`;
}

let measure = null;
function textWidth(text, size = 13) {
  measure ??= document.createElement('canvas').getContext('2d');
  measure.font = `${size}px ${getComputedStyle(document.documentElement).getPropertyValue('--serif')}`;
  return measure.measureText(text).width;
}

/** A CSS cubic-bezier(x1, y1, x2, y2) as an easing function of time. */
function cubicBezier(x1, y1, x2, y2) {
  const B = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t) => {
    if (t <= 0) return 0; if (t >= 1) return 1;
    let lo = 0, hi = 1, s = t;
    for (let i = 0; i < 20; i++) { if (B(x1, x2, s) < t) lo = s; else hi = s; s = (lo + hi) / 2; }
    return B(y1, y2, s);
  };
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
