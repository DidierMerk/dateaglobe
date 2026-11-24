// "Guess the year": the game's rules, with no DOM in sight (tests/game.test.mjs runs them in Node).
//
// A game is a year from the app's timeline. The player has five looks: the whole globe, then, after each miss, a
// clue chosen for that miss (pickClue). A guess wins when it is the year, or a year its clues can't tell from it (the
// game's "group": winSet). A miss rules out its side of the dial ("earlier" / "later"), and nothing more: its hint says
// why ("Congo is independent: not yet in 1958"), but never gives away the clue's own years, which only the result shows.
//
// A globe "of year y" shows the world at y + 0.5, the middle of the year; a clue holds in year y when its picture
// holds then. So every year has one picture per clue, and years with the same pictures can't be told apart.

export const LOOKS = 5;
export const AXIS_START = 1886;          // the app's timeline starts here (CShapes)
export const FIRST = 1890, LAST = 2015;  // the years a random game can land on

const I = Infinity;
const years = new Map(); // the same few hundred dates are read over and over (stateAt runs for every clue and year)
export const toYear = (iso) => {
  if (!iso) return null;
  let t = years.get(iso);
  if (t === undefined) {
    const [y, m = 1, d = 1] = String(iso).split('-').map(Number);
    years.set(iso, (t = y + (m - 1) / 12 + (d - 1) / 365.25));
  }
  return t;
};

/** A small seeded generator, so a game can be played again from its seed (and tested). */
export function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// --- The years still possible: a list of whole-year stretches [first, last], in order ---------------------
export const cutSet = (S, lo, hi) => S.map(([a, b]) => [Math.max(a, lo), Math.min(b, hi)]).filter(([a, b]) => a <= b);
export const interSet = (A, B) => {
  const out = [];
  for (const a of A) for (const b of B) { const lo = Math.max(a[0], b[0]), hi = Math.min(a[1], b[1]); if (lo <= hi) out.push([lo, hi]); }
  return out;
};
export const bounds = (S) => [S[0][0], S[S.length - 1][1]];
/** B lies inside A: each stretch of B grows out of the stretch of A that holds it (e from 0 to 1). */
export function lerpSet(A, B, e) {
  if (e <= 0) return A;
  if (e >= 1) return B;
  const out = B.map((b) => { const a = A.find((x) => x[0] <= b[0] && x[1] >= b[1]) ?? b; return [a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e]; }).sort((p, q) => p[0] - q[0]);
  const merged = [];
  for (const s of out) { const m = merged[merged.length - 1]; if (m && s[0] <= m[1] + 1) m[1] = Math.max(m[1], s[1]); else merged.push(s.slice()); }
  return merged;
}

/** The state of a feature that holds at decimal year t (its index), or -1. */
export function stateAt(feature, t) {
  return feature.states.findIndex((s) => (toYear(s.validFrom) ?? -I) <= t && t < (toYear(s.validTo) ?? I));
}
/** A clue holds in year y: its picture (any state its option draws alike) holds in the middle of that year. */
export const holds = (clue, y) => clue.members.has(stateAt(clue.feature, y + 0.5));
/** The years, as whole-year stretches, in which all the clues hold: the years they can't tell apart. */
export const winSet = (pool, endYear) => pool.reduce((S, c) => interSet(S, c.set), [[AXIS_START, endYear]]);
/** Is year y in the stretches S? */
export const inSet = (S, y) => S.some(([a, b]) => y >= a && y <= b);
/** How far year y lies from the nearest year of S. */
export const distTo = (S, y) => Math.min(...S.map(([a, b]) => (y < a ? a - y : y > b ? y - b : 0)));

// --- The clues ----------------------------------------------------------------------------------------------
// A clue is something the app's data says a globe of that year shows: a picture first (a border, a colony, a
// capital), a name only where no picture will do (the globe prints names anyway). It is chosen at the moment of
// a miss, from the guess and the years still possible:
//   1. it was true in the globe's year and NOT in the year just guessed, so it says why the guess was wrong
//      ("South Sudan is independent · This means after 2008"); a hint is never anything else;
//   2. it cuts the years still possible where one can; among those, the one whose edge on the guess's side lies
//      nearest the guess is likeliest, so it reads as "before or after about 1950" and the player keeps the work of
//      closing in; one whose other edge also cuts the years still possible (a give-away from both sides) is much less
//      likely; a striking one (salience) and one from a part of the world not yet visited are likelier;
//   3. where none can (a guess a year or two off, with nothing on the globe changing in between: "Earlier than 2007"
//      already says all the clue would), it is still the clue that says why, though it narrows nothing more; the
//      change nearest the guess likeliest. A clue that holds in the guessed year too is never shown: it can only cut
//      the far side, which says nothing about the guess ("The Maghreb is independent" after a guess of 2007).
// A game is reproducible: its seed, the look and the guess fix every draw.

const KINDS = ['pick_state', 'pick_name']; // a picture before a name
const size = (S) => S.reduce((n, [a, b]) => n + b - a + 1, 0);
const NEAR = 3; // years: a clue whose edge lies this much further from the guess is e times less likely

/**
 * Everything the data says a globe of this year shows: { feature, option, state, members, from, to, into, out, run, set, kind }.
 * state: the feature's state that year; members: the states drawn alike (the option's); from / to: the decimal years the
 * picture starts and ends around the year (null: the timeline's end), into / out: the transitions there (indexes, or
 * null); run: those as whole years [first, last]; set: every year it holds (whole-year stretches).
 */
/**
 * Clues the game leaves out (the quiz keeps them): changes inside a country, which its globe can't show without drawing
 * internal borders, and a few lone outlines gave the hints away (decided 2026-11-21). Never a hint, never in "The world in …".
 */
export const GAME_LEAVES_OUT = new Set(['oklahoma-indian-territory', 'dakota-split', 'north-central-australia', 'nunavut', 'tocantins-state']);

