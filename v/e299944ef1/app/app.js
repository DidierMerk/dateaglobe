// Date a Globe: wires the engine to the globe, the evidence timeline and the panel.
// Screens: landing -> setup (setup.js) -> yes/no question <-> answer -> result; "Guess the year" (game.js) and the
// help (help.js) sit beside them.

import { createSession, nowDecimalYear, optionsFor, stateProbabilities } from '../engine/engine.js';
import { createGlobe } from './globe.js';
import { createTimeline } from './timeline.js';
import { createSetupFlow, transition, ghostOut } from './setup.js';
import { createScenes } from './scenes.js';
import { createWhere } from './where.js';
import { createVerdict, GUTTER } from './verdict.js';
import { agreement } from './agreement.js';
import { odometerHTML, setOdometer, rollOdometer } from './odometer.js';
import { isCompact, isWide, isPage, onLayout, layout } from './viewport.js';
import { createQuizLayout, medallionSlot } from './quiz-layout.js';
import { whenQuiet } from './quiet.js';
import { chartDims } from './result-chart.js';
import { createShareModal } from './share-modal.js';
import { shareFacts } from './share-logic.js';
import { createGame } from './game.js';
import { readGameCode } from './game-logic.js';
import { isCustomCode, writeLink, answersFrom, agreeYears } from './custom-globe.js';
import { showNotice } from './notice.js';
import { createHelp, helpData } from './help.js';
import { isDevHost, addressOptions } from './dev.js';

const panel = document.getElementById('panel');
const statusEl = document.getElementById('status');
const captionEl = document.getElementById('globe-caption');

// The address's options, read once at start (?debug: test hooks; ?preview, ?game / ?g / ?d: see the end of this file)
// The test options (?debug, ?preview, ?game=YEAR …) only on this computer or its Wi-Fi; the public site drops them (dev.js)
const { query, dropped } = addressOptions(location.search, isDevHost(location.hostname));
if (dropped) history.replaceState(null, '', location.pathname + (query.size ? `?${query}` : '') + location.hash);
const debug = query.has('debug');

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const html = (strings, ...values) => strings.reduce((out, s, i) => out + s + (i < values.length ? values[i] : ''), '');

// The landing page and the setup need only the vocabulary (a few KB) and the base map. The questions'
// data (about 3 MB) downloads in the background meanwhile and is parsed in a quiet moment, one file at a
// time, so a large parse never lands in the middle of an animation; the quiz waits for it (quizData).
// Files are found next to this script (not the page), so the same code runs here and in the published dist/ build,
// where the scripts sit in a versioned folder (tools/dist.mjs)
const here = (path) => new URL(path, import.meta.url);
const needBuild = (r) => { if (!r.ok) throw new Error('Run `npm run build` first'); return r; };
const [vocab, world] = await Promise.all([
  fetch(here('data/vocab.json')).then(needBuild).then((r) => r.json()),
  fetch(here('../node_modules/world-atlas/countries-110m.json')).then((r) => r.json()),
]);
let bundle = null;
let scenes = null;
let featureById = new Map();
const bundleText = fetch(here('data/bundle.json')).then(needBuild).then((r) => r.text());
const bordersText = fetch(here('data/borders.topo.json')).then(needBuild).then((r) => r.text());
const quizData = (async () => {
  const b = await bundleText;
  bundle = await whenQuiet(() => JSON.parse(b));
  featureById = new Map(bundle.features.map((f) => [f.id, f]));
  const t = await bordersText;
  scenes = await whenQuiet(() => createScenes(JSON.parse(t)));
})();

const startYear = Number(vocab.timeRange.start.slice(0, 4));
const endYear = Math.floor(nowDecimalYear());
let where = null; // the "Where are we?" loupe follows the globe's view
const globe = createGlobe(document.getElementById('globe'), world, {
  onView: (v) => where?.update(v),
  // The landing globe rises only up to the hero text, never into it
  heroClear: () => document.querySelector('#landing .hero')?.getBoundingClientRect().bottom ?? 0,
});
where = createWhere(document.querySelector('.globe-wrap'), globe);
// The finer coastline for the setup close-ups (prepared at build time) loads in the background and is
// taken in when nothing moves; until then the base map is drawn
fetch(here('data/detail.json')).then((r) => r.text()).then((t) => whenQuiet(() => globe.setDetail(JSON.parse(t)))).catch(() => {});
const timeline = createTimeline(document.getElementById('timeline'), startYear, endYear, {
  // Clicking a row asks that question again on the main screen
  onSelect: (row) => reask(row),
  // Phones: a short strip that opens as a sheet of tappable rows
  compact: () => isCompact() && !document.body.classList.contains('mode-result'),
});
// Phones: the result's chart is the strip grown up, zoomed to the evidence and dragged through the years (result-chart.js)
// onInfo: the phone chart closes its labels itself (a tap under it, Escape); the (i) follows
let setResultInfo = null;
const verdict = createVerdict(document.getElementById('timeline'), startYear, endYear, { onSelect: (row) => reask(row), compact: () => isCompact(), sizes: () => resultSizes, onInfo: (open) => setResultInfo?.(open), rowLine: () => isPage() });
// Phones and upright tablets: the question and answer screens as a stage with fixed places (quiz-layout.js)
const quizLayout = createQuizLayout({ layoutEl: document.querySelector('.layout'), wrap: document.querySelector('.globe-wrap'), panel, globe, timelineEl: document.getElementById('timeline'), onHeadroom: (px) => timeline.setHeadroom(px) });
// "Guess the year" (game.js): a globe from a year the app picks, with the names of that year (data/names.json)
const namesData = fetch(here('data/names.json')).then(needBuild).then((r) => r.json());
// a friend's custom globe (?d=) also needs how the border versions overlap (tools/overlaps.mjs): asked for only then
let overlapsData = null;
const overlaps = () => (overlapsData ??= fetch(here('data/overlaps.json')).then(needBuild).then((r) => r.text()).then((t) => whenQuiet(() => JSON.parse(t))));
const game = createGame({
  host: document.getElementById('game'), globe, topbar: document.querySelector('.topbar'), endYear, debug,
  load: async () => { await quizData; return { bundle, scenes, names: await namesData, optionsFor, overlaps, world }; },
  onAgain: () => transition(() => { globe.setScene(null); flow.showLanding(); }), // as the brand link does
  onInvalid: () => badLink(true),
});
/**
 * A friend's globe's link (?d=) that can't be read: the landing, with a notice at the top that says so (notice.js); the
 * address loses its ?d= so a reload doesn't say it again.
 */
function badLink(fade = false) {
  history.replaceState(null, '', location.pathname);
  const go = () => { globe.setScene(null); flow.showLanding(); };
  if (fade) transition(go); else go();
  showNotice({ title: 'This link doesn’t open a globe.', text: 'It may have been cut short on the way. Ask your friend to send it again.' });
}
// "How it works" (help.js): behind the "?" at the top bar's right end. Its figures' data is asked for only when it first opens
createHelp({
  button: document.getElementById('help-btn'), debug,
  data: async () => { await quizData; return helpData({ world, scenes, bundle, optionsFor }); },
});
// "Share" on the result: the help's kind of modal, two conversations built from the result (share-modal.js)
const shareModal = createShareModal({ debug, hold: (on) => globe.hold(on) });
/** The one-column layout, where the quiz screens are built as pieces that quiz-layout.js places. */
const staged = () => layout().kind === 'stacked';
/** Change screens: a cross-fade on wide layouts; on the stage the pieces move themselves. */
const swapScreen = (fn) => (staged() ? fn() : transition(fn));
/** The size step's desk globe, handed over to the first question (phones: it lifts off the desk into the lens). */
let arrival = null;
let lastCamera = null;
/** Puts the globe back to whatever the current screen shows (set by each screen). */
let restoreGlobe = () => {};
/** Draws the current screen again (set by each screen), to return to it after a re-ask. */
let resumeScreen = () => {};

