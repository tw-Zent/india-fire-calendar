// Data access per data/processed/CONTRACT.md v1.x
// Files (copied into public/data/ by scripts/copy-data.mjs): manifest.json, coverage.json, tiles/{lat0}_{lon0}.json
import { applyUncertainty } from './accuracy.js';
const BASE = 'data/';
const DAY = 86400000;

export const SENSORS = ['t', 'a', 's', 'n'];
export const SENSOR_LABELS = { t: 'MODIS Terra', a: 'MODIS Aqua', s: 'VIIRS S-NPP', n: 'VIIRS NOAA-20' };

let meta = null;
let unc = null;
let driftCsv = null;
// year → { Aqua: hours, Terra: hours } median daytime detection time, local solar (Pipeline, P&H box)
function parseDrift(t) {
  if (!t) return null;
  const [head, ...rows] = t.trim().split(/\r?\n/);
  const H = head.split(','); const iy = H.indexOf('year'), is = H.indexOf('satellite'), it = H.indexOf('lst_med');
  if (iy < 0 || is < 0 || it < 0) return null;
  const out = {};
  for (const r of rows) { const c = r.split(','); (out[+c[iy]] ||= {})[c[is]] = +c[it]; }
  return out;
}
const tileCache = new Map();

const epochDay = (iso) => Math.round(Date.parse(iso + 'T00:00:00Z') / DAY);

export async function loadMeta() {
  if (meta) return meta;
  const [man, cov, dom] = await Promise.all([
    fetch(BASE + 'manifest.json').then((r) => { if (!r.ok) throw new Error('manifest.json missing'); return r.json(); }),
    fetch(BASE + 'coverage.json').then((r) => { if (!r.ok) throw new Error('coverage.json missing'); return r.json(); }),
    fetch(BASE + 'domain.json').then((r) => (r.ok ? r.json() : null)).catch(() => null), // contract ≥1.1
    fetch(BASE + 'aqua_overpass_drift.csv').then((r) => (r.ok ? r.text() : null)).catch(() => null).then((t) => { driftCsv = t; }),
    fetch(BASE + 'uncertainty.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((u) => { unc = u; }),
  ]);
  const uncUsed = applyUncertainty(unc, man.version);
  // domain[tile] = Uint8Array(400), 1 = cell inside the data domain. Without domain.json every cell counts.
  let domain = null;
  if (dom?.tiles) {
    domain = {};
    for (const [tid, cells] of Object.entries(dom.tiles)) { const u = new Uint8Array(400); for (const c of cells) u[c] = 1; domain[tid] = u; }
  }
  const d0 = epochDay(man.date_first);
  const n_days = epochDay(man.date_last) - d0 + 1;
  // Re-index coverage to app day index (0 = date_first). Outside cov.d0..d1 → 0 (no coverage).
  const mask = new Uint8Array(n_days);
  const regime = new Uint8Array(n_days); // contract ≥1.2: 0 none, 1 terra_only, 2 modis_ta, 3 viirs
  for (let i = 0; i < cov.mask.length; i++) {
    const di = cov.d0 + i - d0;
    if (di >= 0 && di < n_days) { mask[di] = cov.mask[i]; if (cov.regime) regime[di] = cov.regime[i]; }
  }
  meta = {
    version: man.version + (man.h_status ? ` (h: ${man.h_status.replace(/_/g, ' ')})` : ''),
    h_method: man.h_method || null,
    hasRegime: !!cov.regime,
    regime,
    regimeNames: cov.regimes || { 0: 'none', 1: 'terra_only', 2: 'modis_ta', 3: 'viirs' },
    rawVersion: man.version,
    h_status: man.h_status,
    h_ratios: man.h_ratios,
    start: man.date_first,
    end: man.date_last,
    d0,
    t0: d0 * DAY,
    n_days,
    tiles: man.tiles,
    bits: cov.bits,
    mask,
    domain,
    domainCells: dom?.n_cells ?? null,
    uncertaintyFrom: uncUsed ? 'uncertainty.json' : 'app config',
    overpass: parseDrift(driftCsv),
    harmonized_label: 'Harmonized (S-NPP-VIIRS-equivalent detections)',
  };
  return meta;
}

export const isoOf = (m, di) => new Date(m.t0 + di * DAY).toISOString().slice(0, 10);
export const idxOf = (m, iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - m.t0) / DAY);