export function cluePool(bundle, year, optionsFor, endYear, fits = null, seen = null) {
  const t = year + 0.5, out = [];
  for (const feature of bundle.features) {
    if (!['pick_state', 'pick_name'].includes(feature.kind) || feature.salience < 2 || feature.perspective || GAME_LEAVES_OUT.has(feature.id)) continue;
    const si = stateAt(feature, t);
    if (si < 0) continue;
    const state = feature.states[si];
    if (!state.validFrom && !state.validTo) continue;             // always true: no clue
    if (state.depictions?.length) continue;                        // drawn differently by different publishers
    if (fits && !fits(feature, state, t)) continue;                // a name the globe does not print that year
    const found = optionsFor(feature, 'en').find((o) => o.members.some((m) => m.state === si));
    if (!found?.claim) continue;
    const option = { ...found, claim: claimAsSeen(feature, si, found.claim) }, members = new Set(option.members.map((m) => m.state));
    // the picture's stretch around the year: neighbouring states drawn alike are one picture
    let first = si, lastS = si;
    while (first > 0 && members.has(first - 1)) first--;
    while (lastS < feature.states.length - 1 && members.has(lastS + 1)) lastS++;
    const from = toYear(feature.states[first].validFrom), to = toYear(feature.states[lastS].validTo);
    const clue = { feature: asSeenFeature(feature), option, state: si, members, from, to, into: first > 0 ? first - 1 : null, out: lastS < feature.states.length - 1 ? lastS : null, kind: feature.kind };
    // a clue says "you could have seen this": each of its changes must show on the globe the player turns (seenFrom)
    if (seen && [clue.into, clue.out].some((i) => i != null && !seen(feature.id, i))) continue;
    // the years it holds, as whole years (in the middle of each)
    const set = [];
    for (let y = AXIS_START; y <= endYear; y++) if (holds(clue, y)) { const m = set[set.length - 1]; if (m && m[1] === y - 1) m[1] = y; else set.push([y, y]); }
    clue.set = set; clue.run = set.find(([a, b]) => year >= a && year <= b);
    out.push(clue);
  }
  return out.sort((p, q) => (p.feature.id < q.feature.id ? -1 : 1));
}

/** True at the globe's year, not in year g. */
export const contrasts = (clue, g) => !holds(clue, g);

/**
 * The clue for the next look, after a miss at guess g that left the years S; used: the clues already shown.
 * Returns null when nothing in the data says why g was wrong (then the next look has the earlier / later alone).
 */
export function pickClue(game, S, g, used, look) {
  const nS = size(S), random = rng((game.seed ^ Math.imul(look + 1, 0x9e3779b1) ^ Math.imul(g, 0x85ebca6b)) >>> 0);
  const regions = new Set(used.map((c) => c.feature.region)), ids = new Set(used.map((c) => c.feature.id));
  const later = g < game.year; // the globe is later than the guess: the guess's side of a clue is its start
  const cutting = [];
  for (const c of game.pool) {
    if (ids.has(c.feature.id)) continue;
    const nK = size(interSet(S, c.set));
    if (nK >= nS || nK === 0) continue;
    // the years it cuts between the guess and its edge on that side (near), and on the far side (far)
    const [a, b] = c.run, near = later ? size(cutSet(S, -I, a - 1)) : size(cutSet(S, b + 1, I));
    cutting.push({ c, nK, near, far: nS - nK - near, contrast: contrasts(c, g) });
  }
  // a friend's custom globe (custom-globe.js): the sender's own answers (clue.fact) before the rest of the pool, tier by
  // tier; a standard game has no answers in its pool and draws exactly as before
  const prefs = game.pool.some((c) => c.fact) ? [true, false] : [null];
  const mine = (c, pref) => pref == null || !!c.fact === pref;
  for (const pref of prefs) for (const kind of KINDS) {
    const tier = cutting.filter((x) => x.c.kind === kind && x.contrast && mine(x.c, pref));
    if (!tier.length) continue;
    const weight = (x) => {
      const close = x.near > 0 ? Math.exp(-(x.near - 1) / NEAR) : 0.02; // nearest the guess first; one that cuts only the far side last
      return x.c.feature.salience ** 2 * close * (x.far > 0 ? 0.12 : 1) * (regions.has(x.c.feature.region) ? 0.5 : 1);
    };
    const total = tier.reduce((s, x) => s + weight(x), 0);
    let r = random() * total;
    for (const x of tier) { r -= weight(x); if (r <= 0) return x.c; }
    return tier[tier.length - 1].c;
  }
  // nothing that says why also narrows: the clue that says why, all the same (its change lies between the guess and the year)
  const gap = (c) => { const e = later ? c.from : c.to; return e == null ? 200 : Math.abs(e - (g + 0.5)); };
  for (const pref of prefs) for (const kind of KINDS) {
    const tier = game.pool.filter((c) => c.kind === kind && !ids.has(c.feature.id) && contrasts(c, g) && mine(c, pref));
    if (!tier.length) continue;
    const weight = (c) => c.feature.salience ** 2 * Math.exp(-gap(c) / NEAR) * (regions.has(c.feature.region) ? 0.5 : 1);
    const total = tier.reduce((s, c) => s + weight(c), 0);
    let r = random() * total;
    for (const c of tier) { r -= weight(c); if (r <= 0) return c; }
    return tier[tier.length - 1];
  }
  return null;
}

/**
 * A new game: { year, win (the winning years: the year and those its clues can't tell from it), lo, hi (win's bounds),
 * period ([from, to): the decimal years in which every one of its clues holds, the world exactly as its globe shows it;
 * a year wins when its middle lies in it), full (every year on the dial), pool (its possible clues), seed }.
 */
export function newGame(bundle, optionsFor, { year = null, seed = (Math.random() * 2 ** 32) >>> 0, endYear = new Date().getFullYear(), fits = null, seen = null } = {}) {
  const random = rng(seed);
  const y = year ?? FIRST + Math.floor(random() * (LAST - FIRST + 1));
  const pool = cluePool(bundle, y, optionsFor, endYear, fits, seen), win = winSet(pool, endYear), [lo, hi] = bounds(win);
  const period = [Math.max(AXIS_START, ...pool.map((c) => c.from ?? -I)), Math.min(endYear + 1, ...pool.map((c) => c.to ?? I))];
  return { year: y, seed, endYear, win, lo, hi, period, full: [[AXIS_START, endYear]], pool };
}

/**
 * The game so far, from the guesses alone. Each look: { g, win, s0, s1, s2, clue, next, dir }:
 * the years possible before the guess and after its "earlier / later" (dir: -1 earlier, +1 later); s2 = s1, as a
 * hint never narrows the dial beyond its guess (kept so the dial's two-step close still reads); clue: the hint this
 * look showed (null on the first look or when none could help); next: the clue the miss chose for the next look.
 */