let session = null;
let current = null; // current question
// ?debug exposes the current question and session to browser tests
if (debug) { window.__current = () => current; window.__session = () => session; }
const setup = { language: null, mapSize: 'medium', mapKind: 'globe', seed: 0 };

/** The evidence timeline: one bar per answered question, plus the most-likely window. */
function refreshTimeline() {
  timeline.update({ rows: answerRows(), window: session && answerRows().length ? likelyWindow() : null });
}

/** One row per answered question (skipped ones left out), as the timeline and the verdict draw them. */
function answerRows() {
  const rows = [];
  if (session) {
    session.history().forEach((h, i) => {
      if (h.special) return;
      const f = featureById.get(h.featureId);
      const option = optionsFor(f, session.language).find((o) => o.key === h.optionKey);
      const allowed = allowedSpans(f.id, h.optionKey, h.reply);
      rows.push({
        id: `${i}:${h.featureId}:${h.optionKey}`, index: i, featureId: h.featureId, optionKey: h.optionKey,
        subject: f.subject, question: option?.question || option?.label || '', claim: option?.claim || option?.question || '', reply: h.reply,
        spans: allowed, rangeText: rangeText(allowed),
      });
    });
  }
  return rows;
}

/**
 * The most-likely window as one or more pieces (a "no" can leave two periods), or null while it
 * still covers more than half the timeline: then nothing has been narrowed down yet.
 */
function likelyWindow() {
  const iv = session.interval(0.8);
  const pieces = [];
  for (const m of iv.months) {
    const last = pieces[pieces.length - 1];
    if (last && m === last.hi + 1) last.hi = m; else pieces.push({ lo: m, hi: m });
  }
  const months = pieces.reduce((t, p) => t + p.hi - p.lo + 1, 0);
  if (months > session.months / 2) return null;
  const segments = pieces.filter((p) => p.hi - p.lo >= 6) // ignore slivers under half a year
    .map((p) => ({ from: session.startYear + p.lo / 12, to: session.startYear + (p.hi + 1) / 12 }));
  return segments.length ? { segments, label: segments.map((g) => yearsText(g.from, g.to)).join(' or ') } : null;
}

// ---------------------------------------------------------------------------
// Setup: landing page and the guided start live in setup.js

function setMode(mode) {
  document.body.classList.remove('mode-landing', 'mode-setup', 'mode-quiz', 'mode-game', 'step-size');
  resultMode(false);
  if (mode !== 'game') game.stop();
  document.body.classList.add(`mode-${mode}`);
  if (mode !== 'quiz') { statusEl.textContent = ''; globe.setScene(null); awaiting = null; quizLayout.detach(); lastCamera = null; }
}

const flow = createSetupFlow({
  bundle: { vocab }, world, globe, panel,
  landingEl: document.getElementById('landing'),
  captionEl,
  setMode,
  onGame: () => startGame(),
  // The questions' data has almost always arrived by now; if not, the quiz starts the moment it has
  onDone: ({ from = null, ...choice }) => quizData.then(() => {
    const go = () => { Object.assign(setup, choice); arrival = staged() ? from : null; start(); };
    // On the stage the desk globe carries over into the first question: no cross-fade
    if (staged()) go(); else transition(go);
  }),
});

/** The game: the landing globe glides into its lens while the game's pieces arrive (a cross-fade on wide layouts). */
function startGame(opts = {}, { instant = false } = {}) {
  const go = () => {
    document.getElementById('landing').innerHTML = '';
    setMode('game');
    globe.setStage('panel', staged() ? { ms: 900, ease: KEYBOARD } : undefined);
    game.start(opts);
  };
  if (instant || staged()) go(); else transition(go);
}

function start() {
  setMode('quiz');
  setup.seed = Math.floor(Math.random() * 1e9);
  session = newSession();
  next();
}

const newSession = () => createSession(bundle, { language: setup.language, mapSize: setup.mapSize, seed: setup.seed });

// ---------------------------------------------------------------------------
// Questions: one picture, one question. "Does your map look like this?" Yes / No / Not sure.

let awaiting = null; // what's on screen: 'question' | 'answer' | null (Enter moves on from an answer)

const year = (t) => Math.floor(t);
const capitalise = (t) => t.charAt(0).toUpperCase() + t.slice(1);

/** The years NOT covered by these spans, between the start of the timeline and now. */
function complement(spans) {
  const out = [];
  let cursor = null; // null = the start of the timeline
  for (const { from, to } of spans) {
    if (from != null && (cursor == null || from > cursor)) out.push({ from: cursor, to: from });
    cursor = to;
    if (to == null) return out;
  }
  out.push({ from: cursor, to: null });
  return out;
}

/** "Not part of China", "Not Kiev"; a label that already says no flips: "No borders of their own" -> "Borders of their own". */
function notLabel(label, isName) {
  if (!isName && /^no /i.test(label)) return capitalise(label.slice(3));
  return `Not ${isName || /^.[A-Z]/.test(label) ? label : label.charAt(0).toLowerCase() + label.slice(1)}`;
}

/** The years an answer allows, in words: "Between 1949 and 1990", "Before 1949 or after 1990", "After 1990". */
function rangeText(spans) {
  if (spans.length === 1 && spans[0].from == null && spans[0].to == null) return 'Any year';
  return capitalise(spans.map(({ from, to }) =>
    from == null ? `before ${year(to)}` : to == null ? `after ${year(from)}` : `between ${year(from)} and ${year(to)}`).join(' or '));
}
const yearsText = (from, to) => (year(from) === year(to) ? `around ${year(from)}` : `${year(from)} – ${year(to)}`);

/**
 * The spans of years a reply allows: the picture's own years for a yes, everything else
 * for a no. When the picture is usual in every year (Abkhazia inside Georgia, with a few
 * maps showing it separate after 2008), a no leaves the years of the other pictures.
 */
function allowedSpans(featureId, optionKey, reply) {
  const spans = session.optionSpans(featureId, optionKey);
  if (reply === 'yes') return spans;
  const rest = complement(spans);
  if (rest.length) return rest;
  const others = optionsFor(featureById.get(featureId), session.language).filter((o) => o.key !== optionKey)
    .flatMap((o) => session.optionSpans(featureId, o.key));
  return union(others);
}

/** Merge overlapping or touching spans, in time order (null = open end). */
function union(spans) {
  const lo = (x) => x.from ?? -Infinity, hi = (x) => x.to ?? Infinity;
  const out = [];
  for (const sp of [...spans].sort((a, b) => lo(a) - lo(b))) {
    const last = out.at(-1);
    if (last && lo(sp) <= hi(last)) { if (hi(sp) > hi(last)) last.to = sp.to; } else out.push({ ...sp });
  }
  return out;
}

function next() {
  endRevise();
  current = session.nextQuestion();
  refreshTimeline();
  if (!current) return renderResult();
  renderQuestion();
}

/**
 * One picture, one question. With `again` (an earlier answer being changed) the screen
 * says what was answered before, and "Keep answer" returns to where the user was.
 */
