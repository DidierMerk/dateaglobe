// "Share", on the dating side's result. A modal in the help's family (help.css): a floating card on every size over the
// paper veil, the help's head (the brand on the left, ✕ on the right) and two pages on a strip that follows the finger,
// with an arrow on each side of the phone (they fade with the strip).
//
// Each page, top to bottom:
//   the half phone   a phone drawn at 300 × 650 in the app's colours (status bar, "Sam"), shown only down to just below
//                    its conversation and dissolving into the card there (a mask). The conversation plays as the page
//                    arrives: your typing dots, your message, Sam's dots, Sam's reply (share-logic.js BEATS).
//   the words        a title and a line in the help's voice; both pages keep the taller one's height
//   Copy | Share     50/50: one row for both pages that stays still while the strip moves, over a slot each page
//                    keeps (so the page lays out as before); it acts on the page in view. A phone on its side, with the
//                    buttons beside the phone, shows each page's own buttons in that slot instead: they turn with it
//   1. Share your globe.   the message with the year, the months and three things the globe shows
//   2. Share as a game.    the message with the link to the sender's own globe as a game (dateaglobe.app/?d=…, "A friend's
//                          globe": custom-globe.js; never the year)
// Every dated globe with an answer to send has page 2 (custom-globe.js: its win rule makes any globe a fair game). Everything
// in both conversations is built from the result on screen (share-logic.js has the words and the rules).
// "Guess the year" opens the same modal with one page of its own (game.js): "Share your score.", the score message
// (a row of squares per guess, never the year) and Sam's reply; no arrows.
//
// Only words are sent. Share hands the message text to the system's share sheet, from inside the tap as Safari requires,
// and the modal closes 250 ms after it went; a cancel leaves it open; any other failure, or no share sheet, copies.
// Copy copies the message. Over http there is no share sheet at all (Safari offers it only on https), so Share is left
// out and Copy copies by the old selection route.
//
// Nothing is drawn per frame: every move (the card in and out, the strip's glide, a message arriving) is a Web Animation
// of transform and opacity; the finger moves the strip directly. The result's globe under the veil holds still while the
// modal is open (hold). Reduced motion: 200 ms fades, the conversations shown at rest.

import { layout } from './viewport.js';
import { landing, rubber, glideMs } from './help-logic.js';
import { WORDS, BEATS, resultMessage, gameMessage, datedLink, withHttps, SITE } from './share-logic.js';

// The modal hears every key and press first while it is open (as the help: added when this module loads, before the app's)
const guard = { key: null, down: null };
addEventListener('keydown', (e) => guard.key?.(e), true);
addEventListener('pointerdown', (e) => guard.down?.(e), true);

const EASE = 'cubic-bezier(.2, .8, .2, 1)'; // the app's CURVE (lang-layout.js), for the browser's own animations
const GAP = 48, T = { open: 320, close: 240, reduced: 200, mine: 520, text: 300, typing: 360, reply: 300 };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const f1 = (v) => v.toFixed(1);
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const PW = 300;               // the phone as drawn: 300 wide (650 tall)
const TOP = 9 + 40 + 52;      // the phone above its conversation: bezel, status bar, Sam's header
const FADE = 44;              // the soft cut, below the conversation (phone units)
const K_MAX = 0.72;           // the largest the phone is ever shown
const FS = 15;                // the message type, in phone units

const SHARE_ICON = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 2v9.5M5.8 5 9 1.9 12.2 5M6.5 7.5H4.5v8.5h9V7.5h-2"/></svg>';
const COPY_ICON = '<svg viewBox="0 0 18 18" aria-hidden="true"><rect x="6" y="6" width="9.5" height="9.5" rx="1.5"/><path d="M12 6V3.5A1.5 1.5 0 0 0 10.5 2h-7A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H6"/></svg>';
const DONE_ICON = '<svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.5 9.5 7.2 13 14.5 5"/></svg>';
const DOTS = '<i></i><i></i><i></i>';


/**
 * open(r): the dating result's pages, r = { button, key, peak, from, to (the likely range's years), agreeText, allAgree,
 *   facts, dated (the custom globe's code for page 2, or null) }; or any part's own, r = { button, pages: [{ title, lead, text, reply }], code } (the game's one page)
 */
