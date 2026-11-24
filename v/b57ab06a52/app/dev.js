// Which address options the app takes. The test switches work only where the app is being built: this computer or a
// phone on its Wi-Fi (tools/serve.mjs prints those addresses). On the public site they are ignored and dropped from the
// address bar, so nobody lands on a test screen or opens a game with its year in the link. A friend's links (?g= from a
// game's score, ?d= a dated globe sent as a game) work everywhere.
//   ?debug             test hooks on window (__game, __help, __current …)
//   ?preview=…&lang=…  one state's picture, or result@YEAR
//   ?game[=YEAR]&seed= straight into the game, on that year and those clues

export const TEST_OPTIONS = ['debug', 'preview', 'lang', 'game', 'seed'];

/** This computer, or a private network address (a phone on the same Wi-Fi). */
export function isDevHost(hostname) {
  return /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|[\w-]+\.local|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/.test(hostname);
}

/** The address's options the app may use, and whether test options were dropped (then the address bar is cleaned). */
export function addressOptions(search, dev) {
  const query = new URLSearchParams(search);
  if (dev) return { query, dropped: false };
  const dropped = TEST_OPTIONS.some((k) => query.has(k));
  for (const k of TEST_OPTIONS) query.delete(k);
  return { query, dropped };
}
