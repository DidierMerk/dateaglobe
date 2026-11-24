// Date a Globe inference engine, version 3: engine v2's model, a different way to pick questions.
// Same API as engine-v1.js and engine-v2.js; engine/engine.js picks one.
//
// v2 always asks the single best question, so the same answers always give the same questions.
// v3 changes only that choice (docs/ENGINE_V3.md):
//   * No same-region bonus: the next question can come from anywhere on the globe.
//   * Variety: among the questions nearly as good as the best one, pick at random, weighted by
//     score. "Nearly as good" is wide for the first questions, where many clues tie, and narrows
//     until, after a few questions, only real ties are left. One question per feature takes part,
//     so a feature with many options doesn't get more chances.
//   * No "any year" questions: an option that is the usual picture in every year (its yes rules
//     nothing out) is never asked when its feature has another option to ask instead.
//   * The random pick depends on the session's seed and the answers so far, nothing else. The
//     same session state always gives the same question (Back, then the same answer, asks the same
//     thing again; a replay from session.config matches), and a new seed gives a new path.
// Everything else (the model, the tables, the stopping rule) is v2's, unchanged.

import * as v2 from './engine-v2.js';

export * from './engine-v2.js';
export const ENGINE_VERSION = 3;

export const DEFAULTS = {
  ...v2.DEFAULTS,
  regionBonus: 1, // no pull towards the previous question's region
  variety: {
    start: 0.25, // first question: anything within 25% of the best score can be picked
    end: 0.03, // from question `fade` on: only near-exact ties
    fade: 8, // questions over which the band narrows from start to end
  },
};

/** FNV-1a over strings: a seed for one session state. */
function hash(...parts) {
  let h = 2166136261 >>> 0;
  for (const ch of parts.join('|')) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

/** How far below the best score a question may be and still be picked, after n questions. */
export function varietyBand(n, variety = DEFAULTS.variety) {
  const f = Math.min(1, n / Math.max(1, variety.fade));
  return variety.start + (variety.end - variety.start) * f;
}

/**
 * The question to ask from a ranked list (best first): one per feature, those within the band of
 * the best score, picked at random with weight proportional to score.
 */
export function pickQuestion(ranked, n, rng, variety = DEFAULTS.variety) {
  if (!ranked.length) return null;
  const top = ranked[0].score;
  const floor = top * (1 - varietyBand(n, variety));
  const seen = new Set();
  const pool = [];
  for (const q of ranked) {
    if (q.score < floor) break; // ranked is sorted, so nothing further qualifies
    if (seen.has(q.feature.id)) continue;
    seen.add(q.feature.id);
    pool.push(q);
  }
  const total = pool.reduce((a, q) => a + q.score, 0);
  let r = rng() * total;
  for (const q of pool) { r -= q.score; if (r < 0) return q; }
  return pool[pool.length - 1];
}

/**
 * @param {object} bundle   compiled bundle (engine/compile.js, with evidence)
 * @param {object} opts     v2's options, plus `variety` ({ start, end, fade }); `seed` drives the picks
 */
export function createSession(bundle, opts = {}) {
  const variety = { ...DEFAULTS.variety, ...(opts.variety ?? {}) };
  const s = v2.createSession(bundle, { ...DEFAULTS, ...opts, variety, features: { ...DEFAULTS.features, ...(opts.features ?? {}) } });
  const cfg = s.config;
  const seed = cfg.seed ?? 12345;

  /**
   * Next question, or null when the session should stop (the same rule as v2).
   * A yes/no about `option`; `options` lists all of the feature's options.
   */
  function nextQuestion() {
    if (s.isDone()) return null;
    const ranked = s.rankedQuestions();
    if (!ranked.length || ranked[0].gain < cfg.minGainBits) return null;
    const history = s.history();
    const state = history.map((h) => `${h.featureId}:${h.optionKey}:${h.reply}`).join(',');
    const rng = v2.mulberry32(hash(seed, state));
    // Never ask about a picture that is usual in every year (two kingdoms with a border, before and
    // after 1905): its yes rules nothing out and reads as "Any year". The feature's other options
    // split the same way and their yes dates the map, so ask one of those instead.
    const anyYear = (x) => x.options.length > 1 && (() => {
      const spans = s.optionSpans(x.feature.id, x.option.key);
      return spans.length === 1 && spans[0].from == null && spans[0].to == null;
    })();
    const q = pickQuestion(ranked.filter((x) => x.gain >= cfg.minGainBits && !anyYear(x)), history.length, rng, variety);
    if (!q) return null;
    return { feature: q.feature, option: q.option, options: q.options, expectedGainBits: q.gain };
  }

  return {
    ...s,
    version: ENGINE_VERSION,
    nextQuestion,
    /** How close the session is to its result: { value: 0..1, done } (engine-v2.js progress), done by v3's own rule. */
    progress: () => s.progress(nextQuestion() === null),
  };
}