function renderQuestion({ feature, option } = current, again = null) {
  resultMode(false);
  const n = again ? again.index + 1 : session.history().length + 1;
  const isName = feature.kind === 'pick_name';
  statusEl.innerHTML = `<span class="st-long">Question</span><span class="st-short" aria-hidden="true">Q</span> ${n}`;
  captionEl.textContent = '';
  globe.setScene(scenes.sceneFor(feature, option, setup.language));
  const stage = staged(), from = arrival;
  arrival = null;
  if (!again) {
    restoreGlobe = ({ duration = 1000, via = null } = {}) => {
      globe.setScene(scenes.sceneFor(feature, option, setup.language));
      globe.flyTo(feature.camera, duration, { mark: false, via });
    };
    resumeScreen = () => renderQuestion();
    if (from) {
      // The first question on a phone: the lens takes the sphere where the desk globe was drawn, turned as it was,
      // in the desk look, and becomes the lens again on its way up (the desk folds away around it meanwhile)
      globe.jumpTo(from.rot, 1);
      globe.setDesk({ look: [1], arc: [1] });
      globe.setDesk({ look: [0, 0, 450], arc: [0, 0, 350] });
      globe.flyTo(feature.camera, 1100, { mark: false, via: 'hop' });
      document.body.classList.add('quiz-arriving');
      setTimeout(() => document.body.classList.remove('quiz-arriving'), 1000);
    } else if (stage) {
      // One clue to the next: the camera hops (zooming out a little and back in); the same clue stays where it is
      if (lastCamera !== feature.camera) globe.flyTo(feature.camera, 1100, { mark: false, via: lastCamera ? 'hop' : null });
    } else globe.flyTo(feature.camera, 1400, { mark: false });
    lastCamera = feature.camera;
  }

  // The prepared question; in a name question the spelling itself is set like a map label
  const question = esc(option.question || option.label);
  const title = isName ? question.replace(esc(option.label), `<span class="q-name">${esc(option.label)}</span>`) : question;

  const clueId = esc(`${feature.id}:${option.key}`);
  if (stage) {
    // The stage's pieces (quiz-layout.js places them): the question, "What to look for" and its hint, Yes / No, the quiet row
    panel.innerHTML = html`
      <div class="q step qs" data-clue="${clueId}">
        <div class="qs-head" data-piece="head" data-id="${clueId}${again ? ':again' : ''}">
          <p class="q-context">${esc(feature.subject)}${again ? html` · <span class="q-was">You said ${again.reply === 'yes' ? 'Yes' : 'No'}</span>` : ''}</p>
          <h2 class="q-title">${title}</h2>
        </div>
        ${option.cue ? html`
          <div class="look qs-look" id="look" data-piece="look">
            <button class="look-toggle" id="look-toggle" aria-expanded="false" aria-controls="look-body">
              <span class="look-icon" aria-hidden="true"></span>What to look for
            </button>
          </div>
          <div class="qs-hint" id="look-body" data-piece="hint" data-id="${clueId}" role="region" aria-labelledby="look-toggle">
            <div class="look-inner"><p>${esc(option.cue)}</p></div>
          </div>` : ''}
        <div class="yesno" data-piece="yesno">
          <button class="yn yes" data-reply="yes">Yes</button>
          <button class="yn no" data-reply="no">No</button>
        </div>
        <div class="q-more" data-piece="row">
          <button class="btn-quiet" data-reply="unsure">Not sure</button>
          ${again ? '<button class="btn-quiet" id="keep">Keep answer</button>'
            : session.history().length ? '<button class="btn-quiet" id="undo">Back</button>' : ''}
        </div>
      </div>`;
  } else panel.innerHTML = html`
    <div class="q step">
      <div class="q-body">
      <p class="q-context">${esc(feature.subject)}${again ? html` · <span class="q-was">You said ${again.reply === 'yes' ? 'Yes' : 'No'}</span>` : ''}</p>
      <h2 class="q-title">${title}</h2>
      ${option.cue ? html`
        <div class="look" id="look">
          <button class="look-toggle" id="look-toggle" aria-expanded="false" aria-controls="look-body">
            <span class="look-icon" aria-hidden="true"></span>What to look for
          </button>
          <div class="look-body" id="look-body" role="region" aria-labelledby="look-toggle">
            <div class="look-inner"><p>${esc(option.cue)}</p></div>
          </div>
        </div>` : ''}
      </div>
      <div class="yesno">
        <button class="yn yes" data-reply="yes">Yes</button>
        <button class="yn no" data-reply="no">No</button>
      </div>
      <div class="q-more">
        <button class="btn-quiet" data-reply="unsure">Not sure</button>
        ${again ? '<button class="btn-quiet" id="keep">Keep answer</button>'
          : session.history().length ? '<button class="btn-quiet" id="undo">Back</button>' : ''}
      </div>
    </div>`;

  panel.querySelector('#look-toggle')?.addEventListener('click', (e) => {
    const open = panel.querySelector('#look').classList.toggle('open');
    e.currentTarget.setAttribute('aria-expanded', String(open));
    quizLayout.setHint(open);
  });
  panel.querySelectorAll('[data-reply]').forEach((b) => b.addEventListener('click', () => (again ? reviseReply : reply)(b.dataset.reply)));
  panel.querySelector('#undo')?.addEventListener('click', undo);
  panel.querySelector('#keep')?.addEventListener('click', keepAnswer);
  awaiting = 'question';
  quizLayout.show({ fromDesk: from?.box ?? null });
}

// ---------------------------------------------------------------------------
// Changing an earlier answer: the question comes back on the main screen (the globe pulls
// out to the whole earth and swoops into that clue), then the app carries on as normal.

let revising = null; // { index, reply, rowId, feature, option } while an earlier question is back on screen

function reask(row) {
  if (!session) return;
  const feature = featureById.get(row.featureId);
  const option = optionsFor(feature, session.language).find((o) => o.key === row.optionKey);
  if (!option) return;
  if (revising?.rowId === row.id) return;
  revising = { index: row.index, reply: row.reply, rowId: row.id, row, feature, option };
  timeline.select(row.id);
  if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: 'smooth' }); // phones: the question is above the timeline
  swapScreen(() => renderQuestion({ feature, option }, revising));
  globe.flyTo(feature.camera, 2200, { mark: false, via: 'earth' });
  lastCamera = feature.camera;
}

function endRevise() {
  if (!revising) return;
  revising = null;
  timeline.select(null);
}

/** "Keep answer": back to the screen the user came from, the same way they left it. */
function keepAnswer() {
  endRevise();
  swapScreen(() => resumeScreen());
  restoreGlobe({ duration: 2200, via: 'earth' });
  lastCamera = current?.feature?.camera ?? null;
}

function reviseReply(answer) {
  const { index, reply: before, row, feature, option } = revising;
  if (answer === before) return keepAnswer();
  endRevise();
  session.revise(index, answer);
  refreshTimeline();
  // Not sure removes the answer: carry on with the best next question
  if (answer === 'unsure') return swapScreen(next);
  swapScreen(() => renderAnswer(feature, option, answer, null, { onBack: () => reask({ ...row, reply: answer }) }));
}

function reply(answer) {
  const { feature, option } = current;
  const result = session.reply(feature.id, option.key, answer);
  refreshTimeline();
  if (answer === 'unsure') return next();
  renderAnswer(feature, option, answer, result);
}

/**
 * The answer screen: the years an answer leaves, and the story of the change.
 * Back undoes the answer; after a changed answer it opens that question again instead.
 */
