// A claim on one line. The phone timeline's open row says what the question claimed ("The city is called
// Canton") beside the user's tick or cross, always on one line. When the name makes it too long, it drops
// the subject ("Called Democratic Republic of the Congo"), then keeps only the name, and only as a last resort
// cuts it with an ellipsis. measure(text) returns the text's width in px; tests/claims.test.mjs runs the
// same function on widths measured from the app's serif.

export function claimCandidates(claim) {
  const out = [claim];
  const m = /\b(called|spelled|labelled) (.+)$/.exec(claim);
  if (m) out.push(`${m[1].charAt(0).toUpperCase()}${m[1].slice(1)} ${m[2]}`, m[2]);
  return out;
}

/** The first candidate that fits maxW, else the claim cut with an ellipsis. { text, cut } */
export function fitClaim(claim, maxW, measure) {
  if (!claim) return { text: '', cut: false };
  for (const c of claimCandidates(claim)) if (measure(c) <= maxW) return { text: c, cut: false };
  let s = claim;
  while (s.length > 1 && measure(`${s}…`) > maxW) s = s.slice(0, -1).trimEnd();
  return { text: `${s}…`, cut: true };
}
