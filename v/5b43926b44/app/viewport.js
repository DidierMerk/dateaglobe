// Which layout the window gets, decided in one place for both CSS and JS. Classes on <html>:
//   vp-wide      side by side: globe left, question right, timeline under both (laptops, iPad landscape)
//   vp-stacked   one column: globe on top, question under it, timeline docked at the bottom (phones, tablets upright)
//   vp-short     a phone on its side: globe left, question right, compact timeline (height <= 500, landscape)
//   vp-compact   the timeline is a short strip that opens as a sheet (stacked phones and vp-short)
//   vp-page      an upright tablet (stacked, not compact, at least 600 px wide): one wide column, a globe sized by the
//                screen, the full timeline with taller rows
//   vp-touch     no hover: hover-only styles and tooltips step aside
// index.html runs the same rule inline before the first paint (keep the two in step).
//
// The app is always exactly one screen tall: --app-h follows the visible height, including the
// part an on-screen keyboard leaves (iOS shrinks only the visual viewport, so it is followed here).

const root = document.documentElement;
const listeners = new Set();

export function layoutFor(w, h) {
  const short = h <= 500 && w >= h;
  const stacked = !short && (w <= 860 || w / h <= 0.8);
  const kind = short ? 'short' : stacked ? 'stacked' : 'wide';
  const compact = short || (stacked && h <= 960);
  return { kind, compact, page: stacked && !compact && w >= 600 };
}

let current = null;
function apply() {
  // A keyboard that shrinks the window (Android) is not a new device shape: keep the layout while typing
  if (current && (typing || isTextField(document.activeElement))) return;
  const { kind, compact, page } = layoutFor(innerWidth, innerHeight);
  const key = `${kind}:${compact}:${page}`;
  root.classList.toggle('vp-wide', kind === 'wide');
  root.classList.toggle('vp-stacked', kind === 'stacked');
  root.classList.toggle('vp-short', kind === 'short');
  root.classList.toggle('vp-compact', compact);
  root.classList.toggle('vp-page', page);
  root.classList.toggle('vp-touch', matchMedia('(hover: none)').matches);
  if (key !== current) { current = key; listeners.forEach((fn) => fn(layout())); }
}

export const layout = () => ({
  kind: root.classList.contains('vp-short') ? 'short' : root.classList.contains('vp-stacked') ? 'stacked' : 'wide',
  compact: root.classList.contains('vp-compact'),
});
export const isWide = () => layout().kind === 'wide';
export const isCompact = () => layout().compact;
export const isPage = () => root.classList.contains('vp-page');
export const onLayout = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

// --- The keyboard: while a text field has focus, the app fits the visible part above it ----------
// vp-kb on <html> while the keyboard is up (reported by the browser), so the home-bar padding can go.
const vv = window.visualViewport;
let typing = false;
function fitKeyboard() {
  if (!vv) return;
  // Pinch-zoomed in, the visual viewport is small for another reason: leave the layout alone
  const h = typing && vv.scale < 1.05 ? Math.round(vv.height) : null;
  const up = !!h && h < innerHeight - 40;
  if (up) { if (root.style.getPropertyValue('--app-h') !== `${h}px`) root.style.setProperty('--app-h', `${h}px`); }
  else root.style.removeProperty('--app-h');
  root.classList.toggle('vp-kb', up);
  // iOS pans the page to show the field; the app already fits above the keyboard, so pan back
  if (window.scrollY) window.scrollTo(0, 0);
}
/**
 * The keyboard is on its way down (a step that ends typing): take the full height now, in this frame, instead of
 * when the browser reports it, so the next screen is laid out once, at its final size, while the keyboard slides away.
 */
export function releaseKeyboard() {
  typing = false;
  root.style.removeProperty('--app-h');
  root.classList.remove('vp-kb');
}
// Not every keyboard sends a resize as it opens (iOS with its AutoFill bar was seen not to):
// for a second after a field gets focus, check the visible height every frame
const isTextField = (el) => !!el?.matches?.('input[type="text"], input:not([type]), textarea');
let watchUntil = 0;
function watchKeyboard(now) {
  fitKeyboard();
  if (typing && now < watchUntil) requestAnimationFrame(watchKeyboard);
}
addEventListener('focusin', (e) => {
  if (!isTextField(e.target)) return;
  typing = true; fitKeyboard();
  const start = !watchUntil || performance.now() > watchUntil;
  watchUntil = performance.now() + 1200;
  if (start) requestAnimationFrame(watchKeyboard);
});
addEventListener('focusout', () => { typing = false; setTimeout(fitKeyboard, 50); setTimeout(apply, 120); });
vv?.addEventListener('resize', fitKeyboard);
vv?.addEventListener('scroll', () => { if (window.scrollY) window.scrollTo(0, 0); });

addEventListener('resize', apply);
addEventListener('orientationchange', () => setTimeout(apply, 120));
apply();