function renderAnswer(feature, option, answer, result = null, { onBack = undo } = {}) {
  resultMode(false);
  const isName = feature.kind === 'pick_name';
  resumeScreen = () => renderAnswer(feature, option, answer, result, { onBack });
  restoreGlobe = ({ duration = 1000, via = null } = {}) => {
    globe.setScene(scenes.sceneFor(feature, option, setup.language));
    globe.flyTo(feature.camera, duration, { mark: false, via });
  };
  const misfit = result?.contradiction
    ? '<p class="a-misfit">That doesn\'t quite fit your other answers. Maybe a reprint, or a sticker on the map.</p>' : '';

  // Yes or no, every answer teaches something: the years it leaves, and the story of the change
  const range = rangeText(allowedSpans(feature.id, option.key, answer));
  // A yes tells the change that brought this picture; a no, the change away from it.
  // A picture usual in every year has no change of its own: a no borrows the other pictures'.
  let cards = session.explain(feature.id, option.key);
  if (!cards.length && answer === 'no') {
    cards = optionsFor(feature, session.language).filter((o) => o.key !== option.key).flatMap((o) => session.explain(feature.id, o.key));
  }
  const story = cards.find((c) => c.relation === (answer === 'no' ? 'out-of' : 'into')) ?? cards[0];
  const clueId = esc(`${feature.id}:${option.key}`);
  if (staged()) {
    // The stage's pieces: the kicker and the years (beside the medallion on a phone), the story, Next and Back
    panel.innerHTML = html`
      <div class="a step as" data-clue="${clueId}">
        <div class="as-head" data-piece="ahead" data-id="${clueId}:${answer}">
          <p class="a-kicker">${esc(feature.subject)} · ${esc(answer === 'yes' ? option.label : notLabel(option.label, isName))}</p>
          <div class="a-years">${esc(range)}</div>
        </div>
        <div class="as-story" data-piece="story" data-id="${clueId}:${answer}">
          ${misfit}
          ${story ? html`
            <p class="a-when">${esc(story.dateLabel)}</p>
            <p class="a-story">${esc(story.funFact)}</p>
            ${story.source ? html`<a class="a-source" href="${esc(story.source.url)}" target="_blank" rel="noopener">${esc(story.source.title)}</a>` : ''}` : ''}
        </div>
        <div class="actions" data-piece="acts">
          <button class="btn" id="next">Next <span aria-hidden="true">→</span></button>
          <button class="btn-quiet" id="undo">Back</button>
        </div>
      </div>`;
  } else panel.innerHTML = html`
    <div class="a step">
      <div class="a-body">
      <p class="a-kicker">${esc(feature.subject)} · ${esc(answer === 'yes' ? option.label : notLabel(option.label, isName))}</p>
      <div class="a-years">${esc(range)}</div>
      ${misfit}
      ${story ? html`
        <p class="a-when">${esc(story.dateLabel)}</p>
        <p class="a-story">${esc(story.funFact)}</p>
        ${story.source ? html`<a class="a-source" href="${esc(story.source.url)}" target="_blank" rel="noopener">${esc(story.source.title)}</a>` : ''}` : ''}
      </div>
      <div class="actions">
        <button class="btn" id="next">Next <span aria-hidden="true">→</span></button>
        <button class="btn-quiet" id="undo">Back</button>
      </div>
    </div>`;
  panel.querySelector('#next').addEventListener('click', next);
  panel.querySelector('#undo').addEventListener('click', onBack);
  panel.querySelector('#next').focus({ preventScroll: true });
  awaiting = 'answer';
  quizLayout.show();
}

function undo() {
  session.undo();
  next();
}

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, select, textarea')) return;
  if (revising && e.key === 'Escape') { e.preventDefault(); keepAnswer(); return; }
  if (awaiting === 'answer' && e.key === 'Enter' && !e.target.closest?.('button, a')) { e.preventDefault(); awaiting = null; next(); }
});

// ---------------------------------------------------------------------------
// Result

// The step into the result, in beats (ms from the click). First the page pulls back (the old
// screen fades, the globe zooms out to the whole earth and shrinks into its medallion). Then
// the evidence: the chart replays the answers one by one, and the year above it is the guess so
// far, in faint ink: it starts at the first year and rolls to the curve's peak as each answer
// lands, while the globe redraws the world of that year. Last, the verdict: as the brass window
// opens in the chart, the year settles, turns brass, and the range and buttons follow. A click
// or a key during the replay jumps to the verdict.
const BEAT = { reshape: 350, year: 1000, chart: 1250, stepRoll: 900, landRoll: 700, legend: 1100 };
let resultRun = 0; // bumps on every renderResult, so a stale beat never fires on a newer screen
let resultCompact = false; // whether the result on screen was drawn for a phone
let resultSizes = null;    // an upright tablet's chart sizes (placeResultPage); verdict.js draws with them
let resultAgree = false;   // whether the chart keeps room under its axis for the agreement's months

