// A friend's globe: the globe the sender dated, rebuilt from the answers they gave, for the friend to play Guess the year
// on ("Share as a game", ?d=<code>). Real globes mix years (a printer updates some regions and not others), so the
// rebuilt globe may too. Pure: no DOM; topojson and d3 come in from outside (the browser's, or npm's in the tests).
//
// THE LINK (writeLink / readLink): URL-safe base64 of
//   version 6 bits (1: the first character is always "B", so it can't be mistaken for an older ?d= game code)
//   check 6 (a hash of everything after it: a mistyped or cut link is told apart)
//   the most likely year − 1800 (8), whether every answer agrees (1), the years they agree on as offsets from that year
//   (6 + 6, −32…31), the map's language (4: LANGS)
//   then per answer (one per feature, the last one given): the feature's link number (9), the link number of a state of
//   the option asked (4), its depiction + 1 (2; 0: none), yes / no (1)
// Feature and state numbers are stable (data/link-ids.json, tools/link-ids.mjs), so a link outlives edits to the data; a
// number the data doesn't know any more, a bad check or another version make readLink say why, and the app opens a
// normal game with a note.
//
// THE FACTS (factOf): what the sender's globe shows for each answer. Perspective questions and "not sure" give none.
// The base year is the dated result's most likely year. A yes: the asked option's state in the base year when the
// option allows it, else its state nearest in time. A no: nothing changes unless the base year's state was the one
// denied, then the nearest other state. A no is weaker than a yes (conflicts, below).
//
// THE GLOBE (compose): the world of the base year, with every fact that is not true then drawn from a date one year
// inside its span (a third of the span when shorter: at the very edge the border data may already show the change,
// as the Soviet republics split off from August 1991). By kind of question:
//   a shape (pick_state with countries; a state that names none takes the countries of all the feature's states):
//     out goes whatever of the world lies mostly (> 20%) under the fact's countries on that date, in comes that date's
//     world there, round by round until the patch closes. Overlaps come from tools/overlaps.mjs (precomputed shares of
//     each border version inside each other), so this is a few set operations. No answers first, then yes answers,
//     each in the order given: a yes swap goes over a no swap. A swap that a later one wipes out is "overridden"; one
//     whose date draws the same lines and names there is "same". An answer's own countries are drawn as of its date even
//     where CShapes has one shape for both dates, when the globe prints them otherwise then (the Gold Coast, Lado).
//   a capital (…-capital): the cities its pictures label take that date (so the capital marker moves with the answer).
//   a name (pick_name): the name printed there is the sender's own spelling, in their map's language; a country's name
//     with the owner of that date ("Gold Coast (Br.)"), a city's name with its capital status of that date. Lake and
//     peak names: the game's globe prints none.
//   a layer (game-logic LAYERS: lakes, the Date Line, the Canal Zone, small places and enclaves…): drawn in the answer's
//     state.
// Conflicts: every shape answer the base year shows is CONFIRMED. A swapped shape over a confirmed country gives way
// when its answer is no stronger: the base year's countries under it come back, the confirmed ones as themselves and the
// rest drawn as ONE (the borders between them hidden, one name: the swapped shape's, of its date). A piece of such a
// group that doesn't touch its main body is drawn on its own, as the base year has it (North Macedonia, cut off from
// "Yugoslavia" by Serbia and Kosovo, stays Macedonia).
// Everything else follows the place it lies in: each country, city and capital marker, small place and layer is drawn
// as of the date its region comes from (a swapped region's date, a group's date, else the base year). So inside a
// swapped Soviet Union Kiev is no capital and St. Petersburg is Leningrad; inside a group "Yugoslavia" Zagreb isn't
// ringed. Borders: the lines between the countries drawn, plus the seam lines a swapped piece brings where its own era
// had a neighbour (topology arcs). A globe whose answers all hold in the base year is exactly the standard world.
//
// THE GAME (customGame): a game object for game-logic's play() / pickClue.
//   pool: the sender's answers that hold in the base year (clue.fact, shown first), then the standard clues of that
//         year whose picture lies wholly in untouched regions (no swapped or merged country, no moved name or capital,
//         no feature the sender answered): a hint can never contradict the globe ("Germany is reunified" on a globe
//         with two Germanys). Answers that don't hold in the base year are drawn, never a hint.
//   win:  the base year's group (the years the drawn globe can't tell apart, as in every game), joined with the years
//         every answer agrees on when they all agree (always right: each of the sender's answers allows them), and
//         the years between. Only clues that hold in all of those years stay in the pool, so no hint ever calls a winning
//         year wrong; the winning years are then those the pool can't tell apart (game-logic winSet), as in every game.
//   rows: the sender's answers as the dating result draws them (✓ / ✗, the years each reply allows), for the result's
//         second timeline: every answer the globe draws, in the order given (the timeline scrolls past five).

import * as R from './game-logic.js';

export const LINK_VERSION = 1;
/** The map languages a link can carry, in a fixed order (append only). */
export const LANGS = ['en', 'nl', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'sv', 'da', 'pl', 'cs', 'tr', 'ja'];
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const BITS = { version: 6, check: 6, base: 8, all: 1, off: 6, lang: 4, feature: 9, state: 4, depiction: 2, reply: 1 };
const PER_ANSWER = BITS.feature + BITS.state + BITS.depiction + BITS.reply;
const I = Infinity;

