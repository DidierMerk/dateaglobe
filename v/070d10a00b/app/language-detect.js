// Works out a map's label language from the names the user types in: what their
// map calls a few countries, one at a time, until one language is left. The
// probe countries were picked because their names and borders stayed the same on
// every map we date (unlike Germany: Deutsches Reich, BRD/DDR, West/East Germany),
// and together they tell all 14 core languages apart:
//   Spain   shares only SPANIEN (German, Swedish, Danish)
//   Greece  shares only GRECIA (Spanish, Italian, Portuguese)
//   France  shares FRANCE (English, French) and FRANCIA (Spanish, Italian)
// Any two of them, asked in any order, settle every language (tests check this).
// Pure code, no DOM, so it runs in node:test and the browser.

export const NATIVE_NAMES = {
  nl: 'Nederlands', de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', it: 'Italiano',
  pt: 'Português', ru: 'Русский', sv: 'Svenska', da: 'Dansk', pl: 'Polski', cs: 'Čeština', tr: 'Türkçe', ja: '日本語',
};

export const LANGS = Object.keys(NATIVE_NAMES);

// Spellings per language: the usual one first, then old spellings and longer
// forms that tell sharing languages apart. Other longer forms ("Reino de España",
// "Kingdom of Greece") need no entry: a typed name that contains a spelling
// still matches it.
export const PROBES = [
  {
    id: 'spain',
    camera: { lat: 40.2, lon: -3.7, zoom: 1 },
    country: '724', // ISO 3166 numeric, as used by world-atlas
    names: {
      nl: ['Spanje'],
      de: ['Spanien', 'Königreich Spanien'],
      en: ['Spain'],
      fr: ['Espagne'],
      es: ['España', 'Estado Español'],
      it: ['Spagna'],
      pt: ['Espanha', 'Hespanha'], // Hespanha: spelling before the 1911 reform
      ru: ['Испания', 'Испанія'], // Испанія: before the 1918 reform
      sv: ['Spanien', 'Konungariket Spanien'],
      da: ['Spanien', 'Kongeriget Spanien'],
      pl: ['Hiszpania'],
      cs: ['Španělsko'],
      tr: ['İspanya'],
      ja: ['スペイン', 'イスパニア', '西班牙'],
    },
  },
  {
    id: 'greece',
    camera: { lat: 39.3, lon: 22.4, zoom: 1 },
    country: '300',
    names: {
      nl: ['Griekenland'],
      de: ['Griechenland'],
      en: ['Greece'],
      fr: ['Grèce'],
      es: ['Grecia', 'Reino de Grecia'],
      it: ['Grecia', 'Regno di Grecia'],
      pt: ['Grécia', 'Reino da Grécia'],
      ru: ['Греция', 'Греція'], // Греція: before the 1918 reform
      sv: ['Grekland'],
      da: ['Grækenland'],
      pl: ['Grecja'],
      cs: ['Řecko'],
      tr: ['Yunanistan'],
      ja: ['ギリシャ', 'ギリシア', '希臘'],
    },
  },
  {
    id: 'france',
    camera: { lat: 46.6, lon: 2.4, zoom: 1 },
    country: '250',
    names: {
      nl: ['Frankrijk'],
      de: ['Frankreich'],
      en: ['France'],
      fr: ['France'],
      es: ['Francia'],
      it: ['Francia'],
      pt: ['França'],
      ru: ['Франция', 'Франція'], // Франція: before the 1918 reform
      sv: ['Frankrike'],
      da: ['Frankrig'],
      pl: ['Francja'],
      cs: ['Francie'],
      tr: ['Fransa'],
      ja: ['フランス', '仏蘭西'],
    },
  },
];

/** The first question's country, kept for callers that only need one. */
export const PROBE = PROBES[0];

const LETTER_MAP = { ø: 'o', æ: 'ae', å: 'a', ß: 'ss', ł: 'l', đ: 'd', ı: 'i', œ: 'oe', ё: 'е' };

/** Lower case, no accents, no spaces or punctuation: "R.F.A." -> "rfa", "Nordsøen" -> "nordsoen". */
export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[øæåßłđıœё]/g, (c) => LETTER_MAP[c])
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '');
}

