// The guided start: hero landing -> label language (read off the map) -> map size.
// One small step per screen; the globe on the left illustrates each step.

import { PROBES, LANGS, completion, narrow, nextProbe } from './language-detect.js';
import { createSizeScene } from './size-scene.js';
import { createLangLayout, bezier, CURVE } from './lang-layout.js';
import { markBusy } from './quiet.js';
import { releaseKeyboard } from './viewport.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? values[i] : ''), '');

// Setup keeps the whole globe in view (zoom 1): a clean circle reads calmer than a cropped close-up.
const EUROPE = { lat: 42, lon: 12, zoom: 1 };
// Phones go from the landing page straight to typing: the keyboard rises with the tap, so the globe rides up
// with it on the keyboard's own curve (a quick start that settles softly) into the small lens beside the question
const GLIDE = { ms: 900, ease: bezier(0.2, 0.8, 0.2, 1) };
// Wide screens: the hero globe moves into its column and the camera flies into the first country as one move, on one
// clock: it gets going at once (no still beat while the landing fades) and settles softly into the lens
const ARRIVE = { ms: 1200, ease: bezier(0.35, 0, 0.15, 1) };
const root = document.documentElement;
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Phones and upright tablets: one column, where the moves below replace the cross-fades. */
const stacked = () => root.classList.contains('vp-stacked');
/** Phones and upright tablets, also a phone on its side: the size step's portrait picture (size-scene.js fit). */
const phoneish = () => stacked() || root.classList.contains('vp-short');
const typesOnArrival = () => stacked() && root.classList.contains('vp-touch');
// The size step's desk globe starts over Europe and Africa, tilted on its axis (size-scene.js): the
// verdict's lens zooms out into exactly that view as it glides there
const DESK = { lat: 20, lon: 0, zoom: 1, roll: -23.4 };
const HANDOFF_MS = 800;
// Back from the size step: the lens lifts off the desk globe from rest, then settles on the keyboard's curve
const LIFT = bezier(0.45, 0, 0.2, 1);

/**
 * Copies of the pieces on screen, fading out where they are (with a small drift) while the screen is
 * rebuilt under them, so a step can change without a cross-fade and without anything vanishing in a frame.
 * Canvases are copied pixel for pixel.
 */