/** A custom globe's code (?d=): it starts with this version's letter; an older ?d= game code is short lowercase. */
export const isCustomCode = (code) => /^[A-Za-z0-9_-]{8,}$/.test(code ?? '') && code[0] === B64[LINK_VERSION];

const checksum = (bits) => { let h = 0x811c9dc5; for (let i = 0; i < bits.length; i++) h = Math.imul(h ^ (bits[i] + 1 + (i & 7)), 0x01000193) >>> 0; return (h ^ (h >>> 6) ^ (h >>> 12) ^ (h >>> 18)) & 63; };

/**
 * spec: { base (the most likely year), agree ([first, last] whole years every answer agrees on, or null), language,
 *         answers: [{ feature, state (index of a state of the option asked), depiction (index or null), reply }] }
 */
export function writeLink({ base, agree = null, language = 'en', answers }) {
  const body = [];
  const put = (v, n) => { for (let i = n - 1; i >= 0; i--) body.push((v >> i) & 1); };
  const off = (y) => Math.max(-32, Math.min(31, y - base)) + 32;
  put(Math.max(0, Math.min(255, base - 1800)), BITS.base);
  put(agree ? 1 : 0, BITS.all); put(agree ? off(agree[0]) : 32, BITS.off); put(agree ? off(agree[1]) : 32, BITS.off);
  put(Math.max(0, LANGS.indexOf(language)), BITS.lang);
  for (const a of answers) {
    put(a.feature.link, BITS.feature); put(a.feature.states[a.state].link, BITS.state);
    put(a.depiction == null ? 0 : a.depiction + 1, BITS.depiction); put(a.reply === 'yes' ? 1 : 0, BITS.reply);
  }
  const bits = [];
  const head = (v, n) => { for (let i = n - 1; i >= 0; i--) bits.push((v >> i) & 1); };
  head(LINK_VERSION, BITS.version); head(checksum(body), BITS.check); bits.push(...body);
  while (bits.length % 6) bits.push(0);
  let s = ''; for (let i = 0; i < bits.length; i += 6) s += B64[parseInt(bits.slice(i, i + 6).join(''), 2)];
  return s;
}
/** The spec back from a code, or { error: 'unreadable' | 'version' | 'check' | 'unknown' } (unknown: data the app no longer has). */
export function readLink(code, bundle) {
  if (!/^[A-Za-z0-9_-]+$/.test(String(code ?? ''))) return { error: 'unreadable' };
  const bits = [];
  for (const ch of code) { const v = B64.indexOf(ch); for (let i = 5; i >= 0; i--) bits.push((v >> i) & 1); }
  let at = 0; const take = (n) => { let v = 0; for (let i = 0; i < n; i++) v = (v << 1) | (bits[at++] ?? 0); return v; };
  if (bits.length < BITS.version + BITS.check + BITS.base + BITS.all + 2 * BITS.off + BITS.lang + PER_ANSWER) return { error: 'unreadable' };
  if (take(BITS.version) !== LINK_VERSION) return { error: 'version' };
  const check = take(BITS.check), headEnd = at;
  const bodyLen = bits.length - headEnd, used = BITS.base + BITS.all + 2 * BITS.off + BITS.lang, n = Math.floor((bodyLen - used) / PER_ANSWER);
  if (checksum(bits.slice(headEnd, headEnd + used + n * PER_ANSWER)) !== check) return { error: 'check' };
  const base = 1800 + take(BITS.base), all = take(BITS.all), a = take(BITS.off) - 32, b = take(BITS.off) - 32, language = LANGS[take(BITS.lang)] ?? 'en';
  if (base < R.AXIS_START || base > 2100) return { error: 'unreadable' };
  const byLink = linkIndex(bundle), answers = [];
  for (let k = 0; k < n; k++) {
    const fl = take(BITS.feature), sl = take(BITS.state), dep = take(BITS.depiction) - 1, reply = take(BITS.reply) ? 'yes' : 'no';
    const f = byLink.get(fl), state = f ? f.states.findIndex((s) => s.link === sl) : -1;
    if (!f || state < 0 || (dep >= 0 && !f.states[state].depictions?.[dep])) return { error: 'unknown' };
    answers.push({ feature: f, state, depiction: dep >= 0 ? dep : null, reply });
  }
  return { base, agree: all ? [base + a, base + b] : null, language, answers };
}
const linkIndexes = new WeakMap();
const linkIndex = (bundle) => { if (!linkIndexes.has(bundle)) linkIndexes.set(bundle, new Map(bundle.features.map((f) => [f.link, f]))); return linkIndexes.get(bundle); };

// --- The answers and the facts ------------------------------------------------------------------------------------
const spanOf = (st) => [R.toYear(st.validFrom) ?? -I, R.toYear(st.validTo) ?? I];
const distTo = (st, t) => { const [a, b] = spanOf(st); return t < a ? a - t : t >= b ? t - b : 0; };
/** The option an answer was given to: the one holding its state (and depiction) in the map's language. */
export const optionOf = (feature, state, depiction, language, optionsFor) =>
  optionsFor(feature, language).find((o) => o.members.some((m) => m.state === state && (m.depiction ?? null) === (depiction ?? null)))
  ?? optionsFor(feature, language).find((o) => o.members.some((m) => m.state === state));