export function play(game, guesses) {
  let S = game.full, clue = null;
  const hist = [], used = [];
  for (let k = 0; k < guesses.length && k < LOOKS; k++) {
    const g = guesses[k], win = inSet(game.win, g), s0 = S;
    let s1 = S, s2 = S, next = null, dir = 0;
    if (!win) {
      dir = g < game.year ? 1 : -1;
      s1 = dir > 0 ? cutSet(S, g + 1, I) : cutSet(S, -I, g - 1);
      s2 = s1; // a hint says which way and why; the clue's own years stay for the result
      if (k + 1 < LOOKS) { next = pickClue(game, s2, g, used, k); if (next) used.push(next); }
    }
    hist.push({ g, win, s0, s1, s2, clue, next, dir });
    S = s2; clue = next;
    if (win) break;
  }
  return hist;
}
export const isOver = (game, hist) => !!hist.length && (hist[hist.length - 1].win || hist.length >= LOOKS);

/** The line that sums a finished game up: a miss counts to the nearest winning year. */
export function verdictLine(game, hist) {
  const last = hist[hist.length - 1], off = distTo(game.win, last.g), n = hist.length;
  if (!last.win) return `${off} year${off === 1 ? '' : 's'} off`;
  return n === 1 ? 'Right on the first guess' : `Got it in ${n} guesses`;
}

/**
 * What a hint means for the year, said literally: the clue holds on the globe but not in the year just guessed, so the
 * globe is from after it ("This means after 2008") or before it ("This means before 2012"). When earlier guesses already
 * closed the other side: "This means between 1920 and 1950". Only the guesses' years, never the clue's own (a hint only
 * says earlier or later). hist: the guesses so far, { g, dir } (dir +1: the globe is later, −1: earlier).
 */
export function clueWhy(clue, g, hist = []) {
  if (!clue || !contrasts(clue, g)) return null;
  const later = clue.from != null && g + 0.5 < clue.from;
  const lo = Math.max(...hist.filter((h) => h.dir > 0).map((h) => h.g), later ? g : -I);
  const hi = Math.min(...hist.filter((h) => h.dir < 0).map((h) => h.g), later ? I : g);
  if (lo > -I && hi < I) return `This means between ${lo} and ${hi}`;
  return lo > -I ? `This means after ${lo}` : `This means before ${hi}`;
}

// --- The stories for the result -------------------------------------------------------------------------------
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function dateLabel(iso) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(String(iso ?? ''));
  if (!m) return String(iso ?? '');
  return m[3] ? `${Number(m[3])} ${MONTHS[m[2] - 1]} ${m[1]}` : m[2] ? `${MONTHS[m[2] - 1]} ${m[1]}` : m[1];
}
const story = (tr) => tr && tr.funFact ? { date: tr.date, when: dateLabel(tr.date), text: tr.funFact, source: tr.sources?.[0] ?? null, t: toYear(tr.date) } : null;

/**
 * The story behind a clue: the change at its edge that lies between the guess and the globe's year (why the guess
 * was wrong), else the edge nearest the globe's year.
 */
export function clueStory(clue, g, year) {
  const tr = clue.feature.transitions ?? [];
  const into = clue.into != null ? tr[clue.into] : null, out = clue.out != null ? tr[clue.out] : null;
  const pick = g != null && contrasts(clue, g) ? (g < year ? into : out) : [into, out].filter(Boolean).sort((p, q) => Math.abs(toYear(p.date) - year) - Math.abs(toYear(q.date) - year))[0];
  return story(pick ?? into ?? out);
}

/**
 * How you could have known: the fewest clues true in the globe's year that, together, rule out every year but the
 * winning ones (the year, or its group). Mostly two: one that had already come ("shows X", the edge into its picture)
 * and one that had not gone yet ("still shows Y", the edge out of it); one when a single picture lasted no longer than
 * the year; a third only where two can't do it.
 * They tell the year on their own, so "Why 1952" always shows how it could have been known. A clue the guesses already
 * earned (shown: their feature ids) may be one of them, on the result's other timeline: a set as small without one is
 * preferred, but never a larger set or a looser one (the 1952 game whose two hints, Libya and Eritrea, were both earned
 * showed clues that only narrowed it to 1947–1953).
 * Among sets as small: pictures before names (the globe prints names anyway), then the changes that are the game's
 * period's own edges (game.period: so the hints' bars meet the result's column), then clues not yet earned, then the
 * nearest, then the more striking. Listed pictures first, then the edge into before the edge out.
 * Returns { from, to (decimal years the hints leave; null: the timeline's own end), hints: [{ clue, edge }] }.
 */
export const MAX_KNOWN = 3;
export function knownHints(game, shown = new Set()) {
  const t = game.year + 0.5, endYear = game.endYear, [lo, hi] = [game.lo, game.hi];
  const mask = (c) => { let m = 0n; for (let y = AXIS_START; y <= endYear; y++) if (!inSet(c.set, y)) m |= 1n << BigInt(y - AXIS_START); return m; };
  let need = 0n; for (let y = AXIS_START; y <= endYear; y++) if (!inSet(game.win, y)) need |= 1n << BigInt(y - AXIS_START);
  const cand = game.pool.map((c) => ({ c, m: mask(c) })).filter((x) => x.m);
  // which edge of a clue does the work: the low one when its picture starts at the group, else the high one; a clue that
  // closes both sides tells the change nearer the year
  const edgeOf = (c) => {
    const [a, b] = c.run, low = a === lo && a > AXIS_START, high = b === hi && b < endYear;
    if (low && high) return t - c.from <= c.to - t ? 'into' : 'out';
    return low ? 'into' : high ? 'out' : (c.from != null && (c.to == null || t - c.from <= c.to - t) ? 'into' : 'out');
  };
  const near = (c, e) => (e === 'into' ? (c.from == null ? 200 : t - c.from) : (c.to == null ? 200 : c.to - t));
  // the changes that are the period's own edges (the latest before the year, the first after it) first: their bars then
  // meet the result's column exactly
  const [p0, p1] = game.period ?? [null, null], eq = (a, b) => a != null && b != null && Math.abs(a - b) < 1e-9;
  const edges = (set) => (p0 > AXIS_START && !set.some((x) => eq(x.c.from, p0)) ? 1 : 0) + (p1 < endYear + 1 && !set.some((x) => eq(x.c.to, p1)) ? 1 : 0);
  const score = (set) => set.reduce((n, x) => n + (x.c.kind === 'pick_name' ? 1e6 : 0) + (shown.has(x.c.feature.id) ? 5e3 : 0) + near(x.c, edgeOf(x.c)) * 10 - x.c.feature.salience, 0) + edges(set) * 1e4;
  const low = (v) => v & -v; // the earliest year still to rule out
  /** The best set of at most MAX_KNOWN that rules out every year in need. */
  const search = () => {
    let best = null;
    for (let k = 1; k <= MAX_KNOWN && !best; k++) {
      const rec = (chosen, m) => {
        const left = need & ~m;
        if (!left) { if (!best || score(chosen) < score(best)) best = [...chosen]; return; }
        if (chosen.length === k) return;
        const y = low(left); // any answer rules this year out: try each clue that does
        for (const x of cand) if (x.m & y && !chosen.includes(x)) { chosen.push(x); rec(chosen, m | x.m); chosen.pop(); }
      };
      rec([], 0n);
    }
    return best;
  };
  const best = search() ?? [];
  const hints = best.map((x) => ({ clue: x.c, edge: edgeOf(x.c) }))
    .sort((p, q) => (p.clue.kind === 'pick_state' ? 0 : 1) - (q.clue.kind === 'pick_state' ? 0 : 1) || (p.edge === 'into' ? 0 : 1) - (q.edge === 'into' ? 0 : 1) || near(p.clue, p.edge) - near(q.clue, q.edge));
  const from = Math.max(...hints.map((h) => h.clue.from ?? -Infinity)), to = Math.min(...hints.map((h) => h.clue.to ?? Infinity));
  return { from: Number.isFinite(from) ? from : null, to: Number.isFinite(to) ? to : null, hints };
}

