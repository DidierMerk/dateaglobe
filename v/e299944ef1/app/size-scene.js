// The map-size picker's illustration: a globe, wall map or atlas drawn to scale
// next to a coffee mug. The "camera" zooms out as the object grows, so the mug
// shrinks and the size difference is felt rather than read.
//
// Two modes. The laptop (fit: false) draws as it always has. Phones and upright tablets (fit: true) have
// a portrait picture, so there:
//   - every object fits the width as well as the height, and the mug's caption stays inside the edge;
//   - the wall map hangs on the wall above the desk, the mug below it, and the atlas stands closed on the
//     desk, as on a shelf: both are about as tall as wide, like the picture;
//   - arriving from the language step (intro), the setup lens is this globe's sphere until reveal(): the
//     scene draws only the ground, the stand and the mug gathering around it, then takes the sphere over;
//   - Back (fold) hands the sphere back to the lens and folds the desk away;
//   - the globe eases into its turn, and switching kind fades the old object out before the new one comes in.

import { CURVE } from './lang-layout.js';

const d3 = window.d3;
const topojson = window.topojson;

const MUG_CM = { h: 9.5, w: 8 };
const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** How tall each object stands, in cm, for a given slider value. */
const OBJECT_HEIGHT = {
  globe: (d) => d * 1.36,   // sphere + meridian ring + stand
  wall: (w) => w * 0.7,     // map sheet + rollers
  atlas: (h) => h,          // page height
};
// Phones: the hanging wall map (mug, a gap, the sheet, its rollers and cord) and the standing atlas
const FIT_HEIGHT = { globe: OBJECT_HEIGHT.globe, wall: (w) => 12.5 + 0.75 * w, atlas: (h) => h * 1.02 };
// Phones: the width each needs, mug included where it stands beside the object (cm; the gap is added in pixels)
const FIT_WIDTH = { globe: (d) => d * 1.1 + MUG_CM.w * 1.3, wall: (w) => w * 1.1, atlas: (h) => h * 0.75 + MUG_CM.w * 1.3 };

// The land shape is the same for every scene: build it once per map
const landOf = new WeakMap();
const band = (t, a, b) => Math.min(1, Math.max(0, (t - a) / (b - a)));

/**
 * holdMs: keep the globe still that long before it starts turning.
 * fit: the phone picture (see the top of this file).
 * intro: arriving from the language step on a phone, { at } = the tap's time (performance.now()); the sphere
 *   is left to the lens until reveal(), and the desk gathers on these times from the tap.
 */