/**
 * The answers to send, from the dating result's rows (app.js answerRows: featureId, optionKey, reply): yes and no
 * only, no perspective questions, one per feature (the last one given, in its place).
 */
export function answersFrom(rows, featureById, optionsFor, language) {
  const out = new Map();
  for (const r of rows) {
    const f = featureById.get(r.featureId);
    if (!f || f.perspective || (r.reply !== 'yes' && r.reply !== 'no')) continue;
    const o = optionsFor(f, language).find((x) => x.key === r.optionKey), m = o?.members[0];
    if (!m) continue;
    out.delete(f.id); out.set(f.id, { feature: f, state: m.state, depiction: m.depiction ?? null, reply: r.reply });
  }
  return [...out.values()];
}
/** What the sender's globe shows for an answer: { feature, option, reply, state (the state drawn) }, or null. */
export function factOf(answer, base, language, optionsFor) {
  const { feature, reply } = answer, option = optionOf(feature, answer.state, answer.depiction, language, optionsFor);
  if (!option || feature.perspective || (reply !== 'yes' && reply !== 'no')) return null;
  const t = base + 0.5, inOpt = new Set(option.members.map((m) => m.state));
  const allowed = feature.states.map((_, i) => i).filter((i) => (reply === 'yes') === inOpt.has(i));
  if (!allowed.length) return null;
  const best = allowed.reduce((x, i) => (distTo(feature.states[i], t) < distTo(feature.states[x], t) ? i : x));
  return { feature, option, reply, state: best, allowed };
}
/** The whole years every answer agrees on (agreement()'s from / to, null = open), when all of them do: [first, last]. */
export function agreeYears(agree, startYear, endYear) {
  if (!agree || agree.count !== agree.n) return null;
  const a = Math.floor(agree.from ?? startYear), b = Math.ceil(agree.to ?? endYear + 1) - 1;
  return b >= a ? [a, b] : null;
}

// --- The globe ------------------------------------------------------------------------------------------------------
const codesOf = (st) => { const ref = st?.visual?.ref ?? {}; return ref.merge ?? ref.gwcodes ?? (ref.gwcode != null ? [ref.gwcode] : []); };
const featureCodes = (f) => [...new Set(f.states.flatMap(codesOf))];
const kindOf = (f) => (R.LAYERS[f.id] ? 'layer' : f.kind === 'pick_name' ? 'name' : /-capital$/.test(f.id) ? 'capital' : 'shape');
const UNPRINTED = /lake|peak|denali/; // names the game's globe never prints (tools/names.mjs leaves them out too)
const NEAR = 0.35; // degrees: a label and the city it names
const near = (a, b) => Math.abs(a[0] - b[0]) < NEAR && Math.abs(a[1] - b[1]) < NEAR;

/**
 * createCustomGlobe({ topo, overlaps, names, bundle, topojson, d3, optionsFor, endYear }).compose(spec) → the globe:
 *   { base, t, facts, world (a scene: borders, overlays), names ({ countries, cities, places, peaks } for globe.setNames),
 *     report ([{ id, claim, reply, did, date, … }]), gap, overlap, dateAt(at), printedAt(at), highlightOf(feature id),
 *     untouched(feature, state), fact(feature id), dateOfClue(clue) }
 */