export function selBBox(sel) {
  if (sel.type === 'rect') return { s: sel.bounds[0][0], w: sel.bounds[0][1], n: sel.bounds[1][0], e: sel.bounds[1][1] };
  let s = 90, n = -90, w = 180, e = -180;
  for (const [la, lo] of sel.latlngs) { s = Math.min(s, la); n = Math.max(n, la); w = Math.min(w, lo); e = Math.max(e, lo); }
  return { s, w, n, e };
}

// A 0.1° cell belongs to the selection when its centre is inside it.
function inside(sel, lat, lon) {
  if (sel.type === 'rect') {
    const [[s, w], [n, e]] = sel.bounds;
    return lat >= s && lat <= n && lon >= w && lon <= e;
  }
  const p = sel.latlngs;
  let c = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [yi, xi] = p[i], [yj, xj] = p[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

async function getTile(m, t) {
  if (!tileCache.has(t.tile)) {
    tileCache.set(t.tile, fetch(BASE + t.file).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!j) return null;
      const N = j.records;
      const day = new Int32Array(N);
      let d = j.d0 - m.d0;
      for (let i = 0; i < N; i++) { d += j.dd[i]; day[i] = d; }
      const h = new Float64Array(N); // Float64: exact JSON values, so totals match Pipeline to the decimal
      for (let i = 0; i < N; i++) h[i] = j.h[i] == null ? NaN : j.h[i];
      return { lat0: j.lat0, lon0: j.lon0, N, day, c: Uint16Array.from(j.c), h,
        t: Uint16Array.from(j.t), a: Uint16Array.from(j.a), s: Uint16Array.from(j.s), n: Uint16Array.from(j.n) };
    }).catch(() => null));
  }
  return tileCache.get(t.tile);
}

// Daily arrays over the full record for the selection.
// No coverage (mask==0) → NaN in h and in every raw series; a sensor whose bit is unset that day → NaN for that sensor.
export async function aggregate(sel, onProgress) {
  const m = await loadMeta();
  const N = m.n_days;
  const bb = selBBox(sel);
  const hits = m.tiles.filter((t) => t.lat1 > bb.s && t.lat0 < bb.n && t.lon1 > bb.w && t.lon0 < bb.e);
  let done = 0;
  onProgress?.(0, hits.length);
  const tiles = await Promise.all(hits.map((t) => getTile(m, t).then((x) => { onProgress?.(++done, hits.length); return x; })));
  const h = new Float64Array(N);
  const raw = Object.fromEntries(SENSORS.map((s) => [s, new Float64Array(N)]));
  let nCells = 0, nSel = 0;
  // Every selected cell counts toward nSel, including cells in tiles with no data file (sea, outside India).
  for (let la = Math.floor(bb.s * 10) / 10; la < bb.n; la = Math.round((la + 0.1) * 10) / 10)
    for (let lo = Math.floor(bb.w * 10) / 10; lo < bb.e; lo = Math.round((lo + 0.1) * 10) / 10)
      if (inside(sel, la + 0.05, lo + 0.05)) nSel++;
  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    if (!t) continue;
    const dm = m.domain ? m.domain[hits[ti].tile] : null;
    const ok = new Uint8Array(400);
    for (let c = 0; c < 400; c++) {
      if (m.domain && !(dm && dm[c])) continue; // outside data domain = no data, never zero
      ok[c] = inside(sel, t.lat0 + Math.floor(c / 20) * 0.1 + 0.05, t.lon0 + (c % 20) * 0.1 + 0.05) ? 1 : 0;
      nCells += ok[c];
    }
    const { day, c, h: th, t: tt, a, s, n } = t;
    for (let i = 0; i < t.N; i++) {
      if (!ok[c[i]]) continue;
      const di = day[i];
      if (di < 0 || di >= N) continue;
      if (th[i] === th[i]) h[di] += th[i];
      raw.t[di] += tt[i]; raw.a[di] += a[i]; raw.s[di] += s[i]; raw.n[di] += n[i];
    }
  }
  const empty = nCells === 0; // whole selection outside the data domain → no data at all
  for (let di = 0; di < N; di++) {
    const mk = empty ? 0 : m.mask[di];
    if (mk === 0) h[di] = NaN;
    for (const s of SENSORS) if (!(mk & m.bits[s])) raw[s][di] = NaN;
  }
  return { h, raw, nCells, nSel, tilesLoaded: hits.length, bbox: bb };
}