function renderResult() {
  awaiting = null;
  resultCompact = isCompact();
  lastCamera = null; // the result shows the whole earth: going back flies to the clue again
  resumeScreen = renderResult;
  const run = ++resultRun;
  const live = () => run === resultRun && resumeScreen === renderResult;
  const s = session.summary();
  const rows = answerRows();
  const answered = rows.length > 0;
  // One most likely year: the calendar year holding the most belief
  const peak = answered ? peakYear(session.yearDensity()) : null;
  // The world as it was in the most likely year, in a small medallion beside the verdict
  restoreGlobe = () => { globe.reset(); globe.setScene(answered ? scenes.worldAt(peak + 0.5) : null); };

  if (!answered) {
    quizLayout.detach();
    statusEl.textContent = '';
    restoreGlobe();
    captionEl.textContent = '';
    panel.innerHTML = html`
      <div class="result step">
        <h2 class="step-title">Not enough to go on yet.</h2>
        <div class="actions"><button class="btn" id="again">Start over</button></div>
      </div>`;
    panel.querySelector('#again').addEventListener('click', () => transition(() => { endRevise(); session = null; globe.setScene(null); refreshTimeline(); flow.restart(); }));
    return;
  }

  const win = { from: s.likely.from, to: s.likely.to };
  const agree = agreement(rows, { startYear, until: endYear + 1, mode: s.mode, transitions: (id) => featureById.get(id).transitions });
  // Played once per set of answers; coming back to the result shows it settled
  resultAgree = !!agree;
  const key = rows.map((r) => `${r.featureId}:${r.optionKey}:${r.reply}`).join('|');
  const play = key !== lastVerdictKey;
  lastVerdictKey = key;
  const frames = replayFrames();
  const wasResult = document.body.classList.contains('mode-result');
  const choreograph = play && !wasResult && !matchMedia('(prefers-reduced-motion: reduce)').matches;

  const range = `${year(win.from)} – ${year(win.to)}`;
  const mount = () => {
    quizLayout.detach();
    panel.innerHTML = html`
      <div class="vd-panel ${choreograph ? 'is-arriving' : ''}">
        <div class="vd-main">
          <p class="a-kicker">Your map was most likely printed in</p>
          <div class="vd-years">${odometerHTML(peak)}</div>
          <p class="vd-range"><span class="vd-range-k">Likely range</span> <span class="vd-range-v">${range}</span><button class="vd-info-btn" id="info-btn" aria-expanded="false" aria-controls="vd-info" title="Reading the chart"><span aria-hidden="true">i</span><span class="vd-sr">Reading the chart</span></button></p>
          ${s.contradictions.length ? '<p class="a-misfit">Some answers disagree. Old maps were sometimes patched with stickers or reprinted from older plates.</p>' : ''}
          <div class="actions">
            <button class="btn" id="again">Play again</button>
            <button class="btn-share" id="share" type="button" aria-haspopup="dialog" aria-expanded="false">${SHARE_ICON}<span>Share</span></button>
          </div>
        </div>
        <aside class="vd-info" id="vd-info" aria-label="Reading the chart">
          <div class="vd-info-head"><p class="vd-info-title">Reading the chart</p><button type="button" class="vd-info-done" id="info-done">Done</button></div>
          ${infoItem('curve', 'brass', 'Most likely', peak, 'How likely each year is; the peak is our best guess.')}
          ${infoItem('band', 'brass', 'Likely range', range, "We're 80% sure your map was printed in these years.")}
          ${agree ? infoItem('agree', '', agree.count === agree.n ? `All ${agree.n} answers agree` : `${agree.count} of ${agree.n} answers agree`, agree.rangeText,
            `The months that fit ${agree.count === agree.n ? 'every answer' : 'the most answers'}. Maps lag behind the world, so the print date is usually a bit later.`) : ''}
        </aside>
      </div>`;
    panel.querySelector('#again').addEventListener('click', () => transition(() => { endRevise(); session = null; globe.setScene(null); refreshTimeline(); flow.restart(); }));
    // Share (every size) opens the modal, with both conversations built from this result (share-modal.js)
    const shareBtn = panel.querySelector('#share');
    shareBtn.addEventListener('click', () => shareModal.open(shareData(shareBtn)));
    // The info button opens "Reading the chart" and draws where the answers agree into the timeline
    const vp = panel.querySelector('.vd-panel'), btn = panel.querySelector('#info-btn');
    // Phones: no sheet; the chart names its own parts in place (result-chart.js showInfo)
    const setInfo = (open) => { vp.classList.toggle('info-open', open); btn.setAttribute('aria-expanded', String(open)); verdict.showAgree(open); fitBand(); };
    setResultInfo = (open) => { if (vp.isConnected) setInfo(open); };
    // Wide windows: open from the start (the choreographed arrival keeps it closed and reveals it as
    // its last beat). Smaller screens keep the chart clear: the legend is a sheet behind the i.
    setInfo(!choreograph && (isWide() || isPage())); // an upright tablet has the room too: the legend sits under the chart
    btn.addEventListener('click', (e) => { e.stopPropagation(); endInfoReveal(); setInfo(!vp.classList.contains('info-open')); });
    panel.querySelector('#info-done').addEventListener('click', () => { setInfo(false); btn.focus({ preventScroll: true }); });
    // As a sheet, a tap anywhere outside it folds it away; on a phone, a tap outside the chart and its labels
    const outside = (e) => {
      if (!vp.isConnected) return removeEventListener('pointerdown', outside, true);
      if (!isWide() && !isPage() && vp.classList.contains('info-open') && !e.target.closest(isCompact() ? '.rc, .vd-info-btn' : '.vd-info, .vd-info-btn')) setInfo(false);
    };
    addEventListener('pointerdown', outside, true);
    vp.addEventListener('keydown', (e) => { if (e.key === 'Escape' && vp.classList.contains('info-open')) { setInfo(false); btn.focus(); } });
    // On a phone the labels live in the chart, outside the panel: Escape closes them from anywhere
    const escape = (e) => {
      if (!vp.isConnected) return removeEventListener('keydown', escape);
      if (e.key === 'Escape' && isCompact() && vp.classList.contains('info-open') && !vp.contains(e.target)) setInfo(false);
    };
    addEventListener('keydown', escape);
    for (const item of panel.querySelectorAll('.vd-info-item')) {
      item.addEventListener('pointerenter', () => verdict.emphasize(item.dataset.part));
      item.addEventListener('pointerleave', () => verdict.emphasize(null));
    }
    return vp;
  };
  const show = () => verdict.show({ rows, frames, window: win, agree, peak }, { animate: play });
  // What the share messages are built from: the year and range, the months the answers agree on and three things the
  // globe shows (share-logic.js shareFacts); and the sender's own globe as a game: the answers, the most likely year and
  // the years every answer agrees on, in a link (custom-globe.js), the same for the same answers
  const sent = answersFrom(rows, featureById, optionsFor, session.language);
  const dated = sent.length ? writeLink({ base: peak, agree: agreeYears(agree, startYear, endYear), language: session.language, answers: sent }) : null;
  const shareData = (button) => ({ button, key, peak, from: year(win.from), to: year(win.to), dated,
    agreeText: agree?.rangeText, allAgree: !!agree && agree.count === agree.n, facts: shareFacts(rows, peak, featureById, session.language) });

  if (!choreograph) {
    statusEl.textContent = '';
    restoreGlobe();
    setOdometer(mount().querySelector('.odo'), peak);
    resultMode(true);
    placeResultHeader();
    show();
    setTimeout(() => live() && fitBand(), 900); // once the page has settled into the result layout
    return;
  }

  // 1. Pull back: the answer screen (and the question count) fade while the globe zooms out, then the page reshapes.
  // Phones rebuild nothing mid-move: the answer fades where it is (copies), the medallion glides into its place,
  // and the chart grows out of the strip it was (result-chart.js), so the page takes its result layout at once.
  captionEl.textContent = '';
  const phone = isCompact();
  let handoff = null;
  if (phone) {
    handoff = { lens: document.querySelector('.globe-wrap').getBoundingClientRect(), strip: timeline.snapshot(), segs: likelyWindow()?.segments ?? [] };
    const pieces = panel.querySelectorAll('.step [data-piece]'); // the stage's pieces; on its side, the whole answer
    ghostOut(pieces.length ? pieces : panel.querySelectorAll('.step'), { ms: 180, dy: 0 });
  } else {
    panel.classList.add('is-leaving');
    statusEl.classList.add('is-leaving');
  }
  const reshape = phone ? 0 : BEAT.reshape, chartAt = phone ? 0 : BEAT.chart;
  // The guess after each answer: the year the replay's curve peaks at, step by step. The globe
  // goes straight from the clue to the world of the first guess (the answer's world would give it away)
  const guesses = frames.map((f) => peakYear(f.density));
  globe.reset();
  globe.setScene(scenes.worldAt(guesses[0] + 0.5));
  const later = (fn) => (phone ? fn() : setTimeout(fn, BEAT.reshape));
  later(() => {
    statusEl.classList.remove('is-leaving');
    if (!live()) return;
    statusEl.textContent = '';
    panel.classList.remove('is-leaving');
    // An upright tablet: the globe glides from the answer's place to the head of the chart (the page is rebuilt at once)
    const pageLens = isPage() ? document.querySelector('.globe-wrap').getBoundingClientRect() : null;
    const el = mount(), odo = el.querySelector('.odo');
    setOdometer(odo, guesses[0]);
    resultMode(true);
    placeResultHeader(); // before the chart measures where it grows to
    if (handoff) globe.lensFrom(handoff.lens, { ms: 440, ease: KEYBOARD });
    else if (pageLens && document.body.classList.contains('res-page')) globe.lensFrom(pageLens, { ms: 600, ease: KEYBOARD });
    el.classList.add('is-weighing');
    // 2. The evidence: the question and the year so far, then the replay drives both
    setTimeout(() => live() && el.classList.add('show-kicker', 'show-year'), BEAT.year - reshape);
    let skipped = false;
    // The press that skips does only that: its click (on a row, say) and its key go no further
    const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
    const skip = (e) => {
      if (e.type === 'keydown' && ['Shift', 'Control', 'Alt', 'Meta', 'Tab'].includes(e.key)) return;
      if (e.target.closest?.('.topbar')) return; // the brand and the top bar keep working as usual
      swallow(e);
      if (e.type === 'pointerdown') {
        addEventListener('click', swallow, { capture: true, once: true });
        setTimeout(() => removeEventListener('click', swallow, { capture: true }), 500); // a press that never became a click
      }
      skipped = true; endSkip(); verdict.skip();
    };
    const endSkip = () => { removeEventListener('pointerdown', skip, true); removeEventListener('keydown', skip, true); endReplaySkip = null; };
    const step = (k) => {
      if (!live()) return;
      const guess = guesses[k + 1];
      if (guess !== odo.__target) { odo.__target = guess; rollOdometer(odo, null, guess, BEAT.stepRoll); globe.setScene(scenes.worldAt(guess + 0.5)); }
    };
    // 3. The verdict: the year settles on the answer and turns brass; the rest follows it
    const land = async () => {
      endSkip();
      if (!live()) return;
      globe.setScene(scenes.worldAt(peak + 0.5));
      el.classList.add('show-kicker', 'show-year');
      // Already on the answer (usual after the last few answers): it turns brass the moment the window opens
      const there = skipped || odo.__target === peak || odo.__value === peak;
      const landed = there ? (setOdometer(odo, peak), odo.__roll++, true) : await rollOdometer(odo, null, peak, BEAT.landRoll);
      if (!landed || !live()) return;
      el.classList.remove('is-weighing');
      el.classList.add('landed');
      // Phones: the footnote under the chart is the last beat, once the buttons have settled (.55 s delay + .6 s)
      verdict.revealFoot(1150);
      // 4. The legend: once the range and buttons have settled, "Reading the chart" opens beside them
      // (wide windows only: on a phone it would cover the chart it explains)
      setTimeout(() => live() && (isWide() || isPage()) && revealInfo(el), BEAT.legend);
    };
    // On a phone the chart's own clock starts now (its replay keeps these beats); elsewhere it starts here
    const startChart = () => {
      if (!live()) return;
      addEventListener('pointerdown', skip, true);
      addEventListener('keydown', skip, true);
      endReplaySkip = endSkip;
      verdict.show({ rows, frames, window: win, agree, peak }, { animate: true, from: handoff && { strip: handoff.strip, segs: handoff.segs }, onStep: step, onVerdict: land });
    };
    if (phone) startChart(); else setTimeout(startChart, chartAt - reshape);
  });
}