/** Typing distance: insertions, deletions, substitutions and swapped neighbours. */
function editDistance(a, b) {
  const A = [...a], B = [...b];
  let prev = Array.from({ length: B.length + 1 }, (_, j) => j), prev2 = prev;
  for (let i = 1; i <= A.length; i++) {
    const cur = [i];
    for (let j = 1; j <= B.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (A[i - 1] === B[j - 1] ? 0 : 1));
      // Two swapped letters ("Spian") are one typo, not two
      if (i > 1 && j > 1 && A[i - 1] === B[j - 2] && A[i - 2] === B[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
    }
    [prev2, prev] = [prev, cur];
  }
  return prev[B.length];
}

/** Typos allowed for a name of this length: none below 5 letters, then one per 5. */
const tolerance = (len) => (len < 5 ? 0 : Math.floor(len / 5));

/** Exact or partial match: "Deutsches Reich (1937)" or just "Bundesrepublik" count when long enough. */
function matchesExactly(input, v) {
  if (input === v) return true;
  return [...input].length >= 5 && [...v].length >= 5 && (input.includes(v) || v.includes(input));
}

/** Every spelling of a probe, with its language and normalized form; only these languages if given. */
function spellings(probe, langs = null) {
  return Object.entries(probe.names).filter(([lang]) => !langs || langs.includes(lang)).flatMap(([lang, variants]) =>
    variants.map((text, i) => ({ lang, text, norm: normalize(text), primary: i === 0 })));
}

/**
 * How the typed text relates to the spellings of this probe.
 *   exact:  matches one or more spellings (langs = their languages)
 *   fuzzy:  only a typo away; `variant` is the closest spelling, to offer as "did you mean"
 *   none:   no match; `nearby` lists up to three spellings that look somewhat alike
 * Exact matches win over typos, so "España" means Spanish, not Portuguese "Espanha".
 * `langs` limits the spellings to the languages still in the running.
 */
export function analyse(probe, text, langs = null) {
  const input = normalize(text);
  if (!input) return { tier: 'none', langs: [], nearby: [] };
  const all = spellings(probe, langs).filter((s) => s.norm);

  // When several spellings fit, the longest one found in the typed text decides:
  // "Königreich Spanien" is German, though plain "Spanien" is also Swedish and Danish.
  const exact = all.filter((s) => matchesExactly(input, s.norm));
  if (exact.length) {
    const found = (s) => (input.includes(s.norm) ? [...s.norm].length : 0);
    const best = Math.max(...exact.map(found));
    return { tier: 'exact', langs: unique(exact.filter((s) => found(s) === best).map((s) => s.lang)) };
  }

  const scored = all
    .map((s) => ({ ...s, d: editDistance(input, s.norm) }))
    .sort((a, b) => a.d - b.d || b.primary - a.primary);
  const fuzzy = scored.filter((s) => s.d <= tolerance([...s.norm].length));
  if (fuzzy.length) {
    const variant = fuzzy[0].text;
    return { tier: 'fuzzy', langs: unique(fuzzy.filter((s) => s.text === variant).map((s) => s.lang)), variant };
  }
  const nearby = unique(scored.filter((s) => s.d / Math.max([...s.norm].length, [...input].length) <= 0.5).map((s) => s.text)).slice(0, 3);
  return { tier: 'none', langs: [], nearby };
}

/** Languages whose spelling of this probe matches the typed text (exact first, then typo-tolerant). */
export function languagesMatching(probe, text) {
  return analyse(probe, text).langs;
}

/** Fold one string for prefix matching: lower case, no accents, Nordic letters simplified. */
function fold(s) {
  return [...String(s).toLowerCase()].map((c) => (LETTER_MAP[c] ?? c).normalize('NFKD').replace(/\p{M}/gu, '')).join('');
}

/**
 * Type-ahead: the rest of the most likely spelling the user has started typing.
 * Prefers primary spellings, then the shortest. Returns { variant, rest } or null.
 */
export function completion(probe, text, langs = null) {
  const f = fold(text);
  if (f.trim().length < 2) return null;
  const hits = spellings(probe, langs)
    .filter((s) => { const fv = fold(s.text); return fv.startsWith(f) && fv !== f; })
    .sort((a, b) => b.primary - a.primary || a.text.length - b.text.length);
  if (!hits.length) return null;
  const chars = [...hits[0].text];
  let i = 0, typed = '';
  while (i < chars.length && typed.length < f.length) typed += fold(chars[i++]);
  return { variant: hits[0].text, rest: chars.slice(i).join('') };
}

/**
 * What one typed answer leaves of the languages still in the running.
 * In order: an exact spelling of those languages; an exact spelling of any other
 * language (the earlier answer may have been the slip, so the new one wins); a
 * typo of those languages; a typo of any language.
 * Returns the analysis of the answer plus `left`, the languages that remain.
 */
export function narrow(probe, text, candidates = LANGS) {
  const within = analyse(probe, text, candidates);
  const anywhere = analyse(probe, text);
  const pick = within.tier === 'exact' ? within
    : anywhere.tier === 'exact' ? anywhere
      : within.tier === 'fuzzy' ? within : anywhere;
  return { ...pick, left: pick.langs };
}

/** Which of the candidate languages each usual spelling of this probe would leave. */
function groups(probe, candidates) {
  return unique(candidates.map((l) => languagesMatching(probe, probe.names[l][0]).filter((x) => candidates.includes(x)).sort().join()));
}

/** Does asking this probe tell at least two of the candidate languages apart? */
export function splits(probe, candidates) {
  return groups(probe, candidates).length > 1;
}

/** The most questions still needed in the worst case, asking the best country each time. */
function worstCase(candidates, asked) {
  if (candidates.length < 2) return 0;
  const useful = PROBES.filter((p) => !asked.includes(p.id) && splits(p, candidates));
  if (!useful.length) return Infinity;
  return Math.min(...useful.map((p) => cost(p, candidates, asked)));
}

/** Questions needed in the worst case if this probe is asked now. */
function cost(probe, candidates, asked) {
  return 1 + Math.max(...groups(probe, candidates).map((g) => worstCase(g.split(','), [...asked, probe.id])));
}

/**
 * The next country to ask about: a random one, not asked yet, among those that
 * keep the worst case shortest (so Greece's GRECIA is followed by Spain, not by
 * France, which can't split Spanish from Italian). Every country is a fine first
 * question. Null when none is left (one language, or all skipped).
 */
export function nextProbe(candidates, asked = [], random = Math.random) {
  if (candidates.length < 2) return null;
  const useful = PROBES.filter((p) => !asked.includes(p.id) && splits(p, candidates));
  if (!useful.length) return null;
  const costs = useful.map((p) => cost(p, candidates, asked));
  const best = useful.filter((_, i) => costs[i] === Math.min(...costs));
  return best[Math.floor(random() * best.length)];
}

const unique = (xs) => [...new Set(xs)];
