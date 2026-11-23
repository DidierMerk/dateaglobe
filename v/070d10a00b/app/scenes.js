// Scenes: what the globe draws for one answer option ("does your map look like this?").
// A scene is the world's borders on the option's date (CShapes), the clue's countries
// highlighted (merged into one shape where the state treats them as one), optional
// overlays (canal zone, lake outlines, hatching, dashed former borders) and labels in
// the map's language.

const d3 = window.d3;
const topojson = window.topojson;

const toYear = (iso) => {
  const [y, m = 1, d = 1] = String(iso).split('-').map(Number);
  return y + (m - 1) / 12 + (d - 1) / 365.25;
};

export function createScenes(topo) {
  const geoms = topo.objects.states.geometries;
  const worlds = new Map(); // date -> { active, features }

  /** All border versions valid on a date, as GeoJSON features (cached). */
  function world(date) {
    const key = Math.round(date * 100) / 100;
    if (!worlds.has(key)) {
      const active = geoms.filter((g) => g.properties.a <= date && date <= g.properties.b);
      const features = topojson.feature(topo, { type: 'GeometryCollection', geometries: active }).features;
      worlds.set(key, { active, features });
    }
    return worlds.get(key);
  }

  const byCodes = (date, codes) => world(date).features.filter((f) => codes.includes(f.properties.g));

  /**
   * The frontiers on a date (tools/geometry.mjs computeFrontiers): a territory's edges that face land no territory
   * covers then, drawn dashed as period maps drew an undefined frontier (Abyssinia beside the Mahdi's Sudan). Null: none.
   */
  const frontierCache = new Map();
  function frontierAt(date) {
    const row = (topo.frontiers ?? []).find(([a, b]) => a <= date && date < b);
    if (!row) return null;
    if (!frontierCache.has(row)) frontierCache.set(row, topojson.feature(topo, { type: 'MultiLineString', arcs: row[2].map((i) => [i]) }).geometry);
    return frontierCache.get(row);
  }

  /** The world's borders on a date: for the result screen ("your globe's world"). */
  function worldAt(date) {
    const { active } = world(date);
    return {
      date,
      borders: topojson.mesh(topo, { type: 'GeometryCollection', geometries: active }, (a, b) => a !== b),
      frontier: frontierAt(date),
      highlight: [], outlines: [], hatch: [], dashed: [], overlays: [], labels: [],
    };
  }

  /**
   * @param feature  compiled feature
   * @param option   one answer option (engine optionsFor)
   * @param language map-label language ('xx' = unknown: English)
   * @param at       the game: draw the clue into the world of this date (decimal year) where its countries exist then,
   *                 instead of the date the picture was researched for, and leave out borders of other times
   */
  function sceneFor(feature, option, language, { at = null } = {}) {
    const member = option.members[0];
    const state = feature.states[member.state];
    const depiction = member.depiction == null ? null : state.depictions[member.depiction];
    const visual = depiction?.visual ?? state.visual ?? {}; // a depiction may bring its own picture
    const ref = visual.ref ?? {};
    let date = ref.date ? toYear(ref.date) : midpoint(state);
    if (at != null) {
      const codes = ref.merge ?? ref.gwcodes ?? (ref.gwcode != null ? [ref.gwcode] : []);
      const there = world(at).active;
      if (codes.every((c) => there.some((g) => g.properties.g === c))) date = at;
    }
    const { active, features } = world(date);

    // What to highlight: merged into one shape, separate countries, or whatever lies under the camera
    const merge = new Set(ref.merge ?? []);
    let highlight = [], outlines = [];
    if (merge.size) {
      const shape = topojson.merge(topo, active.filter((g) => merge.has(g.properties.g)));
      highlight = [{ type: 'Feature', properties: {}, geometry: shape }];
    } else if (ref.gwcodes || ref.gwcode != null) {
      highlight = byCodes(date, ref.gwcodes ?? [ref.gwcode]);
    } else if (['outline', 'fill', 'colour_match'].includes(visual.highlight) && !ref.overlays) {
      const at = [feature.camera.lon, feature.camera.lat];
      const w = world(date);
      highlight = features.filter((f, i) => mayContain(w, i, at) && d3.geoContains(f, at));
    }
    if (highlight.length > 1) outlines = highlight; // e.g. the border between the two Germanys

    // The quiz shows a merged group as one owner's colour, so the lines inside it go. The game keeps them: its globe has no
    // owner colours and draws those lines on its plain look, so a hint must not hide them (Uganda–Kenya in 1962, the Koreas)
    const borders = topojson.mesh(topo, { type: 'GeometryCollection', geometries: active },
      (a, b) => a !== b && (at != null || !(merge.has(a.properties.g) && merge.has(b.properties.g))));

    const hatch = depiction?.style === 'hatched' && ref.hatch ? byCodes(toYear(ref.hatch.date), ref.hatch.gwcodes) : [];
    const dashed = ref.dashed && at == null ? byCodes(toYear(ref.dashed.date), ref.dashed.gwcodes) : [];
    const overlays = (ref.overlays ?? []).filter((o) => o.geojson).map((o) => ({ style: o.style, geojson: o.geojson }));

    // Labels: a name question prints the option's own spelling; others use the state's labels
    const pick = (names) => (names?.[language] ?? names?.en ?? [])[0];
    const labels = (visual.labels ?? []).map((l) => {
      const text = feature.kind === 'pick_name' ? option.label : pick(l.names);
      let at = l.at;
      if (!at && l.gwcode != null) { const f = features.find((x) => x.properties.g === l.gwcode); if (f) at = d3.geoCentroid(f); }
      if (!at && highlight[0]) at = d3.geoCentroid(highlight[0]);
      return text && at ? { text, at, kind: l.kind ?? 'country', side: l.side ?? 'right' } : null;
    }).filter(Boolean);
    // Several country names side by side (two Germanys, two Yemens) are set smaller so they don't collide
    const countries = labels.filter((l) => l.kind === 'country').length;
    labels.forEach((l) => { l.small = l.kind === 'country' && countries > 1; });

    return { date, borders, frontier: frontierAt(date), highlight, outlines, hatch, dashed, overlays, labels };
  }

  /**
   * The countries on a date, for the names the game prints: { g (Gleditsch–Ward code), n (CShapes name),
   * at (the middle of the largest piece), s (its size: the square root of its area, in radians) }.
   */
  function countriesAt(date) {
    const { active, features } = world(date), near = topojson.neighbors(active);
    return features.map((f, i) => {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      let big = null, area = -1;
      for (const c of polys) { const p = { type: 'Polygon', coordinates: c }, a = d3.geoArea(p); if (a > area) { area = a; big = p; } }
      let s = Math.sqrt(area);
      // an island country (no land border: the Philippines, Cuba, Jamaica) is as large as its islands spread, as on a
      // printed globe, where its name sits partly over the sea; a country with neighbours keeps to its largest piece
      if (!near[i].length) s = Math.max(s, 0.5 * d3.geoDistance(...d3.geoBounds(f))); // half its bounds' diagonal
      return { g: f.properties.g, n: f.properties.n, at: d3.geoCentroid(big), s };
    });
  }

  /**
   * Whether a point can lie in feature i of a world: its bounding box (d3.geoBounds, made once per world; a box across
   * the Date Line has lon0 > lon1). Only a cheap first test, so the exact (and much slower) geoContains runs on a few.
   */
  const EPS = 1e-6;
  function mayContain(w, i, [lon, lat]) {
    w.boxes ??= w.features.map((f) => d3.geoBounds(f));
    const [[x0, y0], [x1, y1]] = w.boxes[i];
    if (lat < y0 - EPS || lat > y1 + EPS) return false;
    return x0 <= x1 ? lon >= x0 - EPS && lon <= x1 + EPS : lon >= x0 - EPS || lon <= x1 + EPS;
  }
  /** The territory under a place on a date: { g, n } (Gleditsch–Ward code and CShapes name), or null at sea. */
  function territoryAt(at, date) {
    const w = world(date), f = w.features.find((x, i) => mayContain(w, i, at) && d3.geoContains(x, at));
    return f ? { g: f.properties.g, n: f.properties.n } : null;
  }
  /** Every name CShapes gives territory g, over all its years. */
  const namesOf = (g) => [...new Set(geoms.filter((x) => x.properties.g === g).map((x) => x.properties.n))];

  /** Territory g is on the map on this date. */
  const has = (g, date) => geoms.some((x) => x.properties.g === g && x.properties.a <= date && date <= x.properties.b);

  // topo: the borders themselves, for a friend's custom globe (custom-globe.js composes it from them)
  return { sceneFor, worldAt, countriesAt, territoryAt, namesOf, has, topo };
}

function midpoint(state) {
  const from = state.validFrom ? toYear(state.validFrom) : 1886;
  const to = state.validTo ? toYear(state.validTo) : 2025;
  return (from + to) / 2;
}