export function createShareModal({ debug = false, hold = null, name = '__share' } = {}) {
  const veil = document.createElement('div'); veil.className = 'help-veil';
  const dlg = document.createElement('div');
  dlg.className = 'help sh is-card'; dlg.hidden = veil.hidden = true; dlg.tabIndex = -1;
  dlg.setAttribute('role', 'dialog'); dlg.setAttribute('aria-modal', 'true'); dlg.setAttribute('aria-label', 'Share');
  document.body.append(veil, dlg);
  const S = { open: false, closing: false, i: 0, x: 0, n: 2, step: 1, drag: null, glide: null, k: 1, crop: 0, side: false, size: '' };
  let button = null, view, track, pages = [], arrows = [], still = null, live, P = [], timers = [];
  const secure = () => window.isSecureContext;

  // ------------------------------------------------ build for this result
  function build(r) {
    if (r.pages) { P = r.pages; S.code = r.code ?? null; } // another part's own pages (the game's score: game.js)
    else {
      // page 2: the sender's own globe as a game (custom-globe.js writeLink), offered whenever there is an answer to send
      S.code = r.dated ?? null;
      P = [{ title: WORDS.title[0], lead: WORDS.lead[0], text: resultMessage({ ...r, site: SITE }), reply: WORDS.reply[0] }];
      if (S.code) P.push({ title: WORDS.title[1], lead: WORDS.lead[1], text: gameMessage(datedLink(S.code)), reply: WORDS.reply[1] });
    }
    S.n = P.length;
    const acts = secure()
      ? `<button type="button" class="btn-share sh-copy">${COPY_ICON}<span>${WORDS.copy}</span></button><button type="button" class="btn sh-send">${SHARE_ICON}<span>${WORDS.share}</span></button>`
      : `<button type="button" class="btn sh-copy">${COPY_ICON}<span>${WORDS.copy}</span></button>`;
    dlg.innerHTML = `
      <div class="help-head sh-head"><p class="help-brand"><span class="brand-mark" aria-hidden="true">◍</span> Date a Globe</p><button type="button" class="help-close" aria-label="Close"><svg viewBox="-8 -8 16 16" aria-hidden="true"><path d="M-5,-5L5,5M-5,5L5,-5"/></svg></button></div>
      <div class="help-view"><div class="help-track">${P.map((p) => `
        <section class="help-page sh-page" role="group" aria-roledescription="page" aria-label="${esc(p.title)}">
          <div class="sh-phone-box" role="group" aria-label="An example conversation"><div class="sh-phone"><div class="sh-screen">
            <div class="sh-status" aria-hidden="true"><span class="sh-time">9:41</span><span class="sh-island"></span><svg class="sh-sys" viewBox="0 0 54 12"><g fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1"/><rect x="4.5" y="6" width="3" height="6" rx="1"/><rect x="9" y="3.5" width="3" height="8.5" rx="1"/><rect x="13.5" y="1" width="3" height="11" rx="1"/></g><path d="M22 4.6a8.4 8.4 0 0 1 11 0M24.2 7.1a5.2 5.2 0 0 1 6.6 0M26.4 9.6a2 2 0 0 1 2.2 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="37" y="1.5" width="15" height="9" rx="2.5" fill="none" stroke="currentColor" opacity=".45"/><rect x="38.6" y="3.1" width="11" height="5.8" rx="1.4" fill="currentColor"/></svg></div>
            <div class="sh-top" aria-hidden="true"><svg class="sh-back" viewBox="0 0 10 18"><path d="M8.5 1.5 1.5 9l7 7.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg><div class="sh-who"><span class="sh-av">S</span><span class="sh-name">Sam</span></div></div>
            <div class="sh-chat"><div class="sh-chat-in">
              <div class="sh-msg out" hidden><p class="sh-bub sh-typing sh-mytyping" aria-hidden="true">${DOTS}</p><p class="sh-bub sh-text">${bubble(p.text, SITE)}</p></div>
              <div class="sh-msg in" hidden><p class="sh-bub sh-typing" aria-hidden="true">${DOTS}</p><p class="sh-bub sh-reply" hidden>${esc(p.reply)}</p></div>
            </div></div>
          </div></div></div>
          <div class="sh-words"><h2 class="help-title">${esc(p.title)}</h2><p class="sh-lead">${esc(p.lead)}</p></div>
          <div class="sh-acts sh-slot">${acts}</div>
        </section>`).join('')}</div><div class="sh-acts sh-still">${acts}</div>${S.n > 1 ? `<button type="button" class="sh-arrow prev" aria-label="${esc(P[0].title)}"><svg viewBox="0 0 12 22" aria-hidden="true"><path d="M10 2 2 11l8 9"/></svg></button><button type="button" class="sh-arrow next" aria-label="${esc(P[1].title)}"><svg viewBox="0 0 12 22" aria-hidden="true"><path d="M2 2l8 9-8 9"/></svg></button>` : ''}</div>
      <p class="vd-sr" aria-live="polite"></p>`;
    view = dlg.querySelector('.help-view'); track = dlg.querySelector('.help-track');
    pages = [...dlg.querySelectorAll('.sh-page')];
    arrows = [...dlg.querySelectorAll('.sh-arrow')];
    live = dlg.querySelector('[aria-live]');
    // an arrow's click straight after a swipe that started on it is the swipe's, not a second turn
    arrows.forEach((b, j) => b.addEventListener('click', () => { if (performance.now() - (S.swiped ?? -1e9) > 350) go(j ? S.i + 1 : S.i - 1); }));
    dlg.querySelector('.help-close').addEventListener('click', close);
    // one Copy | Share for both pages: it stays still while the strip moves, and acts on the page in view; a phone on
    // its side, with the buttons beside the phone, uses each page's own (they turn with the page)
    still = dlg.querySelector('.sh-still');
    still.querySelector('.sh-copy').addEventListener('click', (e) => copyIt(S.i, e.currentTarget));
    still.querySelector('.sh-send')?.addEventListener('click', (e) => sendIt(S.i, e.currentTarget));
    pages.forEach((pg, j) => {
      pg.querySelector('.sh-slot .sh-copy').addEventListener('click', (e) => copyIt(j, e.currentTarget));
      pg.querySelector('.sh-slot .sh-send')?.addEventListener('click', (e) => sendIt(j, e.currentTarget));
    });
  }

  // ------------------------------------------------ layout: the half phone, the words, the arrows beside the phone
  /** A page's conversation at rest (every message, no dots), in phone units. */
  function chatHeight(pg) {
    const parts = [...pg.querySelectorAll('.sh-msg, .sh-typing, .sh-text, .sh-reply')], was = parts.map((e) => e.hidden);
    parts.forEach((e) => { e.hidden = e.classList.contains('sh-typing'); });
    const h = pg.querySelector('.sh-chat-in').offsetHeight;
    parts.forEach((e, i) => { e.hidden = was[i]; });
    return h;
  }
  /** Both pages' words as tall as the taller, so the buttons stay in place. */
  function evenWords() {
    const ws = pages.map((p) => p.querySelector('.sh-words'));
    ws.forEach((x) => { x.style.minHeight = ''; });
    const m = Math.max(...ws.map((x) => x.offsetHeight));
    ws.forEach((x) => { x.style.minHeight = `${m}px`; });
  }
  function lay() {
    const Wd = innerWidth, Hd = innerHeight, kind = layout().kind, small = kind !== 'wide' && !document.documentElement.classList.contains('vp-page');
    S.size = `${Wd}x${Hd}`;
    S.side = kind === 'short'; // only a phone on its side puts the words beside the phone
    dlg.classList.toggle('is-small', small); dlg.classList.toggle('is-side', S.side);
    dlg.classList.toggle('is-tiny', Wd < 360 || Hd < 600);
    const w = view.clientWidth; S.step = w + GAP;
    pages.forEach((p) => { p.style.width = `${w}px`; p.style.setProperty('--sh-fs', `${FS}px`); });
    track.style.gap = `${GAP}px`;
    // the phone shown down to just below the taller page's conversation (both pages cut at one height), plus the soft
    // cut; as wide as the room allows (stacked: 72 px of the width left for the arrows; beside the words: half the page)
    // up to K_MAX, smaller only if the card would leave the screen
    S.crop = Math.ceil(TOP + Math.max(...pages.map(chatHeight)) + FADE);
    const boxes = pages.map((p) => p.querySelector('.sh-phone-box'));
    let k = Math.min(K_MAX, (S.side ? w * 0.5 : w - (S.n > 1 ? 72 : 0)) / PW);
    const scale = () => {
      boxes.forEach((b) => {
        b.style.width = `${Math.round(PW * k)}px`; b.style.height = `${Math.round(S.crop * k)}px`;
        b.style.setProperty('--fade', `${Math.round(FADE * k)}px`);
        b.firstElementChild.style.transform = `scale(${k.toFixed(4)})`;
      });
      evenWords();
    };
    scale();
    const over = dlg.offsetHeight - (Hd - 16);
    if (over > 0) { k = Math.max(0.3, k - over / S.crop); scale(); }
    S.k = k;
    // the buttons over the first page's slot (each page keeps one, so its layout is as it was); beside the phone, each
    // page's own buttons in their slot, and no still row
    still.hidden = S.side;
    pages.forEach((p) => { p.querySelector('.sh-slot').inert = !S.side; });
    const slot = pages[0].querySelector('.sh-slot');
    Object.assign(still.style, { left: `${slot.offsetLeft}px`, top: `${slot.offsetTop}px`, width: `${slot.offsetWidth}px` });
    // the arrows on the phone's middle, 26 px outside its edges (beside the words: › at the card's right edge)
    if (arrows.length) {
      const b = boxes[0], y = b.offsetTop + b.offsetHeight / 2;
      const leftC = b.offsetLeft - 26, rightC = S.side ? view.clientWidth - 22 : b.offsetLeft + b.offsetWidth + 26;
      arrows[0].style.left = `${f1(leftC - 22)}px`; arrows[1].style.left = `${f1(rightC - 22)}px`;
      arrows.forEach((a) => { a.style.top = `${f1(y)}px`; });
    }
    place();
  }
  // the strip at S.x, and the arrows following it: ‹ shows as the strip leaves page 1, › as it nears the last
  const tx = (x) => `translateX(${f1(-x * S.step)}px)`;
  const arrowA = (j, x) => (j ? clamp(S.n - 1 - x, 0, 1) : clamp(x, 0, 1));
  function place() {
    if (!Number.isFinite(S.x)) S.x = clamp(S.i, 0, S.n - 1); // never lost between pages
    track.style.transform = tx(S.x);
    arrows.forEach((b, j) => { const a = arrowA(j, S.x); b.style.opacity = a.toFixed(3); b.style.visibility = a > 0.01 ? '' : 'hidden'; });
  }


  // ------------------------------------------------ the strip's glide: the browser's own animation, on the app's curve
  /** Stop a glide where it is now (a finger can catch the strip mid-way). */
  function stopGlide() {
    const G = S.glide; if (!G) return;
    S.glide = null;
    let x = G.to;
    if (!G.fade) { const m = new DOMMatrixReadOnly(getComputedStyle(track).transform); if (Number.isFinite(m.m41) && S.step > 0) x = -m.m41 / S.step; }
    clearTimeout(G.t); G.anims.forEach((a) => a.cancel());
    S.x = x; place();
  }
  function glide(to) {
    stopGlide();
    const from = S.x; S.x = to;
    if (from === to) { place(); return; }
    let G;
    if (reduced()) { // a fade out and in, the strip moved at its middle
      S.x = from;
      G = { fade: true, to, anims: [view.animate([{ opacity: 1 }, { opacity: 0, offset: 0.5 }, { opacity: 1 }], { duration: T.reduced })] };
      G.t = setTimeout(() => { if (S.glide === G) { S.x = to; place(); } }, T.reduced / 2);
    } else {
      const o = { duration: glideMs(to - from), easing: EASE };
      place(); arrows.forEach((b) => { b.style.visibility = ''; }); // the end state underneath; the arrows stay visible while they fade
      G = { to, anims: [track.animate([{ transform: tx(from) }, { transform: tx(to) }], o), ...arrows.map((b, j) => b.animate([{ opacity: arrowA(j, from) }, { opacity: arrowA(j, to) }], o))] };
    }
    S.glide = G;
    G.anims[0].onfinish = () => { if (S.glide === G) { S.glide = null; S.x = to; place(); } };
  }

  // ------------------------------------------------ the conversation: played from when the page arrives
  // From the top of the phone's screen, so it grows downward and nothing above it moves: your bubble rises with typing
  // dots, which give way to your message; then Sam's dots, which give way to the reply.
  function clearChat(j) {
    timers = timers.filter((t) => { if (t.j === j) { clearTimeout(t.id); return false; } return true; });
    const pg = pages[j];
    pg.querySelector('.sh-chat-in').getAnimations({ subtree: true }).forEach((a) => a.cancel());
    pg.querySelectorAll('.sh-msg, .sh-text, .sh-reply').forEach((e) => { e.hidden = true; });
    pg.querySelectorAll('.sh-typing').forEach((e) => { e.hidden = false; });
  }
  function atRest(j) {
    clearChat(j);
    const pg = pages[j];
    pg.querySelectorAll('.sh-msg, .sh-text, .sh-reply').forEach((e) => { e.hidden = false; });
    pg.querySelectorAll('.sh-typing').forEach((e) => { e.hidden = true; });
  }
  function playChat(j, delay = 0) {
    if (reduced()) { atRest(j); return; }
    clearChat(j);
    const pg = pages[j], [mine, theirs] = pg.querySelectorAll('.sh-msg');
    const [myDots, text] = mine.children, [dots, reply] = theirs.children;
    const at = (ms, fn) => timers.push({ j, id: setTimeout(fn, delay + ms) });
    const move = (el, frames, ms) => el.animate(frames, { duration: ms, easing: EASE });
    at(BEATS.mine, () => { mine.hidden = false; move(myDots, [{ opacity: 0, transform: 'translateY(20px) scale(.92)' }, { opacity: 1, transform: 'none' }], T.mine); });
    at(BEATS.text, () => { myDots.hidden = true; text.hidden = false; move(text, [{ opacity: 0, transform: 'scale(.96)' }, { opacity: 1, transform: 'none' }], T.text); });
    at(BEATS.typing, () => { theirs.hidden = false; move(dots, [{ opacity: 0, transform: 'translateY(8px) scale(.94)' }, { opacity: 1, transform: 'none' }], T.typing); });
    at(BEATS.reply, () => { dots.hidden = true; reply.hidden = false; move(reply, [{ opacity: 0 }, { opacity: 1 }], T.reply); });
  }

  function chrome() {
    pages.forEach((p, j) => { p.inert = j !== S.i; });
    live.textContent = S.open && S.n > 1 ? `Page ${S.i + 1} of ${S.n}: ${P[S.i].title}` : '';
  }
  /** Glide to page i; its conversation plays from the start as it arrives. */
  function go(i) {
    i = clamp(Number.isFinite(i) ? i : S.i, 0, S.n - 1);
    if (i !== S.i) playChat(i, 120);
    S.i = i;
    glide(i);
    chrome();
  }

  // ------------------------------------------------ open / close: the browser's own animations of the card and the veil
  function open(r, at = 0) {
    if (S.open) return;
    button = r.button;
    build(r);
    S.open = true; S.closing = false;
    veil.hidden = dlg.hidden = false;
    S.i = clamp(at, 0, S.n - 1); S.x = S.i; S.glide = null; S.drag = null;
    lay(); chrome();
    pages.forEach((_, j) => (j === S.i ? playChat(j, 200) : clearChat(j)));
    for (const el of document.body.children) if (el !== dlg && el !== veil && !el.matches('script')) { el.dataset.shInert = el.inert ? '1' : ''; el.inert = true; }
    button?.setAttribute('aria-expanded', 'true');
    dlg.style.opacity = '1'; dlg.style.transform = 'translate(-50%, -50%)'; veil.style.opacity = '0.6';
    const o = { duration: reduced() ? T.reduced : T.open, easing: reduced() ? 'linear' : EASE };
    dlg.animate([{ opacity: 0, transform: reduced() ? 'translate(-50%, -50%)' : 'translate(-50%, calc(-50% + 12px)) scale(.98)' }, { opacity: 1, transform: 'translate(-50%, -50%)' }], o);
    veil.animate([{ opacity: 0 }, { opacity: 0.6 }], o);
    dlg.focus({ preventScroll: true });
    guard.key = onKey; guard.down = onDown;
    // the app under the veil stops drawing from the tap on (its turning globe would take the slow phone's time); it goes
    // on as the card leaves
    hold?.(true);
  }
  function close() {
    if (!S.open || S.closing) return;
    S.closing = true;
    button?.setAttribute('aria-expanded', 'false');
    hold?.(false);
    const o = { duration: reduced() ? T.reduced : T.close, easing: reduced() ? 'linear' : EASE, fill: 'forwards' };
    const a = dlg.animate([{ opacity: 1, transform: 'translate(-50%, -50%)' }, { opacity: 0, transform: reduced() ? 'translate(-50%, -50%)' : 'translate(-50%, calc(-50% + 12px)) scale(.98)' }], o);
    veil.animate([{ opacity: 0.6 }, { opacity: 0 }], o);
    a.onfinish = finish;
  }
  function finish() {
    S.open = false; S.closing = false; S.drag = null;
    stopGlide();
    timers.forEach((t) => clearTimeout(t.id)); timers = [];
    dlg.getAnimations({ subtree: true }).concat(veil.getAnimations()).forEach((a) => a.cancel());
    veil.hidden = dlg.hidden = true;
    for (const el of document.body.children) if (el.dataset && 'shInert' in el.dataset) { el.inert = el.dataset.shInert === '1'; delete el.dataset.shInert; }
    guard.key = guard.down = null;
    live.textContent = '';
    button?.focus({ preventScroll: true });
  }

  // ------------------------------------------------ the two actions: the message's words, nothing else
  const fullText = (j) => withHttps(P[j].text, SITE);
  /** Share: the system's sheet with the message, from inside the tap; once it went, the modal goes. */
  function sendIt(j, btn) {
    if (!navigator.share) return copyIt(j, btn); // a laptop browser with no share menu: Share copies
    let pr;
    try { pr = navigator.share({ text: fullText(j) }); } catch { pr = null; }
    if (!pr) return copyIt(j, btn);
    pr.then(() => timers.push({ id: setTimeout(close, 250) }), (e) => { if (e?.name !== 'AbortError') copyIt(j, btn); }); // a cancel leaves it open
  }
  /** Copy: the message. */
  function copyIt(j, btn) {
    copyText(fullText(j)).then((ok) => {
      if (!btn.isConnected) return;
      btn.focus({ preventScroll: true }); // the old copy route moved the focus to its own field
      if (!ok) return;
      const label = btn.querySelector('span');
      if (btn._done) clearTimeout(btn._done); else btn._was = { text: label.textContent, icon: btn.querySelector('svg').outerHTML };
      label.textContent = WORDS.copied; btn.querySelector('svg').outerHTML = DONE_ICON;
      btn._done = setTimeout(() => { btn._done = 0; if (!btn.isConnected) return; label.textContent = btn._was.text; btn.querySelector('svg').outerHTML = btn._was.icon; }, 1600);
    });
  }

  // ------------------------------------------------ input: Esc, the Tab trap, ← →, a sideways swipe (also from an arrow),
  // a sideways trackpad scroll, ✕ and the veil
  function onKey(e) {
    if (!S.open) return;
    e.stopImmediatePropagation(); // the app's own keys wait while the modal is open
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const f = [...dlg.querySelectorAll('button')].filter((n) => n.offsetParent && !n.closest('[inert]') && n.style.visibility !== 'hidden');
      const i = f.indexOf(document.activeElement);
      if (i < 0) { e.preventDefault(); (e.shiftKey ? f[f.length - 1] : f[0]).focus(); }
      else if (e.shiftKey && i === 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      return;
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); go(S.i + (e.key === 'ArrowRight' ? 1 : -1)); }
  }
  veil.addEventListener('click', close);
  function onDown(e) {
    if (!S.open) return;
    e.stopImmediatePropagation(); // the app hears no press while the modal is open (its click still comes: the veil, ✕)
    if (!dlg.contains(e.target) || e.button > 0 || S.closing || S.n < 2 || e.target.closest('button:not(.sh-arrow)')) return;
    S.drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, sx: S.x, axis: null, dx: 0, hist: [[performance.now(), e.clientX]] };
  }
  dlg.addEventListener('pointermove', (e) => {
    const g = S.drag; if (!g || g.id !== e.pointerId) return;
    g.dx = e.clientX - g.x0;
    g.hist.push([performance.now(), e.clientX]); if (g.hist.length > 6) g.hist.shift();
    if (!g.axis && Math.hypot(g.dx, e.clientY - g.y0) > 8) {
      g.axis = Math.abs(g.dx) > Math.abs(e.clientY - g.y0) ? 'x' : 'none';
      if (g.axis === 'x') { try { dlg.setPointerCapture(e.pointerId); } catch {} stopGlide(); g.sx = S.x; g.x0 = e.clientX; g.dx = 0; }
    }
    if (g.axis === 'x') { S.x = rubber(g.sx - g.dx / S.step, S.n); place(); }
  });
  // a release lands on the nearest page or the next one along a flick; a touch the system took (cancelled), on the nearest
  const endDrag = (e) => {
    const g = S.drag; if (!g || g.id !== e.pointerId) return;
    S.drag = null;
    if (g.axis !== 'x') return;
    const [t0, x0] = g.hist[0], vx = e.type === 'pointerup' ? (e.clientX - x0) / Math.max(1, performance.now() - t0) : 0;
    S.swiped = performance.now();
    go(landing(S.x, vx, S.n));
  };
  dlg.addEventListener('pointerup', endDrag); dlg.addEventListener('pointercancel', endDrag);
  // the card's own capture lost without a release (not an arrow's, which it takes over as the swipe starts)
  dlg.addEventListener('lostpointercapture', (e) => { if (e.target === dlg) endDrag(e); });
  // a sideways scroll (two fingers on a trackpad, Shift + wheel): the strip follows it 1:1, one page at most per gesture;
  // 140 ms after the last event it glides to the page it was heading for (past 15% of a page), else back (as the help)
  let wheel = null;
  dlg.addEventListener('wheel', (e) => {
    if (!S.open || S.closing || S.drag || S.n < 2) return;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? S.step : 1;
    const dx = (e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * unit;
    if (Math.abs(dx) <= Math.abs(e.shiftKey ? 0 : e.deltaY * unit)) return; // an up / down scroll is not a page turn
    e.preventDefault();
    if (!wheel) { stopGlide(); wheel = { base: clamp(Math.round(S.x), 0, S.n - 1), x: S.x, t: 0 }; }
    wheel.x = clamp(wheel.x + dx / S.step, wheel.base - 1, wheel.base + 1);
    S.x = rubber(wheel.x, S.n); place();
    clearTimeout(wheel.t);
    wheel.t = setTimeout(() => {
      const d = wheel.x - wheel.base, base = wheel.base; wheel = null;
      if (S.open) go(Math.abs(d) > 0.15 ? base + Math.sign(d) : base);
    }, 140);
  }, { passive: false });
  // a new size (a turned phone, a resized window; not the same size again, as iOS sends while its bars move)
  addEventListener('resize', () => { if (S.open && !S.drag && S.size !== `${innerWidth}x${innerHeight}`) { stopGlide(); lay(); } });

  // tests (?debug): the state
  if (debug) window[name] = {
    state: () => ({ code: S.code, open: S.open, i: S.i, x: S.x, n: S.n, k: S.k, crop: S.crop, side: S.side, text: P.map((p) => p.text), shared: P.map((p, j) => fullText(j)), glide: !!S.glide }),
  };
  return { open, close, isOpen: () => S.open };
}

