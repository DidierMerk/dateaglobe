// "Where are we?": a small loupe on the lens rim. Zoomed in on a clue, it pulls back to the whole
// earth and rings the spot (globe.whereAreWe); then it reads "Zoom" and flies back in (globe.zoomBack).
// It shows during questions and on the setup's country close-ups, only when the view is a close-up.
// In setup it is the loupe alone (style.css hides the label there).

const ICON = `<svg class="where-icon" viewBox="0 0 24 24" aria-hidden="true">
  <circle cx="10" cy="10" r="6.25"/>
  <path class="where-handle" d="M14.6 14.6 20 20"/>
  <path d="M7.2 10h5.6"/>
  <path class="where-bar" d="M10 7.2v5.6"/>
</svg>`;

export function createWhere(wrap, globe) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'where';
  button.innerHTML = `<span class="where-loupe">${ICON}</span><span class="where-label"></span>`;
  wrap.appendChild(button);
  const label = button.querySelector('.where-label');
  let state = { zoomed: false, overview: false };
  let shown = false;
  let showTimer = 0;

  function render() {
    button.classList.toggle('is-shown', shown);
    button.classList.toggle('is-out', state.overview);
    label.textContent = state.overview ? 'Zoom' : 'Where are we?';
    button.setAttribute('aria-label', state.overview ? 'Zoom back in to the clue' : 'Where are we? Show the whole earth');
    button.tabIndex = shown ? 0 : -1;
  }

  button.addEventListener('click', () => (state.overview ? globe.zoomBack() : globe.whereAreWe()));
  // Looking while typing: the press must not take the focus from the field, or the keyboard would close
  button.addEventListener('mousedown', (e) => e.preventDefault());
  render();

  return {
    /** Called by the globe whenever its view changes: { zoomed, overview }. */
    update(next) {
      state = next;
      clearTimeout(showTimer);
      // A close-up being flown into: the loupe appears as the camera lands (about 90% of the way), not
      // at the start, when the globe is still far away or still gliding in from the landing page
      if (state.zoomed && !shown && next.settleMs > 0) showTimer = setTimeout(() => { shown = true; render(); }, next.settleMs * 0.9);
      else shown = state.zoomed;
      render();
    },
  };
}
