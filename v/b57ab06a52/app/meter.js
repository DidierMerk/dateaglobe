// The progress line (UI round 56): a brass hairline along the foot of the top bar that fills as Date a Globe closes in
// on a year, while the questions run. On a wide window it spans the question's column, from the question's left edge
// to its right edge (where Yes / No end). That holds wherever the question has a column of its own beside the globe
// (laptops, tablets and phones on their side); upright phones and tablets, one column, have it along the whole bar.
//
// It is a sign of how far along the dating is, not a count of questions: it follows the engine's progress (engine-v2.js
// progress, shared.js progressValue), which can go back after an answer that surprises it. The line then goes back
// too, a little slower and softer than it grows.
//
//   createMeter({ el, bar, panel, layoutEl, beside }) -> { set({ value, done }), show(), hide({ instant }), leave(),
//                                                          place(), shown, value }
//
// - set: the line moves to the value (.9 s on the app's move curve). While the line is hidden it lands there at once, so
//   a new session never un-fills the last one's line, and a line coming back shows where things stand.
// - show / hide: the line comes with the question and answer screens and goes with them (a fade). Coming back from the
//   result, it waits until the page has reshaped, so it appears in its place instead of sliding there.
// - leave: the step into the result. The line completes, then its tail runs after its head to the right end while the
//   hairline fades: it leaves the way it filled, as the old screen fades and before the page reshapes.

const MOVE = 'cubic-bezier(.2, .8, .2, 1)';     // the app's move curve (the keyboard's)
const RESHAPE = 'cubic-bezier(.65, 0, .35, 1)'; // the curve the page reshapes on (style.css body.mode-quiz .layout)
const LEAVE = { fill: 320, tail: 520 };         // ms: completing the line (when it isn't full yet), then its tail

export function createMeter({ el, bar, panel, layoutEl, beside }) {
  const fill = el.querySelector('.meter-fill');
  const track = el.querySelector('.meter-track');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let shown = false;   // the question or answer screen is up (the line may still be waiting for the page to settle)
  let value = 0;
  let leaving = null;  // the animations of the step into the result
  let waiting = null;  // the page's reshape the line waits for before it appears

  /** Moves the line to v; `instant` skips the move. */
  function draw(v, { instant = false } = {}) {
    el.classList.toggle('is-dip', v < value - 1e-3);
    if (instant) {
      fill.style.transition = 'none';
      fill.style.transform = `scaleX(${v})`;
      void fill.offsetWidth; // the jump is drawn before the move comes back
      fill.style.removeProperty('transition');
    } else fill.style.transform = `scaleX(${v})`;
    value = v;
    el.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  }

  function set(p) {
    if (!p || !Number.isFinite(p.value)) return;
    const v = Math.min(1, Math.max(0, p.done ? 1 : p.value));
    if (leaving) { value = v; return; } // the result is on its way; the line comes back at v if the user returns
    if (Math.abs(v - value) < 5e-4) return;
    draw(v, { instant: !el.classList.contains('is-on') || reduced() });
  }

  /**
   * Beside the globe the line spans the question's column: the panel's content box, which is as wide as its column
   * whatever the screen shows, so it stays put from question to answer. In one column the stylesheet keeps it on the
   * bar's own margins.
   */
  function place() {
    if (leaving || !shown) return; // it holds still while the page reshapes into the result
    if (!beside()) { el.style.removeProperty('--meter-l'); el.style.removeProperty('--meter-r'); return; }
    const b = bar.getBoundingClientRect(), p = panel.getBoundingClientRect(), cs = getComputedStyle(panel);
    const l = p.left + parseFloat(cs.borderLeftWidth) + parseFloat(cs.paddingLeft) - b.left;
    const r = b.right - (p.right - parseFloat(cs.borderRightWidth) - parseFloat(cs.paddingRight));
    if (l < 0 || r < 0 || b.width - l - r < 80) { el.style.removeProperty('--meter-l'); el.style.removeProperty('--meter-r'); return; }
    el.style.setProperty('--meter-l', `${Math.round(l)}px`);
    el.style.setProperty('--meter-r', `${Math.round(r)}px`);
  }

  /** The page's own moves (the result's columns folding back into the quiz's), started by the change just made. */
  function reshaping() {
    void getComputedStyle(layoutEl).gridTemplateColumns; // brings the change's transitions into being
    return layoutEl.getAnimations().filter((a) => a.playState === 'running' || a.playState === 'pending');
  }

  function reveal() {
    waiting = null;
    place();
    el.classList.add('is-on');
  }

  function show() {
    if (leaving) stopLeaving();
    if (shown) return;
    shown = true;
    el.removeAttribute('aria-hidden');
    const moves = beside() && !reduced() ? reshaping() : [];
    if (!moves.length) return reveal();
    const wait = (waiting = Promise.all(moves.map((a) => a.finished.catch(() => {}))));
    wait.then(() => { if (waiting === wait && shown) reveal(); });
  }

  function hide({ instant = false } = {}) {
    if (leaving) stopLeaving();
    shown = false;
    waiting = null;
    el.setAttribute('aria-hidden', 'true');
    if (instant || reduced()) {
      el.classList.add('is-still');
      el.classList.remove('is-on');
      void el.offsetWidth;
      el.classList.remove('is-still');
    } else el.classList.remove('is-on');
  }

  /** The step into the result: complete, then the tail runs to the right end and the hairline fades. */
  function leave() {
    if (!shown) return;
    if (!el.classList.contains('is-on') || reduced()) return hide({ instant: true });
    shown = false;
    waiting = null;
    el.setAttribute('aria-hidden', 'true');
    const t = getComputedStyle(fill).transform; // where the line is now, mid-move or not
    const from = t === 'none' ? 1 : new DOMMatrixReadOnly(t).a;
    const fillMs = from < 0.999 ? LEAVE.fill : 0, total = fillMs + LEAVE.tail;
    fill.style.transition = 'none';
    fill.style.transform = 'translateX(100%) scaleX(0)';
    leaving = [
      fill.animate([
        { transform: `translateX(0) scaleX(${from})`, easing: fillMs ? MOVE : RESHAPE },
        ...(fillMs ? [{ transform: 'translateX(0) scaleX(1)', offset: fillMs / total, easing: RESHAPE }] : []),
        { transform: 'translateX(100%) scaleX(0)' },
      ], { duration: total }),
      track.animate([{ opacity: 1 }, { opacity: 0 }], { delay: fillMs + 60, duration: LEAVE.tail - 60, easing: 'ease', fill: 'forwards' }),
    ];
    const run = leaving;
    run[0].finished.then(() => {
      if (leaving !== run) return;
      leaving = null;
      hide({ instant: true });
      for (const a of run) a.cancel();
      draw(value, { instant: true });
    }, () => {});
  }

  /** Back to the question before the step into the result has finished (a row of the chart tapped at once). */
  function stopLeaving() {
    const run = leaving;
    leaving = null;
    for (const a of run) a.cancel();
    hide({ instant: true });
    draw(value, { instant: true });
  }

  let frame = 0;
  addEventListener('resize', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(place); });

  return {
    set, show, hide, leave, place,
    get shown() { return shown; },
    get value() { return value; },
  };
}