/**
 * The period the clues on the result's screen allow: where all their bars overlap (decimal years [from, to), clamped to the
 * timeline). Every clue holds in the globe's year, so it holds the year; and because the hints rule out every other year
 * (with the earned ones where needed), a year wins exactly when its middle lies in it.
 */
export function shownPeriod(game, clues) {
  return [Math.max(AXIS_START, ...clues.map((c) => c.from ?? -I)), Math.min(game.endYear + 1, ...clues.map((c) => c.to ?? I))];
}

/** The story of one edge of a clue: the change into its state ('into') or out of it ('out'). */
export function edgeStory(clue, edge) {
  const tr = clue.feature.transitions ?? [];
  const i = edge === 'into' ? clue.into : clue.out;
  return story(i != null ? tr[i] : null);
}

/**
 * "On a 1929 globe, the Congo is a Belgian colony, … and …." (null when there is nothing to say). label: how the year is
 * written, a group of years that share one globe included ("On a 1977–78 globe, …"; yearLabel).
 */
export function thenLine(year, claims, label = String(year)) {
  if (!claims.length) return null;
  const parts = claims.map((c) => c.replace(/^The /, 'the '));
  const list = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return `On ${String(label).startsWith('18') ? 'an' : 'a'} ${label} globe, ${list}.`;
}

// --- The answer: one year, or a group of years that share one globe -----------------------------------------------
/**
 * The answer as the result writes it: the year, or the group of years its globe can't be told apart from (game.lo–hi),
 * written as ranges usually are: "1977–78", "2003–05", "1999–2000" across a century.
 */
export function yearLabel(game) {
  const { lo, hi } = game;
  if (lo === hi) return String(lo);
  return Math.floor(lo / 100) === Math.floor(hi / 100) ? `${lo}–${String(hi).slice(2)}` : `${lo}–${hi}`;
}
/**
 * Where the result's dial lands after the last guess g: on g itself when it won (a right 1977 stays 1977, never
 * "corrected" to the year the game drew), else on the nearest winning year (the year the verdict counts to).
 */
export function landing(game, g) {
  if (inSet(game.win, g)) return g;
  let best = null;
  for (const [a, b] of game.win) for (const y of [a, b]) if (best == null || Math.abs(y - g) < Math.abs(best - g)) best = y;
  return best;
}

/** A clue's years, as the quiz writes a range: "1918 – today", "until 1918", "1919 – 1991". */
export function clueYears(clue) {
  const a = clue.from == null ? null : Math.floor(clue.from), b = clue.to == null ? null : Math.floor(clue.to);
  return a == null ? `until ${b}` : b == null ? `${a} – today` : `${a} – ${b}`;
}

/** A game as a short code for a link, so the year isn't in plain sight (?g=…); and back. */
const K = 0x5bd1e995n, M40 = (1n << 40n) - 1n;
export function gameCode(year, seed) {
  const v = ((BigInt(seed >>> 0) << 8n) | BigInt((year - 1800) & 255)) & M40;
  return ((v * K) & M40).toString(36);
}
export function readGameCode(code) {
  if (!/^[0-9a-z]{1,9}$/.test(String(code ?? ''))) return null;
  const x = BigInt(parseInt(code, 36)) & M40;
  // the inverse of K modulo 2^40 (Newton's iteration)
  let inv = K; for (let i = 0; i < 6; i++) inv = (inv * (2n - K * inv)) & M40;
  const v = (x * inv) & M40, year = 1800 + Number(v & 255n), seed = Number(v >> 8n);
  // any year of the timeline: a shared dated globe can be later than the years a random game lands on
  return year >= AXIS_START && year <= new Date().getFullYear() ? { year, seed } : null;
}

// --- The names the globe prints for a year (data/names.json, tools/names.mjs) ------------------------------
const clean = (n) => n.replace(/\s*\(.*$/, '').replace(/^Congo, .*/, 'Congo').replace("Cote D'Ivoire", 'Ivory Coast').replace(/^Korea, People.*/, 'North Korea').replace(/^Korea, Republic.*/, 'South Korea').replace(/^Yemen, People.*/, 'South Yemen').replace(/^Vietnam, D.*/, 'North Vietnam').replace(/^Vietnam, R.*/, 'South Vietnam').replace('Italy/Sardinia', 'Italy');
const RAD = Math.PI / 180;
const dist = (a, b) => { // great-circle distance in radians between [lon, lat] points
  const dl = (b[0] - a[0]) * RAD, p1 = a[1] * RAD, p2 = b[1] * RAD;
  const h = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h)));
};
/** The words in a name that already say who ruled it ("British Honduras", "French Togoland"): no owner is added then. */
const SAYS = { 'Br.': /British|Anglo/, 'Fr.': /French/, 'Sp.': /Spanish/, 'Port.': /Portuguese/, 'Ger.': /German|Kaiser/, 'It.': /Italian/, 'Belg.': /Belgian/, 'Neth.': /Dutch/, 'U.S.': /American/, 'Jap.': /Japanese/ };
/** Who ruled territory g at decimal year t ("Sp.", "Br.", …), or null. */
export function ownerAt(names, g, t) {
  return names.owners?.[g]?.find(([a, b]) => a <= t && t < b)?.[2] ?? null;
}
/**
 * The names the globe prints on land no territory covers in decimal year t (names.json regions, tools/names.mjs REGION):
 * [from, until, name, lon, lat, size, owner, aka] ("Egyptian Sudan" with "Mahdist" under it in 1897, "Arabia" until 1926).
 */
