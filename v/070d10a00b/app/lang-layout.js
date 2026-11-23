// The language step on phones and upright tablets: "What does your map call this country?" and,
// once one language is left, "Your map is in Dutch".
//
// At rest it is one column, set a little above the middle of the screen: the gold category line
// and the question, the lens on the country, then the answer box. When the keyboard comes up the
// same pieces fold into the space above it: the lens shrinks beside the question and the answer
// box sits on the keyboard.
//
// The moves (setup.js starts them; each is a function of one clock, drawn once per frame):
// - Arriving to type (attach with arrive): from the landing page, "Not Dutch?" or Back. The field was
//   focused in the tap, so the keyboard is rising; the answer box rides up with it on a slightly slower
//   curve (it never leads the real keyboard, so it seems to come up from behind its edge) and the
//   question fades in beside the lens. Where no keyboard comes up (a tablet with a hardware keyboard),
//   the field lets go after a second and the screen folds open to its resting layout.
// - The next country (swapTitle): the question fades up and out, the new one rises in as the globe
//   arrives. Nothing else moves; the keyboard stays up.
// - Feedback ("We don't recognise that", feedbackChanged): when the lines under the box need more room
//   than the keyboard leaves, the box and the row above lift by the difference, the lens shrinking.
// Skip sits just under the question in both states, travelling with it.
// - The verdict (confirm): the question, box and Skip fade where they are (frozen at the tap, so the
//   keyboard closing cannot pull them around), and the lens takes one straight path, starting softly,
//   up into the question's place; "Your map is in Dutch" settles under it, then Continue / "Not Dutch?".
//
// Smoothness, as far as a web page can follow a keyboard it cannot see:
// - The fold starts the moment the field takes focus and runs on a curve close to the iOS keyboard's.
// - It aims straight at the keyboard's real height when known: each device's keyboard is remembered
//   (per screen size), and the first time a typical height is used. When the browser reports the
//   real height, the target glides there; the fold is never restarted.
// - Nothing is measured while anything moves: heights are read once (attach, a new title, a resize),
//   including the question's height beside the lens for every lens size it can take.
// - The resting height is never re-read while a keyboard may still be on screen or a move is running
//   (a keyboard going down reports late), and a smaller window must stay smaller for a moment first.
//
// The question is shown twice (under the bar at rest, beside the lens while typing). The two copies
// travel one path and cross-fade, so its line breaks never jump. The globe draws itself wherever
// .globe-wrap is (globe.js), so moving that box moves the lens.
//
// An upright tablet (vp-page) has the room to stay one column in both states (drawPage): the question, a large
// lens and the answer box. The lens is sized once, so the column fits above the keyboard; the keyboard only slides
// the column (centred above it, or a little above the middle of the page without one), and the verdict keeps the
// lens's size and changes the words around it.
//
// Wide layouts keep their two columns: there attach() does nothing.

import { layout, isPage, onLayout } from './viewport.js';
import { markBusy } from './quiet.js';

/** A CSS cubic-bezier as a function of time. */
export function bezier(x1, y1, x2, y2) {
  const at = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  return (t) => {
    let lo = 0, hi = 1, s = t;
    for (let i = 0; i < 22; i++) { if (at(x1, x2, s) < t) lo = s; else hi = s; s = (lo + hi) / 2; }
    return at(y1, y2, s);
  };
}
// Close to the iOS keyboard: a quick start that settles softly, a little under half a second
export const CURVE = bezier(0.2, 0.8, 0.2, 1);
// A soft start: the verdict's lens grows into room the question has just left, not over it
const SOFT = bezier(0.45, 0, 0.2, 1);
const OPEN_MS = 440;
const CLOSE_MS = 380;
const CONFIRM_MS = 1000; // from the answer to the settled verdict (style.css times the seal to match)
const RIDE_MS = 520;     // arriving: the box rides up a touch slower than the keyboard
const ARRIVE_MS = 700;
const FB_MS = 300;       // the room for feedback opening or closing
const KB_CHECK_MS = 1000; // arriving to type: no keyboard this long after the tap means the resting layout instead
const GLIDE_MS = 110;   // time constant for the target easing to the keyboard's reported height
const GAP_ABOVE = (h) => (h < 560 ? 20 : 30); // between the question (or verdict) and the lens, and the lens and the box
const UNDER = 44;       // room kept under the box while typing: the live line
const SKIP = 28;        // Skip's line under the question (its 44 px target reaches into the gap below)
const SKIP_LIFT = 8;    // Skip's box starts this far above the question's foot (its padding), so its word sits close under it
const SKIP_UNDER = 16;  // an upright tablet: Skip under the box as on the laptop, its word 60 px under the box's foot (UNDER + 16)
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const band = (v, a, b) => Math.min(1, Math.max(0, (v - a) / (b - a)));
const mix = (a, b, t) => a + (b - a) * t;
const root = document.documentElement;