export function ghostOut(els, { ms = 220, dy = -6 } = {}) {
  const layer = document.createElement('div');
  layer.className = 'panel ghost-layer';
  layer.setAttribute('aria-hidden', 'true');
  for (const el of els) {
    if (!el) continue;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) < 0.02 || !r.width || !r.height) continue;
    const copy = el.cloneNode(true);
    copy.removeAttribute('id');
    copy.querySelectorAll('[id]').forEach((n) => n.removeAttribute('id'));
    Object.assign(copy.style, {
      position: 'absolute', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
      margin: '0', transform: 'none', opacity: cs.opacity, visibility: 'visible', animation: 'none', transition: 'none',
    });
    const from = el.matches('canvas') ? [el] : [...el.querySelectorAll('canvas')];
    const to = copy.matches('canvas') ? [copy] : [...copy.querySelectorAll('canvas')];
    from.forEach((c, i) => { try { to[i].getContext('2d').drawImage(c, 0, 0); } catch { /* an empty canvas */ } });
    layer.appendChild(copy);
  }
  if (!layer.children.length) return;
  document.body.appendChild(layer);
  markBusy(ms);
  const anim = layer.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateY(${REDUCED ? 0 : dy}px)` }],
    { duration: REDUCED ? 180 : ms, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' });
  anim.finished.then(() => layer.remove(), () => layer.remove());
}

const MAP_KINDS = {
  globe: { label: 'Globe', measure: 'Diameter', min: 10, max: 110, initial: 32,
    icon: '<circle cx="12" cy="10" r="6.5"/><path d="M5 14.5a8.5 8.5 0 0 0 14 0M12 18.5V21M8 21h8"/>' },
  wall: { label: 'Wall map', measure: 'Width', min: 60, max: 240, initial: 140,
    icon: '<path d="M3 5h18M3 19h18"/><rect x="4" y="5" width="16" height="14"/><path d="M8 10c2-2 4 2 6 0s3 1 3 1"/>' },
  atlas: { label: 'Atlas', measure: 'Page height', min: 14, max: 50, initial: 30,
    icon: '<path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13c-3-.5-6 0-8 1.5zM12 6v13"/>' },
};

/** Which salience band (vocab map_sizes) a physical size falls in, plus a friendly name. */
function sizeClass(kind, cm) {
  if (kind === 'globe') {
    if (cm < 25) return { size: 'small', name: 'Small globe' };
    if (cm <= 40) return { size: 'medium', name: 'Desk globe' };
    return { size: 'large', name: cm >= 70 ? 'Floor globe' : 'Large globe' };
  }
  if (kind === 'wall') return cm < 90 ? { size: 'medium', name: 'Small wall map' } : { size: 'large', name: 'Classroom wall map' };
  if (cm < 22) return { size: 'small', name: 'Pocket atlas' };
  if (cm <= 38) return { size: 'medium', name: 'School atlas' };
  return { size: 'large', name: 'Large reference atlas' };
}

const SIZE_HINT = {
  small: 'We\'ll stick to the big, unmistakable clues.',
  medium: 'Most clues, skipping the tiniest details.',
  large: 'Every clue, down to canal zones and small islands.',
};

/** Run a DOM change as a smooth cross-fade where the browser supports it. */
export function transition(fn) {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) document.startViewTransition(fn);
  else fn();
}

/**
 * The camera for a probe country: centred on it, zoomed in until its mainland spans about half
 * the lens (globe.js: lens diameter ~ 2(half - 8), earth radius r = (half - 14) * 1.55^(zoom - 1)).
 * Far-off parts (the Canaries, French Guiana) are left out of the measure.
 */
function closeUp(probe, countries) {
  const d3 = window.d3;
  const f = countries.get(probe.country);
  const { lat, lon } = probe.camera;
  if (!f) return probe.camera;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const near = polys.filter((p) => d3.geoDistance(d3.geoCentroid({ type: 'Polygon', coordinates: p }), [lon, lat]) < 0.16);
  const projection = d3.geoOrthographic().rotate([-lon, -lat]).scale(1).translate([0, 0]);
  const [[x0, y0], [x1, y1]] = d3.geoPath(projection).bounds({ type: 'MultiPolygon', coordinates: near.length ? near : polys });
  const extent = Math.max(x1 - x0, (y1 - y0) * 1.1);
  const zoom = 1 + Math.log(1.0 / extent) / Math.log(1.55);
  return { lat, lon, zoom: Math.min(8, Math.max(1, zoom)) };
}

export function createSetupFlow({ bundle, world, globe, panel, landingEl, captionEl, setMode, onDone, onGame }) {
  const state = { language: null, candidates: LANGS, asked: [], answers: {}, probe: null, kind: 'globe', cm: Object.fromEntries(Object.entries(MAP_KINDS).map(([k, v]) => [k, v.initial])) };
  let cleanup = null;
  const countries = new Map(window.topojson.feature(world, world.objects.countries).features.map((f) => [String(f.id), f]));
  // Phones and upright tablets: the language step's own layout, which folds itself above the keyboard
  const wrap = document.querySelector('.globe-wrap');
  const langLayout = createLangLayout({ layoutEl: panel.parentElement, wrap, panel, onLens: (box) => globe.setLensBox(box) });
  let sizeScene = null;
  let handoff = []; // timers of the hand-off into the size step
  let glideTimer = 0;
  /**
   * The lens glides from `box` to its column while the screen is rebuilt under it. The loupe belongs to
   * the column, where the lens is not yet, so it steps aside until the lens arrives.
   */
  function glideLens(box, ms) {
    globe.lensFrom(box, { ms, ease: CURVE });
    if (REDUCED) return;
    wrap.classList.add('is-gliding');
    clearTimeout(glideTimer);
    glideTimer = setTimeout(() => wrap.classList.remove('is-gliding'), ms);
  }

  function mount(markup) {
    cleanup?.(); cleanup = null;
    endHandoff();
    langLayout.detach();
    document.body.classList.remove('step-size');
    panel.scrollTop = 0;
    panel.innerHTML = `<div class="step">${markup}</div>`;
  }

  const progress = (n) => html`<div class="progress" role="img" aria-label="Step ${n} of 2"><span class="on"></span><span class="${n >= 2 ? 'on' : ''}"></span></div>`;
  /** The gold category line the questions also lead with, the step dashes at its right end. */
  const stepHead = (n, label) => html`<div class="step-top"><p class="q-context">${label}</p>${progress(n)}</div>`;

  // -------------------------------------------------------------------------
  // Landing: a large globe rises from the bottom edge while a year counter rolls.
  // "Begin" morphs the globe into its place beside the questions.

  let rollerTimer = null;

  /**
   * Phones (upright): the two buttons sit in the middle of the paper between the year and the globe's ring, as far down
   * as that room allows without pushing the globe (it moves down when the words reach within its gap of the horizon).
   * Measured with layout offsets (the words rise in with a transform). Tablets, laptops and phones on their side: as laid out.
   */
  function placeDoors() {
    const doors = landingEl.querySelector('.hero-doors'), odo = landingEl.querySelector('.odometer');
    if (!doors || !odo) return;
    doors.style.marginTop = '';
    const cls = document.documentElement.classList, room = globe.heroRoom?.();
    if (!room || !cls.contains('vp-stacked') || cls.contains('vp-page')) return;
    const top = doors.offsetTop, bottom = top + doors.offsetHeight, above = top - (odo.offsetTop + odo.offsetHeight);
    const m = Math.max(0, Math.min((room.ring - bottom - above) / 2, room.ring + 12 - room.gap - bottom));
    if (m >= 1) doors.style.marginTop = `${Math.round(m)}px`;
  }
  // a frame later: the globe takes its own new size on the same resize
  addEventListener('resize', () => requestAnimationFrame(() => { if (document.body.classList.contains('mode-landing')) placeDoors(); }));

  function showLanding() {
    cleanup?.(); cleanup = null;
    setMode('landing');
    globe.setStage('hero');
    captionEl.textContent = '';
    const startYear = Number(bundle.vocab.timeRange.start.slice(0, 4));
    const thisYear = new Date().getFullYear();
    const digits = String(startYear).split('').map((d) => html`
      <span class="digit"><span class="strip" style="transform: translateY(-${Number(d) * 10}%)">${'0123456789'.split('').map((n) => `<span>${n}</span>`).join('')}</span></span>`).join('');
    landingEl.innerHTML = html`
      <div class="hero">
        <div class="hero-brand"><span class="brand-mark">◍</span> Date a Globe</div>
        <h1 class="hero-title">Every globe is frozen <br>in the year it was made.</h1>
        <div class="odometer" aria-hidden="true">${digits}</div>
        <div class="hero-doors">
          <button class="btn-begin" id="begin">Find out when <span class="arrow" aria-hidden="true">→</span></button>
          <button class="hero-game" id="play" type="button"><span class="hero-new">New<span class="vd-sr">: </span></span>Guess a globe’s year</button>
        </div>
      </div>`;
    placeDoors(); document.fonts?.ready.then(placeDoors);
    const strips = [...landingEl.querySelectorAll('.strip')];
    const roll = (year) => String(year).split('').forEach((d, i) => { strips[i].style.transform = `translateY(-${Number(d) * 10}%)`; });
    clearInterval(rollerTimer);
    setTimeout(() => roll(1937), 500); // the opening roll, as the globe rises
    rollerTimer = setInterval(() => roll(startYear + Math.floor(Math.random() * (thisYear - startYear + 1))), 2600);
    // The game: a globe from a year the app picks (game.js). The door answers the finger itself: a press that
    // lifts within 12 px of where it went down opens the game, so a browser that drops the click (Safari's bars,
    // a tap read as the start of a scroll) can't swallow it; touch-action: none keeps a touch on it from panning
    const door = landingEl.querySelector('#play');
    let press = null, opened = false;
    const open = () => { if (opened) return; opened = true; clearInterval(rollerTimer); onGame?.(); };
    door.addEventListener('pointerdown', (e) => { if (e.button === 0) press = { id: e.pointerId, x: e.clientX, y: e.clientY }; });
    door.addEventListener('pointerup', (e) => { if (press?.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 12) open(); press = null; });
    door.addEventListener('pointercancel', () => { press = null; });
    door.addEventListener('click', open); // keyboard, and any click the press didn't already answer
    landingEl.querySelector('#begin').addEventListener('click', () => {
      clearInterval(rollerTimer);
      // Phones and upright tablets: straight into typing. Everything happens inside this tap, because an
      // iPhone opens the keyboard only for a field focused during a tap (a cross-fade would build it later)
      if (typesOnArrival()) {
        document.body.classList.add('arriving-typing');
        setTimeout(() => document.body.classList.remove('arriving-typing'), 1600);
        // The landing words lift away while the globe glides into the lens and the answer box rides up with the keyboard
        landingEl.classList.add('is-leaving');
        setTimeout(() => { landingEl.classList.remove('is-leaving'); landingEl.innerHTML = ''; }, 320);
        globe.setStage('panel', GLIDE);
        showLanguage({ typing: true, arrive: { question: [300, 600] } });
        focusField();
        return;
      }
      transition(() => {
        // The globe glides from the hero into its column (globe.js); the first question waits for it
        document.body.classList.add('arriving');
        setTimeout(() => document.body.classList.remove('arriving'), 1600);
        landingEl.innerHTML = '';
        globe.setStage('panel', ARRIVE);
        showLanguage({ glide: ARRIVE });
      });
    });
  }

  // -------------------------------------------------------------------------
  // Step 1: the label language, read off the map. The user types what their map
  // calls a highlighted country; if several languages spell it that way, another
  // country follows, until one language is left (two questions at most). Anything
  // unclear becomes "unknown", which can be changed later from the top bar.

  const langName = (c) => bundle.vocab.languages[c]?.name ?? c;
  const orList = (xs) => (xs.length < 3 ? xs.join(' or ') : `${xs.slice(0, -1).join(', ')} or ${xs.at(-1)}`);

  /** typing: arriving from the landing page on a phone, laid out for the keyboard from the start. */
  function showLanguage({ typing = false, arrive = null, glide = null } = {}) {
    if (state.language && state.language !== 'xx') return showDetected(state.language);
    startDetection({ typing, arrive, glide });
  }

  /**
   * Start over with every language possible; earlier answers are kept to prefill. probe: begin with this
   * country ("Not Dutch?" stays on the country in view, its earlier answer ready to retype).
   */
  function startDetection({ typing = false, arrive = null, probe = null, glide = null } = {}) {
    state.candidates = LANGS;
    state.asked = [];
    showAsk(probe ?? nextProbe(LANGS, []), { typing, arrive, glide });
  }

  /** Focus the answer field (inside a tap, so an iPhone raises its keyboard); select an earlier answer to retype. */
  function focusField({ select = false } = {}) {
    const input = panel.querySelector('#typed');
    if (!input) return;
    if (document.activeElement !== input) input.focus({ preventScroll: true });
    if (select && input.value) input.select();
  }

  /** After an answer or a skip: done, the next country, or (only after skips) a last choice. */
  function askNext() {
    // One language left. On a phone the question on screen becomes the verdict in place; elsewhere a cross-fade
    if (state.candidates.length === 1) return langLayout.canConfirm() ? showDetected(state.candidates[0]) : transition(() => showDetected(state.candidates[0]));
    const next = nextProbe(state.candidates, state.asked);
    // While typing, the next country swaps in place: the field keeps its focus, so the keyboard stays up
    if (next && askTyping()) return showAsk(next);
    if (next) return transition(() => showAsk(next));
    if (state.candidates.length === LANGS.length) return unknown();
    transition(showLastChoice);
  }

  const unknown = () => { state.language = 'xx'; if (stacked()) toSizeHere(); else transition(showSize); };

  /** The type-in step is on screen and its field has focus (on a phone: the keyboard is up). */
  const askTyping = () => !!panel.querySelector('#typed') && document.activeElement === panel.querySelector('#typed');
  const askTitle = () => (state.asked.length === 0 ? 'What does your map call this country?' : 'And this one?');

  /**
   * Point the globe at a probe country: a close-up with the country in brass. hop: from the previous
   * country's close-up, pulling back a little mid-way, the brass handing over at the midpoint.
   */
  function showProbe(probe, { glide = null, hop = false } = {}) {
    globe.setLabel(null);
    if (hop) {
      globe.highlightCountry(probe.country, { fade: 330, delay: 330 });
      globe.flyTo(closeUp(probe, countries), 1100, { mark: false, via: 'hop', ease: window.d3.easeCubicInOut });
      return;
    }
    globe.highlightCountry(probe.country);
    globe.flyTo(closeUp(probe, countries), glide ? glide.ms : 1500, { mark: false, ease: glide?.ease });
  }

  /** glide: the camera's flight on the clock of a move it is part of (the landing's globe moving into its column). */
  function showAsk(probe, { typing = false, arrive = null, glide = null } = {}) {
    setMode('setup');
    const inPlace = askTyping();
    state.probe = probe;
    showProbe(probe, { glide: typing ? GLIDE : glide, hop: inPlace });
    captionEl.textContent = '';

    // The next country while typing: the keyboard stays up and nothing moves but the globe and the words.
    // The typed word and its ✓ line fade, the field empties, and the new title rises in as the globe arrives
    if (inPlace) {
      const input = panel.querySelector('#typed');
      const live = panel.querySelector('#live');
      if (langLayout.active()) langLayout.swapTitle(askTitle());
      else {
        panel.querySelectorAll('.step-title').forEach((t) => t.classList.add('is-swapping'));
        setTimeout(() => {
          langLayout.setTitle(askTitle());
          panel.querySelectorAll('.step-title').forEach((t) => t.classList.remove('is-swapping'));
        }, 180);
      }
      const refill = () => { input.value = state.answers[probe.id] ?? ''; input.dispatchEvent(new Event('input')); };
      if (REDUCED) return refill();
      for (const el of [input, live]) { el.style.transition = 'opacity .18s ease'; el.style.opacity = '0'; }
      setTimeout(() => {
        refill();
        for (const el of [input, live]) el.style.opacity = '';
        setTimeout(() => { for (const el of [input, live]) el.style.transition = ''; }, 200);
      }, 180);
      return;
    }

    mount(html`
      <div class="ask-head">
        ${stepHead(1, 'Map language')}
        <h2 class="step-title">${askTitle()}</h2>
      </div>
      <form class="typein" id="typein" autocomplete="off">
        <div class="typein-field">
          <span class="typein-ghost" aria-hidden="true"><span class="typed"></span><span class="rest"></span></span>
          <input id="typed" class="typein-input" placeholder="Enter answer here" spellcheck="false" autocapitalize="off" autocorrect="off" aria-label="Answer" aria-describedby="live">
        </div>
        <button class="typein-go" aria-label="Check">→</button>
      </form>
      <div class="ask-below">
        <div class="live" id="live" aria-live="polite"></div>
        <div class="feedback" id="feedback" aria-live="polite"></div>
      </div>
      <div class="actions"><button class="btn-quiet" id="skip">Skip</button></div>`);
    langLayout.attach({ intent: typing, arrive });

    const form = panel.querySelector('#typein');
    const input = panel.querySelector('#typed');
    const ghostTyped = panel.querySelector('.typein-ghost .typed');
    const ghostRest = panel.querySelector('.typein-ghost .rest');
    const live = panel.querySelector('#live');
    const feedback = panel.querySelector('#feedback');
    // The probe and the languages still in play change when the next country swaps in place
    const current = () => ({ probe: state.probe, candidates: state.candidates });
    let suggestion = null;
    const earlier = state.answers[probe.id];
    // Selecting would focus the field; on a phone that only happens inside a tap (focusField)
    if (earlier) { input.value = earlier; if (!matchMedia('(hover: none)').matches) input.select(); }
    // A phone would cover the highlighted country with its keyboard straight away: let the user
    // look first and tap the field when ready (the app then fits itself above the keyboard)
    if (!matchMedia('(hover: none)').matches) input.focus();

    // Live: a faint completion of the spelling being typed, and the language once it's recognised
    // Feedback under the box: it fades in (style.css) and out, and the phone layout makes room for it
    let fbToken = 0;
    const showFeedback = (markup) => {
      fbToken++;
      feedback.classList.remove('is-leaving');
      feedback.innerHTML = markup;
      langLayout.feedbackChanged();
    };
    const clearFeedback = () => {
      panel.querySelector('#skip').hidden = false;
      if (!feedback.innerHTML) return;
      const token = ++fbToken;
      const done = () => { if (token !== fbToken) return; feedback.classList.remove('is-leaving'); feedback.innerHTML = ''; langLayout.feedbackChanged(); };
      if (!langLayout.active() || REDUCED) return done();
      feedback.classList.add('is-leaving');
      setTimeout(done, 150);
    };

    const update = () => {
      const { probe, candidates } = current();
      clearFeedback();
      const value = input.value;
      suggestion = input.selectionStart === value.length
        ? completion(probe, value, candidates) ?? completion(probe, value) : null;
      ghostTyped.textContent = suggestion ? value : '';
      ghostRest.textContent = suggestion ? suggestion.rest : '';
      const a = narrow(probe, value, candidates);
      live.innerHTML = a.tier === 'exact'
        ? html`<span class="live-match">${esc(orList(a.left.map(langName)))}</span>`
        : suggestion ? '<span class="live-tip"><kbd>Tab</kbd> to complete</span>' : '';
    };
    input.addEventListener('input', update);
    input.addEventListener('keydown', (e) => {
      if ((e.key === 'Tab' || e.key === 'ArrowRight') && suggestion && !e.shiftKey) {
        e.preventDefault();
        input.value = suggestion.variant;
        update();
      }
    });

    // An answer narrows the languages; several left (Spanien: German, Swedish, Danish) means another country
    const accept = (text) => {
      const { probe, candidates } = current();
      state.answers[probe.id] = text;
      state.asked = [...state.asked, probe.id];
      state.candidates = narrow(probe, text, candidates).left;
      askNext();
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // On a phone the next country arrives ready to type: the keyboard comes up with this tap if it was down
      if (langLayout.active()) focusField();
      const text = input.value.trim();
      if (!text) return input.focus();
      const { probe, candidates } = current();
      const a = narrow(probe, text, candidates);
      if (a.tier === 'exact') return accept(text);
      if (a.tier === 'fuzzy') {
        showFeedback(html`<p class="fb-title">Did you mean <button class="suggest" id="yes">${esc(a.variant)}</button>?</p>`);
        feedback.querySelector('#yes').addEventListener('click', () => { input.value = a.variant; update(); accept(a.variant); });
        return;
      }
      form.classList.remove('shake'); void form.offsetWidth; form.classList.add('shake');
      showFeedback(html`
        <p class="fb-title">We don't recognise that.</p>
        ${a.nearby.length ? html`<p class="fb-line">${a.nearby.map((n) => html`<button class="suggest" data-text="${esc(n)}">${esc(n)}</button>`).join(' ')}</p>` : ''}
        <button class="btn-quiet" id="without">Continue without it</button>`);
      // "Continue without it" says the same, except on phones: there Skip sits under the question, which the keyboard never covers
      // (laptops and upright tablets have Skip under the box, where this note now stands)
      panel.querySelector('#skip').hidden = !document.body.classList.contains('lang-stage') || document.documentElement.classList.contains('vp-page');
      feedback.querySelectorAll('[data-text]').forEach((b) => b.addEventListener('click', () => { input.value = b.dataset.text; update(); accept(b.dataset.text); }));
      feedback.querySelector('#without').addEventListener('click', unknown);
    });

    // Skip: this label may be missing or unreadable, so try another country. On a phone it arrives
    // ready to type: the field takes focus in this tap, so the keyboard comes up with the next country
    panel.querySelector('#skip').addEventListener('click', () => {
      state.asked = [...state.asked, state.probe.id];
      if (langLayout.active() && nextProbe(state.candidates, state.asked)) focusField();
      askNext();
    });

    // The arrow, a suggestion and Skip act without taking the focus from the field, so the keyboard
    // stays up: the tap's own touchend is cancelled (no focus change, no click) and the button is run from here
    const keep = (e) => {
      const b = e.target.closest('.typein-go, .suggest, #skip');
      if (!b) return;
      if (e.type === 'mousedown') { if (document.activeElement === input) e.preventDefault(); return; }
      e.preventDefault();
      b.click();
    };
    const step = panel.querySelector('.step');
    step.addEventListener('touchend', keep, { passive: false });
    step.addEventListener('mousedown', keep);
  }

  /** Only reached when the countries that could settle it were all skipped. */
  function showLastChoice() {
    setMode('setup');
    globe.highlightCountry(null);
    globe.flyTo(EUROPE, 1200, { mark: false }); // no country to show: back to the whole earth
    mount(html`
      ${stepHead(1, 'Map language')}
      <h2 class="step-title">Which language is your map in?</h2>
      <div class="pick-row">${state.candidates.map((c) => html`<button class="pill" data-lang="${c}">${esc(langName(c))}</button>`).join('')}</div>
      <div class="actions"><button class="btn-quiet" id="unsure">Not sure</button></div>`);
    panel.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => transition(() => showDetected(b.dataset.lang))));
    panel.querySelector('#unsure').addEventListener('click', unknown);
  }

  /**
   * "Your map is in Dutch". The globe stays on (or returns to) the last country asked, now with its name
   * printed the way this map prints it. On a phone the verdict sits below the lens, and when the question is
   * on screen it grows out of it in place (lang-layout.js confirm); otherwise it is mounted as its own screen.
   */
  function showDetected(code, { from = null } = {}) {
    setMode('setup');
    state.language = code;
    const name = esc(langName(code));
    const markup = html`
      <div class="vtop">${stepHead(1, 'Map language')}</div>
      <div class="vbody">
        <div class="verdict" role="status">
          <span class="verdict-seal" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>
          <div>
            <div class="verdict-label">Your map is in</div>
            <div class="verdict-lang">${name}</div>
          </div>
        </div>
      </div>
      <div class="actions verdict-actions">
        <button class="btn" id="continue">Continue</button>
        <button class="btn-quiet" id="wrong">Not ${name}?</button>
      </div>`;

    const inPlace = langLayout.canConfirm();
    if (inPlace) {
      panel.querySelector('#typed')?.blur(); // the keyboard folds down with the move
      langLayout.confirm(markup);
    } else {
      mount(markup);
      if (from) panel.querySelector('.step').classList.add('is-returning');
      langLayout.attach();
    }
    // In place, the name inks onto the map while the verdict settles (from about a third of the move).
    // Back from the size step (from): the desk globe turns back into the lens on its way here
    const probe = state.probe;
    if (probe && from) {
      lensFromDesk(from);
      globe.flyTo(closeUp(probe, countries), HANDOFF_MS, { mark: false, ease: LIFT });
      globe.highlightCountry(probe.country, { fade: 350, delay: 450 });
      setTimeout(() => { if (state.language === code) showWordOnGlobe(code, 0.05); }, 550);
    } else if (probe) {
      globe.highlightCountry(probe.country);
      if (!inPlace) globe.flyTo(closeUp(probe, countries), 1400, { mark: false });
      setTimeout(() => { if (state.language === code) showWordOnGlobe(code, inPlace ? 0.04 : 0.08); }, inPlace ? 320 : 0);
    } else {
      globe.highlightCountry(null);
      globe.flyTo(EUROPE, 1400, { mark: false });
    }
    const go = panel.querySelector('#continue');
    if (!matchMedia('(hover: none)').matches) go.focus({ preventScroll: true });
    go.addEventListener('click', () => (stacked() ? toSizeHere() : transition(showSize)));
    // Nothing is ruled out: typing the same name again finds the same language
    panel.querySelector('#wrong').addEventListener('click', () => {
      state.language = null;
      if (!stacked()) { globe.setLabel(null); return transition(startDetection); }
      // On a phone the verdict runs backwards: it fades, the lens glides back beside the question and the
      // keyboard rises with this tap, on the same country with the earlier answer selected to retype
      const box = wrap.getBoundingClientRect();
      ghostOut(panel.querySelectorAll('.vtop, .vbody, .verdict-actions'), { ms: 200, dy: 6 });
      globe.setLabel(null, { fade: true });
      startDetection({ typing: true, probe: state.probe, arrive: { question: [200, 460] } });
      focusField({ select: true });
      glideLens(box, 440);
    });
  }

  /**
   * Continue (or "Continue without it") on a phone: the lens becomes the size step's desk globe. It glides to
   * where the size step draws its globe, zooming out to the whole earth onto the globe's tilted axis, and takes
   * on the desk globe's look (borders fade, the light comes up, the rim closes into the meridian). Meanwhile the
   * ground draws out, the stand rises to meet it and the mug slides in (size-scene.js intro), and the words rise
   * in from the top. Once the lens has landed, the desk globe's own drawing takes over: the same pixels.
   */
  function toSizeHere() {
    const box = wrap.getBoundingClientRect();
    const fromAsk = !!panel.querySelector('#typed');
    panel.querySelector('#typed')?.blur();
    // The keyboard folds away from here: the size step is laid out once, at the full height it will have
    releaseKeyboard();
    const leaving = [...(panel.querySelector('.step')?.children ?? [])];
    if (REDUCED) leaving.push(document.getElementById('globe')); // nothing travels: the lens fades where it is
    ghostOut(leaving, { ms: fromAsk ? 180 : 220, dy: -6 });
    globe.setLabel(null, { fade: true });
    globe.highlightCountry(null, { fade: 350 });
    showSize({ handoff: !REDUCED });
    const at = sceneGlobe();
    // No globe to land on (the wall map or atlas was chosen earlier): the lens fades where it is
    if (!at && !REDUCED) ghostOut([document.getElementById('globe')], { ms: 300, dy: 0 });
    if (!at || REDUCED) { sizeScene?.reveal(); globe.reset(); return; }
    Object.assign(wrap.style, { position: 'fixed', left: `${at.box.left}px`, top: `${at.box.top}px`, width: `${at.box.width}px`, height: `${at.box.height}px`, flex: 'none' });
    document.body.classList.add('size-handoff');
    glideLens(box, HANDOFF_MS);
    globe.flyTo(DESK, HANDOFF_MS - 100, { mark: false, ease: CURVE });
    globe.setDesk({ look: [1, 350, 450], arc: [1, 400, 350] });
    // The lens has landed and looks exactly like the desk globe: the scene draws the sphere from this frame on
    handoff.push(setTimeout(() => { sizeScene?.reveal(); endHandoff(); globe.reset(); }, HANDOFF_MS + 40));
  }

  /** The hand-off is over (or interrupted): the lens folds back into its column. */
  function endHandoff() {
    handoff.forEach(clearTimeout); handoff = [];
    if (!document.body.classList.contains('size-handoff')) return;
    for (const p of ['position', 'left', 'top', 'width', 'height', 'flex']) wrap.style.removeProperty(p);
    document.body.classList.remove('size-handoff');
    sizeScene?.reveal();
  }

  /**
   * Back from the size step on a phone: the lens takes the sphere back where the desk globe is drawn, turned as
   * it is, in the desk look, and turns back into the lens on its way (the desk folds away around it meanwhile).
   */
  function lensFromDesk(from) {
    globe.jumpTo(from.rot, 1);
    globe.setDesk({ look: [1], arc: [1] });
    globe.setDesk({ look: [0, 0, 450], arc: [0, 0, 350] });
    // It lifts off a globe at rest: a soft start, so its first frame is where the desk globe was
    globe.lensFrom(from.box, { ms: HANDOFF_MS, ease: LIFT });
    if (!REDUCED) { wrap.classList.add('is-gliding'); clearTimeout(glideTimer); glideTimer = setTimeout(() => wrap.classList.remove('is-gliding'), HANDOFF_MS); }
  }

  /**
   * The size step's picture leaves with Back: the live drawing is lifted out of the step (so the next screen can be
   * built) and folds its desk away where it is, then goes.
   */
  function liftScene() {
    const canvas = panel.querySelector('#scene'), scene = sizeScene;
    if (!canvas || !scene) return;
    cleanup = null; sizeScene = null; // the next mount must not destroy it yet
    const r = canvas.getBoundingClientRect();
    const layer = document.createElement('div');
    layer.className = 'panel ghost-layer';
    layer.setAttribute('aria-hidden', 'true');
    Object.assign(canvas.style, { position: 'absolute', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    layer.appendChild(canvas);
    document.body.appendChild(layer);
    scene.fold();
    markBusy(450);
    setTimeout(() => { scene.destroy(); layer.remove(); }, 450);
  }

  /** Where the size step's desk globe is on screen, as a lens box (globe.js: earth radius = half the box - 14), and how it is turned. */
  function sceneGlobe() {
    const canvas = panel.querySelector('#scene');
    const at = sizeScene?.globeAt();
    if (!canvas || !at) return null;
    const r = canvas.getBoundingClientRect(), half = at.r + 14;
    return { box: { left: r.left + at.cx - half, top: r.top + at.cy - half, width: 2 * half, height: 2 * half }, rot: sizeScene.rotation() };
  }

  /** Print the last country's name in this language on the globe, like a map label. */
  function showWordOnGlobe(code, speed) {
    const probe = state.probe ?? PROBES[0];
    const text = probe.names[code]?.[0];
    if (!text) return;
    globe.setLabel({ lat: probe.camera.lat, lon: probe.camera.lon, text: /[a-z]/i.test(text) ? text.toUpperCase() : text, speed });
  }

  // -------------------------------------------------------------------------
  // Step 2: what kind of map, and how big

  /** handoff: arriving from the verdict on a phone (toSizeHere moves the globe itself). */
  function showSize({ handoff: handing = false } = {}) {
    if (!handing) {
      globe.setLabel(null);
      globe.highlightCountry(null);
      globe.reset();
    }
    captionEl.textContent = '';
    const phone = phoneish();
    mount(html`
      ${stepHead(2, 'Your map')}
      <h2 class="step-title">What are you dating?</h2>
      <div class="segmented" role="radiogroup" aria-label="Kind of map" style="--i: ${Object.keys(MAP_KINDS).indexOf(state.kind)}">
        <span class="seg-pill" aria-hidden="true"></span>
        ${Object.entries(MAP_KINDS).map(([k, v]) => html`
          <button role="radio" aria-checked="${k === state.kind}" data-kind="${k}">
            <svg viewBox="0 0 24 24" aria-hidden="true">${v.icon}</svg>${esc(v.label)}
          </button>`).join('')}
      </div>
      <div class="scene"><canvas id="scene" aria-hidden="true"></canvas></div>
      <div class="size-readout">
        <div class="size-cm"><span id="cm"></span><small>cm</small></div>
        <div class="size-text">
          <div class="size-name" id="size-name"></div>
          <div class="size-hint" id="size-hint"></div>
        </div>
      </div>
      <label class="slider">
        <span class="slider-label" id="measure"></span>
        <input type="range" id="slider">
      </label>
      <div class="actions">
        <button class="btn" id="go">Start</button>
        <button class="btn-quiet" id="back">Back</button>
      </div>`);
    const step = panel.querySelector('.step');
    // Arriving from the verdict: the words rise in one after another, top to bottom, while the desk gathers
    if (handing) step.classList.add('is-handed-in');

    // Phones fold the globe away here: the drawing of the map beside a mug is this step's picture
    document.body.classList.add('step-size');
    // Arriving from the verdict, the scene leaves the sphere to the lens until it has landed (toSizeHere)
    const scene = createSizeScene(panel.querySelector('#scene'), world, { holdMs: 0, fit: phone, intro: handing ? { at: performance.now() } : null });
    sizeScene = scene;
    cleanup = () => { scene.destroy(); sizeScene = null; };
    const slider = panel.querySelector('#slider');
    const segmented = panel.querySelector('.segmented');
    const els = { cm: panel.querySelector('#cm'), name: panel.querySelector('#size-name'), hint: panel.querySelector('#size-hint'),
      num: panel.querySelector('.size-cm'), text: panel.querySelector('.size-text') };

    // The readout: on a phone the name and hint fade over when the size class changes, and the number goes
    // with them when the kind changes (while sliding the number follows the thumb at once)
    let shownKind = state.kind, swapTimer = 0;
    const writeText = () => {
      const cls = sizeClass(state.kind, state.cm[state.kind]);
      els.name.textContent = cls.name; els.hint.textContent = SIZE_HINT[cls.size];
      els.cm.textContent = state.cm[state.kind];
    };
    const readout = () => {
      const kindChanged = state.kind !== shownKind;
      shownKind = state.kind;
      const name = sizeClass(state.kind, state.cm[state.kind]).name;
      if (!phone || REDUCED || (!kindChanged && name === els.name.textContent) || !els.name.textContent) {
        if (!swapTimer) writeText();
        return;
      }
      if (!kindChanged && !swapTimer) els.cm.textContent = state.cm[state.kind];
      if (swapTimer) return; // already fading out: the newest text goes in when it has
      const leaving = kindChanged ? [els.num, els.text] : [els.text];
      const outs = leaving.map((el) => el.animate([{ opacity: getComputedStyle(el).opacity }, { opacity: 0 }], { duration: 90, easing: 'ease-in', fill: 'forwards' }));
      swapTimer = setTimeout(() => {
        swapTimer = 0;
        writeText();
        outs.forEach((a) => a.cancel());
        for (const el of leaving) el.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'none' }], { duration: 160, easing: 'cubic-bezier(.2,.8,.2,1)' });
      }, 90);
    };

    const sync = () => {
      const kind = MAP_KINDS[state.kind];
      const cm = state.cm[state.kind];
      Object.assign(slider, { min: kind.min, max: kind.max, step: 1 });
      slider.value = cm;
      slider.style.setProperty('--fill', `${((cm - kind.min) / (kind.max - kind.min)) * 100}%`);
      panel.querySelector('#measure').textContent = kind.measure;
      readout();
      panel.querySelectorAll('[data-kind]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.kind === state.kind)));
      segmented.style.setProperty('--i', Object.keys(MAP_KINDS).indexOf(state.kind));
      scene.set(state.kind, cm);
    };
    panel.querySelectorAll('[data-kind]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.kind === state.kind) return;
      // Another kind before the lens has landed: it fades where it is instead of landing on the old picture
      if (document.body.classList.contains('size-handoff')) { ghostOut([document.getElementById('globe')], { ms: 200, dy: 0 }); endHandoff(); globe.reset(); }
      state.kind = b.dataset.kind; sync();
    }));
    slider.addEventListener('input', () => { state.cm[state.kind] = Number(slider.value); sync(); });
    sync();

    panel.querySelector('#back').addEventListener('click', () => {
      if (!stacked()) return transition(showLanguage);
      // On a phone the desk globe turns back into the lens: the words fade where they are, the drawing folds its
      // desk away, and the lens takes the sphere where it is drawn and glides back to the verdict or the question
      const from = sceneGlobe();
      ghostOut([...step.children].filter((el) => !el.matches('.scene')), { ms: 220, dy: 6 });
      // (reduced motion: nothing folds, the picture fades where it is)
      if (from && !REDUCED) liftScene();
      else ghostOut([panel.querySelector('.scene')], { ms: 220, dy: 0 });
      if (state.language && state.language !== 'xx') return showDetected(state.language, { from });
      if (from) lensFromDesk(from);
      startDetection({ typing: true, probe: state.probe, arrive: { question: [300, 600] } });
      if (from && state.probe) {
        // As on the way back to the verdict: the lens lifts off softly and the brass country comes in on the way
        globe.flyTo(closeUp(state.probe, countries), HANDOFF_MS, { mark: false, ease: LIFT });
        globe.highlightCountry(null);
        globe.highlightCountry(state.probe.country, { fade: 350, delay: 450 });
      }
      focusField({ select: true });
    });
    panel.querySelector('#go').addEventListener('click', () => {
      // On a phone the desk globe lifts off into the first question's lens: the words fade up where they are, the
      // drawing folds its desk away, and app.js takes the sphere where it is drawn (from). Reduced motion: it fades.
      // Start before the lens has landed on the desk: the hand-off ends here, or its timer would reset the globe
      // (pull back and spin) in the middle of the first question
      endHandoff();
      const from = stacked() && !REDUCED ? sceneGlobe() : null;
      if (stacked()) {
        ghostOut([...step.children].filter((el) => !el.matches('.scene')), { ms: 220, dy: -6 });
        if (from) liftScene();
        else ghostOut([panel.querySelector('.scene')], { ms: 220, dy: 0 });
      }
      cleanup?.(); cleanup = null;
      document.body.classList.remove('step-size');
      onDone({ language: state.language ?? 'xx', mapSize: sizeClass(state.kind, state.cm[state.kind]).size, mapKind: state.kind, from });
    });
  }

  /** Fresh start for another map: forget the previous map's language, back on the landing page. */
  function restart() {
    state.language = null; state.answers = {};
    showLanding();
  }

  return { showLanding, restart };
}