export function createSizeScene(canvas, world, { holdMs = 0, fit = false, intro = null } = {}) {
  const screen = canvas.getContext('2d');
  let ctx = screen; // the context being drawn: the screen, or the layer an object fades on (phones)
  let layer = null;
  if (!landOf.has(world)) landOf.set(world, topojson.feature(world, world.objects.land));
  const land = landOf.get(world);
  const graticule = d3.geoGraticule10();
  // The phone sphere is projected exactly as the globe's lens (globe.js), so the two can hand over unseen
  const ortho = d3.geoOrthographic().clipAngle(90).precision(fit ? 0.4 : 0.5);
  const flat = d3.geoEquirectangular();
  const atlasLeft = d3.geoOrthographic().rotate([75, -10]).clipAngle(90);
  const atlasRight = d3.geoOrthographic().rotate([-20, -20]).clipAngle(90);
  const cover = d3.geoOrthographic().rotate([-15, -20, -23.4]).clipAngle(90);
  const css = getComputedStyle(document.documentElement);
  const colours = new Map();
  const colour = (name) => { if (!colours.has(name)) colours.set(name, css.getPropertyValue(name).trim()); return colours.get(name); };

  let width = 0, height = 0;
  let kind = 'globe', value = 32;
  let k = null;                 // pixels per cm, derived from the eased size
  let shown = { kind, value };  // the value as drawn, eased towards `value`
  let spin = 0;
  // The hand-over with the lens: the sphere is hidden while the lens is it; parts gather (intro) or fold (Back)
  let sphereHidden = !!intro;
  let gatherAt = intro ? intro.at : null;
  let foldAt = null;
  let spinFrom = null;          // phones: when the turn started (it eases up to speed)

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    width = rect.width; height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    screen.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  /** Phones: an object fading in or out is drawn whole on a layer, then laid down at its opacity (no shape shows through another). */
  function drawFaded(alpha, draw) {
    if (!layer) layer = document.createElement('canvas').getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    if (layer.canvas.width !== canvas.width || layer.canvas.height !== canvas.height) { layer.canvas.width = canvas.width; layer.canvas.height = canvas.height; }
    layer.setTransform(1, 0, 0, 1, 0, 0); layer.clearRect(0, 0, layer.canvas.width, layer.canvas.height);
    layer.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx = layer; draw(); ctx = screen;
    screen.save(); screen.setTransform(1, 0, 0, 1, 0, 0); screen.globalAlpha = alpha; screen.drawImage(layer.canvas, 0, 0); screen.restore();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  // The ground line; below it only the soft shadow strip (10 px). The laptop keeps the room the old caption had
  const ground = () => height - (fit ? 12 : 26);

  /** The ground line; g < 1 draws it out from x (the object's foot). */
  function drawGround(g = 1, x = width / 2) {
    if (g < 0.01) return;
    const y = ground();
    ctx.save();
    if (g < 1) { ctx.beginPath(); ctx.rect(x - width * g, y - 2, width * 2 * g, 16); ctx.clip(); }
    const gr = ctx.createLinearGradient(0, 0, width, 0);
    gr.addColorStop(0, 'rgba(156,138,102,0)');
    gr.addColorStop(0.5, 'rgba(156,138,102,.7)');
    gr.addColorStop(1, 'rgba(156,138,102,0)');
    ctx.strokeStyle = gr; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(width, y + 0.5); ctx.stroke();
    // soft shadow strip
    ctx.fillStyle = 'rgba(31,42,55,.05)';
    ctx.fillRect(0, y + 1, width, 10);
    ctx.restore();
  }

  function shadow(cx, w) {
    const y = ground() + 1;
    const g = ctx.createRadialGradient(cx, y, 0, cx, y, w / 2);
    g.addColorStop(0, 'rgba(31,42,55,.28)');
    g.addColorStop(1, 'rgba(31,42,55,0)');
    ctx.save(); ctx.translate(cx, y); ctx.scale(1, 0.14); ctx.translate(-cx, -y);
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, y, w / 2, 0, 2 * Math.PI); ctx.fill();
    ctx.restore();
  }

  function drawMug(x) {
    const h = MUG_CM.h * k, w = MUG_CM.w * k, y = ground();
    shadow(x + w / 2, w * 1.5);
    ctx.save();
    ctx.lineWidth = Math.max(1, k * 0.35);
    ctx.strokeStyle = colour('--ink'); ctx.fillStyle = '#fffaf0';
    // handle
    ctx.beginPath(); ctx.ellipse(x + w, y - h * 0.52, w * 0.26, h * 0.22, 0, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    // body
    ctx.beginPath();
    ctx.moveTo(x, y - h); ctx.lineTo(x + w, y - h);
    ctx.lineTo(x + w * 0.96, y - h * 0.06); ctx.quadraticCurveTo(x + w * 0.95, y, x + w * 0.86, y);
    ctx.lineTo(x + w * 0.14, y); ctx.quadraticCurveTo(x + w * 0.05, y, x + w * 0.04, y - h * 0.06);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    // a brass band, and steam when the mug is big enough to notice
    const a = ctx.globalAlpha;
    ctx.fillStyle = colour('--brass'); ctx.globalAlpha = a * 0.6;
    ctx.fillRect(x + w * 0.02, y - h * 0.72, w * 0.96, Math.max(1, h * 0.08));
    ctx.globalAlpha = a;
    if (h > 40) {
      ctx.strokeStyle = 'rgba(74,85,101,.35)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        const sx = x + w * (0.35 + i * 0.3), t = spin * 2 + i;
        ctx.beginPath();
        for (let s = 0; s <= 1; s += 0.1) {
          const px = sx + Math.sin(t + s * 6) * w * 0.06, py = y - h - 6 - s * h * 0.45;
          s === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /** The globe. stand: 0..1 grows the base and stem up from the ground; sphere: false leaves the sphere to the lens. */
  function drawGlobe(cx, d, { stand = 1, sphere = true } = {}) {
    const r = (d * k) / 2, y = ground();
    const baseW = r * 1.25, baseH = Math.max(3, r * 0.1);
    const stemH = r * 0.32;
    const cy = y - baseH - stemH - r * 1.08;
    if (stand > 0.01) {
      ctx.save();
      if (stand < 1) ctx.globalAlpha *= Math.min(1, stand * 1.6);
      shadow(cx, baseW * 1.6 * (stand < 1 ? 0.6 + 0.4 * stand : 1));
      // base and stem
      ctx.fillStyle = '#3a2f22';
      ctx.beginPath(); ctx.ellipse(cx, y - baseH / 2, (baseW / 2) * (stand < 1 ? 0.7 + 0.3 * stand : 1), baseH / 2 + 1, 0, 0, 2 * Math.PI); ctx.fill();
      ctx.fillStyle = colour('--brass');
      const h = stemH * stand;
      ctx.fillRect(cx - Math.max(1.5, r * 0.04), y - baseH - h, Math.max(3, r * 0.08), h + 1);
      ctx.restore();
    }
    if (!sphere) return { left: cx - r * 1.1, right: cx + r * 1.1 };
    // sphere (on phones drawn exactly as globe.js draws the lens in its desk look)
    ortho.scale(r).translate([cx, cy]).rotate(rotation());
    const path = d3.geoPath(ortho, ctx);
    const g = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.1, cx, cy, r);
    g.addColorStop(0, colour('--ocean-2')); g.addColorStop(1, colour('--ocean'));
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = g; ctx.fill();
    if (fit || r > 30) { ctx.beginPath(); path(graticule); ctx.strokeStyle = 'rgba(244,236,220,.12)'; ctx.lineWidth = 0.6; ctx.stroke(); }
    ctx.beginPath(); path(land); ctx.fillStyle = colour('--land'); ctx.fill();
    // highlight
    const hl = ctx.createRadialGradient(cx - r * 0.4, cy - r * 0.45, 0, cx - r * 0.4, cy - r * 0.45, r * 0.9);
    hl.addColorStop(0, 'rgba(255,255,255,.22)'); hl.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = hl; ctx.fill();
    // meridian half-ring, tilted with the axis
    ctx.save(); ctx.translate(cx, cy); ctx.rotate((23.4 * Math.PI) / 180);
    ctx.strokeStyle = colour('--brass'); ctx.lineWidth = Math.max(1.5, r * 0.06);
    ctx.beginPath(); ctx.arc(0, 0, r * 1.08, -Math.PI * 0.62, Math.PI * 0.62, true); ctx.stroke();
    ctx.restore();
    return { left: cx - r * 1.1, right: cx + r * 1.1 };
  }

  function drawWallMap(cx, wCm) {
    const w = wCm * k, h = w * 0.62, y = ground();
    const roller = Math.max(3, w * 0.025);
    const top = y - h - roller * 2;
    shadow(cx, w * 1.05);
    sheet(cx, w, h, top, roller);
    return { left: cx - w / 2 - roller * 2, right: cx + w / 2 + roller * 2 };
  }

  /** The map sheet between its two rollers, the top roller at `top`. */
  function sheet(cx, w, h, top, roller) {
    ctx.fillStyle = '#efe4cc';
    ctx.fillRect(cx - w / 2, top + roller, w, h);
    flat.fitExtent([[cx - w / 2 + w * 0.04, top + roller + h * 0.06], [cx + w / 2 - w * 0.04, top + roller + h * 0.94]], { type: 'Sphere' });
    const path = d3.geoPath(flat, ctx);
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = colour('--ocean-2'); ctx.fill();
    ctx.beginPath(); path(graticule); ctx.strokeStyle = 'rgba(244,236,220,.14)'; ctx.lineWidth = 0.5; ctx.stroke();
    ctx.beginPath(); path(land); ctx.fillStyle = colour('--land'); ctx.fill();
    ctx.strokeStyle = colour('--border'); ctx.lineWidth = 1; ctx.strokeRect(cx - w / 2, top + roller, w, h);
    // rollers with brass caps
    for (const ry of [top, top + roller + h]) {
      ctx.fillStyle = '#5a4630'; ctx.fillRect(cx - w / 2 - roller, ry, w + roller * 2, roller);
      ctx.fillStyle = colour('--brass');
      ctx.fillRect(cx - w / 2 - roller * 1.8, ry - roller * 0.15, roller * 0.9, roller * 1.3);
      ctx.fillRect(cx + w / 2 + roller * 0.9, ry - roller * 0.15, roller * 0.9, roller * 1.3);
    }
  }

  /** Phones: the wall map hangs from a nail on the wall, above the desk where the mug stands. */
  function drawWallHung(cx, wCm) {
    const w = wCm * k, h = w * 0.62, roller = Math.max(3, w * 0.025);
    const bottom = ground() - MUG_CM.h * k - Math.max(10, 3 * k);
    const top = bottom - h - roller * 2, cord = Math.max(14, w * 0.08);
    ctx.strokeStyle = '#5a4630'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx - w * 0.36, top + roller * 0.5); ctx.lineTo(cx, top - cord); ctx.lineTo(cx + w * 0.36, top + roller * 0.5); ctx.stroke();
    ctx.fillStyle = colour('--brass'); ctx.beginPath(); ctx.arc(cx, top - cord, 2.5, 0, 2 * Math.PI); ctx.fill();
    ctx.fillStyle = 'rgba(31,42,55,.06)'; ctx.fillRect(cx - w / 2, bottom + 1, w, 5); // its shadow on the wall
    sheet(cx, w, h, top, roller);
    return { left: cx - w / 2 - roller * 2, right: cx + w / 2 + roller * 2 };
  }

  function drawAtlas(cx, hCm) {
    const h = hCm * k, pw = h * 0.72, y = ground();
    const lift = h * 0.06;
    shadow(cx, pw * 2.3);
    // cover peeking out
    ctx.fillStyle = '#4a2f24';
    ctx.beginPath();
    ctx.moveTo(cx - pw - 4, y - h - 2); ctx.lineTo(cx + pw + 4, y - h - 2); ctx.lineTo(cx + pw + 4, y); ctx.lineTo(cx - pw - 4, y); ctx.closePath(); ctx.fill();
    for (const side of [-1, 1]) {
      const x0 = cx, x1 = cx + side * pw;
      ctx.fillStyle = '#fbf5e6';
      ctx.beginPath();
      ctx.moveTo(x0, y - h + lift); ctx.quadraticCurveTo((x0 + x1) / 2, y - h - lift * 0.4, x1, y - h);
      ctx.lineTo(x1, y - 2); ctx.quadraticCurveTo((x0 + x1) / 2, y - 2 - lift * 1.2, x0, y - 2 + 0);
      ctx.closePath(); ctx.fill();
      const proj = side < 0 ? atlasLeft : atlasRight;
      const mx = (x0 + x1) / 2, my = y - h / 2;
      proj.scale(Math.min(pw, h) * 0.36).translate([mx, my]);
      const path = d3.geoPath(proj, ctx);
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.fillStyle = colour('--ocean-2'); ctx.fill();
      ctx.beginPath(); path(land); ctx.fillStyle = colour('--land'); ctx.fill();
      ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = colour('--border'); ctx.lineWidth = 0.8; ctx.stroke();
    }
    // spine shadow
    const sg = ctx.createLinearGradient(cx - pw * 0.12, 0, cx + pw * 0.12, 0);
    sg.addColorStop(0, 'rgba(31,42,55,0)'); sg.addColorStop(0.5, 'rgba(31,42,55,.25)'); sg.addColorStop(1, 'rgba(31,42,55,0)');
    ctx.fillStyle = sg; ctx.fillRect(cx - pw * 0.12, y - h, pw * 0.24, h);
    return { left: cx - pw - 4, right: cx + pw + 4 };
  }

  /** Phones: the atlas stands closed on the desk, as on a shelf, its height the page height. A gilt globe on the cover. */
  function drawAtlasStanding(cx, hCm) {
    const h = hCm * k, w = h * 0.72, x = cx - w / 2, y = ground(), top = y - h, r = Math.max(1.5, w * 0.02);
    shadow(cx, w * 1.5);
    ctx.fillStyle = '#4a2f24'; ctx.beginPath(); ctx.roundRect(x, top, w, h, [r * 0.5, r, r, r * 0.5]); ctx.fill();
    // the spine's hinge
    const sw = w * 0.09;
    ctx.fillStyle = '#3a2419'; ctx.fillRect(x, top, sw, h);
    ctx.strokeStyle = 'rgba(176,138,62,.45)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x + sw + 0.5, top); ctx.lineTo(x + sw + 0.5, y); ctx.stroke();
    // gilt frame, title and globe
    const gold = colour('--brass'), fx = x + sw + w * 0.07, fw = w - sw - w * 0.14, fy = top + h * 0.06, fh = h * 0.88, lw = Math.max(0.8, w * 0.01);
    ctx.strokeStyle = gold; ctx.lineWidth = lw; ctx.strokeRect(fx, fy, fw, fh);
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.6; ctx.strokeRect(fx + lw * 3, fy + lw * 3, fw - lw * 6, fh - lw * 6); ctx.globalAlpha = a;
    const mx = fx + fw / 2, size = Math.max(7, w * 0.11);
    ctx.save();
    ctx.fillStyle = gold; ctx.font = `600 ${size}px ${colour('--serif')}`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${(size * 0.28).toFixed(1)}px`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('ATLAS', mx + size * 0.14, top + h * 0.2);
    ctx.restore();
    cover.scale(fw * 0.34).translate([mx, top + h * 0.53]);
    const path = d3.geoPath(cover, ctx);
    ctx.beginPath(); path(graticule); ctx.strokeStyle = 'rgba(176,138,62,.35)'; ctx.lineWidth = 0.6; ctx.stroke();
    ctx.beginPath(); path(land); ctx.fillStyle = 'rgba(176,138,62,.85)'; ctx.fill();
    ctx.beginPath(); path({ type: 'Sphere' }); ctx.strokeStyle = gold; ctx.lineWidth = lw; ctx.stroke();
    ctx.fillStyle = gold; ctx.fillRect(mx - fw * 0.18, top + h * 0.82, fw * 0.36, lw);
    return { left: x, right: x + w };
  }

  // Footprint of each object in cm, for centring it next to the mug
  const objectWidth = (kd, v) => (kd === 'globe' ? v * 1.1 : kd === 'wall' ? v * 1.05 : fit ? v * 0.75 : v * 1.5);
  const drawObject = (kd, cx, v, opts) => (kd === 'globe' ? drawGlobe(cx, v, opts)
    : kd === 'wall' ? (fit ? drawWallHung(cx, v) : drawWallMap(cx, v))
    : fit ? drawAtlasStanding(cx, v) : drawAtlas(cx, v));
  /** Pixels per cm. The laptop scales to the height; phones to the width too (44 px of headroom instead of 64). */
  function kFor(kd, v) {
    if (!fit) return Math.max(1.1, Math.min(14, (height - 64) / OBJECT_HEIGHT[kd](v)));
    const kH = (height - 30) / FIT_HEIGHT[kd](v);
    let kk = Math.min(14, kH);
    for (let i = 0; i < 4; i++) {
      const gap = kd === 'wall' ? 0 : Math.max(18, Math.min(40, kk * 4));
      kk = Math.min(14, kH, (width - 8 - gap) / FIT_WIDTH[kd](v));
    }
    return Math.max(0.5, kk);
  }
  /** Centre of the object and left edge of the mug, so the pair sits centred in the scene. */
  function layout(kd, v, kk = k) {
    if (fit && kd === 'wall') return { cx: width / 2, mugX: width / 2 + (v * kk) / 2 - MUG_CM.w * kk * 1.7 }; // the mug on the desk under the map
    const objW = objectWidth(kd, v) * kk, mugW = MUG_CM.w * kk;
    const gap = Math.max(18, Math.min(40, kk * 4));
    const cx = width / 2 - (objW + gap + mugW * 1.3) / 2 + objW / 2;
    return { cx, mugX: cx + objW / 2 + gap };
  }

  /** The globe's rotation as drawn now (d3 rotate: lambda, phi, gamma). */
  function rotation() { return [spin * 30, -20, -23.4]; }
  /** Seconds of turn: the laptop starts at full speed after the hold; phones ease up to it over 0.6 s. */
  function turn(elapsed, now) {
    if (sphereHidden) return 0;
    if (!fit) return Math.max(0, elapsed - holdMs) / 1000;
    if (REDUCED) return 0;
    spinFrom ??= intro ? now : performance.now() - elapsed + holdMs;
    const s = Math.max(0, now - spinFrom) / 1000;
    return s < 0.6 ? (s * s) / 1.2 : s - 0.3;
  }

  let last = null;
  let fade = null; // switching kind: { from: {kind, value}, kFrom, t }
  const timer = d3.timer((elapsed) => {
    const now = performance.now();
    spin = turn(elapsed, now);
    const dt = last == null ? 0 : Math.min(0.05, (elapsed - last) / 1000);
    last = elapsed;

    // Switching globe / wall map / atlas: cross-fade the two objects while the zoom glides over
    if (shown.kind !== kind) {
      fade = { from: { ...shown }, kFrom: k ?? kFor(kind, value), t: 0, start: now };
      shown = { kind, value };
    }
    // Time-based easing, so the size follows the slider at the same pace on any screen
    shown.value += (value - shown.value) * (1 - Math.exp(-dt / 0.085));
    const kTarget = kFor(shown.kind, shown.value);
    let e = 1, outA = 0, inA = 1;
    if (fade && fit) {
      // Phones: the old object leaves quickly and the new one comes a moment later, so they are never both
      // half there; the zoom glides on the keyboard's curve, in proportion (a log scale)
      const t = REDUCED ? 1e9 : now - fade.start;
      e = CURVE(Math.min(1, t / 420));
      k = Math.exp(Math.log(fade.kFrom) + (Math.log(kTarget) - Math.log(fade.kFrom)) * e);
      outA = 1 - band(t, 0, 160); inA = band(t, 110, 380);
      if (t >= 420) fade = null;
    } else if (fade) {
      fade.t = Math.min(1, fade.t + dt / 0.5);
      e = d3.easeCubicInOut(fade.t);
      k = fade.kFrom + (kTarget - fade.kFrom) * e;
      outA = 1 - e; inA = e;
      if (fade.t >= 1) fade = null;
    } else {
      k = kTarget; // zoom follows the eased size directly: no second, out-of-step easing
    }

    // The desk gathering around the lens (intro), or folding away as the lens takes the sphere back (fold)
    let groundA = 1, standA = 1, mugA = 1, mugDx = 0;
    if (gatherAt != null) {
      const t = now - gatherAt;
      groundA = CURVE(band(t, 400, 750)); standA = CURVE(band(t, 450, 800));
      const m = band(t, 520, 860); mugA = m; mugDx = 16 * (1 - CURVE(m));
      if (t >= 860) gatherAt = null;
    }
    if (foldAt != null) {
      const t = now - foldAt;
      mugA = 1 - band(t, 0, 200); mugDx = 12 * band(t, 0, 200);
      standA = 1 - CURVE(band(t, 0, 350)); groundA = 1 - CURVE(band(t, 0, 400));
    }

    ctx.clearRect(0, 0, width, height);
    const now_ = layout(shown.kind, shown.value);
    drawGround(groundA, now_.cx);
    const opts = { stand: standA, sphere: !sphereHidden };
    if (fade) {
      const before = layout(fade.from.kind, fade.from.value);
      if (fit) {
        if (outA > 0.005) drawFaded(outA, () => drawObject(fade.from.kind, before.cx, fade.from.value, opts));
        if (inA > 0.005) drawFaded(inA, () => drawObject(shown.kind, now_.cx, shown.value, opts));
      } else {
        if (outA > 0.005) { ctx.globalAlpha = outA; drawObject(fade.from.kind, before.cx, fade.from.value, opts); }
        if (inA > 0.005) { ctx.globalAlpha = inA; drawObject(shown.kind, now_.cx, shown.value, opts); }
      }
      ctx.globalAlpha = 1;
      if (fit) {
        // The mug walks from where it stood in the old picture to where it stands in the new one, inside the edge
        const a = layout(fade.from.kind, fade.from.value, fade.kFrom).mugX, b = layout(shown.kind, shown.value, kTarget).mugX;
        drawMug(Math.max(4, Math.min(a + (b - a) * e, width - 4 - MUG_CM.w * k * 1.26)));
      } else drawMug(before.mugX + (now_.mugX - before.mugX) * e);
    } else {
      drawObject(shown.kind, now_.cx, shown.value, opts);
      if (mugA > 0.005) { ctx.globalAlpha = mugA; drawMug(now_.mugX + mugDx); ctx.globalAlpha = 1; }
    }
  });

  return {
    set(nextKind, nextValue) {
      kind = nextKind; value = nextValue;
      if (k === null) shown = { kind, value }; // the first size is drawn as it is, not eased in from the default
    },
    /** Where the globe's sphere is drawn, in canvas pixels ({ cx, cy, r }), or null for a wall map or atlas. */
    globeAt() {
      // Measured now, not when the ResizeObserver next reports: the step's text may have just changed the room
      const rect = canvas.getBoundingClientRect();
      if (rect.width !== width || rect.height !== height) resize();
      if (kind !== 'globe' || !height) return null;
      const kk = kFor('globe', value);
      const { cx } = layout('globe', value, kk);
      const r = (value * kk) / 2;
      return { cx, cy: ground() - Math.max(3, r * 0.1) - r * 0.32 - r * 1.08, r };
    },
    /** The globe's rotation as drawn now (d3 rotate: lambda, phi, gamma). */
    rotation,
    /** The lens has landed on the sphere: draw it from now on (the same pixels), and start turning. */
    reveal() { sphereHidden = false; spinFrom = null; },
    /** Back: the lens takes the sphere back from this frame on, and the desk folds away around it. */
    fold() { sphereHidden = true; gatherAt = null; foldAt = performance.now(); },
    destroy() { timer.stop(); ro.disconnect(); },
  };
}