export const regionsAt = (names, t) => (names.regions ?? []).filter((r) => r[0] <= t && t < r[1]);
/** A region's name as the globe prints it, with its owner: "Egyptian Sudan (Mahdist)". */
export const regionText = (r) => (r[6] ? `${r[2]} (${r[6]})` : r[2]);
/**
 * The region name printed on a point of blank land (no territory covers it) in decimal year t: the nearest region of that
 * year within 9° (a region's name stands in the middle of its land, as a country's does), or null: the globe prints
 * nothing there.
 */
export function regionAt(names, at, t) {
  let best = null, bd = 9 * RAD;
  for (const r of regionsAt(names, t)) { const d = dist(at, [r[3], r[4]]); if (d < bd) { bd = d; best = r; } }
  return best;
}
/** A clue's label names this region: its name, or another name period maps gave the same land (aka), brackets aside. */
export const namesRegion = (r, text) => [r[2], ...r[7]].some((n) => plain(n) === plain(text));
/**
 * One country as the globe prints it in decimal year t: [name, lon, lat, size, owner]. name: a name to print instead of
 * the period's (a friend's globe prints the spelling its sender read: custom-globe.js); the owner is still that year's,
 * left out when the name says it ("British Honduras").
 */
export function countryRow(names, c, t, name = null) {
  const rule = names.countries[c.g]?.find((r) => t < r[0]), printed = name ?? (rule ? rule[1] : clean(c.n)), owner = ownerAt(names, c.g, t);
  return [printed, c.at[0], c.at[1], c.s, owner && !SAYS[owner]?.test(printed) ? owner : null];
}
/**
 * names: data/names.json; countries: [{ g, n, at: [lon, lat], s }] for the borders of that date (scenes.countriesAt).
 * Returns { countries: [[name, lon, lat, size, owner]], cities: [[name, lon, lat, rank, capital]] }, most important
 * first; owner: who ruled it then ("Sp."), printed under its name, or null (independent, or the name says it).
 */
export function placesAt(names, countries, t) {
  // the countries of that date, and the names of the land no country covers then (regionsAt), printed alike
  const named = [...countries.map((c) => countryRow(names, c, t)), ...regionsAt(names, t).map(([, , name, lon, lat, s, owner]) => [name, lon, lat, s, owner])]
    .sort((p, q) => q[3] - p[3]);
  const cities = [];
  const rows = names.cities.filter((r) => r[0] <= t && t < r[1]).sort((p, q) => p[7] - q[7]);
  for (const [, , name, lon, lat, rank, cap, src] of rows) {
    const hit = cities.find((c) => dist([c.lon, c.lat], [lon, lat]) < 0.004);
    if (hit) {
      // a clue's name for the place wins; a capital there makes it a capital
      if (src === 1) { hit.cap = 1; hit.rank = Math.min(hit.rank, rank, 2); }
      continue;
    }
    cities.push({ name, lon, lat, rank, cap });
  }
  cities.sort((p, q) => p.rank - q.rank || q.cap - p.cap);
  return { countries: named, cities: cities.map((c) => [c.name, c.lon, c.lat, c.rank, c.cap]) };
}

// --- What the game's globe draws besides borders and names: the app's own clues, drawn plainly ------------------
/**
 * Lakes, a dried lagoon, the Date Line, the Panama Canal and its zone, the Arabian neutral zones, the line across
 * Cyprus, the islands of Severnaya Zemlya as they were charted, and the names of small places that have no country
 * of their own on the globe: each is taken from the clue's state that holds that year, so the globe changes exactly
 * when the clue does. styles: the clue's overlay style → the globe's plain one (a style not listed is not drawn:
 * the rivers a lake drowned are not on the globe, nor are any others). places: the clue's labels printed as names,
 * with who ruled the place (null: no one, or as the label says it in brackets); owned: only while the label names a
 * ruler (Walvis Bay is printed as an enclave, never as a plain Namibian town). peak: the label is a mountain's.
 */