/** The keyboard's curve, cubic-bezier(.2, .8, .2, 1): the medallion's glide into the result. */
function KEYBOARD(t) {
  const B = (a, b, s) => 3 * (1 - s) * (1 - s) * s * a + 3 * (1 - s) * s * s * b + s * s * s;
  if (t <= 0) return 0; if (t >= 1) return 1;
  let lo = 0, hi = 1, s = t;
  for (let i = 0; i < 20; i++) { if (B(0.2, 0.2, s) < t) lo = s; else hi = s; s = (lo + hi) / 2; }
  return B(0.8, 1, s);
}

/**
 * The legend's entrance, the last beat of the result: a hairline draws down, the title arrives,
 * then each line in turn, its little drawing wiping in while its part of the chart lights up
 * (the curve, then the window); the agreement column opens from its middle with the last line.
 */
const LEGEND_STEP = { first: 380, gap: 420, hold: 900 };
let infoRevealTimers = [];
function endInfoReveal() {
  infoRevealTimers.forEach(clearTimeout);
  infoRevealTimers = [];
  panel.querySelector('.vd-panel')?.classList.remove('info-reveal');
  verdict.emphasize(null);
}
function revealInfo(vp) {
  endInfoReveal();
  const btn = vp.querySelector('#info-btn');
  vp.classList.add('info-reveal', 'info-open');
  btn.setAttribute('aria-expanded', 'true');
  fitBand();
  const at = (ms, fn) => infoRevealTimers.push(setTimeout(() => { if (vp.isConnected) fn(); }, ms));
  const items = [...vp.querySelectorAll('.vd-info-item')];
  items.forEach((item, i) => {
    const t = LEGEND_STEP.first + i * LEGEND_STEP.gap;
    const part = item.dataset.part;
    item.style.setProperty('--reveal-at', `${t}ms`); // the line rises as its part of the chart lights up
    at(t, () => {
      if (part === 'agree') verdict.showAgree(true);
      verdict.emphasize(part, { slow: true });
    });
  });
  const end = LEGEND_STEP.first + items.length * LEGEND_STEP.gap + LEGEND_STEP.hold;
  at(end - LEGEND_STEP.hold + 300, () => verdict.emphasize(null, { slow: true }));
  at(end, () => { vp.classList.remove('info-reveal'); verdict.emphasize(null); infoRevealTimers = []; });
}

/** Tiny drawings of the chart's parts, for the "Reading the chart" legend. */
const SWATCH = {
  curve: '<path d="M1 13C8 13 9 2 13 2s5 11 12 11" fill="var(--brass)" fill-opacity=".25" stroke="var(--brass)" stroke-width="1.5"/>',
  band: '<rect x="7" y="1" width="12" height="12" fill="var(--brass)" fill-opacity=".18"/><path d="M7 1v12M19 1v12" stroke="var(--brass)" stroke-dasharray="2 2"/>',
  agree: '<rect x="9" y="0" width="8" height="14" fill="var(--ink)" fill-opacity=".07"/><path d="M9 0v14M17 0v14" stroke="var(--ink)" stroke-opacity=".5"/>'
    + '<rect x="1" y="5" width="24" height="4" rx="2" fill="var(--ink)" fill-opacity=".35"/><rect x="9" y="5" width="8" height="4" fill="var(--ink)"/>',
};

/** One line of the legend: the chart part's drawing, its name and value, and a sentence on what it means. */
function infoItem(part, tone, name, value, text) {
  return html`<div class="vd-info-item" data-part="${part}"><svg class="vd-sw" viewBox="0 0 26 14" aria-hidden="true">${SWATCH[part]}</svg>
    <div><p class="vd-info-k ${tone}">${esc(name)} <b>${esc(String(value))}</b></p><p>${esc(text)}</p></div></div>`;
}

/** The calendar year with the most belief. */
function peakYear(density) {
  return density.reduce((best, d) => (d.p > best.p ? d : best)).year;
}

let lastVerdictKey = null;
let endReplaySkip = null; // drops the replay's click-to-skip listeners when the result is left mid-replay


/** Result layout on or off: the chart takes over the timeline's place and most of the page. */
function resultMode(on) {
  document.body.classList.toggle('mode-result', on);
  document.getElementById('timeline').classList.toggle('is-verdict', on);
  if (on) fitBand();
  else { endInfoReveal(); endReplaySkip?.(); verdict.hide(); captionEl.textContent = ''; document.body.style.removeProperty('--res-h'); placeResultHeader(); setResultInfo = null; }
}

/**
 * Size the result's band: one height whether the legend is open or not, so the chart under it
 * never jumps. Only an open legend that is taller than the band (a narrow window wraps its
 * lines) makes it grow. Measured with the legend open only: while the page reshapes into the
 * result the columns are still narrow, and the verdict would measure too tall.
 */
