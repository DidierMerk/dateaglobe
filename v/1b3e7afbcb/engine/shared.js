// Pieces both engines share: lag curve, answer options, name normalising, the posterior
// numerics, a small seeded RNG. Pure computation, no DOM.

import { formatDate } from './dates.js';

/** Lag CDF: exponential with the given median, zero before the change. */
export function lagCdf(x, median) {
  return x <= 0 ? 0 : 1 - Math.pow(0.5, x / median);
}

/** P(depiction | state, bloc, map language): a per-language value wins over the bloc prior. */
export function depictionP(depiction, bloc, language) {
  return depiction.pByLanguage?.[language] ?? depiction.pByBloc[bloc] ?? 0;
}

/** Normalise a spelling for grouping: case, accents, punctuation and spaces. */
export function normaliseName(s) {
  return s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * The question as a short positive statement: the written claim, or for "Is the X called {name}?"
 * (and "Are the islands called …", "spelled", "labelled") the rule "The X is called {name}".
 * Null when there is neither.
 */
const CALLED = /^(Is|Are) ((?!there |it )[^,?]+?) (called|spelled|labelled) ([^,?]+)\?$/;
export function claimFor(src) {
  if (src.claim) return src.claim;
  const m = CALLED.exec(src.question ?? '');
  if (!m) return null;
  const [, verb, subject, how, name] = m;
  return `${subject.charAt(0).toUpperCase()}${subject.slice(1)} ${verb.toLowerCase()} ${how} ${name}`;
}

/**
 * Answer options for a feature, for a given map-label language.
 * Each option: { key, label, question, claim, cue, names[], members: [{ state, depiction }] }.
 * Name questions group states whose primary spelling is the same in that
 * language; picture questions group by visual_group and split by depiction (a depiction
 * with its own visual_group joins the option of the states drawn that way).
 */
export function optionsFor(feature, language) {
  const groups = new Map();
  const add = (key, make, member) => {
    if (!groups.has(key)) groups.set(key, { key, ...make(), members: [] });
    groups.get(key).members.push(member);
  };

  feature.states.forEach((state, si) => {
    if (feature.kind === 'pick_name') {
      // A name printed only by some publishers (Gulf of America on US maps) is a depiction with its own names
      const variants = state.depictions.length
        ? state.depictions.map((d, di) => ({ names: d.names ?? state.names, depiction: di }))
        : [{ names: state.names, depiction: null }];
      for (const v of variants) {
        const lang = v.names?.[language] ? language : 'en';
        const spellings = v.names?.[lang] ?? [state.label];
        const src = { question: state.question, claim: (v.depiction != null ? state.depictions[v.depiction].claim : null) ?? state.claim };
        add(normaliseName(spellings[0]), () => ({ label: spellings[0], question: (state.question ?? '').replace('{name}', spellings[0]), claim: claimFor(src)?.replace('{name}', spellings[0]) ?? null, cue: state.cue, names: [] }), { state: si, depiction: v.depiction });
        const g = groups.get(normaliseName(spellings[0]));
        for (const s of spellings) if (!g.names.includes(s)) g.names.push(s);
      }
    } else if (state.depictions.length) {
      state.depictions.forEach((d, di) =>
        // A depiction that looks like another state (a border drawn as if nothing changed) joins that state's option
        add(d.visualGroup ?? `${state.visualGroup}:${d.id}`, () => ({ label: d.label, question: d.question, claim: claimFor(d), cue: d.cue, names: [] }), { state: si, depiction: di }));
    } else {
      add(state.visualGroup, () => ({ label: state.label, question: state.question, claim: claimFor(state), cue: state.cue, names: [] }), { state: si, depiction: null });
    }
  });
  return [...groups.values()];
}

export function card(tr, relation) {
  return {
    relation,
    date: tr.date,
    dateLabel: formatDate(tr.date),
    funFact: tr.funFact,
    source: tr.sources[0] ?? null,
  };
}

export function bayes(post, L, k, M, B, no = false) {
  let z = 0;
  for (let m = 0; m < M; m++) for (let b = 0; b < B; b++) {
    const i = m * B + b;
    const l = L[(k * M + m) * B + b];
    post[i] *= no ? 1 - l : l;
    z += post[i];
  }
  for (let i = 0; i < post.length; i++) post[i] /= z;
}

export function predictive(post, L, k, M, B) {
  let p = 0;
  for (let m = 0; m < M; m++) for (let b = 0; b < B; b++) p += post[m * B + b] * L[(k * M + m) * B + b];
  return p;
}

export function monthMarginal(post, M, B) {
  const out = new Float64Array(M);
  for (let m = 0; m < M; m++) { let s = 0; for (let b = 0; b < B; b++) s += post[m * B + b]; out[m] = s; }
  return out;
}

export function monthEntropy(post, M, B) {
  const marg = monthMarginal(post, M, B);
  let H = 0;
  for (let m = 0; m < M; m++) if (marg[m] > 0) H -= marg[m] * Math.log2(marg[m]);
  return H;
}

export function nowDecimalYear() {
  const d = new Date();
  return d.getUTCFullYear() + d.getUTCMonth() / 12 + (d.getUTCDate() - 1) / 365.25;
}

// Small deterministic RNG so option order is stable within a session.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
