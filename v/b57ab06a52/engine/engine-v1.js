// Date a Globe inference engine, version 1: every clue counts both ways, one lag per change.
// Kept as a fallback and for comparison (tools/compare.mjs); the app uses whichever engine/engine.js selects.
//
// Hidden variables
//   m : the month the map was printed (grid from vocab.timeRange.start to "now")
//   b : the publisher's bloc (western / eastern / neutral); matters only for
//       perspective-sensitive features
//
// Model
//   For a transition j at time d_j, the probability that a map printed at time t
//   already shows the new state is a lag CDF F_j(t - d_j) with a median that
//   depends on the transition's prominence. Being "caught up" is cumulative:
//   a map can only show state k if it has caught up with transitions 1..k.
//   P(state k | t) = G_k(t) - G_{k+1}(t), with G_k = min(F_1..F_k).
//   An answer option groups one or more (state, depiction) pairs.
//   A small error rate eps lets users misread a map without breaking the result.
//
// Questions are yes/no: "does your map look like this?" about one option.
//   yes -> likelihood L[o]; no -> 1 - L[o]. A yes settles the feature; a no
//   rules out that option, and another option of the same feature may follow.
//
// Everything here is pure computation: no DOM, no fetch. The browser app and
// the Node tools share it.

import { monthCentre, formatDecimalYear } from './dates.js';
import { lagCdf, depictionP, normaliseName, optionsFor, card, bayes, predictive, monthMarginal, monthEntropy, nowDecimalYear, mulberry32, shuffle, progressValue } from './shared.js';

export { lagCdf, depictionP, normaliseName, optionsFor, nowDecimalYear, mulberry32 };
export const ENGINE_VERSION = 1;

export const DEFAULTS = {
  epsilon: 0.03,          // chance an answer is a random misread
  maxQuestions: 30,       // yes/no questions are quick, so allow more of them
  stopWidthMonths: 36,    // stop when the 80% window is this narrow
  stopMass: 0.8,
  minGainBits: 0.05,      // stop when no question is worth asking
  regionBonus: 1.15,      // prefer staying in the same region (smooth camera)
  contradictionP: 0.03,   // flag answers the model found this unlikely
  lagSamples: 7,          // quadrature points across a transition's date uncertainty
};

// ---------------------------------------------------------------------------
// Likelihood building blocks

/** P(map printed at time t shows the post-transition state). */
export function caughtUp(t, tr, samples = DEFAULTS.lagSamples) {
  if (tr.uncertainty <= 0) return lagCdf(t - tr.t, tr.lagMedian);
  let sum = 0;
  for (let i = 0; i < samples; i++) {
    const d = tr.t - tr.uncertainty + (2 * tr.uncertainty * (i + 0.5)) / samples;
    sum += lagCdf(t - d, tr.lagMedian);
  }
  return sum / samples;
}

/** P(state k | t) for every state of a feature. */
export function stateProbabilities(feature, t) {
  const n = feature.states.length;
  const G = new Array(n + 1);
  G[0] = 1;
  for (let k = 1; k < n; k++) G[k] = Math.min(G[k - 1], caughtUp(t, feature.transitions[k - 1]));
  G[n] = 0;
  const p = new Array(n);
  for (let k = 0; k < n; k++) p[k] = G[k] - G[k + 1];
  return p;
}

// ---------------------------------------------------------------------------
// Session (answer options and numerics live in shared.js)

/**
 * @param {object} bundle   compiled bundle (engine/compile.js)
 * @param {object} opts     { language, mapSize, now (decimal year), seed, ...DEFAULTS overrides }
 */
