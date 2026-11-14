// Fire-density / anomaly raster for the map: one canvas image, one pixel per 0.1° cell (scaled up, pixelated).
import { RAMP } from './Calendar.jsx';

export const ZERO_RGBA = [214, 218, 222, 140];
// Diverging, colourblind-safe (blue = less than typical, orange = more)
export const DIV = { bins: [-75, -50, -25, 25, 50, 100], colors: ['#08519c', '#4a8fc4', '#a9cbe6', '#ececec', '#fdc58a', '#f28c28', '#b35806'] };
export const DIV_LABELS = ['≤ −75 %', '−75 to −50 %', '−50 to −25 %', '−25 to +25 %', '+25 to +50 %', '+50 to +100 %', '> +100 %'];
// Cells whose typical window total is below this are not compared (stakeholder-01 #4): "too few fires to compare".
export const MIN_TYPICAL = 3;
export const TOO_FEW_RGBA = [248, 248, 248, 235]; // near-white, clearly unlike the dark-grey "no data" mask (stakeholder-02 N5)

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];

export function totalEdges(max) {
  if (!(max > 0)) return [1];
  return RAMP.map((_, i) => Math.pow(max, (i + 1) / RAMP.length));
}

export function pctOf(c) {
  if (!(c.typical > 0)) return c.total > 0 ? Infinity : 0;
  return (100 * (c.total - c.typical)) / c.typical;
}

export function colorFor(c, mode, edges) {
  if (mode === 'anomaly') {
    if (!(c.typical >= MIN_TYPICAL)) return TOO_FEW_RGBA;
    const p = pctOf(c);
    let i = DIV.bins.findIndex((b) => p <= b);
    if (i < 0) i = DIV.colors.length - 1;
    return [...hex(DIV.colors[i]), 215];
  }
  if (!(c.total > 0)) return ZERO_RGBA;
  let i = edges.findIndex((e) => c.total <= e);
  if (i < 0) i = RAMP.length - 1;
  return [...hex(RAMP[i]), 215];
}

export function buildRaster(cells, mode) {
  if (!cells.length) return null;
  let s = 90, n = -90, w = 180, e = -180, max = 0;
  for (const c of cells) {
    s = Math.min(s, c.lat); n = Math.max(n, c.lat); w = Math.min(w, c.lon); e = Math.max(e, c.lon);
    if (c.total > max) max = c.total;
  }
  const lat0 = Math.round((s - 0.05) * 10) / 10, lat1 = Math.round((n + 0.05) * 10) / 10;
  const lon0 = Math.round((w - 0.05) * 10) / 10, lon1 = Math.round((e + 0.05) * 10) / 10;
  const W = Math.round((lon1 - lon0) * 10), H = Math.round((lat1 - lat0) * 10);
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(W, H);
  const edges = totalEdges(max);
  const lookup = new Map();
  for (const c of cells) {
    const x = Math.floor((c.lon - lon0) * 10), y = Math.floor((lat1 - c.lat) * 10);
    if (x < 0 || y < 0 || x >= W || y >= H) continue;
    const [r, g, b, a] = colorFor(c, mode, edges);
    const i = (y * W + x) * 4;
    img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
    lookup.set(`${Math.floor(c.lat * 10)}_${Math.floor(c.lon * 10)}`, c);
  }
  ctx.putImageData(img, 0, 0);
  return { url: cv.toDataURL(), bounds: [[lat0, lon0], [lat1, lon1]], lookup, max, edges, mode };
}
