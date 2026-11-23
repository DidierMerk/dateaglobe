// Turns raw feature files (data/features/*.json) into the compact form the
// engine uses. Pure function: no file system, so it runs in Node and the browser.
//
// Raw files keep transitions as the single source of truth for dates.
// Compilation derives each state's validity interval from them.

import { parseDate } from './dates.js';

/**
 * @param {object} raw   one parsed feature file
 * @param {object} vocab parsed schema/vocab.json
 */
export function compileFeature(raw, vocab, evidence = null) {
  const clue = vocab.clue_types[raw.clue_type];
  if (!clue) throw new Error(`${raw.id}: unknown clue_type ${raw.clue_type}`);
  const stateIndex = new Map(raw.states.map((s, i) => [s.id, i]));
  const sourceById = new Map(raw.sources.map((s) => [s.id, s]));

  const transitions = raw.transitions.map((tr) => {
    const parsed = parseDate(tr.date);
    const prominence = vocab.prominence[tr.prominence];
    if (!prominence) throw new Error(`${raw.id}: unknown prominence ${tr.prominence}`);
    return {
      from: stateIndex.get(tr.from),
      to: stateIndex.get(tr.to),
      date: tr.date,
      dateDeFacto: tr.date_de_facto ?? null,
      // 'day' | 'month' | 'year': lets a finer timeline (where in the year) trust only real precision
      precision: parsed.precision,
      dateNote: tr.date_note ?? null,
      t: parsed.t,
      // Explicit uncertainty wins; otherwise the date's own precision.
      uncertainty: Math.max(tr.date_uncertainty_years ?? 0, parsed.halfWidth),
      lagMedian: prominence.lag_median_years,
      prominence: tr.prominence,
      funFact: tr.fun_fact,
      perspectiveNotes: tr.perspective_notes ?? null,
      sources: tr.sources.map((id) => sourceById.get(id)).filter(Boolean),
      // Research evidence (data/evidence.json), used by engine v2 only; v1 ignores it
      evidence: compileEvidence(evidence?.transitions?.[`${raw.id}:${tr.from}>${tr.to}`]),
    };
  });

  const states = raw.states.map((s, i) => ({
    id: s.id,
    label: s.label,
    question: s.question,
    claim: s.claim ?? null,
    cue: s.cue,
    visual: s.visual,
    visualGroup: s.visual_group ?? s.id,
    names: s.names ?? null,
    depictions: (s.depictions ?? []).map((d) => ({ id: d.id, label: d.label, question: d.question, claim: d.claim ?? null, cue: d.cue, style: d.style ?? 'plain', visual: d.visual ?? null, visualGroup: d.visual_group ?? null, names: d.names ?? null, pByBloc: d.p_by_bloc, pByLanguage: d.p_by_language ?? null })),
    validFrom: i === 0 ? null : transitions[i - 1].date,
    validTo: i === raw.states.length - 1 ? null : transitions[i].date,
  }));

  return {
    id: raw.id,
    title: raw.title,
    clueType: raw.clue_type,
    kind: clue.question_kind, // 'pick_state' | 'pick_name'
    languageFree: clue.language_free,
    subject: raw.question.subject,
    prompt: raw.question.prompt,
    help: raw.question.help,
    region: raw.region,
    camera: raw.camera,
    salience: raw.salience,
    perspective: raw.perspective_sensitive,
    states,
    transitions,
    sources: raw.sources,
    lookalikes: (evidence?.lookalikes?.[raw.id] ?? []).map((l) => ({ states: l.states.map((id) => stateIndex.get(id)), p: l.p, note: l.note ?? null })),
  };
}

/** One transition's evidence in engine form: verdicts, early use (decimal years) and holdouts. */
function compileEvidence(e) {
  if (!e) return null;
  return {
    floor: e.floor ?? null,
    ceiling: e.ceiling ?? null,
    early: e.early ? { from: parseDate(e.early.from).t, share: e.early.share } : null,
    holdouts: e.holdouts == null ? null
      : typeof e.holdouts === 'number' ? { default: e.holdouts, byBloc: {}, byLanguage: {} }
      : { default: e.holdouts.default ?? 0, byBloc: e.holdouts.by_bloc ?? {}, byLanguage: e.holdouts.by_language ?? {} },
  };
}

/**
 * Checks data/evidence.json against the features (and the vocabulary, when given): every key must
 * name a real transition or state, verdicts and shares must be valid, and each verdict must carry
 * what it needs. A typo would otherwise silently do nothing. Returns a list of problems.
 */