export const LAYERS = {
  'lake-volta': { styles: { water: 'water' } }, 'lake-kariba': { styles: { water: 'water' } }, 'lake-nasser': { styles: { water: 'water' } },
  'rybinsk-reservoir': { styles: { water: 'water' } }, 'kakhovka-reservoir': { styles: { water: 'water' } }, 'aral-sea': { styles: { water: 'water' } },
  'kara-bogaz-gol': { styles: { water: 'water', salt: 'salt' } },
  'date-line': { styles: { dateline: 'dateline' } },
  'panama-canal-zone': { styles: { zone: 'zone', canal: 'canal', dashed: 'canal-building' }, places: { 'Canal Zone': 'U.S.' }, rank: 2 },
  'arabian-neutral-zones': { styles: { hatch: 'hatch' }, places: { 'Neutral Zone': null }, rank: 2 },
  'cyprus': { styles: { border: 'line' } },
  // before 1913 there is only sea where today's coastline has these islands; then the one land charted in 1913
  'severnaya-zemlya': { styles: { water: 'sea', island: 'island', undefined: 'uncharted' }, places: { 'Severnaya Zemlya': null }, rank: 2 },
  'easter-island': { styles: { island: 'island', highlight: 'island' }, places: { 'Easter Island': null }, rank: 2 },
  'netherlands-antilles': { styles: { island: 'island' }, places: { 'Curaçao': 'Neth.', 'Netherlands Antilles': 'Neth.' }, rank: 2 },
  'svalbard': { places: { 'Spitsbergen': null, 'Svalbard': null }, rank: 1 },
  'vanuatu-name': { places: { 'New Hebrides': 'Br./Fr.', 'Vanuatu': null }, rank: 2 },
  'communism-peak-name': { peak: true, rank: 2 },
  // colonies and enclaves too small for a border of their own on the globe
  'hong-kong-macau': { places: { 'Hong Kong': null, 'Macao': null }, rank: 1 },
  'kiaochow': { styles: { highlight: 'zone' }, places: { 'Kiaochow': null }, rank: 2, owned: true },
  'danish-west-indies': { styles: { island: 'island' }, places: { 'Danish West Indies': null, 'Virgin Islands': null }, rank: 2 },
  'walvis-bay': { styles: { highlight: 'zone' }, places: { 'Walvis Bay': null }, rank: 2, owned: true },
  // a border the atlases left undefined: dashed over the globe's solid line
  'saudi-yemen-border': { styles: { undefined: 'undefined' } },
  'white-sea-canal': { styles: { water: 'water', canal: 'canal' } },
  // the phantom island, charted until 2012
  'sandy-island': { styles: { island: 'island' }, places: { 'Sandy Island': null }, rank: 3 },
  // (no names inside countries: their five clues are out of the game, GAME_LEAVES_OUT)
};
/**
 * Five clues the quiz pictures with a river: before a dam (and, at Kakhovka, after the dam was destroyed in 2023) a
 * brass river line; after it, the lake. The game's globe draws the lakes (LAYERS) but never a river, nor the places these
 * pictures name (Aswan, Wadi Halfa, Victoria Falls, Rybinsk, Mologa, Zaporizhzhia: names.json prints none of them), so
 * in the game they say only what that globe shows: a lake there, or none. subject: the hint's tag; claims: per state.
 * Their pictures keep only what the globe draws (the lake's water) and no labels (sceneAsSeen). The quiz keeps its own.
 */
export const AS_SEEN = {
  // each claim places its lake by what the globe shows in every year of its state: a sea's shape, or a city it prints
  // under that name throughout (Accra, Moscow and Odessa 1886–2026; Salisbury to 1981, Lusaka from 1935), never a
  // country, whose printed name changes (United Arab Republic, Gold Coast, the Rhodesias, U.S.S.R.); a year without
  // the lake says what the globe shows there (dry land), not what is missing
  'lake-nasser': { subject: 'North-east Africa', claims: { 0: 'Dry land lies west of the Red Sea', 1: 'A long lake lies west of the Red Sea' } },
  'lake-volta': { subject: 'West Africa', claims: { 0: 'Dry land lies north of Accra', 1: 'A huge lake lies north of Accra' } },
  'lake-kariba': { subject: 'Southern Africa', claims: { 0: 'Dry land lies north-west of Salisbury', 1: 'A long lake lies south of Lusaka' } },
  'rybinsk-reservoir': { subject: 'Eastern Europe', claims: { 0: 'Dry land lies north of Moscow', 1: 'A big lake lies north of Moscow' } },
  'kakhovka-reservoir': { subject: 'Eastern Europe', claims: { 0: 'Dry land lies east of Odessa', 1: 'A long lake lies east of Odessa', 2: 'Dry land lies east of Odessa' } },
};
/** A state's claim in the game's words (AS_SEEN), else its own. */
export function claimAsSeen(feature, state, claim) { return AS_SEEN[feature.id]?.claims[state] ?? claim; }
/** A feature as the game names it: its subject (the hint's tag) in the game's words. */
export function asSeenFeature(feature) { return AS_SEEN[feature.id] ? { ...feature, subject: AS_SEEN[feature.id].subject } : feature; }
/** A clue's picture (scenes.sceneFor) cut to what the game's globe draws: the lake's water only, no river line, no labels. */
export function sceneAsSeen(id, scene) {
  if (!AS_SEEN[id]) return scene;
  return { ...scene, highlight: [], outlines: [], overlays: scene.overlays.filter((o) => LAYERS[id]?.styles?.[o.style]), labels: [] };
}
const featureIndex = new WeakMap();
const featureById = (bundle, id) => { if (!featureIndex.has(bundle)) featureIndex.set(bundle, new Map(bundle.features.map((f) => [f.id, f]))); return featureIndex.get(bundle).get(id); };
/**
 * The globe's own layer in decimal year t: { overlays: [{ style: 'base-…', geojson, feature }], places: [[name, lon, lat,
 * rank, owner]], peaks: [[name, lon, lat, rank]] }. skip: a feature id left out (the clue on show draws its own).
 */
export function layersAt(bundle, t, skip = null) {
  return layersFor(bundle, (f) => stateAt(f, t), skip);
}
/** The same layer with each feature's state given by stateOf(feature) (a friend's globe: its region's date, or the answer). */
export function layersFor(bundle, stateOf, skip = null) {
  const overlays = [], places = [], peaks = [];
  for (const [id, L] of Object.entries(LAYERS)) {
    if (id === skip) continue;
    const f = featureById(bundle, id), si = f ? stateOf(f) : -1;
    if (si < 0) continue;
    const st = f.states[si];
    for (const o of st.visual?.ref?.overlays ?? []) { const style = L.styles?.[o.style]; if (style && o.geojson) overlays.push({ style: `base-${style}`, geojson: o.geojson, feature: id }); }
    for (const l of st.visual?.labels ?? []) {
      const text = l.names?.en?.[0]; if (!text || !l.at) continue;
      if (L.peak) { peaks.push([text, l.at[0], l.at[1], L.rank ?? 2]); continue; }
      const m = /^(.*?)\s*\(([^)]*)\)$/.exec(text), name = m ? m[1] : text;
      if (L.owned && !m) continue;
      if (L.places && name in L.places) places.push([name, l.at[0], l.at[1], L.rank ?? 2, m ? m[2] : L.places[name]]);
    }
  }
  return { overlays, places, peaks };
}
/** Whether the game's globe shows a feature's change (transition i): names.json seen (tools/seen.mjs); unknown = yes. */
export const seenFrom = (names) => (id, i) => names?.seen?.[id]?.[i] !== 0;

