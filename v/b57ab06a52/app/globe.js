// The globe: d3 orthographic projection drawn on canvas.
// Today's borders (world-atlas) are the base; each scene (scenes.js) brings the historical borders
// and the clue's picture, and the camera flies to each clue.
//
// Stages: 'hero' (landing page: a large globe rising from the bottom edge)
// and 'panel' (centred in its column, seen through a round brass-ringed lens,
// so zoomed views stay circular instead of being cut off by the canvas).
//
// The canvas is a fixed layer covering the whole window. In the panel stage the globe is
// drawn where its column (the canvas's parent, .globe-wrap) currently is, so going from
// the hero to the panel is one continuous move of the same globe, not a cross-fade.

import { markBusy } from './quiet.js';

const d3 = window.d3;
const topojson = window.topojson;

export function createGlobe(canvas, world, { onView, heroClear = () => 0 } = {}) {
  const screen = canvas.getContext('2d');
  let ctx = screen;           // the context being drawn: the screen, or one of the still-frame layers
  const land = topojson.feature(world, world.objects.land);
  const countries = topojson.feature(world, world.objects.countries).features;
  const borders = topojson.mesh(world, world.objects.countries, (a, b) => a !== b);
  const graticule = d3.geoGraticule10();
  const projection = d3.geoOrthographic().clipAngle(90).precision(0.4);
  const path = d3.geoPath(projection, ctx);
  const css = getComputedStyle(document.documentElement);
  const colours = new Map(); // the palette is fixed: read each colour once, not on every frame
  const colour = (name) => { if (!colours.has(name)) colours.set(name, css.getPropertyValue(name).trim()); return colours.get(name); };

  let width = 0, height = 0;
  let rotation = [-10, -25, 0];
  let zoom = 1;
  let focus = null;           // { lat, lon }
  let label = null;           // { lat, lon, text } printed like an old map label
  let highlight = null;       // a world-atlas country feature, filled in brass
  let hlFade = null;          // { prev, start, ms }: the brass handing over from prev to highlight (or fading out)
  let glide = null;           // { box, start, ms, ease }: the lens gliding from box to its column (lensFrom)
  let givenBox = null;        // the column's box as a layout script placed it (setLensBox), so it need not be read back
  let detail = null;          // a finer coastline for the setup close-ups (setDetail), or null
  let idle = true;            // slow spin until the first question
  let idleTimer = 0;          // reset(): the spin resumes once the pull-back has landed, unless the camera moved on
  let flight = null;
  let stage = 'panel';
  let introStart = 0;         // hero: when the globe started rising
  let scene = null;           // a historical picture (scenes.js), or null for today's borders
  let sceneAlpha = 1;         // fades a new scene in, and the one it replaced (prevScene) out
  let prevScene;              // the scene being faded out (null = today's borders), undefined when none
  let hatchPattern = null;
  let morph = null;           // { start, duration, from: { cx, cy, r, ringR, clipR } }: hero -> panel move
  const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MORPH_MS = REDUCED ? 0 : 1300;
  // "Where are we?": the clue's own camera, whether we pulled back from it, and the ring that marks it
  let view = { camera: null, overview: false };
  let ring = null;            // { lat, lon, radius (deg), born, duration, phase: 'out' | 'in' }
  let labelFade = 1;          // scene labels step aside while the whole earth is shown, so the ring reads alone
  let labelsWanted = true;    // false while the lens is a small medallion beside an answer (setLabelsShown)
  // The game's globe prints the countries and cities of its year (setNames): { countries, cities } from game-logic placesAt
  let names = null;           // what to print now, or null
  let namesShown = null;      // the last set printed, kept while it fades out
  let namesAlpha = 0;         // the whole layer, fading in or out
  let namesSeq = 0;           // a new set of names is a new picture
  let namesBusy = false;      // a name is fading in or out this frame
  const nameFade = new Map(); // name -> { a, side }: every name fades by itself and a city keeps its side
  let namesPlaced = [];       // the names given a place this frame (tests read it)
  // The size step's desk globe on phones (size-scene.js): the lens takes on its look, so the two can hand over
  // unseen. look: borders fade and a light comes up; arc: the brass rim closes into the tilted meridian half-ring.
  // Each is { from, to, start, ms }; deskLook / deskArc are this frame's values.
  const deskTrack = { look: { from: 0, to: 0, start: 0, ms: 0 }, arc: { from: 0, to: 0, start: 0, ms: 0 } };
  let deskLook = 0, deskArc = 0;
  const trackAt = (T, now) => (T.ms && now < T.start + T.ms ? T.from + (T.to - T.from) * Math.max(0, (now - T.start) / T.ms) : T.to);
  const trackBusy = (T, now) => T.ms > 0 && now < T.start + T.ms;
  // settleMs: how long until the camera lands (a flight just started), so a control can wait for it
  // Any close-up gets the loupe: a few clues are framed wide (zoom 1.6–2.4), and a loupe that skips them reads as missing
  const emit = (settleMs = 0) => onView?.({ zoomed: !!view.camera && view.camera.zoom > 1.2, overview: view.overview, settleMs });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    screen.setTransform(dpr, 0, 0, dpr, 0, 0);
    still.key = null;
  }

  /**
   * The hero globe: large, rising from below the bottom edge. Wide windows centre it under the
   * title; upright screens show a broad dome over the lower part; a phone on its side puts it to
   * the right of the text. It never rises into the hero text (heroClear: the text's bottom edge).
   */
  const heroShort = () => height <= 500 && width >= height;
  const heroUpright = () => !heroShort() && (width <= 860 || width / height <= 0.8);
  // upright: the horizon's own height (an upright tablet, wide and tall: a little higher, closer to the button), and the
  // gap it keeps under the hero text (it moves down, out of the way, when the text reaches lower)
  const heroHorizon = () => height * (width >= 600 && height > 960 ? 0.52 : 0.58);
  const heroGap = () => height * 0.045;
  function heroFrame() {
    const rise = d3.easeCubicOut(Math.min(1, (performance.now() - introStart) / 2200));
    const short = heroShort(), upright = heroUpright();
    let r, cx = width / 2, top;
    if (short) {
      r = height * 0.8; cx = width - Math.max(r * 0.55, width * 0.2); top = height * 0.38;
    } else if (upright) {
      r = Math.min(width * 1.05, height * 0.62);
      top = Math.max(heroClear() + heroGap(), heroHorizon());
    } else {
      r = Math.min(width * 0.44, height * 0.8);
      top = Math.max(height + r * 0.42 - r, heroClear() + 18); // as before, unless the title runs into it
    }
    const cy = top + r + (1 - rise) * r * 0.7;
    return { cx, cy, r, ringR: r + 12, clipR: Math.hypot(width, height) };
  }

  /** The panel globe: centred in its column (measured every frame, so it follows layout and scrolling). */
  function panelFrame(z) {
    const box = lensBox();
    const half = Math.min(box.width, box.height) / 2;
    const lensR = half - 8;
    // zoom 1 = the whole globe; each step enlarges about 55%, so a clue fills the lens (zoom 3.5 = 3x)
    const r = (half - 14) * Math.pow(1.55, z - 1);
    return { cx: box.left + box.width / 2, cy: box.top + box.height / 2, r, ringR: Math.min(r + 6, lensR + 4), clipR: lensR };
  }

  /**
   * The lens's box: its column (.globe-wrap), or partway from where it was when a screen changed under it
   * (lensFrom), so the lens keeps one path while the page around it is rebuilt.
   */
  function lensBox() {
    const b = givenBox ?? canvas.parentElement.getBoundingClientRect();
    if (!glide) return b;
    const t = Math.min(1, (performance.now() - glide.start) / glide.ms);
    if (t >= 1) { glide = null; return b; }
    const e = glide.ease(t), m = (a, c) => a + (c - a) * e;
    return { left: m(glide.box.left, b.left), top: m(glide.box.top, b.top), width: m(glide.box.width, b.width), height: m(glide.box.height, b.height) };
  }

  /** Where to draw this frame: hero, panel, or partway along the move between them. */
  function frame(z) {
    if (stage === 'hero') return { ...heroFrame(), k: 0 };
    const to = panelFrame(z);
    if (!morph) return { ...to, k: 1 };
    const t = Math.min(1, (performance.now() - morph.start) / morph.duration);
    if (t >= 1) morph = null;
    const e = (morph?.ease ?? d3.easeCubicInOut)(t), mix = (a, b) => a + (b - a) * e;
    const f = morph?.from ?? to;
    // Everything on one curve: the lens closes in from the hero's ring to its column while the earth moves and resizes.
    // The brass ring stays on the visible edge all the way, as the panel draws it: on the earth's rim while the earth
    // is the smaller of the two, else on the lens's rim (its gap to the earth narrows from the hero's 12 px to 6)
    const r = mix(f.r, to.r), clipR = mix(f.clipR, to.clipR);
    const ringR = Math.min(r + mix(f.ringR - f.r, 6), clipR + 4);
    return { cx: mix(f.cx, to.cx), cy: mix(f.cy, to.cy), r, ringR, clipR, k: e };
  }

  /** The detailed shapes that can reach the lens this frame (their bounding circle meets the visible cap). */
  function nearView(items) {
    const centre = [-rotation[0], -rotation[1]], cap = (projection.clipAngle() * Math.PI) / 180;
    return items.filter((it) => d3.geoDistance(centre, it.at) - it.r < cap).map((it) => it.coordinates);
  }
  const detailLand = () => ({ type: 'MultiPolygon', coordinates: nearView(detail.land) });
  const detailBorders = () => ({ type: 'MultiLineString', coordinates: nearView(detail.borders) });

  // --- Drawing ------------------------------------------------------------------------------
  // A frame is three layers: the earth under the brass country (ocean, graticule, land), the brass country
  // itself (it pulses), and everything over it (borders or the scene, the "Where are we?" ring, the name,
  // the brass rim). While nothing but the pulse changes, the two still layers are kept as pictures and
  // only the brass is drawn again, so a globe at rest costs almost nothing.
  // Only the part of the earth the lens can show is drawn: the projection is cut to that cap, so a
  // close-up no longer projects and strokes the whole hemisphere just to clip it away.

  const still = { key: null, ready: false, below: null, above: null, count: 0 };
  const sceneIds = new WeakMap(); let sceneSeq = 0;
  const sceneId = (sc) => { if (!sc) return 0; if (!sceneIds.has(sc)) sceneIds.set(sc, ++sceneSeq); return sceneIds.get(sc); };
  const layerCanvas = () => { const c = document.createElement('canvas'); return { canvas: c, ctx: c.getContext('2d') }; };

  /** The cap of earth the lens shows (degrees around its centre), with a little margin; 90 = the whole hemisphere. */
  function viewCap(scale, clipR) {
    if (stage !== 'panel' || scale <= clipR + 2) return 90;
    return Math.min(90, (Math.asin(Math.min(1, (clipR + 2) / scale)) * 180) / Math.PI + 3);
  }

  /** Nothing moves this frame but the pulse: no flight, glide, morph, spin, fade or ripple. */
  function isStill(now) {
    if (stage !== 'panel' || flight || morph || glide || idle || hlFade) return false;
    if (trackBusy(deskTrack.look, now) || trackBusy(deskTrack.arc, now)) return false;
    if (prevScene !== undefined || sceneAlpha < 1) return false;
    if (label && (label.out || (label.alpha ?? 1) < 1)) return false;
    if (labelFade !== (view.overview || !labelsWanted ? 0 : 1)) return false;
    if (namesBusy || namesAlpha !== (names ? 1 : 0)) return false;
    if (ring && (ring.phase === 'in' || now - (ring.born + ring.duration) < 2700)) return false;
    return true;
  }
  const keyOf = (F) => [F.cx, F.cy, F.r, F.clipR, F.ringR, F.k, rotation[0], rotation[1], rotation[2], zoom, width, height,
    sceneId(scene), highlight?.id ?? '', label?.text ?? '', ring ? 1 : 0, detail ? 1 : 0, focus ? `${focus.lat},${focus.lon}` : '', labelFade, deskLook, deskArc, namesSeq, namesAlpha].join('|');

  function draw(time) {
    const F = frame(zoom);
    const { cx, cy, r: scale, clipR } = F;
    screen.clearRect(0, 0, width, height);
    // A column folded away (phones hide the globe on the size step): nothing to draw
    if (stage === 'panel' && (clipR < 24 || scale < 12)) { still.key = null; return; }
    projection.scale(scale).translate([cx, cy]).rotate(rotation).clipAngle(viewCap(scale, clipR));
    const now = performance.now();
    deskLook = trackAt(deskTrack.look, now); deskArc = trackAt(deskTrack.arc, now);
    const h = hlFade ? Math.min(1, Math.max(0, (now - hlFade.start) / hlFade.ms)) : 1;
    if (hlFade && h >= 1) hlFade = null;
    const fine = detail && (highlight || hlFade?.prev) && !scene && prevScene === undefined && zoom >= 3;

    // At rest: the same picture as last frame apart from the pulse
    const key = isStill(now) ? keyOf(F) : null;
    if (key && key === still.key) {
      if (!still.ready && ++still.count >= 2) buildStill(F, fine, h);
      if (still.ready) return compose(F, fine, h, time);
    } else { still.key = key; still.ready = false; still.count = 0; }

    below(F, fine);
    brass(F, fine, h, time);
    above(F, fine);
    marker(F, time);
  }

  let oceanAt = null; // where this frame's ocean light sits
  /** The ocean's paint: a soft light from the upper left (on the context drawing now). */
  function oceanPaint() {
    const { cx, cy, scale } = oceanAt;
    const g = ctx.createRadialGradient(cx - scale * 0.35, cy - scale * 0.4, scale * 0.1, cx, cy, scale);
    g.addColorStop(0, colour('--ocean-2')); g.addColorStop(1, colour('--ocean'));
    return g;
  }
  const GRATICULE = 'rgba(244,236,220,0.10)';
  /** The earth under the brass: ocean with a soft light from the upper left, graticule, land. */
  function below(F, fine) {
    const { cx, cy, r: scale, clipR } = F;
    ctx.save();
    if (stage === 'panel') { ctx.beginPath(); ctx.arc(cx, cy, clipR, 0, 2 * Math.PI); ctx.clip(); }
    oceanAt = { cx, cy, scale };
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = oceanPaint(); ctx.fill();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = deskLook ? `rgba(244,236,220,${0.10 + 0.02 * deskLook})` : GRATICULE; ctx.lineWidth = 0.6; ctx.stroke();
    // The setup close-up of a country uses the finer map once it has loaded; clues keep the base map,
    // which their period borders were drawn against
    ctx.beginPath(); path(fine ? detailLand() : land); ctx.fillStyle = colour('--land'); ctx.fill();
    ctx.restore();
  }

  /** The brass country; while it hands over (the next country, or none), the two cross-fade. */
  function brass(F, fine, h, time) {
    if (!highlight && !hlFade?.prev) return;
    const { cx, cy, clipR } = F;
    ctx.save();
    if (stage === 'panel') { ctx.beginPath(); ctx.arc(cx, cy, clipR, 0, 2 * Math.PI); ctx.clip(); }
    const pulse = (Math.sin(time / 420) + 1) / 2;
    const one = (f, a) => {
      if (!f || a < 0.01) return;
      ctx.globalAlpha = a;
      ctx.beginPath(); path(fine ? detail.byId.get(String(f.id)) ?? f : f);
      ctx.fillStyle = `rgba(176,138,62,${0.45 + pulse * 0.25})`; ctx.fill();
      ctx.strokeStyle = colour('--brass'); ctx.lineWidth = 1.5; ctx.stroke();
      ctx.globalAlpha = 1;
    };
    one(hlFade?.prev, 1 - h);
    one(highlight, h);
    ctx.restore();
  }

  const visible = (p) => d3.geoDistance([p.lon, p.lat], [-rotation[0], -rotation[1]]) < Math.PI / 2;

  /** Over the brass: borders or the scene, the "Where are we?" ring, the name, and the brass rim. */
  function above(F, fine) {
    const { cx, cy, r: scale, ringR, clipR, k } = F;
    lensNow = { cx, cy, clipR };
    ctx.save();
    if (stage === 'panel') { ctx.beginPath(); ctx.arc(cx, cy, clipR, 0, 2 * Math.PI); ctx.clip(); }
    // A new scene cross-fades over the one it replaces, borders included, so nothing pops: the
    // clue's highlight and labels fade out, and changed borders melt into the new ones. Square
    // roots keep borders both scenes share near full strength halfway through.
    const fading = prevScene !== undefined && sceneAlpha < 1;
    if (fading) {
      const out = Math.sqrt(1 - sceneAlpha);
      if (prevScene) drawScene(scale, prevScene, out, out); else drawBorders(out);
    } else prevScene = undefined;
    const inA = fading ? Math.sqrt(sceneAlpha) : 1;
    if (scene) drawScene(scale, scene, sceneAlpha, inA); else if (deskLook < 1) drawBorders(inA * (1 - deskLook), fine ? detailBorders() : borders);
    // The desk globe's light from the upper left (size-scene.js), coming up as the borders go
    if (deskLook > 0) {
      const hl = ctx.createRadialGradient(cx - scale * 0.4, cy - scale * 0.45, 0, cx - scale * 0.4, cy - scale * 0.45, scale * 0.9);
      hl.addColorStop(0, `rgba(255,255,255,${0.22 * deskLook})`); hl.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = hl; ctx.fill();
    }

    if (namesShown && namesAlpha > 0.01 && stage === 'panel') drawNames(F); else namesBusy = false;

    if (ring) drawRing();

    // A place name printed in old-map style: spaced serif capitals with a paper halo
    if (label && visible(label)) {
      const p = projection([label.lon, label.lat]);
      let size = Math.max(14, Math.min(26, scale / 14));
      ctx.save();
      const fontAt = (sz) => { ctx.font = `600 ${sz}px ${colour('--serif')}`; if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(sz * 0.18)}px`; };
      fontAt(size);
      // In a small lens a long name (GRIECHENLAND) shrinks to fit inside it
      const room = stage === 'panel' ? clipR * 2 * 0.78 : Infinity, wide = ctx.measureText(label.text).width;
      if (wide > room) { size = Math.max(11, size * room / wide); fontAt(size); }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.globalAlpha = label.alpha ?? 1;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(233,220,192,.9)'; ctx.lineJoin = 'round';
      ctx.strokeText(label.text, p[0], p[1]);
      ctx.fillStyle = colour('--ink'); ctx.fillText(label.text, p[0], p[1]);
      ctx.restore();
    }
    ctx.restore();

    // Brass meridian ring: hugs the globe, or the lens edge when zoomed in
    if (deskArc < 1) {
      ctx.beginPath(); ctx.arc(cx, cy, ringR, 0, 2 * Math.PI);
      ctx.strokeStyle = colour('--brass'); ctx.lineWidth = 1.5 + 0.5 * k; ctx.globalAlpha = (0.6 + 0.2 * k) * (1 - deskArc);
      ctx.stroke(); ctx.globalAlpha = 1;
    }
    // ...closing into the desk globe's half-ring, tilted with its axis (size-scene.js)
    if (deskArc > 0) {
      ctx.save(); ctx.globalAlpha = deskArc; ctx.translate(cx, cy); ctx.rotate((23.4 * Math.PI) / 180);
      ctx.strokeStyle = colour('--brass'); ctx.lineWidth = Math.max(1.5, scale * 0.06);
      const sweep = Math.PI * 0.62 * (0.55 + 0.45 * deskArc);
      ctx.beginPath(); ctx.arc(0, 0, scale * 1.08, -sweep, sweep, true); ctx.stroke();
      ctx.restore();
    }
  }

  /** Focus marker: a pulsing brass ring where the clue is (never with a brass country or a name). */
  function marker(F, time) {
    if (!focus || highlight || label || !visible(focus)) return;
    const { cx, cy, clipR } = F;
    ctx.save();
    if (stage === 'panel') { ctx.beginPath(); ctx.arc(cx, cy, clipR, 0, 2 * Math.PI); ctx.clip(); }
    const p = projection([focus.lon, focus.lat]);
    const pulse = (Math.sin(time / 380) + 1) / 2;
    ctx.beginPath(); ctx.arc(p[0], p[1], 10 + pulse * 10, 0, 2 * Math.PI);
    ctx.strokeStyle = `rgba(176,138,62,${0.9 - pulse * 0.6})`; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 2 * Math.PI); ctx.fillStyle = colour('--accent'); ctx.fill();
    ctx.restore();
  }

  /** The lens's square on the canvas (CSS pixels), clamped to it. */
  function region(F) {
    const R = Math.max(F.clipR, F.ringR) + 4;
    const x = Math.max(0, Math.floor(F.cx - R)), y = Math.max(0, Math.floor(F.cy - R));
    return { x, y, w: Math.min(width, Math.ceil(F.cx + R)) - x, h: Math.min(height, Math.ceil(F.cy + R)) - y };
  }

  /** Draw the two still layers once, into their own canvases. */
  function buildStill(F, fine) {
    const dpr = window.devicePixelRatio || 1;
    still.below ??= layerCanvas(); still.above ??= layerCanvas();
    for (const L of [still.below, still.above]) {
      if (L.canvas.width !== canvas.width || L.canvas.height !== canvas.height) { L.canvas.width = canvas.width; L.canvas.height = canvas.height; }
      L.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      L.ctx.clearRect(0, 0, width, height);
    }
    ctx = still.below.ctx; path.context(ctx); below(F, fine);
    ctx = still.above.ctx; path.context(ctx); above(F, fine);
    ctx = screen; path.context(ctx);
    still.ready = true;
  }

  /** A still frame: the two kept layers with the pulsing brass (or marker) between and over them. */
  function compose(F, fine, h, time) {
    const dpr = window.devicePixelRatio || 1, r = region(F);
    if (r.w <= 0 || r.h <= 0) return;
    const blit = (L) => screen.drawImage(L.canvas, r.x * dpr, r.y * dpr, r.w * dpr, r.h * dpr, r.x, r.y, r.w, r.h);
    blit(still.below);
    brass(F, fine, h, time);
    blit(still.above);
    marker(F, time);
  }

  /** Today's borders, at an opacity. */
  function drawBorders(alpha, mesh = borders) {
    ctx.globalAlpha = alpha;
    ctx.beginPath(); path(mesh); ctx.strokeStyle = colour('--border'); ctx.lineWidth = 0.5; ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /** A historical picture: period borders, the clue highlighted, overlays and labels (`a` for those, `bordersA` for the borders). */
  function drawScene(scale, scene, a, bordersA = 1) {
    if (scene.highlight.length) {
      ctx.globalAlpha = a;
      ctx.beginPath(); scene.highlight.forEach((f) => path(f));
      ctx.fillStyle = 'rgba(176,138,62,.55)'; ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (scene.hatch.length) {
      hatchPattern ??= makeHatch();
      ctx.save(); ctx.globalAlpha = a;
      ctx.beginPath(); scene.hatch.forEach((f) => path(f)); ctx.clip();
      ctx.fillStyle = hatchPattern; ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
    for (const o of scene.overlays) {
      ctx.globalAlpha = a;
      ctx.beginPath(); path(o.geojson);
      if (o.style === 'water') { ctx.fillStyle = colour('--ocean-2'); ctx.fill(); }
      else if (o.style === 'zone') { ctx.fillStyle = 'rgba(181,69,44,.45)'; ctx.fill(); ctx.strokeStyle = colour('--accent'); ctx.lineWidth = 1.2; ctx.stroke(); }
      else if (o.style === 'canal') { ctx.strokeStyle = colour('--ocean'); ctx.lineWidth = 3; ctx.stroke(); }
      else if (o.style === 'dashed') { ctx.setLineDash([5, 4]); ctx.strokeStyle = colour('--ocean'); ctx.lineWidth = 2.5; ctx.stroke(); ctx.setLineDash([]); }
      else if (o.style === 'highlight') {
        islands(o.geojson);
        ctx.fillStyle = colour('--land'); ctx.fill(); // brass over land, also where an island dot sits on the sea
        ctx.fillStyle = 'rgba(176,138,62,.55)'; ctx.fill(); ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 1.6; ctx.stroke();
      }
      else if (o.style === 'hatch') {
        hatchPattern ??= makeHatch();
        ctx.save(); ctx.clip(); ctx.fillStyle = hatchPattern; ctx.fillRect(0, 0, width, height); ctx.restore();
        ctx.beginPath(); path(o.geojson); ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 1.2; ctx.stroke();
      }
      else if (o.style === 'ice') { ctx.fillStyle = 'rgba(250,247,240,.95)'; ctx.fill(); ctx.strokeStyle = 'rgba(31,42,55,.45)'; ctx.lineWidth = 0.8; ctx.stroke(); }
      else if (o.style === 'island') {
        islands(o.geojson);
        ctx.fillStyle = colour('--land'); ctx.fill(); ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 1.4; ctx.stroke();
      }
      else if (o.style === 'rail') {
        ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 2; ctx.stroke();
        ctx.setLineDash([1.5, 6]); ctx.lineWidth = 6; ctx.stroke(); ctx.setLineDash([]); // cross-ties
      }
      else if (o.style === 'rail_building') { ctx.setLineDash([6, 5]); ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
      else if (o.style === 'border') { ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 1.6; ctx.stroke(); }
      else if (o.style === 'salt') { ctx.fillStyle = '#f3ecdd'; ctx.fill(); ctx.setLineDash([2, 3]); ctx.strokeStyle = 'rgba(31,42,55,.55)'; ctx.lineWidth = 1; ctx.stroke(); ctx.setLineDash([]); }
      else if (o.style === 'dateline') { ctx.setLineDash([7, 5]); ctx.strokeStyle = colour('--accent'); ctx.lineWidth = 2; ctx.stroke(); ctx.setLineDash([]); }
      else if (o.style.startsWith('base-')) drawBase(o);
      ctx.globalAlpha = 1;
    }
    ctx.globalAlpha = bordersA;
    ctx.beginPath(); path(scene.borders); ctx.strokeStyle = colour('--border'); ctx.lineWidth = 0.6; ctx.stroke();
    // a frontier with land no state held (scenes frontierAt): dotted, as period maps drew an undefined border
    if (scene.frontier) { ctx.beginPath(); path(scene.frontier); ctx.setLineDash([2, 3]); ctx.lineWidth = 0.8; ctx.stroke(); ctx.setLineDash([]); }
    ctx.globalAlpha = a;
    if (scene.highlight.length) {
      ctx.beginPath(); scene.highlight.forEach((f) => path(f));
      ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 1.6; ctx.stroke();
    }
    if (scene.dashed.length) {
      ctx.setLineDash([6, 5]); ctx.beginPath(); scene.dashed.forEach((f) => path(f));
      ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 1.4; ctx.stroke(); ctx.setLineDash([]);
    }
    // An undefined border: drawn over the base borders, erasing their solid line first
    for (const o of scene.overlays.filter((x) => x.style === 'undefined')) {
      ctx.beginPath(); path(o.geojson);
      ctx.strokeStyle = colour('--land'); ctx.lineWidth = 3.5; ctx.stroke();
      ctx.setLineDash([4, 4]); ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 1.8; ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = a * labelFade;
    // water names last: they look for room beside their lake, so the places' names must be on the picture already
    for (const l of scene.labels) if (l.kind !== 'water') drawLabel(l, scale);
    namesTaken = [];
    for (const l of scene.labels) if (l.kind === 'water') drawLabel(l, scale);
    ctx.globalAlpha = 1;
  }

  // Small islands are drawn at least a few pixels wide, so they show at globe scale: each shape
  // smaller than 7 px becomes a dot (r px), larger ones keep their outline
  function islands(geojson, r = 4) {
    ctx.beginPath();
    for (const f of geojson.features ?? [geojson]) {
      const [[x0, y0], [x1, y1]] = path.bounds(f);
      if (!Number.isFinite(x0)) continue;
      if (Math.max(x1 - x0, y1 - y0) >= 7) { path(f); continue; }
      const x = (x0 + x1) / 2, y = (y0 + y1) / 2;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 2 * Math.PI);
    }
  }

  /**
   * The game globe's own layer (game-logic layersAt), drawn as the globe draws its own coasts and borders: water in the
   * ocean's paint, lines in the border colour, nothing in brass. The path is already set (drawScene).
   */
  function drawBase(o) {
    const st = o.style.slice(5), line = (w, dash = []) => { ctx.setLineDash(dash); ctx.lineWidth = w; ctx.stroke(); ctx.setLineDash([]); };
    if (st === 'water' || st === 'sea') {
      ctx.fillStyle = oceanAt ? oceanPaint() : colour('--ocean'); ctx.fill();
      // sea over today's coastline keeps the graticule running through it
      if (st === 'sea') { ctx.save(); ctx.clip(); ctx.beginPath(); path(graticule); ctx.strokeStyle = GRATICULE; ctx.lineWidth = 0.6; ctx.stroke(); ctx.restore(); }
    } else if (st === 'salt') { ctx.fillStyle = '#efe5cf'; ctx.fill(); ctx.strokeStyle = colour('--border'); line(0.8, [2, 3]); }
    else if (st === 'dateline') { ctx.strokeStyle = 'rgba(244,236,220,.5)'; line(0.9, [5, 4]); }
    else if (st === 'canal') { ctx.strokeStyle = colour('--ocean'); line(1.4); }
    else if (st === 'canal-building') { ctx.strokeStyle = colour('--ocean'); line(1.4, [3, 3]); }
    else if (st === 'zone') { ctx.strokeStyle = colour('--border'); line(0.6); }
    else if (st === 'hatch') {
      baseHatch ??= makeHatch('rgba(156,138,102,.55)', 0.8);
      ctx.save(); ctx.clip(); ctx.fillStyle = baseHatch; ctx.fillRect(0, 0, width, height); ctx.restore();
      ctx.beginPath(); path(o.geojson); ctx.strokeStyle = colour('--border'); line(0.6);
    }
    else if (st === 'line') { ctx.strokeStyle = colour('--ink-soft'); line(1.1, [3, 2.5]); } // a ceasefire line across a country, dashed as atlases print it
    else if (st === 'island') { islands(o.geojson, 2.4); ctx.fillStyle = colour('--land'); ctx.fill(); ctx.strokeStyle = colour('--border'); line(0.6); }
    else if (st === 'uncharted') { ctx.strokeStyle = colour('--border'); line(0.8, [3, 3]); }
    // a border the atlases left undefined (Saudi Arabia and Yemen before 2000): the solid line under it wiped out, then dashed
    else if (st === 'undefined') { ctx.strokeStyle = colour('--land'); line(2.4); ctx.strokeStyle = colour('--border'); line(0.8, [2, 3]); }
  }
  let baseHatch = null;

  /**
   * The footprint of the close-up: the patch of earth the lens showed, as a ring on the globe.
   * Pulling back, it starts on the lens edge and shrinks with the earth; flying back in it grows
   * until it meets the brass rim and dissolves into it. Two soft ripples mark the spot on arrival.
   */
  function drawRing() {
    const now = performance.now();
    const t = Math.min(1, (now - ring.born) / Math.max(1, ring.duration));
    const circle = (deg) => d3.geoCircle().center([ring.lon, ring.lat]).radius(deg).precision(2)();
    const fade = Math.min(1, Math.max(0, (t - 0.65) / 0.35)); // flying in, the ring melts into the rim over the last third
    const alpha = ring.phase === 'in' ? 1 - fade * fade * (3 - 2 * fade) : 1;
    ctx.save();
    ctx.globalAlpha = Math.max(0, alpha);
    ctx.beginPath(); path(circle(ring.radius));
    // The tint gathers as the ring leaves the rim, so the first frame is not a brass wash over the whole lens
    const tint = ring.phase === 'out' ? Math.min(1, t / 0.45) : 1;
    ctx.fillStyle = `rgba(176,138,62,${0.18 * tint})`; ctx.fill();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(244,236,220,.75)'; ctx.lineWidth = 4.5; ctx.stroke(); // paper halo, readable on sea and land
    ctx.strokeStyle = colour('--brass'); ctx.lineWidth = 2; ctx.stroke();
    // Ripples once the earth is in view: two, then stillness
    const since = now - (ring.born + ring.duration);
    if (ring.phase === 'out' && since > 0 && !REDUCED) {
      for (let k = 0; k < 2; k++) {
        const p = (since - k * 900) / 1700;
        if (p <= 0 || p >= 1) continue;
        const e = d3.easeCubicOut(p);
        ctx.globalAlpha = (1 - e) * 0.7;
        ctx.beginPath(); path(circle(ring.radius * (1 + 1.6 * e)));
        ctx.strokeStyle = colour('--brass'); ctx.lineWidth = 1.5; ctx.stroke();
      }
    }
    ctx.restore();
    if (ring.phase === 'in' && t >= 1) ring = null;
  }

  /** How many degrees of earth the lens shows around its centre at zoom z. */
  function footprint(z) {
    const { r, clipR } = panelFrame(z);
    return (Math.asin(Math.min(1, clipR / r)) * 180) / Math.PI;
  }

  /** Pull-back time grows with the distance in zoom, so a deep close-up takes a little longer. */
  const pullMs = (z) => (REDUCED ? 0 : Math.min(2100, 1100 + 170 * (z - 1)));

  function makeHatch(stroke = 'rgba(31,42,55,.55)', width = 1.2) {
    const c = document.createElement('canvas');
    c.width = c.height = 8;
    const x = c.getContext('2d');
    x.strokeStyle = stroke; x.lineWidth = width;
    x.beginPath(); x.moveTo(-2, 10); x.lineTo(10, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(6, 10); x.lineTo(10, 6); x.stroke();
    return ctx.createPattern(c, 'repeat');
  }

  /** Map typography: countries in spaced capitals, cities with a dot, capitals with a star, water in italics. */
  // The widest a country name may be: 300 px; in the game (a small lens, a globe turned by hand) also no wider
  // than the lens leaves around the name's own place, so it is not cut off at the rim
  let lensNow = null; // { cx, cy, clipR } of this frame (above())
  function labelRoom(p) {
    if (!names || stage !== 'panel' || !lensNow) return 300;
    const dy = p[1] - lensNow.cy, half = Math.sqrt(Math.max(0, lensNow.clipR ** 2 - dy * dy)) - Math.abs(p[0] - lensNow.cx) - 6;
    return Math.min(300, Math.max(lensNow.clipR * 0.7, 2 * half));
  }
  // --- Water names: inside the water when they fit, else beside it (lakes) or moved within it (seas) ----------
  // As old atlases do: a lake too small for its name has the name beside it, in the ocean's blue with the land's
  // halo. What counts is the picture as drawn (the base map's sea, the lakes a clue draws, salt flats, ice), so it
  // is read off the canvas near the name: again whenever the view changed, at most every 150 ms while the globe
  // moves (in between the last place, scaled with the globe). Water: dark and blue; free for a name beside it:
  // opaque and light (thin borders are).
  const waterFont = (size, serif) => {
    ctx.font = `italic 500 ${size}px ${serif}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${size >= 13 ? 2 : 1}px`;
  };
  let namesTaken = []; // the boxes of the water names already on this picture (drawScene clears it)
  const placed = new WeakMap(); // label → { inside, size, dx, dy, align } and where, how big and when it was measured (p, scale, t)
  function waterPlace(l, p, scale, serif) {
    const size = Math.max(13, Math.min(18, scale / 40));
    const last = placed.get(l), now = performance.now();
    if (last) {
      const same = Math.abs(scale / last.scale - 1) < 0.02 && Math.hypot(p[0] - last.p[0], p[1] - last.p[1]) < 2;
      // the same view: the same place; moving: the last place, grown with the globe, measured again every 150 ms
      if (same || (ctx === screen && now - last.t < 150)) {
        const k = scale / last.scale;
        return { ...last, dx: last.dx * k, dy: last.dy * k };
      }
    }
    const w = measureWater(l, p, size, serif);
    placed.set(l, { ...w, scale, p: [p[0], p[1]], t: now });
    return w;
  }
  function measureWater(l, p, size, serif) {
    const textW = (s) => { waterFont(s, serif); return ctx.measureText(l.text).width + 4; };
    // the picture around the name: what is drawn so far, over the base layer when drawing a still layer
    const R = Math.ceil(Math.max(textW(size) * 1.5, 130)), RY = 90;
    const x0 = Math.floor(p[0] - R), y0 = Math.floor(p[1] - RY), W = 2 * R, H = 2 * RY;
    const m = ctx.getTransform(), k = m.a;
    // the window read: this one, or a larger one only when the name must look further away (nearestFree)
    let win = null;
    const read = (wx, wy, ww, wh) => {
      const grab = (c) => c.getImageData(Math.round(wx * k + m.e), Math.round(wy * k + m.f), Math.max(1, Math.round(ww * k)), Math.max(1, Math.round(wh * k)));
      const top = grab(ctx);
      win = { wx, wy, top, base: ctx !== screen && still.below ? grab(still.below.ctx) : null, PW: top.width, PH: top.height };
    };
    read(x0, y0, W, H);
    const px = (x, y) => { // [r, g, b, a] at a CSS point, the layers blended as the screen shows them
      const { wx, wy, top, base, PW, PH } = win;
      const X = Math.round((x - wx) * k), Y = Math.round((y - wy) * k);
      if (X < 0 || Y < 0 || X >= PW || Y >= PH) return null;
      const i = (Y * PW + X) * 4, t = top.data, at = t[i + 3] / 255;
      if (!base) return [t[i], t[i + 1], t[i + 2], t[i + 3]];
      const b = base.data, ab = b[i + 3] / 255, a = at + ab * (1 - at);
      if (a <= 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((j) => (t[i + j] * at + b[i + j] * ab * (1 - at)) / a).concat(a * 255);
    };
    const wet = (x, y) => { const c = px(x, y); return !!c && c[3] > 200 && c[0] + c[1] + c[2] < 330 && c[2] - c[0] > 35; };
    const free = (x, y) => { const c = px(x, y); return !!c && c[3] > 200 && c[0] + c[1] + c[2] > 330; };
    // land: paper-light (land, salt, ice); a border line over water is dark, an island's brass dot mid-tone
    const notLand = (x, y) => { const c = px(x, y); return !c || c[3] < 200 || c[0] + c[1] + c[2] < 560; };
    // the text's box from its anchor (align: where the anchor sits in the line) sampled on a grid
    const box = (x, y, s, align, test, share) => {
      const tw = textW(s), h = s * 0.9, left = align === 'center' ? x - tw / 2 : align === 'right' ? x - tw : x;
      if (namesTaken.some((b) => left < b.x1 + 4 && left + tw > b.x0 - 4 && y - h / 2 < b.y1 + 3 && y + h / 2 > b.y0 - 3)) return false; // another water name
      let n = 0, ok = 0;
      const N = Math.ceil(tw / 3); // every 3 px along the line, so a narrow strip of land or a line can't slip between
      for (let i = 0; i <= N; i++) for (let j = 0; j <= 2; j++) { n++; if (test(left + (tw * i) / N, y - h / 2 + (h * j) / 2)) ok++; }
      return ok >= share * n;
    };
    // inside: on water (a line across it may cross the name) and nowhere on land, however narrow the strip
    const inside = (dx, dy, s) => box(p[0] + dx, p[1] + dy, s, 'center', wet, 0.9) && box(p[0] + dx, p[1] + dy, s, 'center', notLand, 1);
    // 1. inside, at its size or a little smaller (never below 12 px)
    for (let s = size; s >= Math.max(12, size * 0.8) - 1e-9; s -= 1) if (inside(0, 0, s)) return { inside: true, size: s, dx: 0, dy: 0, align: 'center' };
    // 2. the water under or nearest the name, followed across the window on a 2 px grid
    const G = 2, cols = Math.floor(W / G), rows = Math.floor(H / G), cell = (c, r) => wet(x0 + c * G, y0 + r * G);
    let start = null, best = Infinity;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      const d = Math.hypot(x0 + c * G - p[0], y0 + r * G - p[1]);
      if (d < best && d <= 30 && cell(c, r)) { best = d; start = [c, r]; }
    }
    let bx0 = p[0], bx1 = p[0], by0 = p[1], by1 = p[1], open = false;
    if (start) {
      const seen = new Uint8Array(cols * rows), stack = [start];
      seen[start[1] * cols + start[0]] = 1;
      while (stack.length) {
        const [c, r] = stack.pop(), x = x0 + c * G, y = y0 + r * G;
        bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
        if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) open = true;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const c2 = c + dc, r2 = r + dr;
          if (c2 < 0 || r2 < 0 || c2 >= cols || r2 >= rows || seen[r2 * cols + c2] || !cell(c2, r2)) continue;
          seen[r2 * cols + c2] = 1; stack.push([c2, r2]);
        }
      }
    }
    // 3. a sea (its water runs past the window): the nearest place within it where the name fits
    if (open) {
      for (let d = 4; d <= 80; d += 4) for (let a = 0; a < 16; a++) {
        const dx = d * Math.cos((a * Math.PI) / 8), dy = d * Math.sin((a * Math.PI) / 8);
        if (inside(dx, dy, size)) return { inside: true, size, dx, dy, align: 'center' };
      }
      for (let s = size - 1; s >= 12; s -= 1) if (inside(0, 0, s)) return { inside: true, size: s, dx: 0, dy: 0, align: 'center' };
      return nearestFree(p[0], p[1]) ?? { inside: true, size, dx: 0, dy: 0, align: 'center' }; // no room at all: as it always was
    }
    // 4. a lake: beside it, on the first side clear of water, lines and other names (right, left, below, above)
    const gap = 6, line = size * 0.75, y = Math.min(Math.max(p[1], by0), by1);
    const sides = [
      { x: bx1 + gap, y, align: 'left' }, { x: bx0 - gap, y, align: 'right' },
      { x: p[0], y: by1 + line, align: 'center' }, { x: p[0], y: by0 - line, align: 'center' },
    ];
    const pick = sides.find((s) => box(s.x, s.y, size, s.align, free, 1));
    if (pick) return { inside: false, size, dx: pick.x - p[0], dy: pick.y - p[1], align: pick.align };
    return nearestFree((bx0 + bx1) / 2, (by0 + by1) / 2) ?? { inside: false, size, dx: sides[0].x - p[0], dy: sides[0].y - p[1], align: 'left' };
    /** The nearest clear place on land around (cx, cy) for the name, centred, within 150 px, at its size or down to 12 px; or null. */
    function nearestFree(cx, cy) {
      const reach = 150 + textW(size) / 2 + 10;
      read(Math.floor(cx - reach), Math.floor(cy - reach), 2 * reach, 2 * reach);
      for (let s = size; s >= Math.min(size, 12) - 1e-9; s -= 1) {
        for (let d = 8; d <= 150; d += 4) for (let a = 0; a < 24; a++) {
          const x = cx + d * Math.cos((a * Math.PI) / 12), y = cy + d * Math.sin((a * Math.PI) / 12);
          if (box(x, y, s, 'center', free, 1)) return { inside: false, size: s, dx: x - p[0], dy: y - p[1], align: 'center' };
        }
      }
      return null;
    }
  }

  function drawLabel(l, scale) {
    if (d3.geoDistance(l.at, [-rotation[0], -rotation[1]]) > Math.PI / 2 - 0.05) return;
    const p = projection(l.at);
    if (!p) return;
    const serif = colour('--serif');
    const latin = /[a-z]/i.test(l.text);
    ctx.save();
    ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
    const halo = (text, x, y) => { ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(233,220,192,.92)'; ctx.strokeText(text, x, y); };
    if (l.kind === 'country') {
      let size = Math.max(12, Math.min(l.small ? 16 : 22, scale / 30));
      const text = latin ? l.text.toUpperCase() : l.text;
      ctx.font = `600 ${size}px ${serif}`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size * 0.16)}px`;
      const w = ctx.measureText(text).width;
      const room = labelRoom(p);
      if (w > room) { size = Math.max(room < 300 ? 9 : 10, size * room / w); ctx.font = `600 ${size}px ${serif}`; if (room < 300 && 'letterSpacing' in ctx) ctx.letterSpacing = `${Math.round(size * 0.16)}px`; }
      ctx.textAlign = 'center';
      halo(text, p[0], p[1]); ctx.fillStyle = colour('--ink'); ctx.fillText(text, p[0], p[1]);
    } else if (l.kind === 'water') {
      const w = waterPlace(l, p, scale, serif);
      waterFont(w.size, serif);
      ctx.textAlign = w.align;
      const x = p[0] + w.dx, y = p[1] + w.dy;
      const tw = ctx.measureText(l.text).width, left = w.align === 'center' ? x - tw / 2 : w.align === 'right' ? x - tw : x;
      namesTaken.push({ x0: left, x1: left + tw, y0: y - w.size * 0.45, y1: y + w.size * 0.45 });
      if (w.inside) { ctx.fillStyle = colour('--land'); ctx.fillText(l.text, x, y); }
      else { halo(l.text, x, y); ctx.fillStyle = colour('--ocean'); ctx.fillText(l.text, x, y); }
    } else {
      const capital = l.kind === 'capital';
      ctx.fillStyle = colour('--ink');
      if (capital) star(p[0], p[1], 7, 3); else { ctx.beginPath(); ctx.arc(p[0], p[1], 3.5, 0, 2 * Math.PI); ctx.fill(); }
      ctx.font = `${capital ? 600 : 500} ${capital ? 17 : 15}px ${serif}`;
      const dx = l.side === 'left' ? -11 : 11;
      ctx.textAlign = l.side === 'left' ? 'right' : 'left';
      halo(l.text, p[0] + dx, p[1]); ctx.fillStyle = colour('--ink'); ctx.fillText(l.text, p[0] + dx, p[1]);
    }
    ctx.restore();
  }

  // --- The names of the game's globe: countries and cities of its year, by distance -----------------------
  // A country's name is printed once it fits inside the country, the largest first, in the map labels' spaced
  // capitals (a step lighter than a clue's own label). A small country is named once it is at least half as wide as its
  // name (the name runs a little over its edges, as on a printed globe) from zoom 4, and at the last zoom steps every country in
  // view is, however small (Luxembourg, Bahrain, Gaza): so each country of the year has its name at some zoom. Cities come in three ranks as the earth grows on screen,
  // capitals ringed. A name is printed whole inside the lens or not at all, and never over another: one that
  // would collide waits. Each fades by itself.
  const CITY_AT = { 1: 300, 2: 520, 3: 820 }; // the earth's radius on screen (px) from which a city of that rank is printed
  // where a country's name may sit: on its point, or a step or two under or over it, clear of a capital's label (from
  // NEAR_ZOOM a step is half the name's height and 10 px: a city's label is 7 px either side of its dot; 7 px before)
  const SLOTS = [0, 1, -1, 2, -2];
  const NEAR_ZOOM = 4, SMALL_ZOOM = 7;        // from zoom 4 a name may run over its country's edges; from 7 (the deepest is 8)
                                              // every country in view is named. Below 4 the globe names as before: no clutter
  const widths = new Map();
  function width10(text, weight, spacing) {
    const key = weight + text;
    if (!widths.has(key)) {
      ctx.font = `${weight} 10px ${colour('--serif')}`;
      const spaced = 'letterSpacing' in ctx;
      if (spaced) ctx.letterSpacing = `${spacing * 10}px`;
      widths.set(key, ctx.measureText(text).width + (spaced ? 0 : spacing * 10 * text.length));
      if (spaced) ctx.letterSpacing = '0px';
    }
    return widths.get(key);
  }
  const twoLines = (name) => {
    if (name.length < 12 || !name.includes(' ')) return [name];
    const mid = name.length / 2; let best = -1;
    for (let i = 0; i < name.length; i++) if (name[i] === ' ' && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    return [name.slice(0, best), name.slice(best + 1)];
  };
  const overlaps = (b, list) => list.some((o) => b.x0 < o.x1 && b.x1 > o.x0 && b.y0 < o.y1 && b.y1 > o.y0);
  /** Where the scene's own labels are (drawLabel's sizes), so the names keep clear of the clue. */
  function sceneLabelBoxes(scale) {
    if (!scene || sceneAlpha < 0.5 || labelFade < 0.5) return [];
    const out = [];
    for (const l of scene.labels) {
      const p = projection(l.at); if (!p) continue;
      if (l.kind === 'country') {
        const size = Math.max(12, Math.min(l.small ? 16 : 22, scale / 30)), w = Math.min(labelRoom(p), width10(l.text.toUpperCase(), '600', 0.16) * size / 10);
        out.push({ x0: p[0] - w / 2 - 6, x1: p[0] + w / 2 + 6, y0: p[1] - size * 0.75, y1: p[1] + size * 0.75, at: l.at, text: l.text.toLowerCase() });
      } else {
        const size = l.kind === 'capital' ? 17 : 15, w = width10(l.text, l.kind === 'water' ? 'italic 500' : '500', 0) * size / 10, left = l.side === 'left';
        out.push({ x0: left ? p[0] - 13 - w : p[0] - 8, x1: left ? p[0] + 8 : p[0] + 13 + w, y0: p[1] - 10, y1: p[1] + 10, at: l.at, text: l.text.toLowerCase() });
      }
    }
    return out;
  }
  function drawNames(F) {
    const { cx, cy, r: scale, clipR } = F, P = namesShown, centre = [-rotation[0], -rotation[1]], serif = colour('--serif');
    const reserved = sceneLabelBoxes(scale), cand = [];
    // zoomed out, a country's name keeps close to its point (as it always did); from NEAR_ZOOM it may step further
    const near = zoom >= NEAR_ZOOM, slots = near ? SLOTS : SLOTS.slice(0, 3), step = near ? 10 : 7;
    const seen = (lon, lat) => { if (d3.geoDistance([lon, lat], centre) > 1.3) return null; const p = projection([lon, lat]); return p && Math.hypot(p[0] - cx, p[1] - cy) < clipR ? p : null; };
    const inside = (b) => [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]].every(([x, y]) => Math.hypot(x - cx, y - cy) < clipR - 3);
    const nearClue = (lon, lat, text) => reserved.some((r) => d3.geoDistance(r.at, [lon, lat]) < 0.07 || r.text.includes(text) || text.includes(r.text));
    for (const [name, lon, lat, s, owner] of P.countries) {
      const p = seen(lon, lat); if (!p) continue;
      // who ruled it, on its own line under the name, as period atlases print it: "PHILIPPINES / (SP.)"
      const E = s * scale, fs = Math.max(9, Math.min(14, E / 8.5)), lines = [...twoLines(name.toUpperCase()), ...(owner ? [`(${owner.toUpperCase()})`] : [])];
      const w = Math.max(...lines.map((line) => width10(line, '600', 0.14))) * fs / 10, h = lines.length * fs * 1.18;
      // a country with room to spare is named first; a small one only after the capitals, so its name never hides one
      const named = E >= Math.max(30, w * 0.74) || (zoom >= NEAR_ZOOM && E >= Math.max(18, w * 0.5)) || zoom >= SMALL_ZOOM;
      // a small one in the middle of the lens (the one being looked at) goes before the other small ones
      const middle = Math.hypot(p[0] - cx, p[1] - cy) < clipR * 0.3;
      cand.push({ id: `c${name}${lon}`, country: true, p, fs, lines, pri: s, ord: E >= 2.2 * w ? 0 : middle ? 1.5 : 2, ok: named && !nearClue(lon, lat, name.toLowerCase()),
        boxes: slots.map((k) => { const dy = k * (h / 2 + step); return { dy, x0: p[0] - w / 2 - 4, x1: p[0] + w / 2 + 4, y0: p[1] + dy - h / 2 - 2, y1: p[1] + dy + h / 2 + 2 }; }) });
    }
    // places with no country of their own on the globe (Canal Zone, Svalbard, Easter Island): printed as countries are,
    // small, from the zoom a city of their rank needs, after every country
    for (const [name, lon, lat, rank, owner] of P.places ?? []) {
      if (scale < CITY_AT[rank] * 0.8) continue;
      const p = seen(lon, lat); if (!p) continue;
      const fs = 9.5, lines = [...twoLines(name.toUpperCase()), ...(owner ? [`(${owner.toUpperCase()})`] : [])];
      const w = Math.max(...lines.map((line) => width10(line, '600', 0.14))) * fs / 10, h = lines.length * fs * 1.18;
      cand.push({ id: `p${name}${lon}`, country: true, p, fs, lines, pri: -rank, ord: 2, ok: scale >= CITY_AT[rank] && !nearClue(lon, lat, name.toLowerCase()),
        boxes: slots.map((k) => { const dy = k * (h / 2 + step); return { dy, x0: p[0] - w / 2 - 4, x1: p[0] + w / 2 + 4, y0: p[1] + dy - h / 2 - 2, y1: p[1] + dy + h / 2 + 2 }; }) });
    }
    // mountain peaks: a small triangle and the name, as a city
    for (const [name, lon, lat, rank] of P.peaks ?? []) {
      if (scale < CITY_AT[rank] * 0.8) continue;
      const p = seen(lon, lat); if (!p) continue;
      const fs = 11, w = width10(name, '500', 0) * fs / 10, gap = 7;
      cand.push({ id: `k${name}${lon}`, country: false, peak: true, p, fs, name, cap: 0, gap, pri: -rank - 0.6, ord: 3, ok: scale >= CITY_AT[rank] && !nearClue(lon, lat, name.toLowerCase()),
        boxes: [{ x0: p[0] - 4, x1: p[0] + gap + w + 2, y0: p[1] - fs * 0.62, y1: p[1] + fs * 0.62 }, { x0: p[0] - gap - w - 2, x1: p[0] + 4, y0: p[1] - fs * 0.62, y1: p[1] + fs * 0.62 }] });
    }
    for (const [name, lon, lat, rank, cap] of P.cities) {
      if (scale < CITY_AT[rank] * 0.8) continue;
      const p = seen(lon, lat); if (!p) continue;
      const fs = rank === 1 ? 11.5 : 11, w = width10(name, '500', 0) * fs / 10, r = cap ? 4.4 : 2.2, gap = r + 4;
      cand.push({ id: `t${name}${lon}`, country: false, p, fs, name, cap, gap, pri: -rank - (cap ? 0 : 0.5), ord: cap ? 1 : 3, ok: scale >= CITY_AT[rank] && !nearClue(lon, lat, name.toLowerCase()),
        boxes: [{ x0: p[0] - r - 1, x1: p[0] + gap + w + 2, y0: p[1] - fs * 0.62, y1: p[1] + fs * 0.62 }, { x0: p[0] - gap - w - 2, x1: p[0] + r + 1, y0: p[1] - fs * 0.62, y1: p[1] + fs * 0.62 }] });
    }
    // countries with room to spare by size, then capitals, then the small countries (the one in the middle first) and places, then the other cities by
    // rank: the same view always prints the same names. A name keeps the place it found: a city its side, a country's
    // name its spot on its point, or a step or two under or over it where that would hide a capital
    cand.sort((a, b) => a.ord - b.ord || b.pri - a.pri);
    const placed = reserved.slice(), base = ctx.globalAlpha;
    let busy = false; namesPlaced = [];
    for (const c of cand) {
      const st = nameFade.get(c.id) ?? { a: 0, side: 0 };
      let on = false;
      if (c.ok) {
        const side = st.side < c.boxes.length ? st.side : 0, order = c.country ? [side, ...c.boxes.map((_, i) => i).filter((i) => i !== side)] : st.side === 1 ? [1, 0] : [0, 1];
        for (const i of order) if (inside(c.boxes[i]) && !overlaps(c.boxes[i], placed)) { placed.push(c.boxes[i]); st.side = i; on = true; namesPlaced.push(c.lines?.[0] && c.country ? c.lines.join(' ') : c.name); break; }
      }
      st.a = REDUCED ? +on : Math.max(0, Math.min(1, st.a + (on ? 0.11 : -0.11)));
      nameFade.set(c.id, st);
      if (st.a > 0 && st.a < 1) busy = true;
      if (st.a < 0.01) continue;
      ctx.save();
      ctx.globalAlpha = base * namesAlpha * st.a; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(233,220,192,.9)';
      if (c.country) {
        ctx.font = `600 ${c.fs}px ${serif}`; if ('letterSpacing' in ctx) ctx.letterSpacing = `${c.fs * 0.14}px`;
        ctx.textAlign = 'center';
        const dy = c.boxes[st.side]?.dy ?? 0;
        c.lines.forEach((line, i) => { const y = c.p[1] + dy + (i - (c.lines.length - 1) / 2) * c.fs * 1.18; ctx.strokeText(line, c.p[0], y); ctx.fillStyle = '#3d4857'; ctx.fillText(line, c.p[0], y); });
      } else {
        ctx.fillStyle = colour('--ink');
        ctx.beginPath();
        if (c.peak) { ctx.moveTo(c.p[0], c.p[1] - 3.2); ctx.lineTo(c.p[0] + 3.4, c.p[1] + 2.4); ctx.lineTo(c.p[0] - 3.4, c.p[1] + 2.4); ctx.closePath(); }
        else ctx.arc(c.p[0], c.p[1], c.cap ? 1.6 : 2.2, 0, 2 * Math.PI);
        ctx.fill();
        if (c.cap) { ctx.save(); ctx.beginPath(); ctx.arc(c.p[0], c.p[1], 3.9, 0, 2 * Math.PI); ctx.strokeStyle = colour('--ink'); ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
        ctx.font = `500 ${c.fs}px ${serif}`; if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
        const left = st.side === 1, x = c.p[0] + (left ? -c.gap : c.gap);
        ctx.textAlign = left ? 'right' : 'left';
        ctx.strokeText(c.name, x, c.p[1]); ctx.fillText(c.name, x, c.p[1]);
      }
      ctx.restore();
    }
    // names that left the view are forgotten
    if (nameFade.size > cand.length) { const live = new Set(cand.map((c) => c.id)); for (const id of nameFade.keys()) if (!live.has(id)) nameFade.delete(id); }
    namesBusy = busy;
  }

  function star(x, y, r, inner) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 ? inner : r, ang = -Math.PI / 2 + (i * Math.PI) / 5;
      ctx.lineTo(x + rad * Math.cos(ang), y + rad * Math.sin(ang));
    }
    ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(233,220,192,.92)'; ctx.stroke();
    ctx.fillStyle = colour('--accent'); ctx.fill();
  }

  const tick = (elapsed) => {
    if (flight) {
      const k = Math.min(1, (performance.now() - flight.start) / flight.duration);
      const e = (flight.ease ?? d3.easeCubicInOut)(k);
      rotation = flight.rot(e);
      zoom = flight.zoom(e);
      if (k >= 1) flight = null;
    } else if (idle) {
      rotation = [rotation[0] + (stage === 'hero' ? 0.05 : 0.08), rotation[1], 0];
    }
    if (label?.out) { label.alpha -= REDUCED ? 1 : 0.08; if (label.alpha <= 0) label = null; }
    else if (label && label.alpha < 1) label.alpha = REDUCED ? 1 : Math.min(1, label.alpha + (label.speed ?? 0.08));
    if (sceneAlpha < 1) sceneAlpha = Math.min(1, sceneAlpha + 0.05);
    const labelTarget = view.overview || !labelsWanted ? 0 : 1;
    if (labelFade !== labelTarget) labelFade = REDUCED ? labelTarget : Math.max(0, Math.min(1, labelFade + (labelTarget ? 0.04 : -0.06)));
    const namesTarget = names ? 1 : 0;
    if (namesAlpha !== namesTarget) namesAlpha = REDUCED ? namesTarget : Math.max(0, Math.min(1, namesAlpha + (namesTarget ? 0.05 : -0.1)));
    draw(elapsed);
  };
  const timer = d3.timer(tick);
  let held = false;

  resize();
  new ResizeObserver(resize).observe(canvas);

  return {
    /**
     * Fly to a camera { lat, lon, zoom }, marking the spot unless mark is false.
     * via: 'earth' pulls back to the whole earth halfway, then swoops in: one smooth
     * curve (the zoom dips along a sine), so there is no pause at the top.
     */
    flyTo(camera, duration = 1400, { mark = true, via = null, internal = false, ease = null } = {}) {
      idle = false; clearTimeout(idleTimer);
      if (REDUCED) duration = 1; // reduced motion: the camera cuts instead of flying
      if (!internal) { view = { camera, overview: false }; ring = null; }
      focus = mark ? { lat: camera.lat, lon: camera.lon } : null;
      const target = [-camera.lon, -camera.lat, camera.roll ?? 0];
      // Take the short way around in longitude
      const from = rotation.slice();
      while (target[0] - from[0] > 180) target[0] -= 360;
      while (target[0] - from[0] < -180) target[0] += 360;
      const z0 = zoom, z1 = Math.min(camera.zoom, 8);
      const dip = Math.max(0, (z0 + z1) / 2 - 1); // reaches zoom 1 (whole earth) at the midpoint
      let zoomAt = via === 'earth'
        ? (e) => z0 + (z1 - z0) * e - dip * Math.sin(Math.PI * e)
        : d3.interpolate(z0, z1);
      let rotAt = d3.interpolate(from, target);
      if (via === 'hop') {
        // One close-up to the next: van Wijk and Nuij's smooth zoom, so the camera pulls back a little
        // mid-way and both countries are briefly in view. A lens of zoom z shows about 2 / 1.55^(z-1) radians.
        const a = [-from[0], -from[1]], b = [camera.lon, camera.lat];
        const dist = d3.geoDistance(a, b), along = d3.geoInterpolate(a, b);
        const w = (z) => 2 / Math.pow(1.55, z - 1);
        const path = d3.interpolateZoom.rho(1.3)([0, 0, w(z0)], [dist, 0, w(z1)]);
        const zoomOf = (e) => 1 + Math.log(2 / path(e)[2]) / Math.log(1.55);
        // A lens can't show more than the whole earth: a path that would pull back further (far apart, or starting from
        // the whole earth, as the first question does) would shrink the earth inside the lens and grow it back. It
        // turns across the whole earth instead, as far out as it needs (never past zoom 1), and dives in at the end
        // The roll comes along on the same curve (the size step's desk globe hands over tilted on its axis)
        const rollAt = (e) => from[2] + (target[2] - from[2]) * e;
        let dips = false;
        for (let i = 1; i < 32 && !dips; i++) dips = zoomOf(i / 32) < 0.995;
        if (!dips) {
          rotAt = (e) => { const [ux] = path(e); const [lon, lat] = along(dist ? ux / dist : 1); return [-lon, -lat, rollAt(e)]; };
          zoomAt = zoomOf;
        } else {
          rotAt = (e) => { const [lon, lat] = along(e); return [-lon, -lat, rollAt(e)]; };
          zoomAt = (e) => 1 + (z0 - 1) * (1 - e) * (1 - e) + (z1 - 1) * e * e;
        }
      }
      flight = { start: performance.now(), duration: Math.max(1, duration), rot: rotAt, zoom: zoomAt, ease };
      markBusy(duration);
      if (!internal) emit(REDUCED ? 0 : duration);
    },
    /**
     * The desk globe's look (phones' size step): to 1 the lens becomes it, to 0 the lens again. look: borders and
     * light, arc: the rim closing into the meridian; each [to, delay, ms] (ms 0 = at once).
     */
    setDesk({ look = null, arc = null } = {}) {
      const now = performance.now();
      for (const [T, v] of [[deskTrack.look, look], [deskTrack.arc, arc]]) {
        if (!v) continue;
        const [to, delay = 0, ms = 0] = v;
        Object.assign(T, { from: trackAt(T, now), to, start: now + delay, ms: REDUCED ? 0 : ms });
        if (T.ms) markBusy(delay + ms);
      }
    },
    /** Back to a whole-earth view, spinning slowly. */
    reset() {
      deskTrack.look = { from: 0, to: 0, start: 0, ms: 0 }; deskTrack.arc = { from: 0, to: 0, start: 0, ms: 0 };
      focus = null; label = null; highlight = null; hlFade = null;
      view = { camera: null, overview: false }; ring = null; emit();
      flight = { start: performance.now(), duration: 1200, rot: d3.interpolate(rotation.slice(), [rotation[0], -20, 0]), zoom: d3.interpolate(zoom, 1) };
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (!focus) idle = true; }, 1200);
    },
    /** "Where are we?": pull back to the whole earth, leaving a ring where the close-up was. */
    whereAreWe() {
      const cam = view.camera;
      if (!cam || view.overview) return;
      const z = Math.min(cam.zoom, 8), duration = pullMs(z);
      ring = { lat: cam.lat, lon: cam.lon, radius: footprint(z), born: performance.now(), duration, phase: 'out' };
      this.flyTo({ lat: cam.lat, lon: cam.lon, zoom: 1 }, duration, { mark: false, internal: true });
      view = { camera: cam, overview: true }; emit();
    },
    /** Back into the clue's close-up; the ring grows into the lens rim. */
    zoomBack() {
      const cam = view.camera;
      if (!cam || !view.overview) return;
      const duration = pullMs(Math.min(cam.zoom, 8));
      ring = ring && { ...ring, born: performance.now(), duration, phase: 'in' };
      this.flyTo(cam, duration, { mark: false, internal: true });
      view = { camera: cam, overview: false }; emit();
    },
    /** Upright screens: where the hero globe's ring would start with no text in the way (its top − the ring's 12 px), and
     *  the gap it keeps under the text; null on other layouts. The landing places its buttons with it (setup.js). */
    heroRoom() { return heroUpright() ? { ring: heroHorizon() - 12, gap: heroGap() } : null; },
    /** 'hero' (landing page; the globe rises into view) or 'panel'. */
    /** ms / ease: a different glide from the hero into the panel (phones opening straight into typing). */
    setStage(name, { ms = MORPH_MS, ease = null } = {}) {
      if (name === stage) return;
      // Leaving the hero: remember where the globe is now, and move it from there into its column
      // The lens starts as a circle just inside the hero's ring (the hero isn't clipped: this frame looks the same) and
      // closes in from there, on the same curve as the move, so the ring never floats inside the earth
      const hero = heroFrame();
      morph = stage === 'hero' && name === 'panel' && MORPH_MS ? { start: performance.now(), duration: REDUCED ? MORPH_MS : ms, ease, from: { ...hero, clipR: hero.ringR - 4 } } : null;
      if (morph) markBusy(morph.duration);
      stage = name;
      if (name === 'hero') {
        introStart = performance.now();
        rotation = [rotation[0], -12, 0]; zoom = 1; focus = null; label = null; highlight = null; hlFade = null; idle = true; flight = null; clearTimeout(idleTimer);
      }
    },
    /** Draw a historical scene (scenes.js) instead of today's borders; null goes back to today. */
    setScene(next) {
      if (next !== scene) { prevScene = scene; sceneAlpha = REDUCED ? 1 : 0; }
      scene = next;
      if (next) { focus = null; label = null; highlight = null; hlFade = null; }
    },
    /** Print a name on the globe at { lat, lon } (speed: how fast it fades in, per frame), or clear it with null. */
    setLabel(next, { fade = false } = {}) {
      if (!next) { if (label && fade && !REDUCED) label.out = true; else label = null; return; }
      const same = label && label.text === next.text;
      label = { ...next, alpha: same ? label.alpha : 0 };
    },
    /**
     * The finer coastline for the setup close-ups, prepared at build time (tools/detail.mjs): land polygons
     * and border lines, each with its bounding circle, and the probe countries for the brass highlight.
     */
    setDetail(fine) {
      const unpack = (items) => items.map(([lon, lat, r, coordinates]) => ({ at: [lon, lat], r: (r * Math.PI) / 180, coordinates }));
      detail = {
        land: unpack(fine.land), borders: unpack(fine.borders),
        byId: new Map(Object.entries(fine.countries).map(([id, g]) => [id, { type: 'Feature', id, geometry: g }])),
      };
      still.key = null;
    },
    /** fade: hand the brass over in that many ms (after delay), the old country fading as the new one comes in. */
    highlightCountry(id, { fade = 0, delay = 0 } = {}) {
      const next = id ? countries.find((c) => String(c.id) === String(id)) ?? null : null;
      if (next === highlight) return;
      hlFade = fade && !REDUCED ? { prev: highlight, start: performance.now() + delay, ms: fade } : null;
      highlight = next;
    },
    /**
     * The lens glides from `box` (a DOMRect-like box, where it was drawn) to its column over ms, wherever
     * the column is meanwhile. Used when the page is rebuilt under the lens (the size step, "Not Dutch?").
     */
    lensFrom(box, { ms = 800, ease = d3.easeCubicInOut } = {}) {
      glide = REDUCED || !box ? null : { box: { left: box.left, top: box.top, width: box.width, height: box.height }, start: performance.now(), ms, ease };
      if (glide) markBusy(ms);
    },
    /** Scene labels on or off (they fade): off while the lens is a medallion too small to print them. */
    setLabelsShown(on) { labelsWanted = !!on; },
    /** The column's box as the layout placed it (viewport pixels), or null to read it from the page again. */
    setLensBox(box) { givenBox = box; },
    /** Put the camera somewhere at once (rotation [lambda, phi, gamma], zoom), e.g. where another drawing of the earth left off. */
    jumpTo(rot, z = zoom) { flight = null; idle = false; clearTimeout(idleTimer); rotation = rot.slice(); zoom = z; },
    // --- The game: a globe to study -------------------------------------------------------------------------
    /** Print the countries and cities of a year over the map ({ countries, cities }: game-logic placesAt), or null for none. */
    setNames(next) { if (next && next !== namesShown) { namesShown = next; namesSeq++; nameFade.clear(); } names = next; },
    /** The camera now: { lon, lat, zoom }. */
    camera() { return { lon: -rotation[0], lat: -rotation[1], zoom }; },
    /** Put the camera somewhere at once, north up: a finger turning or pinching the globe. */
    lookAt({ lon, lat, zoom: z = zoom }) { flight = null; idle = false; clearTimeout(idleTimer); rotation = [-lon, -lat, 0]; zoom = z; },
    /** The place [lon, lat] under a point of the window, or null off the earth. */
    geoAt(x, y) {
      if (stage !== 'panel') return null;
      const F = panelFrame(zoom);
      if (Math.hypot(x - F.cx, y - F.cy) > F.r * 0.97) return null;
      const g = d3.geoOrthographic().scale(F.r).translate([F.cx, F.cy]).rotate(rotation).invert([x, y]);
      return g && Number.isFinite(g[0]) && Number.isFinite(g[1]) ? g : null;
    },
    /** The earth's radius on screen now (px), and the lens's. */
    lens() { const F = panelFrame(zoom); return { cx: F.cx, cy: F.cy, r: F.clipR, earth: F.r }; },
    /** The slow turn of a globe nobody is touching. */
    setIdle(on) { clearTimeout(idleTimer); idle = !!on; if (on) flight = null; },
    /** Stop drawing while something covers the globe (the share modal), so a slow phone spends nothing on it; and go on. */
    hold(on) { if (!!on === held) return; held = !!on; if (held) timer.stop(); else timer.restart(tick); },
    isFlying() { return !!flight; },
    /** The names printed this frame (tests), and the set given (setNames). */
    namesNow() { return { placed: namesPlaced.slice(), given: namesShown }; },
    stop() { timer.stop(); },
  };
}