/**
 * The result's header on an upright phone: the globe medallion takes the answer screen's place and size
 * (quiz-layout.js medallionSlot), so stepping from the last answer into the result moves nothing. The words
 * start 12 px right of the circle, centred on its ring as the answer centres its head; the kicker is always
 * one line (13 px where it fits, else just small enough, measured here because iOS's font is wider). The
 * chart starts 28 + 16 / 22 + 12 / 16 + 8 px under the header.
 */
function placeResultHeader() {
  placeResultPage();
  const body = document.body, vp = panel.querySelector('.vd-panel'), layoutEl = document.querySelector('.layout');
  const on = body.classList.contains('mode-result') && !!vp && layout().kind === 'stacked' && isCompact();
  body.classList.toggle('res-phone', on);
  const props = ['--rh-gx', '--rh-gy', '--rh-gd', '--rh-tx', '--rh-ty', '--rh-tw', '--rh-h', '--rh-gap'];
  if (!on) { for (const p of props) body.style.removeProperty(p); body.classList.remove('res-stack', 'res-snug'); vp?.querySelector('.vd-main > .a-kicker')?.style.removeProperty('font-size'); return; }
  const vh = innerHeight, width = layoutEl.clientWidth;
  const { x0, qY, med } = medallionSlot(width, vh);
  const tx = x0 + med + 12, tw = width - x0 - tx;
  const set = (p, v) => body.style.setProperty(p, `${v}px`);
  set('--rh-gx', x0 - 8); set('--rh-gy', qY - 8); set('--rh-gd', med + 16); set('--rh-tx', tx); set('--rh-tw', tw);
  // One line: the words' own width, measured at each size tried (text doesn't scale exactly with its size)
  const kicker = vp.querySelector('.vd-main > .a-kicker');
  const r = document.createRange(); r.selectNodeContents(kicker);
  const widthAt = (px) => { kicker.style.fontSize = `${px}px`; return r.getBoundingClientRect().width; };
  let px = 13, w = widthAt(px);
  for (let i = 0; i < 4 && w > tw; i++) { px = Math.floor(((px * tw) / w) * 10) / 10; w = widthAt(px); }
  while (w > tw && px > 9) w = widthAt((px = Math.round((px - 0.1) * 10) / 10));
  // The words' block (kicker to range, or the misfit note), centred on the medallion; layout boxes, not transforms
  const parts = [...vp.querySelector('.vd-main').children].filter((el) => !el.matches('.actions'));
  const first = parts[0], last = parts.at(-1);
  const textH = last.offsetTop + last.offsetHeight - first.offsetTop;
  set('--rh-ty', qY + (med - textH) / 2 - first.offsetTop);
  const rhH = Math.max(qY + med, qY + (med + textH) / 2);
  set('--rh-h', rhH);
  // Three parts: the header, the timeline (a fixed block: the peak's year to the caption line under the axis) and
  // the buttons, with one gap above the timeline and the same gap below it, ink to ink (the header's ink: the lower of
  // the medallion's ring and the range line). The buttons stack only where both gaps stay at least 24 px.
  const D = chartDims(vh), n = session ? answerRows().length : 0;
  const block = D.curveH + Math.min(n, D.maxRows) * D.pitch + D.caption;
  const acts = vp.querySelector('.vd-main > .actions'), primaryH = acts.querySelector('#again').offsetHeight;
  const actsRow = innerHeight - parseFloat(getComputedStyle(acts).bottom) - primaryH;
  const top = layoutEl.getBoundingClientRect().top, ink = top + Math.max(qY + med + 1, qY + (med + textH) / 2); // the ring ends 1 px under the medallion slot
  const stack = (actsRow - ink - block - STACK) / 2 >= 24;
  body.classList.toggle('res-stack', stack);
  // In one row the two buttons split the width 50/50; where a half can't hold "Play again" with 12 px a side
  // (a 320 px phone) both labels step down a little (style.css res-snug)
  const lr = document.createRange(); lr.selectNodeContents(acts.querySelector('#again'));
  body.classList.toggle('res-snug', !stack && (acts.clientWidth - 10) / 2 < lr.getBoundingClientRect().width + 24);
  const gap =Math.max(8, (actsRow - (stack ? STACK : 0) - ink - block) / 2);
  set('--rh-gap', ink + gap - 2 - (top + rhH)); // the block's ink starts 2 px into the chart (the peak's year)
}
const STACK = 54 + 10; // Share (54 px, as tall as the primary) over it, 10 px apart

/**
 * The result on an upright tablet: the globe and the year stand on the chart's own left edge (its first year), and the
 * chart is as tall as its rows. The spare height is handed out in order: the rows (30 to 44 px), the curve (130 to
 * 200), the globe (200 to 280), the two gaps (32 to 48); what is still left sits above (40%) and below. More answers
 * than fit at 30 px scroll inside the rows. "Reading the chart" is part of the page, not a sheet: the laptop's legend,
 * under the chart, with its room kept whether it is open or not. The legend and the buttons span the page on the top
 * bar's margins (UI round 54).
 */
function placeResultPage() {
  const body = document.body, vp = panel.querySelector('.vd-panel');
  const on = body.classList.contains('mode-result') && !!vp && isPage();
  body.classList.toggle('res-page', on);
  const props = ['--rp-top', '--rp-g', '--rp-gx', '--rp-tx', '--rp-ty', '--rp-chart', '--rp-gap', '--rp-ax', '--rp-aw', '--rp-ay', '--rp-iy'];
  if (!on) {
    for (const p of props) body.style.removeProperty(p);
    vp?.querySelectorAll('.vd-info-item p').forEach((p) => p.style.removeProperty('font-size')); // fitLegendLines is for this layout only
    resultSizes = null; return;
  }
  const set = (p, v) => body.style.setProperty(p, `${Math.round(v * 10) / 10}px`);
  const cs = getComputedStyle(body), box = body.getBoundingClientRect();
  const padL = parseFloat(cs.paddingLeft) || 0, width = box.width - padL - (parseFloat(cs.paddingRight) || 0);
  const navB = document.querySelector('.topbar').getBoundingClientRect().bottom, floor = box.bottom - (parseFloat(cs.paddingBottom) || 0);
  const n = Math.max(1, session ? answerRows().length : 1), axisH = resultAgree ? 50 : 24, BTN = vp.querySelector('.vd-main > .actions')?.offsetHeight || 60;
  const gutter = width - 28 < 640 ? 30 : GUTTER; // verdict.js: a narrow chart has no label column
  const edge = 14 + gutter;                       // the chart's first year, from the page's left edge
  // The legend and the buttons run across the page, on the top bar's side margins (20 px)
  const bar = getComputedStyle(document.querySelector('.topbar')), mL = parseFloat(bar.paddingLeft) || 20, mR = parseFloat(bar.paddingRight) || 20;
  set('--rp-ax', padL + mL); set('--rp-aw', width - mL - mR);
  // The legend at that width (no sentence ending on a word alone): its height is kept under the chart, 24 px below the axis
  const info = vp.querySelector('.vd-info');
  if (info) fitLegendLines(info);
  const LEGEND = info ? info.offsetHeight + 24 : 0;
  const avail = floor - 14 - navB - LEGEND;
  const shown = Math.min(n, Math.max(3, Math.floor((avail - (20 + 200 + 64 + 130 + axisH + BTN)) / 30)));
  let rowH = 30, curveH = 130, g = 200, gap = 32;
  let slack = avail - (20 + g + gap + curveH + shown * rowH + axisH + gap + BTN);
  const give = (max) => { const v = Math.min(Math.max(slack, 0), max); slack -= v; return v; };
  rowH = Math.floor(rowH + give(shown * 14) / shown); curveH = Math.round(curveH + give(70)); g = Math.round(g + give(80)); gap = Math.round(gap + give(32) / 2);
  slack = Math.max(0, avail - (20 + g + gap + curveH + shown * rowH + axisH + gap + BTN));
  const chartH = curveH + shown * rowH + axisH, top = 20 + slack * 0.4;
  resultSizes = { curveH, rowH };
  set('--rp-top', top); set('--rp-g', g); set('--rp-gx', edge - 8); set('--rp-tx', edge + g + 12);
  set('--rp-chart', chartH); set('--rp-gap', gap);
  set('--rp-iy', navB + top + g + gap + chartH + 24); set('--rp-ay', navB + top + g + gap + chartH + LEGEND + gap);
  // The words (kicker to range, or the misfit note), centred on the globe
  const parts = [...vp.querySelector('.vd-main').children].filter((el) => !el.matches('.actions'));
  const first = parts[0], last = parts.at(-1);
  set('--rp-ty', (g - (last.offsetTop + last.offsetHeight - first.offsetTop)) / 2 - first.offsetTop);
}
/**
 * A legend sentence whose last line would hold one word alone ("later.") steps its type down a little, 0.1 px at a
 * time and at most 1 px (14 → 13), until the word joins the line above. If even that doesn't do it, it keeps its size.
 */