/** Other names a clue's label may use for a territory (by Gleditsch–Ward code), besides those in names.json and CShapes. */
const ALIAS = { 840: ['Philippine Islands'], 696: ['Trucial States', 'Trucial Coast'], 850: ['Netherlands East Indies', 'Netherlands Indies'], 851: ['Netherlands New Guinea'],
  255: ['German Empire'], 750: ['British India'], 823: ['North Borneo', 'Malaysia'], 625: ['Sudan'], 471: ['Cameroons', 'Cameroun'], 115: ['Surinam', 'Suriname'], 360: ['Romania', 'Roumania'],
  365: ['Soviet Union', 'USSR', 'Russia'], 2: ['United States', 'USA'], 610: ['Spanish Sahara'], 640: ['Ottoman Empire'], 730: ['Korea'], 713: ['Formosa', 'Taiwan'],
  // a later country's name on the territory that stood there before it: the globe's own name for that year is printed
  824: ['Malaysia'], 821: ['Malaya'], 822: ['Malaya'], 827: ['Malaya'], 8201: ['Malaya'], 8202: ['Malaya'], 8203: ['Malaya'],
  4781: ['Nigeria'], 4782: ['Nigeria'], 4783: ['Nigeria'], 4784: ['Nigeria'], 912: ['German New Guinea'], 678: ['North Yemen'],
  680: ['Yemen'], 681: ['Yemen'], 6801: ['Yemen'], 6812: ['Yemen'], 5518: ['Northern Rhodesia'], 5519: ['Northern Rhodesia'], 552: ['Northern Rhodesia'],
  310: ['Austria-Hungary'], 305: ['Austria-Hungary'] };
const plain = (s) => String(s).toLowerCase().replace(/\s*\(.*?\)/g, '').replace(/^(the|union of|commonwealth of|federation of|republic of|kingdom of|territory of)\s+/g, '').replace(/[^a-z]/g, '');
/**
 * A clue's country label as the game's globe prints that territory in decimal year t: its name then, and who ruled it
 * ("Ethiopia" for "Abyssinia" in 1985, "Angola" for "Angola (Port.)" after 1975, "Philippines (Sp.)"). Only when the label
 * names the territory it stands on (g, CShapes name n, other CShapes names `known`); else null (a region such as "East
 * Pakistan" or "Canal Zone" keeps the clue's own words).
 */
export function periodLabel(names, g, known, n, text, t) {
  const all = new Set([...(names.countries[g] ?? []).map((r) => r[1]), ...known, ...(ALIAS[g] ?? []), n].map((x) => plain(clean(String(x)))));
  if (!all.has(plain(text))) return null;
  const row = countryRow(names, { g, n, at: [0, 0], s: 1 }, t);
  return row[4] ? `${row[0]} (${row[4]})` : row[0];
}

/**
 * Whether a clue agrees with the globe in decimal year t, so the game shows it only then:
 *   - every territory its picture highlights is on the globe that year (else the picture would bring another era's borders);
 *   - a name clue: every country it names is printed under that name then ("Northern Rhodesia" is left out before 1911,
 *     when the globe prints North-Western Rhodesia);
 *   - any clue: a country label on land no territory covers that year names what the globe prints there (a region of
 *     names.json: "Egyptian Sudan (Mahdist)" in 1897), or a territory just beside it ("Transjordan", whose label stands a
 *     little south of CShapes' first outline). A label the globe has nothing for (Nigeria in 1890, on the land it
 *     prints as Sokoto; Saudi Arabia in 1920) keeps the clue out: its hint would name what the player never saw.
 * territoryAt(at, t) -> { g, n } | null, namesOf(g) and has(g, t) come from scenes.js (or the same data in Node);
 * onLand([lon, lat]): the point is land on the globe's coastline (world-atlas). Without it, a label off every territory is
 * taken to stand on the sea beside its islands, as before.
 */
export function globeFits(names, { territoryAt, namesOf, has, onLand = () => false }) {
  /** A territory within about 2° of a point whose period names include the label's (null: none). */
  const beside = (at, text, t) => {
    for (const k of [1, 2]) for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4, p = [at[0] + k * Math.cos(a) / Math.max(0.2, Math.cos(at[1] * RAD)), at[1] + k * Math.sin(a)];
      const u = territoryAt(p, t);
      if (u && periodLabel(names, u.g, namesOf(u.g), u.n, text, t) != null) return u;
    }
    return null;
  };
  return (feature, state, t) => {
    const ref = state.visual?.ref ?? {}, codes = ref.merge ?? ref.gwcodes ?? (ref.gwcode != null ? [ref.gwcode] : []);
    if (!codes.every((g) => has(g, t))) return false;
    for (const l of state.visual?.labels ?? []) {
      const text = l.names?.en?.[0];
      if (!text || !l.at || (l.kind ?? 'country') !== 'country') continue;
      let u = territoryAt(l.at, t);
      if (!u && onLand(l.at)) {
        // blank land: a territory beside it that the label names, else the name printed there, else nothing
        u = beside(l.at, text, t);
        if (!u) { const r = regionAt(names, l.at, t); if (r && namesRegion(r, text)) continue; return false; }
      }
      if (!u || feature.kind !== 'pick_name') continue;
      const printed = periodLabel(names, u.g, namesOf(u.g), u.n, text, t);
      if (printed == null || plain(printed) !== plain(text)) return false;
    }
    return true;
  };
}

/** A clue as one line that stands on its own: the subject leads when the claim leans on it ("Russia and its neighbours: it is one country…"). */
export function clueLine(clue) {
  return standAlone(clue.feature, clue.option.claim);
}
const LEANS = /^(It|Its|They|There|This|The country|The region)\b/;
const standAlone = (feature, c) => (LEANS.test(c) ? `${feature.subject}: ${c.charAt(0).toLowerCase()}${c.slice(1)}` : c);

// --- Why that year: the result's second timeline -----------------------------------------------------------------
/**
 * The changes around the globe's year, for "Why 1991" under the clues that pin the year (knownHints): clues the game
 * could use (game.pool) with a change within `window` years of the year, drawn at random from the game's seed, likelier
 * when striking (salience²), a picture (×3), with a fun fact (×1.5, else ×0.5) and near (e^(−d/8)); a part of the world
 * already on screen counts ×0.3. A change at the same date as a clue already on screen (datesUsed) is skipped. Two rows
 * or more hold both sides of the year: at least one change before it and one after, where the window has both. Every
 * row states the picture the globe's year shows, so its bar holds the year: a change before it reads "The Bahamas are
 * independent (1973 – today)", never the picture that had just ended ("The Bahamas are British (until 1973)", which a
 * player has to flip to read as a fact about the year).
 * Returns at most n: [{ clue, edge ('into' | 'out': the change shown), line (the claim, standing on its own), years,
 * from, to (the bar's decimal years; null: the timeline's end), d }], earliest change first.
 */
