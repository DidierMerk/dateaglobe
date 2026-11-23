// The question and answer screens on phones and upright tablets: a stage with fixed places.
//
// The question sits on top, the globe in the middle at one size per screen, then "What to look for",
// Yes / No and a quiet row (Not sure, Back) under the thumb, and the timeline strip at the bottom edge.
// - The globe's size is set once per screen, so a four-line question fits above it (99% of the questions),
//   and it is at most two thirds of the column wide. A shorter question doesn't make it bigger: it only
//   re-centres in the extra room.
// - "What to look for" unfolds its hint between the toggle and Yes. The strip sinks away (body.quiz-hint)
//   and Yes / No and the quiet row slide down into its room; the question and the globe stay where they are.
// - The answer: on a phone the globe glides into a medallion beside the years and the story takes the middle;
//   Next and Back sit at the foot of the column.
// - An upright tablet (vp-page) is a page of its own: one column of up to 680 px, and the globe takes all the room
//   between a two-line question and the toggle. The hint opens the same way, but the timeline stays: the buttons
//   slide into the free room at its top, and a full timeline steps its rows down meanwhile (onHeadroom). The answer
//   puts the years in the question's place and the story under the globe as its caption, Next right under it;
//   the globe steps back a little to give the story its room.
//
// app.js renders each screen's pieces (data-piece, and data-id where the content belongs to one clue) and calls
// show(). The pieces that stay (same piece, same content) glide from where they were to their new place; the
// old screen's other pieces fade up and out where they were; the new ones rise in. All of it, and the lens, is
// drawn on one clock. Heights are read once per screen (show, a resize), never during a move. The globe draws
// itself in .globe-wrap (globe.js), which this module places, and is told the box directly (setLensBox).
//
// Wide layouts and phones on their side keep their columns: show() does nothing there.

import { layout, isCompact, isPage, onLayout } from './viewport.js';
import { markBusy } from './quiet.js';
import { CURVE, bezier } from './lang-layout.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const LIFT = bezier(0.45, 0, 0.2, 1); // the desk globe lifting off: a soft start
const band = (v, a, b) => (b <= a ? (v >= b ? 1 : 0) : Math.min(1, Math.max(0, (v - a) / (b - a))));
const mix = (a, b, t) => a + (b - a) * t;
const RISE = 6; // px: words rise as they arrive and lift as they leave

// Each move's timing (ms from the tap). out: what leaves; in: what arrives (per piece); glide: what stays, and the lens.
const MOVES = {
  enter: { ms: 360, out: [0, 150], in: { _: [0, 300] }, glide: [0, 1] },
  answer: { ms: 560, out: [0, 150], in: { _: [180, 420], story: [240, 480], acts: [300, 540] }, glide: [0, 440] },
  next: { ms: 600, out: [0, 150], outBy: { acts: [0, 120] }, in: { _: [220, 460], look: [250, 490], yesno: [280, 520], row: [320, 560] }, glide: [0, 440] },
  back: { ms: 560, out: [0, 150], outBy: { acts: [0, 120] }, in: { _: [220, 460], look: [240, 480], yesno: [260, 500], row: [300, 540] }, glide: [0, 440] },
  same: { ms: 480, out: [0, 150], in: { _: [220, 460] }, glide: [0, 440] },
  hintOpen: { ms: 420, out: [0, 160], in: { _: [150, 390] }, glide: [0, 400] },
  hintClose: { ms: 440, out: [0, 140], in: { _: [0, 160] }, glide: [60, 440] },
  start: { ms: 900, out: [0, 220], in: { _: [500, 740], look: [540, 780], yesno: [580, 820], row: [620, 860] }, glide: [0, 800], ease: LIFT },
};
const REDUCED_MOVE = { ms: 180, out: [0, 180], in: { _: [0, 180] }, glide: [0, 1] };

/**
 * Where the answer screen's medallion sits on a phone, in the layout's own pixels: the column's left edge x0,
 * the head's top qY and the lens's diameter med (its box is med + 16, 8 px around the lens). The result's
 * header (app.js) takes the same place, so stepping from the last answer into the result moves nothing.
 */
export function medallionSlot(width, vh) {
  const W = Math.min(600, width - 40);
  return { x0: (width - W) / 2, qY: vh >= 800 ? 14 : vh >= 640 ? 12 : 10, med: vh >= 800 ? 128 : vh >= 640 ? 104 : 84 };
}