export function createSession(bundle, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const startYear = Number(bundle.vocab.timeRange.start.slice(0, 4));
  const now = cfg.now ?? nowDecimalYear();
  const M = Math.floor((now - startYear) * 12) + 1;
  const blocs = bundle.vocab.blocs;
  const B = blocs.length;
  const language = cfg.language ?? 'en';
  // Name clues compare spellings, so they need the map's language. When it is unknown ('xx'),
  // only language-free clues are asked; setting the language later unlocks the name clues.
  const knowsLanguage = Object.hasOwn(bundle.vocab.languages, language);
  const minSalience = bundle.vocab.mapSizes[cfg.mapSize ?? 'medium']?.min_salience ?? 2;

  const langInfo = bundle.vocab.languages[language];
  const blocPrior = blocs.map((b) => langInfo?.bloc_prior?.[b] ?? 1 / B);
  const blocPriorSum = blocPrior.reduce((a, c) => a + c, 0);

  // Prior: uniform over months, bloc prior from the label language.
  const prior = new Float64Array(M * B);
  for (let m = 0; m < M; m++) for (let b = 0; b < B; b++) prior[m * B + b] = blocPrior[b] / blocPriorSum / M;

  const rng = mulberry32(cfg.seed ?? 12345);
  const features = bundle.features;
  const featureById = new Map(features.map((f) => [f.id, f]));
  const cache = new Map(); // feature id -> { options, L: Float64Array(K*M*B) }

  /** Likelihood table L[o, m, b] including the error rate. */
  function table(feature) {
    if (cache.has(feature.id)) return cache.get(feature.id);
    const options = shuffle(optionsFor(feature, language), rng);
    const K = options.length;
    const L = new Float64Array(K * M * B);
    for (let m = 0; m < M; m++) {
      const ps = stateProbabilities(feature, monthCentre(m, startYear));
      for (let k = 0; k < K; k++) {
        for (let b = 0; b < B; b++) {
          let p = 0;
          for (const mem of options[k].members) {
            const dep = mem.depiction == null ? 1 : depictionP(feature.states[mem.state].depictions[mem.depiction], blocs[b], language);
            p += ps[mem.state] * dep;
          }
          L[(k * M + m) * B + b] = (1 - cfg.epsilon) * p + cfg.epsilon / K;
        }
      }
    }
    const entry = { options, L, K };
    cache.set(feature.id, entry);
    return entry;
  }

  let history = []; // [{ featureId, optionKey, reply: 'yes'|'no'|null, special, predictive, gainBits }]
  let post = prior.slice();
  let revision = 0; // bumps whenever the answers change

  function recompute() {
    revision++;
    post = prior.slice();
    for (const h of history) {
      if (h.special) continue;
      const f = featureById.get(h.featureId);
      const { options, L } = table(f);
      const k = options.findIndex((o) => o.key === h.optionKey);
      const no = h.reply === 'no';
      const before = monthEntropy(post, M, B);
      const pYes = predictive(post, L, k, M, B);
      h.predictive = no ? 1 - pYes : pYes;
      bayes(post, L, k, M, B, no);
      h.gainBits = before - monthEntropy(post, M, B);
    }
  }

  /** Features that are settled (a yes, or "not sure"), and options ruled out by a no. */
  function status() {
    const settled = new Set(), denied = new Map();
    for (const h of history) {
      if (h.reply === 'no') {
        if (!denied.has(h.featureId)) denied.set(h.featureId, new Set());
        denied.get(h.featureId).add(h.optionKey);
      } else settled.add(h.featureId);
    }
    return { settled, denied };
  }

  /** Every (feature, option) pair still worth asking about. */
  function candidates() {
    const { settled, denied } = status();
    const out = [];
    for (const f of features) {
      if (settled.has(f.id) || f.salience < minSalience) continue;
      if (!knowsLanguage && !f.languageFree) continue;
      const { options, K } = table(f);
      if (K < 2) continue;
      const open = options.map((o, k) => ({ o, k })).filter(({ o }) => !denied.get(f.id)?.has(o.key));
      if (open.length < 2) continue; // only one picture left: the answer is already implied
      for (const { k } of open) out.push({ feature: f, k });
    }
    return out;
  }

  /** Expected drop in entropy of the print month from a yes/no about option k. */
  function expectedGain(f, k) {
    const { L } = table(f);
    const H0 = monthEntropy(post, M, B);
    const yes = new Float64Array(M), no = new Float64Array(M);
    let pYes = 0, pNo = 0;
    for (let m = 0; m < M; m++) {
      let y = 0, n = 0;
      for (let b = 0; b < B; b++) {
        const w = post[m * B + b], l = L[(k * M + m) * B + b];
        y += w * l; n += w * (1 - l);
      }
      yes[m] = y; no[m] = n; pYes += y; pNo += n;
    }
    const H = (q, z) => { let h = 0; if (z <= 0) return 0; for (let m = 0; m < M; m++) if (q[m] > 0) { const p = q[m] / z; h -= p * Math.log2(p); } return h; };
    return H0 - (pYes * H(yes, pYes) + pNo * H(no, pNo));
  }

  function lastRegion() {
    for (let i = history.length - 1; i >= 0; i--) return featureById.get(history[i].featureId).region;
    return null;
  }

  // Worked out once per set of answers: the next question and the progress line both need it
  let ranked = null, rankedAt = -1;
  function rankQuestions() {
    if (rankedAt !== revision) { ranked = rankAll(); rankedAt = revision; }
    return ranked;
  }

  function rankAll() {
    const region = lastRegion();
    return candidates()
      .map(({ feature, k }) => {
        const gain = expectedGain(feature, k);
        return { feature, k, gain, score: gain * (feature.region === region ? cfg.regionBonus : 1) };
      })
      .sort((a, b) => b.score - a.score);
  }

  function interval(mass = cfg.stopMass) {
    const marg = monthMarginal(post, M, B);
    const order = [...marg.keys()].sort((a, b) => marg[b] - marg[a]);
    let acc = 0;
    const chosen = [];
    for (const i of order) { chosen.push(i); acc += marg[i]; if (acc >= mass) break; }
    chosen.sort((a, b) => a - b);
    const lo = chosen[0], hi = chosen[chosen.length - 1];
    return {
      from: startYear + lo / 12,
      to: startYear + (hi + 1) / 12,
      widthMonths: hi - lo + 1,
      contiguous: chosen.length === hi - lo + 1,
      months: chosen,
      mass: acc,
    };
  }

  const startWidth = interval().widthMonths; // the 80% window before any answer

  const api = {
    config: cfg,
    startYear,
    months: M,
    language,

    /**
     * Next question, or null when the session should stop.
     * A yes/no about `option` ("does your map look like this?"); `options` lists all of the feature's options.
     */
    nextQuestion() {
      if (api.isDone()) return null;
      const ranked = rankQuestions();
      if (!ranked.length || ranked[0].gain < cfg.minGainBits) return null;
      const { feature: f, k } = ranked[0];
      const { options } = table(f);
      return { feature: f, option: options[k], options, expectedGainBits: ranked[0].gain };
    },

    /** Record a reply to "does your map look like option X?": 'yes', 'no' or 'unsure'. */
    reply(featureId, optionKey, answer) {
      if (answer === 'unsure') return api.answer(featureId, 'cant_tell');
      const f = featureById.get(featureId);
      if (!f) throw new Error(`Unknown feature ${featureId}`);
      if (!table(f).options.some((o) => o.key === optionKey)) throw new Error(`Unknown option ${optionKey} for ${featureId}`);
      history.push({ featureId, optionKey, reply: answer === 'no' ? 'no' : 'yes', special: false, predictive: null, gainBits: 0 });
      recompute();
      const h = history[history.length - 1];
      return { contradiction: h.predictive < cfg.contradictionP, predictive: h.predictive, gainBits: h.gainBits };
    },

    /** Record that the map shows this option (a yes), or 'cant_tell' / 'not_on_map'. */
    answer(featureId, optionKey) {
      const special = optionKey === 'cant_tell' || optionKey === 'not_on_map';
      if (!special) return api.reply(featureId, optionKey, 'yes');
      if (!featureById.has(featureId)) throw new Error(`Unknown feature ${featureId}`);
      history.push({ featureId, optionKey, reply: null, special, predictive: null, gainBits: 0 });
      recompute();
      return { contradiction: false, predictive: null, gainBits: 0 };
    },

    /**
     * When an option holds on the ground: [{ from, to }] in decimal years, before any lag.
     * Several ranges when non-adjacent states share a picture (interwar and post-1991 Baltics).
     */
    optionSpans(featureId, optionKey) {
      const f = featureById.get(featureId);
      const opt = table(f).options.find((o) => o.key === optionKey);
      if (!opt) return [];
      const idx = [...new Set(opt.members.map((m) => m.state))].sort((a, b) => a - b);
      const spans = [];
      for (const i of idx) {
        const from = i === 0 ? null : f.transitions[i - 1].t;
        const to = i === f.states.length - 1 ? null : f.transitions[i].t;
        const last = spans[spans.length - 1];
        if (last && last.to === from) last.to = to; else spans.push({ from, to });
      }
      return spans;
    },

    undo() {
      history = history.slice(0, -1);
      recompute();
    },

    /**
     * Change an earlier answer (history index) to 'yes', 'no' or 'unsure'. Later answers stay, except
     * later questions about the same feature when the new answer is yes: a yes settles a feature, so
     * those questions would never have been asked.
     */
    revise(index, reply) {
      const h = history[index];
      if (!h) throw new Error(`No answer at ${index}`);
      const updated = reply === 'unsure'
        ? { featureId: h.featureId, optionKey: 'cant_tell', reply: null, special: true, predictive: null, gainBits: 0 }
        : { ...h, reply: reply === 'no' ? 'no' : 'yes', special: false };
      history = history
        .map((x, i) => (i === index ? updated : x))
        .filter((x, i) => i <= index || !(reply === 'yes' && x.featureId === h.featureId));
      recompute();
    },

    history: () => history.map((h) => ({ ...h })),

    isDone() {
      const answered = history.filter((h) => !h.special).length;
      if (history.length >= cfg.maxQuestions) return true;
      if (answered > 0 && interval().widthMonths <= cfg.stopWidthMonths) return true;
      return false;
    },

    interval,

    /** How close the session is to its result: { value: 0..1, done } (engine-v2.js progress, shared.js progressValue). */
    progress(done = api.nextQuestion() === null) {
      if (done) return { value: 1, done: true };
      if (!history.some((h) => !h.special)) return { value: 0, done: false };
      const value = progressValue({
        widthMonths: interval().widthMonths, startWidthMonths: startWidth, stopWidthMonths: cfg.stopWidthMonths,
        bestGainBits: rankQuestions()[0]?.gain, minGainBits: cfg.minGainBits,
      });
      return { value, done: false };
    },

    /** Probability per calendar year, for the time ribbon. */
    yearDensity() {
      const marg = monthMarginal(post, M, B);
      const years = Math.ceil(M / 12);
      const out = new Array(years).fill(0);
      for (let m = 0; m < M; m++) out[Math.floor(m / 12)] += marg[m];
      return out.map((p, i) => ({ year: startYear + i, p }));
    },

    blocPosterior() {
      const out = Object.fromEntries(blocs.map((b) => [b, 0]));
      for (let m = 0; m < M; m++) for (let b = 0; b < B; b++) out[blocs[b]] += post[m * B + b];
      return out;
    },

    mode() {
      const marg = monthMarginal(post, M, B);
      let best = 0;
      for (let m = 1; m < M; m++) if (marg[m] > marg[best]) best = m;
      return monthCentre(best, startYear);
    },

    /** The history cards for an answer: the change into and out of the chosen state(s). */
    explain(featureId, optionKey) {
      const f = featureById.get(featureId);
      const opt = table(f).options.find((o) => o.key === optionKey);
      if (!opt) return [];
      const idx = opt.members.map((m) => m.state);
      const first = Math.min(...idx), last = Math.max(...idx);
      const cards = [];
      if (first > 0) cards.push(card(f.transitions[first - 1], 'into'));
      if (last < f.states.length - 1) cards.push(card(f.transitions[last], 'out-of'));
      return cards;
    },

    summary() {
      const i80 = interval(0.8), i50 = interval(0.5);
      const decisive = history
        .filter((h) => !h.special)
        .sort((a, b) => b.gainBits - a.gainBits)
        .slice(0, 4)
        .map((h) => {
          const f = featureById.get(h.featureId);
          const o = table(f).options.find((x) => x.key === h.optionKey);
          return { featureId: f.id, optionKey: o.key, reply: h.reply, title: f.title, subject: f.subject, label: o.label, answer: h.reply === 'no' ? `Not ${o.label}` : o.label, gainBits: h.gainBits };
        });
      const contradictions = history
        .filter((h) => !h.special && h.predictive < cfg.contradictionP)
        .map((h) => ({ featureId: h.featureId, title: featureById.get(h.featureId).title, predictive: h.predictive }));
      return {
        likely: { from: i80.from, to: i80.to, label: `${formatDecimalYear(i80.from)} - ${formatDecimalYear(i80.to)}`, contiguous: i80.contiguous },
        core: { from: i50.from, to: i50.to, label: `${formatDecimalYear(i50.from)} - ${formatDecimalYear(i50.to)}` },
        mode: api.mode(),
        blocs: api.blocPosterior(),
        decisive,
        contradictions,
        questionsAsked: history.length,
      };
    },
  };
  return api;
}