// Grey raster of cells outside the data domain, over the tiled extent (for the map).
export function domainOverlay(m) {
  if (!m.domain) return null;
  const la0 = Math.min(...m.tiles.map((t) => t.lat0)), la1 = Math.max(...m.tiles.map((t) => t.lat1));
  const lo0 = Math.min(...m.tiles.map((t) => t.lon0)), lo1 = Math.max(...m.tiles.map((t) => t.lon1));
  const W = Math.round((lo1 - lo0) * 10), H = Math.round((la1 - la0) * 10);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const lat = la1 - (y + 0.5) / 10, lon = lo0 + (x + 0.5) / 10;
    const tlat = Math.floor((lat + 90) / 2) * 2 - 90, tlon = Math.floor((lon + 180) / 2) * 2 - 180;
    const dm = m.domain[`${tlat}_${tlon}`];
    const c = (Math.floor((lat - tlat) * 10)) * 20 + Math.floor((lon - tlon) * 10);
    const i = (y * W + x) * 4;
    if (!(dm && dm[c])) { img.data[i] = 90; img.data[i + 1] = 90; img.data[i + 2] = 90; img.data[i + 3] = 110; }
  }
  ctx.putImageData(img, 0, 0);
  return { url: cv.toDataURL(), bounds: [[la0, lo0], [la1, lo1]] };
}

// Per-cell totals inside the selection for day range [a, b], plus per-cell typical (median over reference-year windows
// of the same calendar span). No data logic changes: same tiles, same h, same domain/coverage rules.
// refStarts: day index where each reference year's window starts (window length = b - a + 1).
export async function cellStats(sel, a, b, refStarts, skipDay) {
  const m = await loadMeta();
  const bb = selBBox(sel);
  const hits = m.tiles.filter((t) => t.lat1 > bb.s && t.lat0 < bb.n && t.lon1 > bb.w && t.lon0 < bb.e);
  const tiles = await Promise.all(hits.map((t) => getTile(m, t)));
  const L = b - a + 1;
  const R = refStarts.length;
  // day → reference-year slot (-1 if none)
  const slot = new Int8Array(m.n_days).fill(-1);
  refStarts.forEach((s, ri) => { for (let k = 0; k < L; k++) { const di = s + k; if (di >= 0 && di < m.n_days && slot[di] < 0 && !(skipDay && skipDay(di))) slot[di] = ri; } });
  const cells = []; // {lat, lon, total, ref: Float64Array(R)}
  for (let ti = 0; ti < tiles.length; ti++) {
    const t = tiles[ti];
    if (!t) continue;
    const dm = m.domain ? m.domain[hits[ti].tile] : null;
    const idx = new Int32Array(400).fill(-1);
    for (let c = 0; c < 400; c++) {
      if (m.domain && !(dm && dm[c])) continue;
      const lat = t.lat0 + Math.floor(c / 20) * 0.1 + 0.05, lon = t.lon0 + (c % 20) * 0.1 + 0.05;
      if (!inside(sel, lat, lon)) continue;
      idx[c] = cells.length;
      cells.push({ lat, lon, total: 0, ref: new Float64Array(R) });
    }
    const { day, c, h } = t;
    for (let i = 0; i < t.N; i++) {
      const ci = idx[c[i]];
      if (ci < 0) continue;
      const v = h[i];
      if (v !== v) continue;
      const di = day[i];
      if (di >= a && di <= b) cells[ci].total += v;
      const r = slot[di];
      if (r >= 0) cells[ci].ref[r] += v;
    }
  }
  for (const cl of cells) {
    const s = Array.from(cl.ref).sort((x, y) => x - y);
    cl.typical = !R ? NaN : R % 2 ? s[(R - 1) / 2] : (s[R / 2 - 1] + s[R / 2]) / 2;
    delete cl.ref;
  }
  return { cells, nRef: R };
}