export function createQuizLayout({ layoutEl, wrap, panel, globe, timelineEl, onHeadroom = () => {} }) {
  let on = false;
  let pieces = new Map();   // key -> { el, piece, id }
  let pose = null;          // where everything goes: { at: Map(key -> { x, y, o }), lens: { cx, cy, d } }
  let drawn = new Map();    // key -> { x, y, o }: where each piece was last drawn
  let lens = null;          // { cx, cy, d }: the lens as last drawn (d: the lens's diameter; the box is d + 16)
  let ghosts = [];          // { el, x, y, o, w }: the old screen's pieces fading where they were
  let ghostLayer = null;
  let move = null;          // { t0, W, from: Map, lens0 }
  let raf = 0;
  let screen = null, clue = null, hint = false, tall = false; // tall: the answer's story needs the strip's room
  let size = null;
  let observer = null;
  let medTimer = 0;
  let headroom = 0;         // px an open hint's buttons take from the top of the timeline (tablets)

  const active = () => on;
  const keyOf = (el) => `${el.dataset.piece}|${el.dataset.id ?? el.textContent.replace(/\s+/g, ' ').trim()}`;

  function attach() {
    if (on) return;
    on = true;
    document.body.classList.add('quiz-stage');
    observer = new ResizeObserver(() => { if (!on || move) return; measure(); place(); });
    observer.observe(layoutEl);
  }

  function detach() {
    if (!on) return;
    on = false;
    cancelAnimationFrame(raf); raf = 0; move = null;
    clearTimeout(medTimer);
    observer?.disconnect(); observer = null;
    for (const g of ghosts) g.el.remove();
    ghosts = []; ghostLayer?.remove(); ghostLayer = null;
    for (const { el } of pieces.values()) el.removeAttribute('style');
    pieces = new Map(); drawn = new Map(); pose = null; lens = null; screen = null; clue = null; hint = false; tall = false;
    for (const p of ['left', 'top', 'width', 'height']) wrap.style.removeProperty(p);
    globe.setLensBox(null);
    globe.setLabelsShown(true);
    document.body.classList.remove('quiz-stage', 'quiz-hint', 'quiz-medallion', 'quiz-tall');
    if (headroom) { headroom = 0; onHeadroom(0); }
  }

  /** The fixed sizes of this screen (the same for every question), read from a probe of the pieces. */
  function measure() {
    const r = layoutEl.getBoundingClientRect();
    const width = layoutEl.clientWidth, H = layoutEl.clientHeight;
    const page = isPage();
    const W = page ? Math.min(680, width - 2 * Math.max(48, Math.round(width * 0.085))) : Math.min(600, width - 40), x0 = (width - W) / 2;
    const tablet = W >= 560, vh = innerHeight;
    const probe = document.createElement('div');
    probe.className = 'quiz-probe step q';
    probe.setAttribute('aria-hidden', 'true');
    probe.style.width = `${W}px`;
    probe.innerHTML = `<div class="qs-head" data-piece="p"><p class="q-context">X</p><h2 class="q-title">X</h2></div>
      <div class="look qs-look" data-piece="p"><button class="look-toggle" tabindex="-1"><span class="look-icon"></span>What to look for</button></div>
      <div class="yesno" data-piece="p"><button class="yn yes" tabindex="-1">Yes</button><button class="yn no" tabindex="-1">No</button></div>
      <div class="q-more" data-piece="p"><button class="btn-quiet" tabindex="-1">Not sure</button></div>
      <div class="actions" data-piece="p"><button class="btn" tabindex="-1">Next</button><button class="btn-quiet" tabindex="-1">Back</button></div>`;
    panel.appendChild(probe);
    const [head, look, yesno, row, acts] = probe.children;
    const title = head.querySelector('.q-title');
    const lineH = parseFloat(getComputedStyle(title).lineHeight) || title.offsetHeight;
    const ctxH = head.offsetHeight - title.offsetHeight;
    const S = { lookH: look.offsetHeight, ynH: yesno.offsetHeight, rowH: row.offsetHeight, actsH: acts.offsetHeight };
    probe.remove();
    // The strip: where it is at rest (its slide while arriving or stepping aside is a transform, taken out here)
    const tr = timelineEl.getBoundingClientRect();
    const ty = new DOMMatrixReadOnly(getComputedStyle(timelineEl).transform).m42 || 0;
    const compact = isCompact();
    const stripTop = tr.top - ty - r.top, stripBottom = tr.bottom - ty - r.top;
    const zoneB = Math.min(H, stripTop) - (compact ? 12 : 18); // the quiet row ends here
    const air = tablet ? 24 : medallionSlot(width, vh).qY;
    const gap = page ? 32 : tablet ? 28 : vh >= 800 ? 18 : vh >= 640 ? 14 : 12;
    const med = medallionSlot(width, vh).med;
    const rowY = zoneB - S.rowH, ynY = rowY - 4 - S.ynH, lookY = ynY - 8 - S.lookH, qY = air;
    const R4 = ctxH + 4 * lineH; // room for a four-line question
    const R2 = ctxH + 2 * lineH; // a tablet's globe is sized for a two-line question (97% of them at this width)
    const dFix = page ? Math.floor(Math.max(120, Math.min(W, lookY - (qY + R2) - 2 * gap)))
      : Math.floor(Math.max(60, Math.min(W, Math.round(W * 0.66), (lookY - gap) - (qY + R4 + gap))));
    const slotBottom = compact ? H - 8 : stripBottom;
    // A tablet's hint: the buttons slide into the top of the timeline, as far as its rows can step down
    const headMax = Math.max(0, (stripBottom - stripTop) - 132);
    size = { origin: { left: r.left, top: r.top }, width, H, W, x0, tablet, page, gap, med, rowY, ynY, lookY, qY, zoneB, dFix, R2, headMax, slotMax: page ? headMax : Math.max(0, slotBottom - zoneB), ...S };
    // Widths, so the heights below are the ones that will be drawn
    for (const { el, piece } of pieces.values()) {
      el.style.width = `${piece === 'ahead' && screen === 'a' && !tablet ? W - med - 16 : W}px`;
      if (piece === 'row') el.style.width = '';
    }
  }

  /** Where everything goes on this screen. */
  function compute() {
    const S = size, at = new Map();
    const get = (piece) => [...pieces.entries()].find(([, p]) => p.piece === piece);
    const put = (piece, x, y, o = 1) => { const e = get(piece); if (e) at.set(e[0], { x, y, o }); };
    let L;
    if (screen === 'q') {
      const head = get('head')?.[1].el, hintEl = get('hint')?.[1].el, hasLook = !!get('look');
      let down = 0, over = 0;
      headroom = 0;
      if (hint && hintEl) { const need = hintEl.offsetHeight + 6; down = Math.min(need, S.slotMax); over = need - down; }
      const look = hasLook ? S.lookY - over : S.ynY + 8 + S.lookH; // no toggle: the globe takes its line
      put('head', S.x0, S.qY);
      put('look', S.x0, look);
      put('hint', S.x0, look + S.lookH + 6, hint ? 1 : 0);
      put('yesno', S.x0, S.ynY + down);
      put('row', S.x0, S.rowY + down);
      const top = S.qY + (head?.offsetHeight ?? 0) + S.gap, bottom = (hasLook ? look : S.ynY) - S.gap;
      if (S.page) {
        // One place for every question: centred in the room under a two-line question (a third line only tightens the gaps)
        const hh = head?.offsetHeight ?? 0, foot = hasLook ? look : S.ynY, extra = Math.max(0, hh - S.R2);
        L = { cx: S.width / 2, cy: (S.qY + S.R2 + foot + extra) / 2, d: Math.max(48, Math.min(S.dFix, foot - (S.qY + hh) - 28)) };
        headroom = down;
      } else L = { cx: S.width / 2, cy: (top + bottom) / 2, d: Math.max(48, Math.min(S.dFix, bottom - top)) };
    } else {
      const ahead = get('ahead')?.[1].el, story = get('story')?.[1].el;
      const actY = S.zoneB - S.actsH;
      const ah = ahead?.offsetHeight ?? 0;
      headroom = 0;
      if (S.page) {
        // The years in the question's place, the globe, then the story as its caption and Next right under it.
        // The globe has one size and place for every answer: what a story of the tallest usual height leaves
        const aTop = S.qY + ah + S.gap;
        const dA = Math.floor(Math.max(48, Math.min(S.dFix, actY - 18 - 190 - S.gap - aTop)));
        const sy = aTop + dA + S.gap;
        if (story) story.style.maxHeight = `${Math.max(60, actY - 18 - sy)}px`;
        const sh = story?.offsetHeight ?? 0;
        put('ahead', S.x0, S.qY); put('story', S.x0, sy); put('acts', S.x0, Math.min(actY, sy + sh + 18));
        L = { cx: S.width / 2, cy: aTop + dA / 2, d: dA };
      } else if (S.tablet) {
        // The answer above the globe, which keeps its size
        const sy = S.qY + ah + 14;
        if (story) story.style.maxHeight = `${Math.max(60, actY - S.gap - 120 - sy)}px`;
        const sh = story?.offsetHeight ?? 0;
        put('ahead', S.x0, S.qY); put('story', S.x0, sy); put('acts', S.x0, actY);
        const top = sy + sh + S.gap, bottom = actY - S.gap;
        L = { cx: S.width / 2, cy: (top + bottom) / 2, d: Math.max(48, Math.min(S.dFix, bottom - top)) };
      } else {
        // The globe as a medallion beside the years; the whole story under them, Next and Back right under it.
        // A story taller than the room above the strip (only on the smallest phones) takes the strip's room too:
        // the strip sinks away, as it does for the hint. Only past that does the story scroll.
        const m = S.med, rowH = Math.max(m, ah), sy = S.qY + rowH + 16;
        let foot = actY;
        if (story) {
          story.style.maxHeight = 'none';
          const need = story.scrollHeight, room = actY - 18 - sy;
          tall = need > room;
          if (tall) foot = actY + Math.min(need - room, S.slotMax);
          story.style.maxHeight = `${Math.max(40, foot - 18 - sy)}px`;
        }
        const sh = story?.offsetHeight ?? 0;
        put('ahead', S.x0 + m + 16, S.qY + Math.max(0, (m - ah) / 2));
        put('story', S.x0, sy); put('acts', S.x0, Math.min(foot, sy + sh + 18));
        L = { cx: S.x0 + m / 2, cy: S.qY + m / 2, d: m };
      }
    }
    return { at, lens: L };
  }

  /**
   * The screen in the panel is new (app.js has just rendered it). fromDesk: the size step's desk globe, as a
   * lens box in viewport pixels, for the first question (the globe lifts off the desk into the lens).
   */
  function show({ fromDesk = null } = {}) {
    if (layout().kind !== 'stacked' || document.body.classList.contains('mode-result')) { detach(); return; }
    const step = panel.querySelector('.step');
    if (!step?.matches('.qs, .as')) { detach(); return; }
    const was = on ? { pieces, drawn, lens, screen, clue } : null;
    attach();
    // The old screen's pieces: those that stay (same piece, same content) hand their place to the new element
    pieces = new Map();
    for (const el of step.querySelectorAll('[data-piece]')) pieces.set(keyOf(el), { el, piece: el.dataset.piece, id: el.dataset.id });
    screen = step.matches('.as') ? 'a' : 'q';
    clue = step.dataset.clue;
    hint = false; tall = false;
    document.body.classList.remove('quiz-hint');
    measure();
    pose = compute();
    document.body.classList.toggle('quiz-tall', tall);
    onHeadroom(headroom);
    const kind = REDUCED ? 'reduced' : fromDesk ? 'start' : !was ? 'enter'
      : was.screen === 'q' && screen === 'a' ? 'answer'
      : was.screen === 'a' && screen === 'q' ? (was.clue === clue ? 'back' : 'next') : 'same';
    const from = new Map();
    if (was) {
      for (const [k, p] of was.pieces) {
        const d = was.drawn.get(k);
        if (!d) continue;
        if (pieces.has(k) && d.o > 0.5) from.set(k, d);
        else if (d.o > 0.01) ghost(p, d);
      }
    }
    let lens0 = was?.lens ?? null;
    if (fromDesk) lens0 = { cx: fromDesk.left + fromDesk.width / 2 - size.origin.left, cy: fromDesk.top + fromDesk.height / 2 - size.origin.top, d: fromDesk.width - 16 };
    // The medallion: its labels step aside and the loupe fades; growing back, the loupe returns once the lens is nearly home
    const medallion = screen === 'a' && !size.tablet;
    clearTimeout(medTimer);
    globe.setLabelsShown(!medallion);
    if (medallion) document.body.classList.add('quiz-medallion');
    // On to the next clue the camera hops (app.js, 1100 ms): the loupe waits until it has landed, as it does on a first close-up
    else if (document.body.classList.contains('quiz-medallion')) medTimer = setTimeout(() => document.body.classList.remove('quiz-medallion'), REDUCED ? 0 : kind === 'next' ? 1000 : 380);
    begin(kind, from, lens0);
  }

  /** "What to look for" opened or closed: the hint unfolds and the buttons slide down into the strip's room. */
  function setHint(open) {
    if (!on || screen !== 'q' || open === hint) return;
    hint = open;
    document.body.classList.toggle('quiz-hint', open && !size.page); // a tablet's timeline stays in view
    pose = compute();
    onHeadroom(headroom);
    begin(REDUCED ? 'reduced' : open ? 'hintOpen' : 'hintClose', new Map([...drawn].filter(([, d]) => d.o > 0.5)), lens);
  }

  /** A copy of a piece that is leaving keeps fading where it was (the element itself, out of the new screen's way). */
  function ghost(p, d) {
    if (!ghostLayer || !ghostLayer.isConnected) { ghostLayer = document.createElement('div'); ghostLayer.className = 'quiz-ghosts'; ghostLayer.setAttribute('aria-hidden', 'true'); }
    panel.appendChild(ghostLayer);
    const el = p.el;
    el.removeAttribute('id'); el.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    el.querySelectorAll('button, a').forEach((n) => n.setAttribute('tabindex', '-1'));
    el.style.pointerEvents = 'none';
    ghostLayer.appendChild(el);
    ghosts.push({ el, piece: p.piece, ...d });
  }

  function begin(kind, from, lens0) {
    const W = kind === 'reduced' ? REDUCED_MOVE : MOVES[kind];
    // Ghosts of an interrupted move carry on fading from where they are now
    for (const g of ghosts) if (g.now) Object.assign(g, g.now);
    // The clock starts on the frame after the first: a new screen's first frame can be slow (its picture is drawn
    // for the first time), and a move timed from the tap would lose its opening to it
    move = { t0: null, W, from, lens0: lens0 ?? pose.lens, ghosts: ghosts.slice() };
    markBusy(W.ms + 100);
    draw(performance.now());
    if (!raf) raf = requestAnimationFrame(frame);
  }

  function frame(now) {
    raf = 0;
    if (!on || !move) return;
    // The new screen is rendered in the frame after the tap (the first callback here runs just before it): the
    // clock starts on the frame after that one
    if (move.t0 == null && (move.waited = (move.waited ?? 0) + 1) >= 2) move.t0 = now - 8;
    draw(now);
    if (move) raf = requestAnimationFrame(frame);
  }

  /** Everything where it is at this moment of the move (or at rest). */
  function draw(now) {
    const S = size;
    const t = move ? (move.t0 == null ? 0 : now - move.t0) : Infinity;
    const W = move?.W;
    const inWin = (piece) => W.in[piece] ?? W.in._;
    const outWin = (piece) => W.outBy?.[piece] ?? W.out;
    const glide = W ? (W.ease ?? CURVE)(band(t, ...W.glide)) : 1;
    for (const [k, p] of pieces) {
      const to = pose.at.get(k);
      if (!to) { set(p.el, 0, 0, 0); drawn.set(k, { x: 0, y: 0, o: 0 }); continue; }
      const f = move?.from.get(k);
      let x = to.x, y = to.y, o = to.o;
      if (move && f && to.o > 0.5) { x = mix(f.x, to.x, glide); y = mix(f.y, to.y, glide); }
      else if (move && to.o > 0.5) { const e = band(t, ...inWin(p.piece)); o = e; y = to.y + RISE * (1 - CURVE(e)); }
      else if (move && f && to.o < 0.5) { const e = band(t, ...outWin(p.piece)); o = 1 - e; x = f.x; y = f.y - RISE * CURVE(e); }
      set(p.el, o, x, y);
      drawn.set(k, { x, y, o, final: to });
    }
    for (const g of ghosts) {
      const e = move ? band(t, ...outWin(g.piece)) : 1;
      g.now = { o: g.o * (1 - e), y: g.y - RISE * CURVE(e) };
      set(g.el, g.now.o, g.x, g.now.y);
    }
    const a = move?.lens0 ?? pose.lens, b = pose.lens;
    lens = { cx: mix(a.cx, b.cx, glide), cy: mix(a.cy, b.cy, glide), d: mix(a.d, b.d, glide) };
    const box = lens.d + 16;
    wrap.style.left = `${lens.cx - box / 2}px`; wrap.style.top = `${lens.cy - box / 2}px`;
    wrap.style.width = wrap.style.height = `${box}px`;
    globe.setLensBox({ left: S.origin.left + lens.cx - box / 2, top: S.origin.top + lens.cy - box / 2, width: box, height: box });
    if (move && t >= W.ms) {
      for (const g of move.ghosts) { g.el.remove(); ghosts = ghosts.filter((x) => x !== g); }
      move = null;
      draw(now);
    }
  }

  function set(el, o, x, y) {
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.style.opacity = o;
    el.style.visibility = o < 0.01 ? 'hidden' : '';
    el.style.pointerEvents = o > 0.9 ? '' : 'none';
  }

  /** At rest, after a resize: everything at its place at once. */
  function place() { if (!on) return; pose = compute(); document.body.classList.toggle('quiz-tall', tall); onHeadroom(headroom); draw(performance.now()); }

  // Turning the device can switch layouts: app.js renders the screen again, which calls show()
  onLayout(() => { if (layout().kind !== 'stacked') detach(); });

  return { show, setHint, detach, active };
}
