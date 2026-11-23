// Date helpers shared by the compiler, engine and tools.
// All internal time is a "decimal year" (e.g. 1990.75 = 1 October 1990).

/** Days in a month (1-12) of a given year. */
function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Decimal year for a calendar date. */
export function toDecimalYear(year, month = 1, day = 1) {
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return year + (Date.UTC(year, month - 1, day) - start) / (end - start);
}

/**
 * Parse a "YYYY", "YYYY-MM" or "YYYY-MM-DD" string.
 * Returns the decimal year of the *middle* of the stated period and the
 * period's half-width, so a year-precision date carries +/-0.5 years of
 * uncertainty automatically.
 */
export function parseDate(text) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (!m) throw new Error(`Bad date: ${text}`);
  const year = Number(m[1]);
  if (m[3]) {
    const t = toDecimalYear(year, Number(m[2]), Number(m[3]));
    return { t, halfWidth: 0, precision: 'day' };
  }
  if (m[2]) {
    const month = Number(m[2]);
    const start = toDecimalYear(year, month, 1);
    const end = start + daysInMonth(year, month) / 365.25;
    return { t: (start + end) / 2, halfWidth: (end - start) / 2, precision: 'month' };
  }
  return { t: year + 0.5, halfWidth: 0.5, precision: 'year' };
}

/** Decimal year at the centre of grid month i. */
export function monthCentre(i, startYear) {
  return startYear + (i + 0.5) / 12;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Human label for a date string at its own precision: "22 May 1972", "Nov 1918", "1987". */
export function formatDate(text) {
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text);
  if (!m) return text;
  if (m[3]) return `${Number(m[3])} ${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
  if (m[2]) return `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}`;
  return m[1];
}

/** Label for a decimal year as month + year, e.g. "Oct 1990". */
export function formatDecimalYear(t) {
  const year = Math.floor(t);
  const month = Math.min(11, Math.floor((t - year) * 12));
  return `${MONTH_NAMES[month]} ${year}`;
}