export function createCustomGlobe({ topo, overlaps, names, bundle, topojson, d3, optionsFor, endYear }) {
  const geoms = topo.objects.states.geometries;
  if (overlaps.check.versions !== geoms.length || overlaps.check.arcs !== topo.arcs.length) throw new Error('overlaps.json was made from other borders: run npm run build');
  const shares = overlaps.shares.map((list) => new Map(list)), area = overlaps.area;
  const idxOf = new Map(geoms.map((g, i) => [g, i]));
  const worlds = new Map();
  const world = (d) => { const k = Math.round(d * 1000); if (!worlds.has(k)) worlds.set(k, geoms.map((g, i) => [g.properties, i]).filter(([p]) => p.a <= d && d <= p.b).map(([, i]) => i)); return worlds.get(k); };
  const S = (i, j) => (i === j ? 1 : shares[i].get(j) ?? 0);
  const shareIn = (i, set) => { let s = set.has(i) ? 1 : 0; for (const [j, v] of shares[i]) if (set.has(j)) s += v; return Math.min(1, s); };
  const arcsOf = (g) => (g.type === 'Polygon' ? g.arcs.flat() : g.type === 'MultiPolygon' ? g.arcs.flat(2) : []).map((a) => (a < 0 ? ~a : a));
  const arcCounts = new Map();
  const countArcs = (list) => { const m = new Map(); for (const i of list) for (const a of arcsOf(geoms[i])) m.set(a, (m.get(a) ?? 0) + 1); return m; };
  const eraArcs = (d) => { const k = Math.round(d * 1000); if (!arcCounts.has(k)) arcCounts.set(k, countArcs(world(d))); return arcCounts.get(k); };
  const key = (at) => `${(+at[0]).toFixed(2)},${(+at[1]).toFixed(2)}`;

  function compose(spec) {
    const y = spec.base, t = y + 0.5, end = endYear + 1, language = spec.language ?? 'en';
    const base = world(t);
    const cur = new Set(base), from = new Map(), owner = new Map(); // geometry → the date it is drawn from (else the base year), → the fact that brought it
    const facts = [];
    for (const a of spec.answers) {
      const x = factOf(a, y, language, optionsFor); if (!x) continue;
      const st = x.feature.states[x.state], [s0, s1] = spanOf(st), atBase = R.stateAt(x.feature, t) === x.state;
      const m = Math.min(1, (Math.min(s1, end) - Math.max(s0, R.AXIS_START)) / 3);
      facts.push({ ...x, st, kind: kindOf(x.feature), strong: x.reply === 'yes', atBase, date: atBase ? t : t < s0 ? s0 + m : s1 - m, did: null });
    }
    // 1. shapes: no answers first, then yes answers, each in the order given
    // (a name of a country the base year doesn't have, "Czechoslovakia" on a 2000 globe, brings that country in too)
    const baseCodes = new Set(base.map((i) => geoms[i].properties.g));
    for (const x of facts) if (x.kind === 'name' && !x.atBase && codesOf(x.st).length && codesOf(x.st).some((c) => !baseCodes.has(c))) x.nameSwap = true;
    for (const x of [...facts.filter((f) => !f.strong), ...facts.filter((f) => f.strong)]) {
      if (x.kind !== 'shape' && !x.nameSwap) continue;
      x.codes = codesOf(x.st).length ? codesOf(x.st) : featureCodes(x.feature);
      if (!x.codes.length) { x.did = 'not drawn'; continue; }
      if (x.atBase) { x.did = 'base'; continue; }
      const there = world(x.date), mine = there.filter((i) => x.codes.includes(geoms[i].properties.g));
      if (!mine.length) { x.did = 'no shape'; continue; }
      const inn = new Set(mine), out = new Set();
      for (let round = 0; round < 8; round++) {
        let changed = false;
        for (const g of cur) if (!out.has(g) && !inn.has(g) && shareIn(g, inn) > 0.2) { out.add(g); changed = true; }
        for (const g of there) if (!inn.has(g) && !cur.has(g) && shareIn(g, out) > 0.2) { inn.add(g); changed = true; }
        if (!changed) break;
      }
      for (const g of out) { cur.delete(g); from.delete(g); owner.delete(g); }
      // the answer's own countries are drawn as of its date even where the border version is the same one (CShapes has one
      // shape for the Gold Coast and Ghana, for Lado inside the Congo): their names, cities and layers then follow it; only
      // where the globe prints it otherwise then (France, listed with its colonies, stays the base year's)
      const printedThen = (g, d) => R.countryRow(names, { g: geoms[g].properties.g, n: geoms[g].properties.n, at: [0, 0], s: 0 }, d).join('|');
      const add = [...inn].filter((g) => !cur.has(g) || (mine.includes(g) && printedThen(g, x.date) !== printedThen(g, t)));
      for (const g of add) { cur.add(g); from.set(g, x.date); owner.set(g, x); }
      const outA = [...out].reduce((s, g) => s + area[g], 0);
      // (nothing to add: that date's globe is drawn the same here, lines and names: "same")
      Object.assign(x, { did: add.length ? 'swapped' : 'same', out: [...out], in: add, gap: outA ? [...out].reduce((s, g) => s + area[g] * (1 - shareIn(g, inn)), 0) / outA : 0 });
    }
    for (const x of facts) if (x.did === 'swapped' && !x.in.some((g) => cur.has(g) && owner.get(g) === x)) x.did = 'overridden';
    // 2. conflicts: a swapped shape over a confirmed country gives way, when its answer is no stronger
    const confirmed = new Map();
    for (const x of facts) if (x.did === 'base') for (const i of base) if (x.codes.includes(geoms[i].properties.g)) confirmed.set(i, Math.max(confirmed.get(i) ?? 0, x.strong ? 2 : 1));
    const groups = [], wonBack = new Set();
    for (let round = 0; round < 6; round++) {
      let changed = false;
      for (const [m, strength] of confirmed) {
        if (cur.has(m)) continue;
        const over = [...cur].filter((G) => from.has(G) && S(m, G) > 0.05 && (owner.get(G).strong ? 2 : 1) <= strength);
        for (const G of over) {
          const date = from.get(G), x = owner.get(G);
          cur.delete(G); from.delete(G); owner.delete(G);
          // the base year's countries under it that nothing covers now come back: the confirmed as themselves, the rest as one
          const back = base.filter((u) => !cur.has(u) && S(u, G) > 0.05 && shareIn(u, cur) < 0.5);
          const members = new Set(back.filter((u) => !confirmed.has(u)));
          back.forEach((u) => cur.add(u));
          if (members.size) groups.push({ label: G, date, fact: x, members });
          x.gaveWay = true; wonBack.add(m);
          changed = true;
        }
        if (!cur.has(m) && shareIn(m, cur) < 0.5) { cur.add(m); changed = true; }
      }
      if (!changed) break;
    }
    // a group's pieces that don't touch its main body are drawn on their own (decided 2026-11-22)
    for (const grp of groups) {
      const list = [...grp.members].filter((g) => cur.has(g) && !from.has(g));
      const nb = topojson.neighbors(list.map((i) => geoms[i])), seen = new Set(), parts = [];
      for (let k = 0; k < list.length; k++) {
        if (seen.has(k)) continue;
        const part = [], todo = [k]; seen.add(k);
        while (todo.length) { const q = todo.pop(); part.push(list[q]); for (const r of nb[q]) if (!seen.has(r)) { seen.add(r); todo.push(r); } }
        parts.push(part);
      }
      parts.sort((p, q) => q.reduce((s, g) => s + area[g], 0) - p.reduce((s, g) => s + area[g], 0));
      grp.members = new Set(parts[0] ?? []); grp.apart = parts.slice(1).flat();
    }
    const live = groups.filter((g) => g.members.size);
    const groupOf = new Map(); live.forEach((grp, k) => grp.members.forEach((g) => groupOf.set(g, k)));
    for (const x of facts) if (x.gaveWay) x.did = live.some((g) => g.fact === x) ? 'merged' : x.in.some((g) => cur.has(g)) ? 'swapped' : 'gave way';
    for (const x of facts) {
      if (x.did !== 'base') continue;
      const mine = base.filter((i) => x.codes.includes(geoms[i].properties.g));
      if (mine.some((i) => !cur.has(i) || from.has(i))) x.did = 'covered'; // a stronger answer's shape lies over it
      else if (mine.some((i) => wonBack.has(i))) x.did = 'won back';
    }

    // 3. where everything is drawn from: a geometry's date; a place's geometry
    const dateOfGeom = (g) => (g == null ? t : groupOf.has(g) ? live[groupOf.get(g)].date : from.get(g) ?? t);
    let curFeatures = null;
    const geomAt = (at) => {
      const list = overlaps.points[key(at)];
      if (list) return list.find((i) => cur.has(i)) ?? null;
      curFeatures ??= [...cur].map((i) => [i, topojson.feature(topo, geoms[i])]);
      return curFeatures.find(([, f]) => d3.geoContains(f, at))?.[0] ?? null;
    };
    const dateAt = (at) => dateOfGeom(geomAt(at));

    // 4. capitals, names and layers the answers set
    const pointDate = [], cityName = [], countryName = [], layerState = new Map();
    for (const x of facts) {
      if (x.kind === 'layer') { layerState.set(x.feature.id, x.state); x.did = x.atBase ? 'base' : 'layer'; continue; }
      if (x.kind === 'capital') {
        // every city its pictures label (the old capital and the new) takes the answer's date: Rio is ringed, Brasília not yet there
        if (!x.atBase) for (const l of x.feature.states.flatMap((st) => st.visual?.labels ?? [])) if (l.at && ['capital', 'city'].includes(l.kind) && !pointDate.some((p) => near(p.at, l.at))) pointDate.push({ at: l.at, d: x.date });
        x.did = x.atBase ? 'base' : 'capital'; continue;
      }
      if (x.kind !== 'name') continue;
      if (UNPRINTED.test(x.feature.id)) { x.did = 'not drawn'; continue; }
      const spelled = optionsFor(x.feature, language).find((o) => o.members.some((m) => m.state === x.state))?.label;
      for (const l of x.st.visual?.labels ?? []) {
        if (!l.at) continue;
        // a name the base year has: only its spelling in another language (in English the globe prints it already), and
        // only where the globe is the base year's (a country or city another answer brought in from its own year keeps that
        // year's name); a name of another year: there, always
        if (x.atBase && language === 'en') continue;
        if ((l.kind ?? 'country') === 'country') countryName.push({ at: l.at, d: x.date, name: spelled, fact: x, base: x.atBase });
        else if (['city', 'capital'].includes(l.kind)) { if (!x.atBase) pointDate.push({ at: l.at, d: x.date }); cityName.push({ at: l.at, name: spelled, cap: l.kind === 'capital' ? 1 : 0, base: x.atBase }); }
      }
      if (!x.nameSwap || x.did !== 'swapped') x.did = x.atBase ? 'base' : 'name';
      x.spelled = spelled;
    }
    const cityDate = (at) => pointDate.find((p) => near(p.at, at))?.d ?? dateAt(at);

    // 5. the countries' names: each from its own date; a group: one name, of its date
    const drawn = [...cur].sort((p, q) => p - q), drawnG = drawn.map((i) => geoms[i]);
    const nbAll = topojson.neighbors(drawnG), solo = [];
    drawn.forEach((g, k) => { if (!groupOf.has(g)) solo.push([g, k]); });
    const feats = topojson.feature(topo, { type: 'GeometryCollection', geometries: solo.map(([g]) => geoms[g]) }).features;
    const entryOf = (f, island) => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      let big = null, ar = -1;
      for (const c of polys) { const p = { type: 'Polygon', coordinates: c }, a = d3.geoArea(p); if (a > ar) { ar = a; big = p; } }
      let s = Math.sqrt(ar);
      if (island) s = Math.max(s, 0.5 * d3.geoDistance(...d3.geoBounds(f))); // as scenes.countriesAt: an island country spreads its name
      return { g: f.properties.g, n: f.properties.n, at: d3.geoCentroid(big), s };
    };
    const rowOf = new Map(); // geometry (or group label) → [row, entry, date]
    solo.forEach(([g, k], j) => { const e = entryOf(feats[j], !nbAll[k].length), d = dateOfGeom(g); rowOf.set(g, [R.countryRow(names, e, d), e, d]); });
    for (const grp of live) {
      const shape = topojson.merge(topo, [...grp.members].map((i) => geoms[i])), P = geoms[grp.label].properties;
      const e = entryOf({ type: 'Feature', properties: { g: P.g, n: P.n }, geometry: shape }, false);
      grp.row = [R.countryRow(names, e, grp.date), e, grp.date];
    }
    let renamed = 0;
    for (const c of countryName) {
      const g = geomAt(c.at); if (g == null || (c.base && dateOfGeom(g) !== t)) continue;
      const hit = groupOf.has(g) ? live[groupOf.get(g)] : rowOf.get(g); if (!hit) continue;
      const [old, e] = groupOf.has(g) ? hit.row : hit, row = R.countryRow(names, e, c.d, c.name);
      if (row[0] === old[0] && row[4] === old[4]) continue;
      if (groupOf.has(g)) hit.row = [row, e, c.d]; else rowOf.set(g, [row, e, c.d]);
      c.fact.printed = row[0]; renamed++;
    }
    // and the base year's names for land no country covers (game-logic regionsAt), where nothing is drawn there now
    const blankNames = R.regionsAt(names, t).filter((r) => geomAt([r[3], r[4]]) == null).map(([, , name, lon, lat, s, owner]) => [name, lon, lat, s, owner]);
    const countries = [...[...rowOf.values()].map((r) => r[0]), ...live.map((g) => g.row[0]), ...blankNames].sort((p, q) => q[3] - p[3]);

    // 6. cities: each as of its region's date (or the date an answer gives its place); the sender's spellings
    const dateKey = (d) => Math.round(d * 1e4);
    const dates = new Map([[dateKey(t), t]]);
    for (const d of [...from.values(), ...live.map((g) => g.date), ...pointDate.map((p) => p.d)]) dates.set(dateKey(d), d);
    let cities = [];
    for (const d of dates.values()) for (const c of R.placesAt(names, [], d).cities) if (dateKey(cityDate([c[1], c[2]])) === dateKey(d)) cities.push(c.slice());
    for (const c of cityName) {
      if (!c.name || (c.base && dateAt(c.at) !== t)) continue;
      const hit = cities.filter((x) => near([x[1], x[2]], c.at)).sort((p, q) => Math.hypot(p[1] - c.at[0], p[2] - c.at[1]) - Math.hypot(q[1] - c.at[0], q[2] - c.at[1]))[0];
      if (hit) { if (hit[0] !== c.name) { hit[0] = c.name; renamed++; } } else { cities.push([c.name, c.at[0], c.at[1], 3, c.cap]); renamed++; }
    }
    cities = cities.sort((p, q) => p[3] - q[3] || q[4] - p[4]);

    // 7. the globe's own layer, each feature as of its place's date (or the answer's state)
    const layer = R.layersFor(bundle, (f) => (layerState.has(f.id) ? layerState.get(f.id) : R.stateAt(f, f.camera ? dateAt([f.camera.lon, f.camera.lat]) : t)));
    const own = new Set(layer.places.map((p) => p[0]));

    // 8. the borders: between the countries drawn (not inside a group), and the seams a piece brings from its own era
    const inGroup = (a, b) => { const ga = groupOf.get(idxOf.get(a)), gb = groupOf.get(idxOf.get(b)); return ga != null && ga === gb; };
    const mesh = topojson.mesh(topo, { type: 'GeometryCollection', geometries: drawnG }, (a, b) => a !== b && !inGroup(a, b));
    const counts = countArcs(drawn), seams = [];
    // an arc only one drawn country has, which in that country's own year lay between two: a border whose other side now
    // comes from another year (none on a globe that is all the base year's)
    for (const g of drawn) {
      const era = eraArcs(from.get(g) ?? t);
      for (const a of arcsOf(geoms[g])) if (counts.get(a) === 1 && (era.get(a) ?? 0) >= 2) seams.push(a);
    }
    const seamLines = [...new Set(seams)].length ? topojson.feature(topo, { type: 'MultiLineString', arcs: [...new Set(seams)].map((a) => [a]) }).geometry.coordinates : [];
    const borders = seamLines.length ? { type: 'MultiLineString', coordinates: [...mesh.coordinates, ...seamLines] } : mesh;
    // the frontiers (dotted: a country beside land no state held, scenes frontierAt): each drawn country's, from its own
    // year (the base year's, or the answer's that brought it in), where it still faces nothing on this globe
    const fronts = [];
    for (const g of drawn) {
      const era = frontierArcs(from.get(g) ?? t);
      for (const a of arcsOf(geoms[g])) if (counts.get(a) === 1 && era.has(a)) fronts.push(a);
    }
    const frontier = fronts.length ? topojson.feature(topo, { type: 'MultiLineString', arcs: [...new Set(fronts)].map((a) => [a]) }).geometry : null;

    // 9. how well it closes: the base year's land nothing covers, and land drawn twice (shares of area)
    const baseA = base.reduce((s, g) => s + area[g], 0), drawnA = drawn.reduce((s, g) => s + area[g], 0), drawnSet = new Set(drawn);
    const gap = base.reduce((s, g) => s + area[g] * Math.max(0, 1 - shareIn(g, drawnSet)), 0) / baseA;
    const overlap = drawn.reduce((s, g) => { let o = 0; for (const [j, v] of shares[g]) if (drawnSet.has(j)) o += v; return s + area[g] * Math.min(1, o); }, 0) / (2 * drawnA);

    const factById = new Map(facts.map((x) => [x.feature.id, x]));
    const swappedOrGrouped = (g) => from.has(g) || groupOf.has(g);
    /** A feature's picture lies wholly in regions drawn as the base year has them, with nothing an answer moved there. */
    function untouched(feature, state, { answered = false } = {}) {
      if (!answered && factById.has(feature.id)) return false;
      const codes = codesOf(state);
      for (const c of codes) for (const i of base) if (geoms[i].properties.g === c && (!cur.has(i) || swappedOrGrouped(i))) return false;
      if (codes.some((c) => !base.some((i) => geoms[i].properties.g === c))) return false;
      for (const l of state.visual?.labels ?? []) {
        if (!l.at) continue;
        const g = geomAt(l.at);
        if (g != null && swappedOrGrouped(g)) return false;
        if (pointDate.some((p) => near(p.at, l.at)) || countryName.some((c) => c.fact.feature.id !== feature.id && geomAt(c.at) === g && g != null)) return false;
      }
      if (!codes.length && feature.camera) { const g = geomAt([feature.camera.lon, feature.camera.lat]); if (g != null && swappedOrGrouped(g)) return false; }
      return true;
    }
    /** The country the globe prints at a place, as a clue's label names it ("Gold Coast (Br.)"), or null. */
    function printedAt(at) {
      const g = geomAt(at); if (g == null) return null;
      const row = groupOf.has(g) ? live[groupOf.get(g)].row[0] : rowOf.get(g)?.[0];
      return row ? (row[4] ? `${row[0]} (${row[4]})` : row[0]) : null;
    }
    /** An answer's countries as the globe draws them: its group as one shape, its swapped pieces, or the base year's. */
    function highlightOf(id) {
      const x = factById.get(id), codes = x?.codes ?? [];
      const grp = x && live.find((g) => g.fact === x);
      if (grp) return [{ type: 'Feature', properties: {}, geometry: topojson.merge(topo, [...grp.members].map((i) => geoms[i])) }];
      const list = drawn.filter((i) => codes.includes(geoms[i].properties.g) && (x?.did === 'swapped' ? owner.get(i) === x : !from.has(i)));
      return list.length ? topojson.feature(topo, { type: 'GeometryCollection', geometries: list.map((i) => geoms[i]) }).features : null;
    }
    /** The date a clue's picture is drawn from: an answer's own (its swap) or the base year. */
    const dateOfClue = (c) => { const x = factById.get(c.feature.id); return x && ['swapped', 'merged', 'name', 'capital', 'layer'].includes(x.did) ? x.date : t; };

    const report = facts.map((x) => ({ id: x.feature.id, claim: x.option.claim ?? x.st.claim ?? x.st.label, reply: x.reply, state: x.st.id, kind: x.kind, did: x.did, date: x.date,
      out: x.out?.map((g) => geoms[g].properties.n), in: x.in?.filter((g) => cur.has(g)).map((g) => geoms[g].properties.n), gap: x.gap, printed: x.printed ?? x.spelled }));
    for (const grp of live) report.push({ id: '(group)', claim: `${grp.row[0][0]} drawn as one`, did: 'group', date: grp.date, in: [...grp.members].map((g) => geoms[g].properties.n), apart: grp.apart.map((g) => geoms[g].properties.n) });

    return {
      base: y, t, facts, report, gap, overlap, drawn, groups: live.map((g) => ({ name: g.row[0][0], date: g.date, members: [...g.members], apart: g.apart })),
      world: { date: t, borders, frontier, highlight: [], outlines: [], hatch: [], dashed: [], overlays: layer.overlays, labels: [] },
      layer, names: { countries, cities: cities.filter((c) => !own.has(c[0])), places: layer.places, peaks: layer.peaks },
      dateAt, printedAt, highlightOf, untouched, dateOfClue, fact: (id) => factById.get(id) ?? null, swapped: drawn.filter(swappedOrGrouped),
      // nothing differs from the standard globe of the base year: no shape, name, capital or layer moved
      consistent: !from.size && !live.length && !pointDate.length && !renamed && [...layerState].every(([id, s]) => R.stateAt(bundle.features.find((f) => f.id === id), t) === s),
    };
  }
  /** The frontier arcs of a date (tools/geometry.mjs computeFrontiers, as scenes.js draws them), as a set. */
  const frontierSets = new Map();
  function frontierArcs(date) {
    const row = (topo.frontiers ?? []).find(([a, b]) => a <= date && date < b);
    if (!frontierSets.has(row)) frontierSets.set(row, new Set(row?.[2] ?? []));
    return frontierSets.get(row);
  }
  return { compose };
}

