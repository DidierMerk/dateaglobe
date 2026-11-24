// A short notice at the top of the screen, over whatever is there (it never moves the page): the paper card of the help, a
// title in the serif and a line in the help's text voice, ✕ to close it. It leaves by itself after `ms`: a brass hairline
// along its foot runs out over that time, and stops while a pointer rests on the card or focus is inside it. Used when a
// game link (?d=) can't be read: the landing opens with this on top (app.js).
//   showNotice({ title, text, ms }) -> close()

const CLOSE = '<svg viewBox="-8 -8 16 16" aria-hidden="true"><path d="M-5,-5L5,5M-5,5L5,-5"/></svg>';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let current = null;
export function showNotice({ title, text, ms = 7000 }) {
  current?.();
  const el = document.createElement('div');
  el.className = 'notice'; el.setAttribute('role', 'status'); el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<span class="brand-mark notice-mark" aria-hidden="true">◍</span>
    <div class="notice-words"><p class="notice-title">${esc(title)}</p><p class="notice-text">${esc(text)}</p></div>
    <button type="button" class="help-close notice-close" aria-label="Close">${CLOSE}</button><i class="notice-time" aria-hidden="true"></i>`;
  el.style.setProperty('--notice-ms', `${ms}ms`);
  // just under the top bar, whatever its height on this screen
  const bar = document.querySelector('.topbar')?.getBoundingClientRect();
  el.style.top = `${Math.round((bar?.bottom ?? 0) + 12)}px`;
  document.body.append(el);
  let gone = false;
  const close = () => {
    if (gone) return; gone = true; if (current === close) current = null;
    el.classList.remove('on');
    setTimeout(() => el.remove(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 220);
  };
  el.querySelector('.notice-close').addEventListener('click', close);
  el.querySelector('.notice-time').addEventListener('animationend', close); // the hairline has run out
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('on')));
  current = close;
  return close;
}
