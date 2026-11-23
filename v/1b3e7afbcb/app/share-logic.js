// "Share" on the dating side's result (share-modal.js): the rules that need no screen, so they can be tested in Node.
// The dating result's two pages: their words, the two messages built from this result every time it is shown (the three
// things the globe shows, the game's link at dateaglobe.app), and whether the globe makes a fair game. The game's one
// page: its words and the score message (a Wordle-style row per guess, never the year). And the conversation's beats.
// Only words are ever shared: Share hands the message text to the system's share sheet, Copy puts it on the clipboard.

import { optionsFor, stateProbabilities } from '../engine/engine.js';
import { leansOnSubject, distTo, LOOKS } from './game-logic.js';

/** The app's address in the messages, and the links (always this address, on every host): a game of Guess the year to
 *  play as anyone would (?g=, from the game's score), or a dated globe sent as a game (?d=: "A friend's globe"). */
export const SITE = 'didiermerk.github.io/dateaglobe';
export const gameLink = (code) => `${SITE}/?g=${code}`;
export const datedLink = (code) => `${SITE}/?d=${code}`; // code: custom-globe.js writeLink

/** Each page's title and line (under the phone), Sam's replies, the game's page, the buttons. */
export const WORDS = {
  title: ['Share your globe.', 'Share as a game.'],
  lead: ['Let your friends know in what year your globe was printed!', 'Challenge your friends to guess when your globe was made. Can they figure it out?'],
  reply: ['Wow, that’s so cool! 😍', 'Challenge accepted 🧐'],
  game: { title: 'Share your score.', lead: 'Show your friends how you did, and challenge them to beat it.', reply: 'Challenge accepted 🧐' },
  copy: 'Copy', share: 'Share', copied: 'Copied',
};

const MONTH = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
/** agreement()'s months written out: "Oct 1961 – Apr 1963" → ["October 1961", "April 1963"], "Mar – Oct 1990" →
 *  ["March 1990", "October 1990"], "1989 – Apr 1990" → ["1989", "April 1990"]. Anything else (one month, "since …"): null. */
export function months(text) {
  const m = /^(?:([A-Z][a-z]{2}) )?(\d{4})? ?– (?:([A-Z][a-z]{2}) )?(\d{4})$/.exec(text ?? '');
  if (!m) return null;
  const [, ma, ya, mb, yb] = m;
  if ((ma && !MONTH[ma]) || (mb && !MONTH[mb]) || (!ya && !ma)) return null;
  return [`${ma ? `${MONTH[ma]} ` : ''}${ya ?? yb}`, `${mb ? `${MONTH[mb]} ` : ''}${yb}`];
}

/**
 * Page 1's message: the months every answer (or most) fits, then up to three things the globe shows.
 *   r: { agreeText (agreement().rangeText), allAgree, from, to (the likely range's years), facts: [claim], site }
 */
export function resultMessage({ agreeText, allAgree, from, to, facts = [], site = SITE }) {
  const mm = months(agreeText), when = mm ? `between ${mm[0]} and ${mm[1]}` : `of ${from}–${to}`;
  const seen = facts.length ? ` You can see:\n${facts.map((f) => `📍 ${f}`).join('\n')}` : '';
  return `I just dated my globe using Date a Globe! 🌍\n\nIt ${allAgree ? '' : 'almost '}perfectly matches the world ${when}.${seen}\n\nTry it yourself at ${site}!`;
}
/** Page 2's message, with the game's link on a line of its own (a friend's globe's link is long: it wraps cleanly in a chat). */
export const gameMessage = (link) => `I found this old globe at a vintage market. Bet you can’t guess when it was made 😏\n\nGuess the year in five tries:\n${link}`;
/** The message as it is sent: the address written without "https://" in the bubble, with it in what is shared. */
export const withHttps = (text, site = SITE) => text.replace(new RegExp(`(^|\\s)(${site.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')})`, 'g'), '$1https://$2');

/** A guess's square: how close it was (🟩 right, 🟨 within 3 years, 🟧 4–10, 🟥 more than 10 off). */
export const closeness = (off) => (off === 0 ? '🟩' : off <= 3 ? '🟨' : off <= 10 ? '🟧' : '🟥');
/**
 * The game's score message, Wordle-style: the score (n/5, X/5 when the five looks ran out), then a row per guess in
 * order: its square and the game's own hint (➡️ later, ⬅️ earlier; ✅ on the winning guess; on a lost game the last
 * row says ❌ and how far off, no square: "❌ 3 years off"), then the link to the same globe, on a line of its own. Never the year, never a clue (either would give it away).
 *   game: newGame()'s; hist: the guesses ({ g, win, dir }); link: the game's link (gameLink)
 */
export function scoreMessage(game, hist, link) {
  const won = hist.at(-1)?.win, lost = !won && hist.length >= LOOKS;
  const rows = hist.map((h, i) => {
    const off = h.win ? 0 : distTo(game.win, h.g), sq = closeness(off);
    if (h.win) return `${sq} ✅`;
    if (lost && i === hist.length - 1) return `❌ ${off} year${off === 1 ? '' : 's'} off`; // the last look, missed: no square
    return `${sq} ${h.dir > 0 ? '➡️' : '⬅️'}`;
  });
  return `Date a Globe 🌍 Guess the year ${won ? hist.length : 'X'}/${LOOKS}\n\n${rows.join('\n')}\n\nCan you date it faster?\n${link}`;
}

/**
 * Three things this globe shows, from the answers: for each yes / no answer (perspective questions left out), the state
 * that fits the reply and is likeliest in the peak year (its claim, when p > 0.3); the most salient first, no two the
 * same. Claims that lean on their question ("… is the capital", "The whole …", "It is …") or on other places ("the
 * region", "the others", "the rest") don't stand alone in a message and are skipped.
 *   rows: answerRows() of app.js; features: Map id → feature
 */
const standsAlone = (c) => !leansOnSubject(c) && !/^It\b/.test(c) && !/\b(the region|the others|the rest)\b/i.test(c);
export function shareFacts(rows, peak, features, language = 'en') {
  const out = [];
  for (const r of rows) {
    if (r.reply !== 'yes' && r.reply !== 'no') continue;
    const f = features.get(r.featureId); if (!f || f.perspective) continue;
    const opt = optionsFor(f, language).find((o) => o.key === r.optionKey); if (!opt) continue;
    const inOpt = new Set(opt.members.map((m) => m.state)), ps = stateProbabilities(f, peak + 0.5);
    let best = -1;
    f.states.forEach((st, i) => {
      if ((r.reply === 'yes') !== inOpt.has(i) || !st.claim || !standsAlone(st.claim)) return;
      if (best < 0 || ps[i] > ps[best]) best = i;
    });
    if (best >= 0 && ps[best] > 0.3) out.push({ claim: f.states[best].claim, s: f.salience ?? 0 });
  }
  out.sort((a, b) => b.s - a.s);
  return [...new Set(out.map((o) => o.claim))].slice(0, 3);
}

/** A page's beats, in ms from when it arrives: your typing dots, your message in their place, Sam's typing dots, Sam's
 *  reply in theirs. */
export const BEATS = { mine: 250, text: 1050, typing: 2250, reply: 3450 };