export const NEAR_WINDOW = 15;
export function nearbyClues(game, { exclude = new Set(), n = 3, window = NEAR_WINDOW, regionsUsed = [], datesUsed = [] } = {}) {
  const t = game.year + 0.5, random = rng((game.seed ^ 0x51ed2701) >>> 0), cand = [];
  for (const c of game.pool) {
    if (exclude.has(c.feature.id)) continue;
    const dIn = c.from != null ? t - c.from : I, dOut = c.to != null ? c.to - t : I;
    const edge = dIn <= dOut ? 'into' : 'out', d = Math.min(dIn, dOut);
    if (!(d <= window)) continue;
    const at = edge === 'into' ? c.from : c.to;
    if (datesUsed.some((x) => x != null && Math.abs(x - at) < 0.02)) continue; // the same change as a clue already on screen
    const tr = c.feature.transitions?.[edge === 'into' ? c.into : c.out];
    const w = c.feature.salience ** 2 * (c.kind === 'pick_state' ? 3 : 1) * (tr?.funFact ? 1.5 : 0.5) * Math.exp(-d / 8);
    cand.push({ clue: c, edge, line: clueLine(c), years: clueYears(c), from: c.from, to: c.to, d, w });
  }
  const out = [], regions = new Set(regionsUsed);
  while (out.length < n && cand.length) {
    const wt = (x) => x.w * (regions.has(x.clue.feature.region) ? 0.3 : 1);
    // both sides of the year: the last row comes from the other side when every row so far is a change before it (or
    // every one after it), where the window holds one
    const other = n >= 2 && out.length === n - 1 && out.every((x) => x.edge === out[0].edge) ? (out[0].edge === 'into' ? 'out' : 'into') : null;
    const from = other && cand.some((x) => x.edge === other) ? cand.filter((x) => x.edge === other) : cand;
    const total = from.reduce((s, x) => s + wt(x), 0);
    let r = random() * total, k = 0;
    for (; k < from.length - 1; k++) { r -= wt(from[k]); if (r <= 0) break; }
    const x = from[k]; cand.splice(cand.indexOf(x), 1); out.push(x); regions.add(x.clue.feature.region);
  }
  return out.sort((a, b) => (a.edge === 'into' ? -a.d : a.d) - (b.edge === 'into' ? -b.d : b.d));
}

// --- The world in a year: the last guess's story ---------------------------------------------------------------------
/** The era a year belongs to, as one line that opens "The world in …" (by the period's first year). */
export const ERAS = [
  [1885, 'Empires are still racing to fill in the map of Africa.'],
  [1900, 'A few empires rule most of the world, and the map looks settled. It isn’t.'],
  [1914, 'The First World War is tearing up Europe’s borders.'],
  [1919, 'Europe has a crop of brand-new countries; almost everywhere else is still an empire.'],
  [1939, 'The Second World War: borders move with the armies.'],
  [1946, 'The war is over and the old empires are starting to come apart.'],
  [1960, 'The decade Africa’s map fills with new countries.'],
  [1970, 'The Cold War splits the map in two, and the last colonies go one by one.'],
  [1990, 'The Cold War is over and new countries appear almost every year.'],
  [2000, 'Nearly today’s map: the changes are small, and easy to miss.'],
];
export const eraOf = (year) => ERAS.filter(([from]) => year >= from).pop()?.[1] ?? ERAS[0][1];

/**
 * What a globe of this year shows that today's doesn't: the bundle's pictures (pick_state, salience ≥ 3, no perspective,
 * one picture for every publisher) whose state that year is not today's, as claims that stand in a sentence. Most
 * striking first: [{ id, region, sal, claim }].
 */
export function worldClaims(bundle, year, optionsFor, endYear, keep = null) {
  const t = year + 0.5, now = endYear + 0.5, out = [];
  for (const f of bundle.features) {
    if (f.kind !== 'pick_state' || f.salience < 3 || f.perspective || GAME_LEAVES_OUT.has(f.id)) continue;
    const a = stateAt(f, t), b = stateAt(f, now);
    if (a < 0 || a === b || f.states[a].depictions?.length) continue;
    if (keep && !keep(f, a)) continue; // a friend's globe: only what it draws as that year's (custom-globe.js)
    const option = optionsFor(f, 'en').find((o) => o.members.some((m) => m.state === a));
    const claim = option?.claim && claimAsSeen(f, a, option.claim);
    if (claim && !LEANS.test(claim)) out.push({ id: f.id, region: f.region, sal: f.salience, claim });
  }
  return out.sort((p, q) => q.sal - p.sal || (p.id < q.id ? -1 : 1));
}
/** The continent a bundle region lies on (the world story takes one claim from each first). */
export const continentOf = (r) => (/africa/.test(r) ? 'africa' : /^europe/.test(r) ? 'europe' : /america|caribbean/.test(r) ? 'americas' : /oceania|pacific/.test(r) ? 'oceania' : 'asia');
/** A claim that needs its subject to make sense on its own ("Nanking is the capital", "The lagoon is gone"). */
export const leansOnSubject = (c) => /is the capital$|^The (whole|lagoon|city|islands?)\b|^All of\b/.test(c);
/**
 * Four things a globe of this year shows that today's doesn't, for "The world in …": one per continent first, then
 * other regions; never two that end in the same three words; the most striking first, and one with a comma of its own
 * last, so the list still reads as a list (thenLine writes the sentence).
 */
export function worldPick(bundle, year, optionsFor, endYear, n = 4, keep = null) {
  const all = worldClaims(bundle, year, optionsFor, endYear, keep).filter((x) => !leansOnSubject(x.claim)), picked = [], conts = new Set(), regs = new Set();
  const tail = (c) => c.split(' ').slice(-3).join(' '), same = (x) => picked.some((p) => tail(p.claim) === tail(x.claim));
  for (const x of all) { if (picked.length >= n) break; if (conts.has(continentOf(x.region)) || same(x)) continue; conts.add(continentOf(x.region)); regs.add(x.region); picked.push(x); }
  for (const x of all) { if (picked.length >= n) break; if (picked.includes(x) || regs.has(x.region) || same(x)) continue; regs.add(x.region); picked.push(x); }
  return picked.sort((p, q) => (p.claim.includes(',') - q.claim.includes(',')) || all.indexOf(p) - all.indexOf(q)).map((x) => x.claim);
}