export function checkEvidence(rawFeatures, evidence, vocab = null) {
  const problems = [];
  const byId = new Map(rawFeatures.map((f) => [f.id, f]));
  const VERDICTS = ['gold', 'strong', 'soft'];
  const FIELDS = ['floor', 'ceiling', 'early', 'holdouts', 'note'];
  const share = (x) => typeof x === 'number' && x >= 0 && x <= 1;
  const blocs = vocab ? Object.keys(vocab.blocs).filter((k) => !k.startsWith('$')) : null;
  const langs = vocab ? Object.keys(vocab.languages).filter((k) => !k.startsWith('$')) : null;
  for (const [key, e] of Object.entries(evidence.transitions ?? {})) {
    const [fid, pair] = key.split(':');
    const [from, to] = (pair ?? '').split('>');
    const f = byId.get(fid);
    if (!f) { problems.push(`${key}: no feature ${fid}`); continue; }
    const tr = f.transitions.find((t) => t.from === from && t.to === to);
    if (!tr) { problems.push(`${key}: no transition ${from} -> ${to}`); continue; }
    for (const k of Object.keys(e)) if (!FIELDS.includes(k)) problems.push(`${key}: unknown field ${k}`);
    for (const side of ['floor', 'ceiling']) if (e[side] != null && !VERDICTS.includes(e[side])) problems.push(`${key}: ${side} must be gold, strong or soft`);
    if (e.ceiling === 'gold' && e.holdouts) problems.push(`${key}: a gold ceiling can't have holdouts`);
    if (e.ceiling === 'soft' && e.holdouts == null) problems.push(`${key}: a soft ceiling needs holdouts`);
    if (e.floor === 'soft' && !e.early && !e.note) problems.push(`${key}: a soft floor needs early use or a note saying why`);
    if (e.early) {
      if (!share(e.early.share)) problems.push(`${key}: early.share must be between 0 and 1`);
      if (!e.early.from || parseDate(e.early.from).t >= parseDate(tr.date).t) problems.push(`${key}: early.from must be a date before the transition (${tr.date})`);
    }
    if (e.holdouts != null) {
      const h = typeof e.holdouts === 'number' ? { default: e.holdouts } : e.holdouts;
      if (typeof e.holdouts !== 'number' && !share(h.default)) problems.push(`${key}: holdouts.default must be between 0 and 1`);
      for (const [k, v] of Object.entries(h)) {
        if (k === 'default') { if (!share(v)) problems.push(`${key}: holdouts must be between 0 and 1`); continue; }
        if (k !== 'by_bloc' && k !== 'by_language') { problems.push(`${key}: holdouts has unknown field ${k}`); continue; }
        for (const [name, x] of Object.entries(v)) {
          if (!share(x)) problems.push(`${key}: holdouts.${k}.${name} must be between 0 and 1`);
          if (k === 'by_bloc' && blocs && !blocs.includes(name)) problems.push(`${key}: unknown bloc ${name}`);
          if (k === 'by_language' && langs && !langs.includes(name)) problems.push(`${key}: unknown language ${name}`);
        }
      }
    }
  }
  for (const [fid, list] of Object.entries(evidence.lookalikes ?? {})) {
    const f = byId.get(fid);
    if (!f) { problems.push(`lookalikes: no feature ${fid}`); continue; }
    for (const l of list) {
      if (!Array.isArray(l.states) || l.states.length < 2) problems.push(`lookalikes ${fid}: list at least two states`);
      for (const st of l.states ?? []) if (!f.states.some((x) => x.id === st)) problems.push(`lookalikes ${fid}: no state ${st}`);
      if (!share(l.p)) problems.push(`lookalikes ${fid}: p must be between 0 and 1`);
    }
  }
  return problems;
}

export function compileBundle(rawFeatures, vocab, { generatedAt = new Date().toISOString(), evidence = null } = {}) {
  if (evidence) {
    const problems = checkEvidence(rawFeatures, evidence, vocab);
    if (problems.length) throw new Error(`data/evidence.json:\n  ${problems.join('\n  ')}`);
  }
  return {
    generatedAt,
    vocab: {
      timeRange: vocab.time_range,
      languages: vocab.languages,
      blocs: Object.keys(vocab.blocs).filter((k) => !k.startsWith('$')),
      mapSizes: Object.fromEntries(Object.entries(vocab.map_sizes).filter(([k]) => !k.startsWith('$'))),
      clueTypes: vocab.clue_types,
    },
    features: rawFeatures.map((f) => compileFeature(f, vocab, evidence)),
  };
}