function fitLegendLines(info) {
  for (const p of info.querySelectorAll('.vd-info-item p:not(.vd-info-k)')) {
    p.style.removeProperty('font-size');
    if (!aloneOnLastLine(p)) continue;
    const base = parseFloat(getComputedStyle(p).fontSize);
    let px = base;
    while (px > base - 1 + 1e-6 && aloneOnLastLine(p)) { px = Math.round((px - 0.1) * 10) / 10; p.style.fontSize = `${px}px`; }
    if (aloneOnLastLine(p)) p.style.removeProperty('font-size');
  }
}
function aloneOnLastLine(p) {
  const t = p.lastChild;
  if (!t || t.nodeType !== Node.TEXT_NODE) return false;
  const text = t.textContent.trimEnd(), i = text.lastIndexOf(' ');
  if (i < 0) return false;
  const r = document.createRange(); r.setStart(t, i + 1); r.setEnd(t, text.length);
  const word = r.getBoundingClientRect(), box = p.getBoundingClientRect();
  return word.top > box.top + 1 && word.left - box.left < 1; // on a line below the first, at its very start
}
/** iOS's share mark, drawn like the size step's icons (18 px, 1.6 px line). */
const SHARE_ICON = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2v9.5M5.8 5 9 1.9 12.2 5M6.5 7.5H4.5v8.5h9V7.5h-2"/></svg>';
addEventListener('resize', () => { if (document.body.classList.contains('res-phone') || document.body.classList.contains('res-page') || isCompact() || isPage()) placeResultHeader(); });
document.fonts?.ready.then(() => placeResultHeader());

const BAND = 312;
function fitBand() {
  const body = document.body, vp = panel.querySelector('.vd-panel');
  if (!body.classList.contains('mode-result') || !vp || !isWide()) { body.style.removeProperty('--res-h'); return; }
  const open = vp.classList.contains('info-open');
  body.style.setProperty('--res-h', `${open ? Math.max(BAND, vp.offsetHeight + 34 + 18) : BAND}px`);
}
addEventListener('resize', fitBand);
// Turning a phone or resizing across layouts: fold away sheets that belong to the other layout
onLayout(() => {
  timeline.close(); fitBand();
  // The question and answer screens are built differently on the stage: build the one on screen again
  if (awaiting && !document.body.classList.contains('mode-result')) resumeScreen();
  // The result is drawn differently on phones: settled, in the new form
  if (document.body.classList.contains('mode-result') && resumeScreen === renderResult && resultCompact !== isCompact()) renderResult();
});

/** The belief before any answer, then after each answer, by replaying the session from scratch. */
function replayFrames() {
  const replay = createSession(bundle, session.config);
  const frame = () => { const iv = replay.interval(0.8); return { density: replay.yearDensity(), from: iv.from, to: iv.to }; };
  const frames = [frame()];
  for (const h of session.history()) {
    if (h.special) { replay.answer(h.featureId, h.optionKey); continue; }
    replay.reply(h.featureId, h.optionKey, h.reply);
    frames.push(frame());
  }
  return frames;
}

document.getElementById('home').addEventListener('click', () => transition(() => { endRevise(); session = null; globe.setScene(null); refreshTimeline(); flow.showLanding(); }));
// Researcher preview of one state's picture: ?preview=<feature-id>/<state-id>&lang=nl
// and of the result for a map printed in a given year: ?preview=result@1895
const preview = query.get('preview');
const previewYear = Number(/^result@(\d{4})$/.exec(preview ?? '')?.[1]);
if (previewYear) {
  await quizData;
  setMode('quiz');
  session = createSession(bundle, { language: 'en', mapSize: 'large' });
  setup.language = 'en';
  // Answer every question as such a map would look (the likelier reading, no misreads)
  for (let q; (q = session.nextQuestion());) {
    const ps = stateProbabilities(q.feature, previewYear + 0.5);
    session.reply(q.feature.id, q.option.key, q.option.members.reduce((a, m) => a + ps[m.state], 0) > 0.5 ? 'yes' : 'no');
  }
  refreshTimeline();
  renderResult();
} else if (preview) {
  await quizData;
  const [fid, rest = ''] = preview.split('/');
  const [sid, dep] = rest.split(':');
  const feature = bundle.features.find((f) => f.id === fid);
  const lang = query.get('lang') ?? 'en';
  const options = feature && optionsFor(feature, lang);
  const option = options?.find((o) => o.members.some((m) => feature.states[m.state].id === sid
    && (!dep || feature.states[m.state].depictions[m.depiction]?.id === dep))) ?? options?.[0];
  if (!option) throw new Error(`No such feature/state: ${preview}`);
  setMode('quiz');
  session = createSession(bundle, { language: lang, mapSize: 'large' });
  current = { feature, option, options };
  setup.language = lang;
  renderQuestion();
} else if (['game', 'g', 'd'].some((k) => query.has(k))) {
  // Straight into the game: ?game (a random year), ?game=1929 (that year), &seed=7 (those clues);
  // ?g=code: a shared game, played as anyone plays it (game-logic.js gameCode: the year and the seed, not readable at a
  // glance); ?d=code: a dated globe sent as a game, "A friend's globe" (its tag and last button say so): the sender's own
  // globe, rebuilt from their answers (custom-globe.js). Any other ?d= (a cut or mistyped link; the placeholder game codes
  // of 22 Nov 2026, which any short word would also read as) opens the landing with a notice (badLink)
  const q = query, friend = !q.has('g') && q.has('d'), code = q.get('g') ?? q.get('d'), shared = code ? readGameCode(code) : null;
  if (friend && isCustomCode(code)) { overlaps(); startGame({ custom: code, friend: true }, { instant: true }); }
  else if (friend) badLink();
  else startGame(shared ? { ...shared, friend } : { year: Number(q.get('game')) || null, seed: q.has('seed') ? Number(q.get('seed')) : undefined }, { instant: true });
} else {
  flow.showLanding();
}
refreshTimeline();
