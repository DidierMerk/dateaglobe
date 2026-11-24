// Where the answers agree: the stretch of time that the most answers allow, for the result screen.
//
// Each answer allows one or more spans of years. Between any two neighbouring span ends the
// number of answers that fit stays the same, so sweeping over those dates finds every stretch
// exactly, however short. Of the stretches that the most answers allow, the one nearest the most
// likely print date wins; its ends are real changes on the map, named by month.
//
// Pure: no DOM, so the tests can run it in Node.

import { formatDate, formatDecimalYear } from '../engine/dates.js';

/**
 * @param rows   [{ id, featureId, spans: [{ from, to }] }], null = open-ended
 * @param opts   { startYear, until, mode, transitions(featureId) -> [{ t, date, precision }] }
 * @returns { from, to, count, n, rangeText } or null; from/to are null when open-ended
 */
export function agreement(rows, { startYear, until, mode, transitions }) {
  if (!rows.length) return null;
  const lo = (s) => s.from ?? startYear, hi = (s) => s.to ?? until;
  const fits = (r, t) => r.spans.some((s) => t >= lo(s) && t < hi(s));

  const cuts = [...new Set([startYear, until, ...rows.flatMap((r) => r.spans.flatMap((s) => [lo(s), hi(s)]))])]
    .filter((t) => t >= startYear && t <= until)
    .sort((a, b) => a - b);

  // Stretches between neighbouring cuts, with how many answers fit; neighbours with the same top count merge
  let max = 0;
  const pieces = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i], b = cuts[i + 1];
    const count = rows.filter((r) => fits(r, (a + b) / 2)).length;
    max = Math.max(max, count);
    pieces.push({ a, b, count });
  }
  if (max === 0) return null;
  const runs = [];
  for (const p of pieces) {
    if (p.count !== max) continue;
    const last = runs[runs.length - 1];
    if (last && last.b === p.a) last.b = p.b; else runs.push({ a: p.a, b: p.b });
  }

  // A map shows the world at or before its print date, so a stretch after the likely date counts triple
  const dist = ({ a, b }) => (mode < a ? (a - mode) * 3 : mode > b ? mode - b : 0);
  const best = runs.reduce((x, r) => (dist(r) < dist(x) ? r : x));

  const mid = (best.a + best.b) / 2;
  const agreeing = rows.filter((r) => fits(r, mid));
  const from = best.a > startYear ? best.a : null;
  const to = best.b < until ? best.b : null;

  return {
    from, to, count: max, n: rows.length,
    rangeText: rangeText(edge(agreeing, from, 'from', transitions), edge(agreeing, to, 'to', transitions)),
  };
}

/** The change on the map at an end of the stretch, as a month ("Mar 1990") or a year ("1989") when that's all we know. */
function edge(rows, t, side, transitions) {
  if (t == null) return null;
  for (const r of rows) {
    if (!r.spans.some((s) => s[side] === t)) continue;
    const tr = transitions(r.featureId).find((x) => Math.abs(x.t - t) < 1e-9);
    if (tr) return tr.precision === 'year' ? tr.date.slice(0, 4) : formatDate(tr.date.slice(0, 7));
  }
  return formatDecimalYear(t);
}

/** "Feb 2003 – Nov 2005", "Mar – Oct 1990", "Mar 1990", "since Mar 2008", "until Oct 1990". */
export function rangeText(a, b) {
  if (a && b) {
    if (a === b) return a;
    if (a.length > 4 && b.length > 4 && a.slice(-4) === b.slice(-4)) return `${a.slice(0, 3)} – ${b}`;
    return `${a} – ${b}`;
  }
  if (a) return `since ${a}`;
  if (b) return `until ${b}`;
  return 'at any time';
}
