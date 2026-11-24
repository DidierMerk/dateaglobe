// Date a Globe inference engine, version 2. Same API as engine-v1.js; engine/engine.js picks one.
// Design, tests and results: docs/ENGINE_V2.md. What changes against v1:
//
// 1. One-way evidence per transition (data/evidence.json, attached by engine/compile.js):
//      P(new state | t) = early(t) + (1 - early(t)) * (1 - holdouts) * lag(t - d)
//    early: the new name or shape was already drawn before the official date (Namibia from 1968).
//    holdouts: the share of maps that never adopt the change (Burma on English maps, Kosovo on
//    Russian ones). Transitions without evidence get small default holdouts (names more than borders).
// 2. Plate staleness: a hidden class per map, next to the publisher's bloc. Classes multiply the
//    lag of every change; headline changes are exempt unless the class says otherwise, because
//    globe makers patched the big news onto old plates.
// 3. Reliability: a misread rate per question (higher for a clue at the edge of what the map size
//    shows, and for reading a name) and a chance of a confused "yes" between lookalike states.
// 4. Joint answers: several questions about one feature ("not this picture", then "this one?")
//    come from the one state the map shows, so they are combined through that state. v1 multiplies
//    them as independent evidence, which overstates them.
// 5. Question choice: expected information about the print month, per unit of effort.
//
// The hidden variable per map is h = bloc + (number of blocs) * staleness class. Likelihood tables
// drop the bloc dimension for features that don't depend on it, which keeps them small.
// Pure computation, shared by the Node tools and the browser.

import { monthCentre, formatDecimalYear } from './dates.js';
import { lagCdf, depictionP, normaliseName, optionsFor, card, monthMarginal, monthEntropy, nowDecimalYear, mulberry32, shuffle } from './shared.js';

export { lagCdf, depictionP, normaliseName, optionsFor, nowDecimalYear, mulberry32 };
export const ENGINE_VERSION = 2;

export const DEFAULTS = {
  maxQuestions: 30,
  stopWidthMonths: 36,    // stop when the 80% window is this narrow
  stopMass: 0.8,
  minGainBits: 0.05,      // stop when no question is worth asking
  regionBonus: 1.15,      // prefer staying in the same region (smooth camera)
  contradictionP: 0.03,   // flag answers the model found this unlikely
  lagSamples: 7,          // quadrature points across a transition's date uncertainty
  // Misreads: a base rate, more for a clue at the edge of what this map size shows, more for a name
  epsilon: 0.02,
  epsilonHard: 0.04,
  epsilonName: 0.01,
  epsilonFlat: 0.03,      // v1's single rate, used when reliability is switched off
  // Staleness classes: lag multiplier and prior share. Old plates got the headline news patched in;
  // the last class is a reprint that didn't (headline: true ages headline changes too). Adding it
  // never cost accuracy in testing and helped most where stale reprints are common (docs/ENGINE_V2.md).
  lagClasses: [
    { scale: 1, prior: 0.6 },
    { scale: 2.5, prior: 0.22 },
    { scale: 6, prior: 0.13 },
    { scale: 3, prior: 0.05, headline: true },
  ],
  // Holdouts for transitions the research hasn't looked at
  holdoutDefaults: { name: { headline: 0.01, regional: 0.03, obscure: 0.06 }, other: { headline: 0, regional: 0.01, obscure: 0.03 } },
  holdoutStrong: 0.01,
  // Effort: a hard-to-see clue or a name to read costs more of the user's attention
  effortHard: 0.5,
  effortName: 0.2,
  // Each part can be switched off, for tests and comparisons (all off = v1)
  features: { evidence: true, staleness: true, reliability: true, joint: true, effort: true },
};

const NAME_CLUES = new Set(['country_name', 'city_name', 'place_name', 'romanisation']);
const UP_TO_DATE = { scale: 1, prior: 1 };

// ---------------------------------------------------------------------------
// Likelihood building blocks

/** Holdout share for one transition, for this bloc and map language. */
export function holdoutsFor(feature, tr, bloc, language, cfg = DEFAULTS) {
  if (!cfg.features.evidence) return 0;
  const h = tr.evidence?.holdouts;
  if (h) return h.byLanguage?.[language] ?? h.byBloc?.[bloc] ?? h.default ?? 0;
  if (tr.evidence?.ceiling === 'gold') return 0;
  if (tr.evidence?.ceiling === 'strong') return cfg.holdoutStrong;
  const kind = NAME_CLUES.has(feature.clueType) ? 'name' : 'other';
  return cfg.holdoutDefaults[kind][tr.prominence] ?? 0;
}