// The keyboard's height on this device, remembered per screen size (a convenience: absent is fine)
const kbKey = () => `dag-kb:${Math.round(innerWidth)}x${Math.round(innerHeight)}`;
const recallKeyboard = () => { try { return Number(localStorage.getItem(kbKey())) || 0; } catch { return 0; } };
const rememberKeyboard = (h) => { try { localStorage.setItem(kbKey(), String(Math.round(h))); } catch { /* private mode */ } };

/** onLens(box): the lens's box in viewport pixels as placed each frame (or null), so the globe need not read it back. */
export function createLangLayout({ layoutEl, wrap, panel, onLens = () => {} }) {
  // The pieces: the question (headR, its copy headK), the answer box (form, below), Skip, and the
  // verdict (vtop: the gold line, vbody, vact). The question's pieces are null when a verdict was mounted on its own.
  let els = null;
  let observer = null;
  let raf = 0, last = 0;
  let restH = 0;        // the column's height without a keyboard
  let safeBottom = 0;   // the home-bar padding, which the keyboard covers
  let keyboard = 0;     // the keyboard's height (accessory bar included)
  let hk = 0, hkTarget = 0; // the column's height above the keyboard: shown, and where it is going
  let k = 0;            // 0 at rest, 1 with the keyboard up
  let fold = null;      // { from, to, t0, ms }
  let c = 0;            // 0 asking, 1 the verdict
  let verdict = null;   // { t0, ms } while the verdict is arriving
  let frozen = null;    // the question as it was when the verdict started: { k, hk, fb, lens }
  let arrive = null;    // { t0, q: [from, to] }: arriving to type
  let swap = null;      // { t0 }: the next country's title
  let fbRoom = 0, fbTween = null; // the height under the box (live line and feedback), and its glide
  let lens = null;      // the lens as last drawn
  let size = null;      // measurements, read outside the motion
  let origin = { left: 0, top: 0 }; // the column's place in the window, read outside the motion
  let intent = false;   // arriving to type: laid out for the keyboard before the field has focus
  let timers = [];
  let restCheck = 0;
  const besideH = new Map(); // the side copy's height per width (4 px steps), measured once per title
  let askH = 104;       // the question's height, kept so a verdict mounted on its own gets the same lens (tablets)

  const typing = () => !!els?.input && root.classList.contains('vp-touch') && (intent || document.activeElement === els.input);
  const keyboardShown = () => root.classList.contains('vp-kb') || layoutEl.clientHeight < restH - 80;
  const onBlur = () => { intent = false; setTimeout(update, 0); };
  // Focus from script on tap, without letting Safari scroll the page to show the field
  const onTouchEnd = (e) => {
    if (!els?.input || c > 0 || document.activeElement === els.input || e.target.closest('button')) return;
    e.preventDefault();
    els.input.focus({ preventScroll: true });
  };

  /**
   * intent: laid out for typing from the first frame (the field was focused in the tap).
   * arrive: { question: [from, to] ms }: the box rides up with the keyboard and the question fades in then.
   */
  function attach({ intent: arriving = false, arrive: arr = null } = {}) {
    detach();
    if (layout().kind !== 'stacked') return;
    const step = panel.querySelector('.step');
    const headR = step?.querySelector('.ask-head');
    const vtop = step?.querySelector('.vtop');
    if (!headR && !vtop) return;
    document.body.classList.add('lang-stage');
    els = { step, headR, vtop, vbody: step.querySelector('.vbody'), vact: step.querySelector('.verdict-actions') };
    if (headR) {
      // The copy beside the lens: the gold line and the question, without the step dashes
      const headK = headR.cloneNode(true);
      headK.classList.add('is-beside');
      headK.setAttribute('aria-hidden', 'true');
      headK.querySelector('.progress')?.remove();
      step.appendChild(headK);
      Object.assign(els, { headK, form: step.querySelector('.typein'), below: step.querySelector('.ask-below'), input: step.querySelector('#typed'), skip: step.querySelector('.actions:not(.verdict-actions)') });
      els.input.addEventListener('focus', update);
      els.input.addEventListener('blur', onBlur);
      els.form.addEventListener('touchend', onTouchEnd, { passive: false });
    }
    observer = new ResizeObserver(update);
    observer.observe(layoutEl);
    restH = layoutEl.clientHeight;
    intent = !!(arriving && els.input && root.classList.contains('vp-touch'));
    if (intent) {
      // No keyboard came up: let go of the field; the screen folds open to rest
      timers.push(setTimeout(() => {
        if (!els || !intent) return;
        intent = false;
        if (!keyboardShown()) els.input.blur();
        update();
      }, KB_CHECK_MS));
    }
    safeBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    keyboard = recallKeyboard();
    k = typing() ? 1 : 0;
    c = headR ? 0 : 1;
    measure();
    fbRoom = els.below ? els.below.offsetHeight : 0;
    hk = hkTarget = aimHeight();
    if (arr && intent && !REDUCED) {
      arrive = { t0: performance.now(), q: arr.question ?? [300, 600] };
      step.classList.add('is-arriving'); // the step's own rise animation steps aside: this move draws it
    }
    draw();
    if (arrive) run();
  }

  function detach() {
    cancelAnimationFrame(raf); raf = 0; fold = null; verdict = null; intent = false;
    frozen = null; arrive = null; swap = null; fbTween = null; lens = null;
    timers.forEach(clearTimeout); timers = [];
    clearTimeout(restCheck);
    observer?.disconnect(); observer = null;
    if (els) {
      if (els.input) {
        els.input.removeEventListener('focus', update);
        els.input.removeEventListener('blur', onBlur);
        els.form.removeEventListener('touchend', onTouchEnd);
      }
      els.headK?.remove();
      for (const el of [els.headR, els.form, els.below, els.skip, els.vtop, els.vbody, els.vact]) el?.removeAttribute('style');
      els = null;
    }
    for (const p of ['left', 'top', 'width', 'height', 'opacity']) wrap.style.removeProperty(p);
    onLens(null);
    document.body.classList.remove('lang-stage', 'setup-typing');
  }

  /** Widths and heights, read once (and after a resize, a new title or the verdict), never during the motion. */
  function measure() {
    const { headR, headK, form, below, vtop, vbody, vact } = els;
    const width = layoutEl.clientWidth;
    const W = Math.min(width - 40, 540), x0 = (width - W) / 2;
    const o = layoutEl.getBoundingClientRect(); origin = { left: o.left, top: o.top };
    for (const el of [headR, form, below, vtop, vbody, vact]) if (el) el.style.width = `${W}px`;
    for (const el of [form, below]) if (el) el.style.left = `${x0}px`;
    if (headR) askH = Math.max(askH, headR.offsetHeight); // the tallest question so far: the lens never resizes between countries
    size = {
      width, W, x0, page: isPage(),
      hR: headR ? headR.offsetHeight : 0,
      FIELD: form ? form.offsetHeight : 56,
      hG: vtop ? vtop.offsetHeight : 0,
      hV: vbody ? vbody.offsetHeight : 0,
      hA: vact ? vact.offsetHeight : 0,
    };
    // The question beside the lens, at every width the lens (72 to 150 px) can leave it
    besideH.clear();
    if (headK) {
      for (let w = Math.floor((W - 150 - 18) / 4) * 4; w <= W - 72 - 18 + 4; w += 4) {
        headK.style.width = `${w}px`; besideH.set(w, headK.offsetHeight);
      }
    }
  }
  function heightBeside(w) {
    const key = Math.round(w / 4) * 4;
    if (!besideH.has(key)) { els.headK.style.width = `${key}px`; besideH.set(key, els.headK.offsetHeight); }
    return besideH.get(key);
  }

  /** Where the column above the keyboard ends: the reported height, or the best guess before it reports. */
  function aimHeight() {
    const H = layoutEl.clientHeight;
    const reported = root.classList.contains('vp-kb') || H < restH - 80;
    if (typing() && reported) {
      keyboard = restH + safeBottom - H;
      rememberKeyboard(keyboard);
      return H;
    }
    // Not reported (yet): the remembered keyboard, else a typical one (about 45% of a phone's height)
    return restH + safeBottom - (keyboard || Math.round(innerHeight * (size?.page ? 0.3 : 0.455)));
  }

  /** The keyboard came or went, or the window changed. */
  function update() {
    if (!els) return;
    const H = layoutEl.clientHeight;
    // The resting height: only while no keyboard can be on screen and nothing moves. A larger window
    // or a new width is taken at once; a smaller one must stay smaller a moment (a keyboard going down reports late)
    if (!typing() && !root.classList.contains('vp-kb') && !fold && !verdict) {
      if (layoutEl.clientWidth !== size.width || H > restH + 1) { restH = H; measure(); }
      else if (H < restH - 1) {
        clearTimeout(restCheck);
        restCheck = setTimeout(() => {
          const now = layoutEl.clientHeight;
          if (els && !typing() && !root.classList.contains('vp-kb') && !fold && !verdict && now < restH - 1) { restH = now; measure(); draw(); }
        }, 400);
      }
      safeBottom = parseFloat(getComputedStyle(document.body).paddingBottom) || 0;
    }
    hkTarget = aimHeight();
    const o = layoutEl.getBoundingClientRect(); origin = { left: o.left, top: o.top };
    const to = typing() ? 1 : 0;
    if (REDUCED) { k = to; hk = hkTarget; fold = null; draw(); return; }
    if (to !== (fold ? fold.to : k)) fold = { from: k, to, t0: performance.now(), ms: (to ? OPEN_MS : CLOSE_MS) * Math.max(0.4, Math.abs(to - k)) };
    run();
  }

  function run() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } }

  function frame(now) {
    raf = 0;
    if (!els) return;
    const dt = Math.min(64, now - last); last = now;
    if (fold) {
      const p = Math.min(1, (now - fold.t0) / fold.ms);
      k = mix(fold.from, fold.to, CURVE(p));
      if (p >= 1) fold = null;
    }
    if (verdict) {
      c = Math.min(1, (now - verdict.t0) / verdict.ms);
      if (c >= 1) verdict = null;
    }
    if (fbTween) {
      const p = Math.min(1, (now - fbTween.t0) / FB_MS);
      fbRoom = mix(fbTween.from, fbTween.to, CURVE(p));
      if (p >= 1) fbTween = null;
    }
    if (arrive && now - arrive.t0 >= ARRIVE_MS) arrive = null;
    if (swap && now - swap.t0 >= 540) swap = null;
    hk += (hkTarget - hk) * (1 - Math.exp(-dt / GLIDE_MS));
    if (Math.abs(hkTarget - hk) < 0.5) hk = hkTarget;
    draw(now);
    if (fold || verdict || fbTween || arrive || swap || hk !== hkTarget) { raf = requestAnimationFrame(frame); markBusy(60); }
  }

  /** Everything at fold k and verdict c, with the keyboard column hk tall. */
  function draw(now = performance.now()) {
    if (size.page) return drawPage(now);
    const { headR, headK, form, below, skip, vtop, vbody, vact } = els;
    const { width, W, x0, hR, FIELD, hG, hV, hA } = size;
    const LIVE = 28;
    // At rest: the question, the lens, the answer box, as one group a little above the middle
    const GAP = GAP_ABOVE(restH);
    const space = restH - 12;
    const SK = skip ? SKIP : 0;
    const d = Math.round(Math.max(120, Math.min(W * 0.68, space - hR - SK - 2 * GAP - FIELD - LIVE - 40)));
    const group = hR + SK + GAP + d + GAP + FIELD + LIVE;
    const top = Math.max(10, (space - group) * 0.3);
    const R = { cx: width / 2, cy: top + hR + SK + GAP + d / 2, d, x: x0, y: top, field: top + hR + SK + GAP + d + GAP };
    let cx = R.cx, cy = R.cy, dd = R.d;
    let row = 1; // how much of the lens row above the box has room to show

    if (headR) {
      // Once the verdict starts, the question stays where it was at the tap while it fades
      const kk = frozen ? frozen.k : k, hkk = frozen ? frozen.hk : hk, under = frozen ? frozen.fb : fbRoom;
      // Keyboard up: the box on the keyboard (room under it for the live line, more for feedback), lens and question side by side above
      const kField = hkk - 4 - UNDER - FIELD - Math.max(0, under + 6 - UNDER);
      const room = kField - 14 - 8;
      const dk = Math.max(72, Math.min(150, room));
      const wK = W - Math.round(dk) - 18;
      const hK = heightBeside(wK);
      const cyK = 8 + Math.max(dk, room) / 2;
      const K = { cx: x0 + dk / 2, cy: cyK, d: dk, x: x0 + dk + 18, y: cyK - (hK + SK) / 2, field: kField }; // the question and Skip, centred on the lens
      // The smallest phones: when feedback leaves no room for the lens and the question above the box,
      // they step aside (fade) until it clears, rather than lie under the box
      row = mix(1, band(room, 24, 72), kk);
      headK.style.width = `${wK}px`;
      // The two copies of the question share one path between their centres
      const dx = K.x - R.x, dy = (K.y + hK / 2) - (R.y + hR / 2);
      cx = mix(R.cx, K.cx, kk); cy = mix(R.cy, K.cy, kk); dd = mix(R.d, K.d, kk);
      // The verdict's first step: the question, the box and Skip fade, drifting a little out of the lens's way
      const ask = 1 - band(c, 0, 0.2), gone = ask < 0.01;
      // Arriving to type: the question fades in beside the lens; the next country: its title swaps
      let qa = 1, qdy = 0, ride = null, skipA = 1;
      if (arrive) {
        const t = now - arrive.t0, q = band(t, arrive.q[0], arrive.q[1]);
        qa = q; skipA = q; qdy = 6 * (1 - CURVE(q)); ride = CURVE(band(t, 0, RIDE_MS));
      }
      if (swap) {
        const t = now - swap.t0;
        if (t < 200) { const o = band(t, 0, 200); qa *= 1 - o; qdy -= 6 * o; }
        else { const q = band(t, 260, 520); qa *= q; qdy += 6 * (1 - CURVE(q)); }
      }
      headR.style.transform = `translate(${R.x + dx * kk}px, ${R.y + dy * kk + qdy - 6 * (1 - ask)}px)`;
      headR.style.opacity = (1 - band(kk, 0, 0.55)) * ask * qa * row;
      headR.style.visibility = kk > 0.99 || gone ? 'hidden' : '';
      headK.style.transform = `translate(${K.x - dx * (1 - kk) + 8 * (1 - ask)}px, ${K.y - dy * (1 - kk) + qdy}px)`;
      headK.style.opacity = band(kk, 0.4, 1) * ask * qa * row;
      headK.style.visibility = kk < 0.01 || gone ? 'hidden' : '';
      let field = mix(R.field, K.field, kk);
      if (ride !== null) field = mix(restH + safeBottom + 8, field, ride); // up from the bottom edge, with the keyboard
      form.style.transform = `translateY(${field}px)`;
      below.style.transform = `translateY(${field + FIELD}px)`;
      for (const el of [form, below]) { el.style.opacity = ask; el.style.visibility = gone ? 'hidden' : ''; }
      if (skip) {
        // under whichever copy of the question shows, on the same path
        const sx = mix(R.x, K.x, kk), sy = mix(R.y + hR, K.y + hK, kk) - SKIP_LIFT + qdy;
        skip.style.transform = `translate(${sx}px, ${sy}px)`;
        const a = (1 - band(c, 0, 0.3)) * skipA * row; skip.style.opacity = a; skip.style.visibility = a < 0.01 ? 'hidden' : '';
      }
    }

    if (vtop) {
      // The verdict: the gold line on top, the lens moved up into the question's place (using the room the
      // question and keyboard leave, up to 80% of the width), "Your map is in Dutch" and the buttons under it
      const dV = Math.round(Math.max(120, Math.min(W * 0.8, 320, space - (hG + 20 + 26 + hV + 24 + hA) - 60)));
      const groupV = hG + 20 + dV + 26 + hV + 24 + hA;
      const topV = Math.max(10, (space - groupV) * 0.38);
      const V = { cy: topV + hG + 20 + dV / 2, verdict: topV + hG + 20 + dV + 26 };
      // One straight path from where the lens was at the tap, starting softly
      const from = frozen ? frozen.lens : { cx, cy, dd };
      const lv = headR ? SOFT(band(c, 0, 0.62)) : 1;
      cx = mix(from.cx, width / 2, lv); cy = mix(from.cy, V.cy, lv); dd = mix(from.dd, dV, lv);
      vtop.style.transform = `translate(${x0}px, ${topV}px)`;
      vtop.style.opacity = band(c, 0.18, 0.45);
      const v = band(c, 0.315, 0.675);
      vbody.style.transform = `translate(${x0}px, ${V.verdict + (1 - CURVE(v)) * 10}px)`;
      vbody.style.opacity = v;
      const bt = band(c, 0.45, 0.81);
      vact.style.transform = `translate(${x0}px, ${V.verdict + hV + 24 + (1 - CURVE(bt)) * 12}px)`;
      vact.style.opacity = bt;
      for (const el of [vtop, vbody, vact]) el.style.visibility = c < 0.01 ? 'hidden' : '';
      vact.style.pointerEvents = c > 0.9 ? '' : 'none';
    }

    if (vtop) row = 1;
    placeLens(cx, cy, dd, row);
  }

  /** The lens: globe.js draws it in .globe-wrap with radius min(w, h) / 2 - 8. */
  function placeLens(cx, cy, dd, row = 1) {
    lens = { cx, cy, dd };
    if (row < 1) wrap.style.opacity = row; else wrap.style.removeProperty('opacity');
    wrap.style.left = `${cx - dd / 2 - 8}px`; wrap.style.top = `${cy - dd / 2 - 8}px`;
    wrap.style.width = wrap.style.height = `${dd + 16}px`;
    onLens({ left: origin.left + cx - dd / 2 - 8, top: origin.top + cy - dd / 2 - 8, width: dd + 16, height: dd + 16 });
    document.body.classList.toggle('setup-typing', (frozen ? frozen.k : k) > 0.5 && c < 0.2);
  }

  /**
   * An upright tablet: one column in both states. The lens has one size (what the column above the keyboard
   * leaves, at most 54% of the width); only the column's top moves, with the keyboard (k) and into the verdict (c).
   * Skip sits under the box, as on the laptop (phones keep it under the question), and moves with the box.
   */
  function drawPage(now) {
    const { headR, headK, form, below, skip, vtop, vbody, vact } = els;
    const { width, x0, hR, FIELD, hG, hV, hA } = size;
    const GAP = 30;
    const kk = frozen ? frozen.k : k, hkk = frozen ? frozen.hk : hk, under = frozen ? frozen.fb : fbRoom;
    const SK = skip ? SKIP_UNDER + SKIP : 0; // under the box
    const d = Math.round(Math.max(120, Math.min(width * 0.54, hkk - (askH + SK + 2 * GAP + FIELD + UNDER) - 48)));
    let cx = width / 2, cy = 0;
    if (headR) {
      // The column is laid out for the tallest question; a shorter one sits on the lens, so the lens holds still
      const block = askH + GAP + d + GAP + FIELD + UNDER + Math.max(0, under + 6 - UNDER) + SK;
      const top = mix(Math.max(10, (restH - block) * 0.42), Math.max(8, (hkk - block) / 2), kk);
      const ask = 1 - band(c, 0, 0.18), gone = ask < 0.01;
      let qa = 1, qdy = 0, ride = null, skipA = 1;
      if (arrive) {
        const t = now - arrive.t0, q = band(t, arrive.q[0], arrive.q[1]);
        qa = q; skipA = q; qdy = 6 * (1 - CURVE(q)); ride = CURVE(band(t, 0, RIDE_MS));
      }
      if (swap) {
        const t = now - swap.t0;
        if (t < 200) { const o = band(t, 0, 200); qa *= 1 - o; qdy -= 6 * o; }
        else { const q = band(t, 260, 520); qa *= q; qdy += 6 * (1 - CURVE(q)); }
      }
      headR.style.transform = `translate(${x0}px, ${top + askH - hR + qdy - 6 * (1 - ask)}px)`;
      headR.style.opacity = ask * qa;
      headR.style.visibility = gone ? 'hidden' : '';
      headK.style.visibility = 'hidden';
      let field = top + askH + GAP + d + GAP;
      if (ride !== null) field = mix(restH + safeBottom + 8, field, ride); // up from the bottom edge, with the keyboard
      form.style.transform = `translateY(${field}px)`;
      below.style.transform = `translateY(${field + FIELD}px)`;
      for (const el of [form, below]) { el.style.opacity = ask; el.style.visibility = gone ? 'hidden' : ''; }
      if (skip) {
        skip.style.transform = `translate(${x0}px, ${field + FIELD + Math.max(UNDER, under + 6) + SKIP_UNDER - SKIP_LIFT}px)`;
        const a = (1 - band(c, 0, 0.3)) * skipA; skip.style.opacity = a; skip.style.visibility = a < 0.01 ? 'hidden' : '';
      }
      cy = top + askH + GAP + d / 2;
    }
    if (vtop) {
      // The verdict: the gold line, the same lens, then "Your map is in Dutch" and the buttons where the box was.
      // The column settles as the keyboard goes down, on the keyboard's own curve
      const groupV = hG + GAP + d + GAP + hV + 24 + hA;
      const topV = Math.max(10, (restH - groupV) * 0.42);
      const V = { cy: topV + hG + GAP + d / 2, verdict: topV + hG + GAP + d + GAP };
      const from = frozen ? frozen.lens : { cx, cy, dd: d };
      const lv = headR ? CURVE(band(c, 0, 0.38)) : 1;
      cx = mix(from.cx, width / 2, lv); cy = mix(from.cy, V.cy, lv);
      const dy = (1 - lv) * (from.cy - V.cy); // the words arrive on the lens's path
      vtop.style.transform = `translate(${x0}px, ${topV + dy}px)`;
      vtop.style.opacity = band(c, 0.3, 0.56);
      const v = band(c, 0.45, 0.75);
      vbody.style.transform = `translate(${x0}px, ${V.verdict + dy + (1 - CURVE(v)) * 10}px)`;
      vbody.style.opacity = v;
      const bt = band(c, 0.65, 0.95);
      vact.style.transform = `translate(${x0}px, ${V.verdict + hV + 24 + (1 - CURVE(bt)) * 12}px)`;
      vact.style.opacity = bt;
      for (const el of [vtop, vbody, vact]) el.style.visibility = c < 0.01 ? 'hidden' : '';
      vact.style.pointerEvents = c > 0.9 ? '' : 'none';
    }
    placeLens(cx, cy, d);
  }

  /** A new title: both copies, then the layout settles around it. */
  function setTitle(text) {
    panel.querySelectorAll('.step-title').forEach((t) => { t.textContent = text; });
    if (!els) return;
    measure(); draw();
  }

  /** The next country's title: the old one fades up and out, the new one rises in (the text changes while unseen). */
  function swapTitle(text) {
    if (!els?.headR || REDUCED) return setTitle(text);
    swap = { t0: performance.now() };
    run();
    timers.push(setTimeout(() => { if (els) setTitle(text); }, 200));
  }

  /** The lines under the box changed (feedback shown or cleared): open or close the room for them. */
  function feedbackChanged() {
    if (!els?.below || c > 0) return;
    const to = els.below.offsetHeight;
    if (REDUCED) { fbRoom = to; draw(); return; }
    fbTween = { from: fbRoom, to, t0: performance.now() };
    run();
  }

  /**
   * The question on screen becomes the verdict in place. `markup` holds .vtop, .vbody and .verdict-actions;
   * the field should already have lost focus (the keyboard folds down at the same time).
   */
  function confirm(markup) {
    els.step.insertAdjacentHTML('beforeend', markup);
    els.vtop = els.step.querySelector('.vtop');
    els.vbody = els.step.querySelector('.vbody');
    els.vact = els.step.querySelector('.verdict-actions');
    frozen = { k, hk, fb: fbRoom, lens: lens ?? { cx: 0, cy: 0, dd: 0 } };
    intent = false; arrive = null; swap = null; fbTween = null;
    els.step.classList.add('is-confirming');
    measure();
    if (REDUCED) { c = 1; draw(); return; }
    c = 0; draw(); // styled from the first frame: nothing shows at its unstyled place
    verdict = { t0: performance.now(), ms: CONFIRM_MS };
    update();
    run();
  }

  // Turning the device can switch layouts: follow it
  onLayout(() => { if (panel.querySelector('.ask-head, .vtop')) attach(); else detach(); });

  return {
    attach, detach, setTitle, swapTitle, feedbackChanged, confirm,
    /** The question is on screen in the column layout, so the verdict can grow out of it. */
    canConfirm: () => !!els?.headR && c === 0,
    /** This layout is active (phones and upright tablets). */
    active: () => !!els,
  };
}