// --- The game ---------------------------------------------------------------------------------------------------
/**
 * The friend's game on a composed globe (see the header): { …newGame's fields, custom, rows }.
 *   fits / seen: as newGame (game-logic globeFits / seenFrom); agree: the spec's agreement years or null.
 */
export function customGame(bundle, optionsFor, custom, { agree = null, seed = 0, endYear, fits = null, seen = null }) {
  const y = custom.base;
  const pool0 = R.cluePool(bundle, y, optionsFor, endYear, fits, seen).filter((c) => {
    const x = custom.fact(c.feature.id);
    if (!x) return custom.untouched(c.feature, c.feature.states[c.state]);
    // the sender's answer, as the base year shows it, its picture drawn as such (a name in another spelling is not the claim)
    if (!c.members.has(x.state) || !['base', 'won back'].includes(x.did) || !custom.untouched(c.feature, c.feature.states[c.state], { answered: true })) return false;
    if (x.kind === 'name' && (x.spelled ?? c.option.label) !== c.option.label) return false;
    c.fact = true;
    return true;
  });
  const group = R.winSet(pool0, endYear), run = group.find(([a, b]) => a <= y && y <= b) ?? [y, y];
  const W = agree ? [Math.min(run[0], agree[0]), Math.max(run[1], agree[1])] : run;
  const pool = pool0.filter((c) => { for (let k = W[0]; k <= W[1]; k++) if (!R.holds(c, k)) return false; return true; });
  const win = R.winSet(pool, endYear), [lo, hi] = R.bounds(win);
  const period = [Math.max(R.AXIS_START, ...pool.map((c) => c.from ?? -I)), Math.min(endYear + 1, ...pool.map((c) => c.to ?? I))];
  return { year: y, seed, endYear, win, lo, hi, period, full: [[R.AXIS_START, endYear]], pool, custom, rows: answerRows(custom, optionsFor) };
}