// ------------------------------------------------ the words in the bubble
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
/** The message as it reads: the address underlined, each 📍 line with a hanging indent, the blank line kept as a gap. */
function bubble(text, site) {
  const link = (l) => l.split(site).map(esc).join(`<span class="sh-link">${esc(site)}</span>`)
    .replace(/<\/span>(\/\?[gd]=[A-Za-z0-9_-]+)/, '$1</span>');
  // a line that is only the game's link stays one line, cut with an ellipsis at the bubble's edge (a friend's globe's link
  // runs to 50 characters; the whole link is what Copy and Share send)
  const url = (l) => new RegExp(`^${site.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/\\?[gd]=`).test(l);
  return text.split('\n').map((l) => (l.startsWith('📍') ? `<span class="sh-fact"><span class="sh-pin">📍</span>${esc(l.slice(2).trim())}</span>`
    : l === '' ? '<span class="sh-gap"></span>' : `<span class="sh-line${url(l) ? ' sh-url' : ''}">${link(l)}</span>`)).join('');
}

/** Copy words: the clipboard where the browser offers it, else a selection and the old copy command (works over http). */
function copyText(text) {
  const old = () => {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', '');
    Object.assign(ta.style, { position: 'fixed', top: '0', left: '0', opacity: '0', fontSize: '16px' }); // 16 px: iOS doesn't zoom
    document.body.appendChild(ta); ta.focus({ preventScroll: true }); ta.select(); ta.setSelectionRange(0, text.length);
    let ok = false; try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove(); return ok;
  };
  if (window.isSecureContext && navigator.clipboard?.writeText) return navigator.clipboard.writeText(text).then(() => true, old);
  return Promise.resolve(old());
}