/** Share of maps already drawing the new state at t: a ramp from the start of early use to the date. */
function earlyShare(tr, t, cfg) {
  const e = cfg.features.evidence ? tr.evidence?.early : null;
  if (!e) return 0;
  if (t >= tr.t) return e.share;
  if (t <= e.from) return 0;
  return e.share * (t - e.from) / (tr.t - e.from);
}

/** Lag median for a staleness class. */
const lagMedianFor = (tr, cls) => (tr.prominence === 'headline' && !cls.headline ? tr.lagMedian : tr.lagMedian * cls.scale);

/** P(map printed at t shows the post-transition state), for one staleness class and holdout share. */
export function caughtUp(t, tr, { cls = UP_TO_DATE, holdouts = 0, cfg = DEFAULTS } = {}) {
  const med = lagMedianFor(tr, cls);
  let lag;
  if (tr.uncertainty <= 0) lag = lagCdf(t - tr.t, med);
  else {
    const n = cfg.lagSamples;
    lag = 0;
    for (let i = 0; i < n; i++) lag += lagCdf(t - (tr.t - tr.uncertainty + (2 * tr.uncertainty * (i + 0.5)) / n), med);
    lag /= n;
  }
  const e = earlyShare(tr, t, cfg);
  return e + (1 - e) * (1 - holdouts) * lag;
}

/**
 * P(state k | t) for every state of a feature: the same cumulative structure as v1
 * (a map can only show state k after catching up with transitions 1..k).
 * `cls` is a staleness class ({ scale, headline? }); `scale` alone is a shortcut for { scale }.
 */
export function stateProbabilities(feature, t, { cls = null, scale = 1, bloc = 'neutral', language = 'en', cfg = DEFAULTS } = {}) {
  const c = cls ?? { scale };
  const n = feature.states.length;
  const G = new Array(n + 1);
  G[0] = 1;
  for (let k = 1; k < n; k++) {
    const tr = feature.transitions[k - 1];
    G[k] = Math.min(G[k - 1], caughtUp(t, tr, { cls: c, holdouts: holdoutsFor(feature, tr, bloc, language, cfg), cfg }));
  }
  G[n] = 0;
  const p = new Array(n);
  for (let k = 0; k < n; k++) p[k] = G[k] - G[k + 1];
  return p;
}

// ---------------------------------------------------------------------------
// Session

/**
 * @param {object} bundle   compiled bundle (engine/compile.js, with evidence)
 * @param {object} opts     { language, mapSize, now (decimal year), seed, tableCache, features, ...DEFAULTS overrides }
 */