/**
 * The sender's answers for the result's second timeline, as the dating result draws them: the option asked (its claim),
 * the reply (✓ / ✗) and the years the reply allows (bars); all of them by default (n: at most n, the answers drawn from
 * another date first, then those whose years end nearest the base year), listed in the order they were given. Answers the
 * globe can't draw are left out. Each: { fact, clue (for its picture), claim, reply, spans: [[from, to]], years, at, stale }.
 */
export function answerRows(custom, optionsFor, n = Infinity) {
  const t = custom.t, out = [];
  custom.facts.forEach((x, order) => {
    if (['not drawn', 'no shape', 'overridden', 'gave way'].includes(x.did)) return;
    const f = x.feature, tr = f.transitions ?? [];
    const edges = (states) => {
      const spans = [];
      for (const i of [...states].sort((a, b) => a - b)) {
        const a = i === 0 ? null : tr[i - 1]?.t ?? R.toYear(f.states[i].validFrom), b = i === f.states.length - 1 ? null : tr[i]?.t ?? R.toYear(f.states[i].validTo);
        const m = spans[spans.length - 1];
        if (m && m[1] === a) m[1] = b; else spans.push([a, b]);
      }
      return spans;
    };
    const inOpt = new Set(x.option.members.map((m) => m.state));
    const spans = edges(f.states.map((_, i) => i).filter((i) => (x.reply === 'yes') === inOpt.has(i)));
    const ends = spans.flat().filter((e) => e != null), at = ends.sort((p, q) => Math.abs(p - t) - Math.abs(q - t))[0] ?? t;
    const asked = x.option.members[0].state, claim = R.claimAsSeen(f, asked, x.option.claim ?? f.states[asked].claim ?? x.option.label);
    const years = spans.map(([a, b]) => (a == null ? `until ${Math.floor(b)}` : b == null ? `${Math.floor(a)} – today` : `${Math.floor(a)} – ${Math.floor(b)}`)).join(', ');
    // a clue-shaped object for its picture (what the globe draws: the state the answer leaves, for a no too) and its story
    const si = x.state, drawnOpt = x.reply === 'yes' ? x.option : optionOf(f, si, null, 'en', optionsFor) ?? x.option, members = new Set(drawnOpt.members.map((m) => m.state));
    let first = si, last = si; while (first > 0 && members.has(first - 1)) first--; while (last < f.states.length - 1 && members.has(last + 1)) last++;
    const clue = { feature: R.asSeenFeature(f), option: drawnOpt, state: si, members, from: R.toYear(f.states[first].validFrom), to: R.toYear(f.states[last].validTo),
      into: first > 0 ? first - 1 : null, out: last < f.states.length - 1 ? last : null, kind: f.kind, fact: true };
    const stale = !spans.some(([a, b]) => (a ?? -I) <= t && t < (b ?? I));
    out.push({ fact: x, clue, claim, reply: x.reply, spans, years, at, stale, order, near: Math.min(...ends.map((e) => Math.abs(e - t)), 200) });
  });
  return out.sort((p, q) => (q.stale - p.stale) || (p.near - q.near) || (p.order - q.order)).slice(0, n).sort((p, q) => p.order - q.order);
}