export function createSession(bundle, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts, features: { ...DEFAULTS.features, ...(opts.features ?? {}) } };
  const startYear = Number(bundle.vocab.timeRange.start.slice(0, 4));
  const now = cfg.now ?? nowDecimalYear();
  const M = Math.floor((now - startYear) * 12) + 1;
  const blocNames = bundle.vocab.blocs;
  const NB = blocNames.length;
  const classes = cfg.features.staleness ? cfg.lagClasses : [UP_TO_DATE];
  const C = classes.length;
  const B = NB * C; // hidden index h = bloc + NB * class
  const language = cfg.language ?? 'en';
  // Name clues compare spellings, so they need the map's language. When it is unknown ('xx'),
  // only language-free clues are asked; setting the language later unlocks the name clues.
  const knowsLanguage = Object.hasOwn(bundle.vocab.languages, language);
  const minSalience = bundle.vocab.mapSizes[cfg.mapSize ?? 'medium']?.min_salience ?? 2;

  const langInfo = bundle.vocab.languages[language];
  const blocPrior = blocNames.map((b) => langInfo?.bloc_prior?.[b] ?? 1 / NB);
  const blocSum = blocPrior.reduce((a, c) => a + c, 0);
  const classSum = classes.reduce((a, c) => a + c.prior, 0);
  const prior = new Float64Array(M * B);
  for (let m = 0; m < M; m++) for (let c = 0; c < C; c++) for (let b = 0; b < NB; b++) {
    prior[m * B + b + NB * c] = (blocPrior[b] / blocSum) * (classes[c].prior / classSum) / M;
  }

  const rng = mulberry32(cfg.seed ?? 12345);
  const features = bundle.features;
  const featureById = new Map(features.map((f) => [f.id, f]));
  // Tables depend only on the data, language, map size and settings. The cache rides in the
  // config, so a session rebuilt from session.config (the result's replay) reuses it.
  const cache = cfg.tableCache ?? new Map();
  cfg.tableCache = cache;

  const isHard = (f) => f.salience <= minSalience;
  const isName = (f) => f.kind === 'pick_name';
  const epsFor = (f) => (cfg.features.reliability
    ? cfg.epsilon + (isHard(f) ? cfg.epsilonHard : 0) + (isName(f) ? cfg.epsilonName : 0)
    : cfg.epsilonFlat);

  /** Whether a feature's likelihood differs between blocs (depictions or holdouts by bloc). */
  function blocDependent(f) {
    const differs = (get) => blocNames.some((b) => get(b) !== get(blocNames[0]));
    for (const s of f.states) for (const d of s.depictions) {
      if (d.pByLanguage?.[language] == null && differs((b) => d.pByBloc[b] ?? 0)) return true;
    }
    if (!cfg.features.evidence) return false;
    return f.transitions.some((tr) => {
      const h = tr.evidence?.holdouts;
      return h && h.byLanguage?.[language] == null && differs((b) => h.byBloc?.[b] ?? h.default ?? 0);
    });
  }

  /**
   * A feature's tables. L[(k*M + m)*W + hm[h]] = P(yes to option k | month m, hidden h), misreads and
   * lookalikes included. W = B when the feature depends on the bloc, else C (one column per class).
   * Y[(k*n + s)*NB + b] = P(raw yes to option k | state s, bloc b).
   */
  function table(feature) {
    if (cache.has(feature.id)) return cache.get(feature.id);
    const options = shuffle(optionsFor(feature, language), rng);
    const K = options.length, n = feature.states.length;
    const eps = epsFor(feature);
    const byBloc = blocDependent(feature);
    const W = byBloc ? B : C;
    const hm = Int32Array.from({ length: B }, (_, h) => (byBloc ? h : Math.floor(h / NB)));
    const look = cfg.features.reliability ? feature.lookalikes ?? [] : [];

    const Y = new Float64Array(K * n * NB);
    options.forEach((o, k) => {
      for (let s = 0; s < n; s++) for (let b = 0; b < NB; b++) {
        let w = 0, member = false;
        for (const mem of o.members) {
          if (mem.state !== s) continue;
          member = true;
          w += mem.depiction == null ? 1 : depictionP(feature.states[s].depictions[mem.depiction], blocNames[b], language);
        }
        // A lookalike state: the reader may say yes to a picture that only looks like their map
        if (!member) for (const l of look) if (l.states.includes(s) && o.members.some((mem) => l.states.includes(mem.state))) w = Math.max(w, l.p);
        Y[(k * n + s) * NB + b] = Math.min(1, w);
      }
    });

    const L = new Float32Array(K * M * W);
    forEachColumn(feature, byBloc, (m, col, b, ps) => {
      for (let k = 0; k < K; k++) {
        let p = 0;
        for (let s = 0; s < n; s++) p += ps[s] * Y[(k * n + s) * NB + b];
        L[(k * M + m) * W + col] = (1 - eps) * p + eps / K;
      }
    });
    const entry = { options, K, n, eps, byBloc, W, hm, Y, L, PS: null };
    cache.set(feature.id, entry);
    return entry;
  }

  /** Calls fn(m, column, bloc, stateProbabilities) for every month and table column of a feature. */
  function forEachColumn(feature, byBloc, fn) {
    for (let m = 0; m < M; m++) {
      const t = monthCentre(m, startYear);
      for (let c = 0; c < C; c++) {
        if (byBloc) {
          for (let b = 0; b < NB; b++) fn(m, b + NB * c, b, stateProbabilities(feature, t, { cls: classes[c], bloc: blocNames[b], language, cfg }));
        } else {
          fn(m, c, 0, stateProbabilities(feature, t, { cls: classes[c], bloc: blocNames[0], language, cfg }));
        }
      }
    }
  }

  /** P(state s | month, column) for joint answers; built only for features that get answered. */
  function stateTable(feature) {
    const entry = table(feature);
    if (!entry.PS) {
      const { n, W } = entry;
      const PS = new Float32Array(n * M * W);
      forEachColumn(feature, entry.byBloc, (m, col, b, ps) => { for (let s = 0; s < n; s++) PS[(s * M + m) * W + col] = ps[s]; });
      entry.PS = PS;
    }
    return entry.PS;
  }

  /** P(answer | state s) for option k, in table column col (misreads included). */
  function answerProb(entry, k, s, col, reply) {
    const b = entry.byBloc ? col % NB : 0;
    const y = (1 - entry.eps) * entry.Y[(k * entry.n + s) * NB + b] + entry.eps / entry.K;
    return reply === 'no' ? 1 - y : y;
  }

  let history = []; // [{ featureId, optionKey, reply, special, predictive, gainBits }]
  let post = prior.slice();
  // Joint answers: per answered feature, P(state, its answers so far | month, column)
  let stateWeights = new Map();

  /** Rebuilds the posterior from the prior and every answer, in order. */
  function recompute() {
    post = prior.slice();
    stateWeights = new Map();
    for (const h of history) {
      if (h.special) continue;
      const f = featureById.get(h.featureId);
      const entry = table(f);
      const k = entry.options.findIndex((o) => o.key === h.optionKey);
      const before = monthEntropy(post, M, B);
      const ratio = cfg.features.joint ? jointUpdate(f, entry, k, h.reply) : marginalRatio(entry, k, h.reply);
      const { W, hm } = entry;
      let pred = 0, z = 0;
      for (let m = 0; m < M; m++) for (let hh = 0; hh < B; hh++) {
        const i = m * B + hh;
        const r = ratio[m * W + hm[hh]];
        pred += post[i] * r;
        post[i] *= r;
        z += post[i];
      }
      for (let i = 0; i < post.length; i++) post[i] /= z;
      h.predictive = pred;
      h.gainBits = before - monthEntropy(post, M, B);
    }
  }

  /** Likelihood of an answer per (month, column), ignoring earlier answers on the feature (v1's way). */
  function marginalRatio(entry, k, reply) {
    const { L, W } = entry;
    const out = new Float64Array(M * W);
    for (let i = 0; i < M * W; i++) { const l = L[k * M * W + i]; out[i] = reply === 'no' ? 1 - l : l; }
    return out;
  }

  /** Likelihood of an answer per (month, column) given earlier answers on the feature; updates the state weights. */
  function jointUpdate(f, entry, k, reply) {
    const { n, W } = entry;
    const MW = M * W;
    const w = stateWeights.get(f.id) ?? Float64Array.from(stateTable(f));
    const out = new Float64Array(MW);
    for (let i = 0; i < MW; i++) {
      const col = i % W;
      let den = 0, num = 0;
      for (let s = 0; s < n; s++) {
        const ws = w[s * MW + i];
        const a = answerProb(entry, k, s, col, reply);
        den += ws; num += ws * a;
        w[s * MW + i] = ws * a;
      }
      out[i] = den > 0 ? num / den : 0;
    }
    stateWeights.set(f.id, w);
    return out;
  }

  /** P(yes to option k | month, column), given earlier answers on the same feature. */
  function yesLikelihood(f, k) {
    const entry = table(f);
    const { n, W, L } = entry;
    const MW = M * W;
    if (!cfg.features.joint || !stateWeights.has(f.id)) return L.subarray(k * MW, (k + 1) * MW);
    const w = stateWeights.get(f.id);
    const out = new Float64Array(MW);
    for (let i = 0; i < MW; i++) {
      const col = i % W;
      let den = 0, num = 0;
      for (let s = 0; s < n; s++) { const ws = w[s * MW + i]; den += ws; num += ws * answerProb(entry, k, s, col, 'yes'); }
      out[i] = den > 0 ? num / den : entry.eps / entry.K;
    }
    return out;
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
  function expectedGain(f, k, H0) {
    const { W, hm } = table(f);
    const ly = yesLikelihood(f, k);
    const yes = new Float64Array(M), no = new Float64Array(M);
    let pYes = 0, pNo = 0;
    for (let m = 0; m < M; m++) {
      let y = 0, nn = 0;
      for (let hh = 0; hh < B; hh++) {
        const w = post[m * B + hh], l = ly[m * W + hm[hh]];
        y += w * l; nn += w * (1 - l);
      }
      yes[m] = y; no[m] = nn; pYes += y; pNo += nn;
    }
    const H = (q, z) => { let h = 0; if (z <= 0) return 0; for (let m = 0; m < M; m++) if (q[m] > 0) { const p = q[m] / z; h -= p * Math.log2(p); } return h; };
    return H0 - (pYes * H(yes, pYes) + pNo * H(no, pNo));
  }

  const effort = (f) => (cfg.features.effort ? 1 + (isHard(f) ? cfg.effortHard : 0) + (isName(f) ? cfg.effortName : 0) : 1);

  function lastRegion() {
    for (let i = history.length - 1; i >= 0; i--) return featureById.get(history[i].featureId).region;
    return null;
  }

  function rankQuestions() {
    const region = lastRegion();
    const H0 = monthEntropy(post, M, B);
    return candidates()
      .map(({ feature, k }) => {
        const gain = expectedGain(feature, k, H0);
        return { feature, k, gain, score: (gain / effort(feature)) * (feature.region === region ? cfg.regionBonus : 1) };
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

  /**
   * The states in which an option is the usual picture: at least half of maps (for this
   * language, averaged over blocs) drew it this way. The quarter of 1932-45 maps that kept
   * Manchuria in China don't make "part of China" true in every year; those holdouts still
   * count in the inference. A picture that is never the usual one keeps all its states.
   */
  function usualStates(f, opt) {
    const share = (s) => Math.min(1, opt.members.filter((m) => m.state === s).reduce((w, m) => w + (m.depiction == null ? 1
      : blocNames.reduce((acc, b, i) => acc + (blocPrior[i] / blocSum) * depictionP(f.states[s].depictions[m.depiction], b, language), 0)), 0));
    const all = [...new Set(opt.members.map((m) => m.state))].sort((a, b) => a - b);
    const usual = all.filter((s) => share(s) >= 0.5);
    return usual.length ? usual : all;
  }

  const api = {
    config: cfg,
    startYear,
    months: M,
    language,
    version: ENGINE_VERSION,

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

    /**
     * Every question the engine could ask now, best first: { feature, option, options, gain, score }.
     * Read-only; engine v3 picks from this list instead of always taking the top.
     */
    rankedQuestions() {
      return rankQuestions().map(({ feature, k, gain, score }) => {
        const { options } = table(feature);
        return { feature, option: options[k], options, gain, score };
      });
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
     * When an option is the usual picture: [{ from, to }] in decimal years, before any lag.
     * Several ranges when non-adjacent states share a picture (interwar and post-1991 Baltics).
     * Only the states where it was the usual picture count (usualStates).
     */
    optionSpans(featureId, optionKey) {
      const f = featureById.get(featureId);
      const opt = table(f).options.find((o) => o.key === optionKey);
      if (!opt) return [];
      const idx = usualStates(f, opt);
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

    /** Probability per calendar year, for the time ribbon. */
    yearDensity() {
      const marg = monthMarginal(post, M, B);
      const years = Math.ceil(M / 12);
      const out = new Array(years).fill(0);
      for (let m = 0; m < M; m++) out[Math.floor(m / 12)] += marg[m];
      return out.map((p, i) => ({ year: startYear + i, p }));
    },

    blocPosterior() {
      const out = Object.fromEntries(blocNames.map((b) => [b, 0]));
      for (let m = 0; m < M; m++) for (let hh = 0; hh < B; hh++) out[blocNames[hh % NB]] += post[m * B + hh];
      return out;
    },

    /** Posterior over the staleness classes: [{ scale, headline, p }]. */
    stalenessPosterior() {
      const out = classes.map((c) => ({ scale: c.scale, headline: !!c.headline, p: 0 }));
      for (let m = 0; m < M; m++) for (let hh = 0; hh < B; hh++) out[Math.floor(hh / NB)].p += post[m * B + hh];
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
      // Every change into or out of the years this picture was usual, in time order. A picture
      // that comes back (China, Manchukuo, China again) has both, around the gap.
      const usual = new Set(usualStates(f, opt));
      const cards = [];
      f.transitions.forEach((t, i) => {
        if (usual.has(i + 1) && !usual.has(i)) cards.push(card(t, 'into'));
        else if (usual.has(i) && !usual.has(i + 1)) cards.push(card(t, 'out-of'));
      });
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
