// Historical comparison: per-day median across reference years, anomalies, critical periods.
// No-coverage days (NaN) are excluded from every statistic (HQ D9).
import { idxOf, isoOf } from './data.js';

const md = (iso) => (iso.slice(5) === '02-29' ? '02-28' : iso.slice(5));

function quantile(sorted, q) {
  if (!sorted.length) return NaN;
  const p = (sorted.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
}

// Centred moving average ignoring NaN; NaN where the centre day itself is NaN.
export function smooth(arr, w) {
  if (w <= 1) return arr;
  const out = new Float64Array(arr.length), r = Math.floor(w / 2);
  for (let i = 0; i < arr.length; i++) {
    if (Number.isNaN(arr[i])) { out[i] = NaN; continue; }
    let s = 0, k = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(arr.length - 1, i + r); j++) if (!Number.isNaN(arr[j])) { s += arr[j]; k++; }
    out[i] = s / k;
  }
  return out;
}

export function yearsOf(meta) { return { y0: +meta.start.slice(0, 4), y1: +meta.end.slice(0, 4) }; }

// For each day in [from,to]: median, p25, p75 of the same calendar day in reference years (excluding the day's own year).
export function compare(meta, h, from, to, refFrom, refTo, win = 1, skipTerraOnly = true) {
  const src = smooth(h, win);
  const a = idxOf(meta, from), b = idxOf(meta, to);
  const L = b - a + 1;
  const out = { a, b, value: new Float64Array(L), median: new Float64Array(L), p25: new Float64Array(L), p75: new Float64Array(L),
    diff: new Float64Array(L), pct: new Float64Array(L), nRef: new Uint8Array(L) };
  for (let k = 0; k < L; k++) {
    const di = a + k;
    const iso = isoOf(meta, di), y = +iso.slice(0, 4), mmdd = md(iso);
    const vals = [];
    for (let ry = refFrom; ry <= refTo; ry++) {
      if (ry === y) continue;
      const j = idxOf(meta, `${ry}-${mmdd}`);
      if (j < 0 || j >= meta.n_days) continue;
      if (skipTerraOnly && meta.regime[j] === 1) continue; // terra_only days: unreliable daily values (contract v1.2)
      const v = src[j];
      if (!Number.isNaN(v)) vals.push(v);
    }
    vals.sort((p, q) => p - q);
    const v = src[di];
    out.value[k] = v;
    out.nRef[k] = vals.length;
    out.median[k] = quantile(vals, 0.5);
    out.p25[k] = quantile(vals, 0.25);
    out.p75[k] = quantile(vals, 0.75);
    out.diff[k] = v - out.median[k];
    out.pct[k] = out.median[k] > 0 ? (100 * out.diff[k]) / out.median[k] : NaN;
  }
  return out;
}

// Critical periods: from the multi-year median climatology (15-day smoothed), contiguous spans of the
// calendar year where the typical daily value is ≥ 25 % of its annual peak. Then per-year peak date and total.
export function criticalPeriods(meta, h, refFrom, refTo, skipTerraOnly = true) {
  const { y0, y1 } = yearsOf(meta);
  const days = 365;
  const mdOf = (k) => new Date(Date.UTC(2001, 0, 1 + k)).toISOString().slice(5, 10); // non-leap template
  const clim = new Float64Array(days);
  for (let k = 0; k < days; k++) {
    const vals = [];
    for (let y = refFrom; y <= refTo; y++) {
      const j = idxOf(meta, `${y}-${mdOf(k)}`);
      if (j >= 0 && j < meta.n_days && !Number.isNaN(h[j]) && !(skipTerraOnly && meta.regime[j] === 1)) vals.push(h[j]);
    }
    vals.sort((p, q) => p - q);
    clim[k] = vals.length ? quantile(vals, 0.5) : 0;
  }
  // circular 15-day smoothing
  const sm = new Float64Array(days);
  for (let k = 0; k < days; k++) { let s = 0; for (let j = -7; j <= 7; j++) s += clim[(k + j + days) % days]; sm[k] = s / 15; }
  const peak = Math.max(...sm);
  if (!(peak > 0)) return { periods: [], clim: sm };
  // Seasons are found per local peak, not against one global threshold: a smaller second season (e.g. the
  // wheat-residue season next to the much larger paddy season) gets its own bounds, where the typical value
  // stays at or above 25 % of THAT season's peak. Candidate peaks must reach 10 % of the yearly maximum.
  const cands = [];
  for (let k = 0; k < days; k++) {
    const l = sm[(k - 1 + days) % days], r = sm[(k + 1) % days];
    if (sm[k] >= 0.1 * peak && sm[k] >= l && sm[k] > r) cands.push(k);
  }
  cands.sort((x, y) => sm[y] - sm[x]);
  const claimed = new Uint8Array(days);
  let periods = [];
  for (const pk of cands) {
    if (claimed[pk]) continue;
    const thr = 0.25 * sm[pk];
    let s0 = pk, e0 = pk;
    while (s0 > 0 && sm[s0 - 1] >= thr && !claimed[s0 - 1]) s0--;
    while (e0 < days - 1 && sm[e0 + 1] >= thr && !claimed[e0 + 1]) e0++;
    for (let j = s0; j <= e0; j++) claimed[j] = 1;
    let mass = 0; for (let j = s0; j <= e0; j++) mass += clim[j];
    periods.push({ s: s0, e: e0, pk, mass });
  }
  // Merge neighbouring seasons (≤ 10 days apart) when there is no real valley between their peaks
  // (lowest typical value between them ≥ 50 % of the smaller peak): one season with a shoulder, not two.
  periods.sort((x, y) => x.s - y.s);
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i + 1 < periods.length; i++) {
      const A = periods[i], Bp = periods[i + 1];
      if (Bp.s - A.e > 10) continue;
      let valley = Infinity;
      for (let j = Math.min(A.pk, Bp.pk); j <= Math.max(A.pk, Bp.pk); j++) valley = Math.min(valley, sm[j]);
      if (valley >= 0.5 * Math.min(sm[A.pk], sm[Bp.pk])) {
        periods.splice(i, 2, { s: Math.min(A.s, Bp.s), e: Math.max(A.e, Bp.e), pk: sm[A.pk] >= sm[Bp.pk] ? A.pk : Bp.pk, mass: A.mass + Bp.mass });
        merged = true; break;
      }
    }
  }
  const annual = clim.reduce((x, y) => x + y, 0);
  // keep seasons holding ≥ 5 % of the typical year's detections and ≥ 7 days long; at most 3, in calendar order
  periods = periods.filter((p) => p.mass >= 0.05 * annual && p.e - p.s >= 6).sort((x, y) => y.mass - x.mass).slice(0, 3).sort((x, y) => x.s - y.s);
  const MARGIN = 15; // per-year peaks are searched a little beyond the typical bounds (clipped at neighbouring seasons)
  const inRef = (y) => y >= refFrom && y <= refTo;
  const res = periods.map(({ s, e, pk }, pi) => {
    const lo = Math.max(s - MARGIN, pi > 0 ? periods[pi - 1].e + 1 : 0);
    const hi = Math.min(e + MARGIN, pi < periods.length - 1 ? periods[pi + 1].s - 1 : days - 1);
    const L = e - s + 1;
    const years = [];
    for (let y = y0; y <= y1; y++) {
      const a = idxOf(meta, `${y}-${mdOf(s)}`), b = idxOf(meta, `${y}-${mdOf(e)}`);
      if (b < 0 || a >= meta.n_days) continue;
      const partial = a < 0 || b >= meta.n_days;
      let tot = 0, best = -1, bestDi = -1, gaps = 0, n = 0, terra = 0;
      for (let di = Math.max(0, a); di <= Math.min(meta.n_days - 1, b); di++) {
        if (Number.isNaN(h[di])) { gaps++; continue; }
        n++; tot += h[di];
        if (meta.regime[di] === 1) terra++;
      }
      const sa = Math.max(0, idxOf(meta, `${y}-${mdOf(lo)}`)), sb = Math.min(meta.n_days - 1, idxOf(meta, `${y}-${mdOf(hi)}`));
      const ys = smooth(h.slice(sa, sb + 1), 7);
      for (let i = 0; i < ys.length; i++) if (ys[i] > best) { best = ys[i]; bestDi = sa + i; }
      if (!n) continue;
      const peakIso = bestDi >= 0 ? isoOf(meta, bestDi) : null;
      const shift = peakIso ? Math.round((Date.parse(`2001-${md(peakIso)}`) - Date.parse(`2001-${mdOf(pk)}`)) / 86400000) : null;
      // usable as a reference year: complete, ≥ 90 % of days covered, and (by default) no Terra-only days
      const usable = !partial && n >= 0.9 * L && !(skipTerraOnly && terra > 0);
      years.push({ year: y, total: tot, peak: peakIso, shift, gaps, partial, usable });
    }
    // "Typical" season total = median over reference years of each year's OWN season total (HQ, stakeholder-01 #1),
    // leaving out the year being judged — not the sum of daily medians.
    const refTotals = (skipYear) => years.filter((r) => r.usable && inRef(r.year) && r.year !== skipYear).map((r) => r.total).sort((x, y) => x - y);
    for (const r of years) { const t = refTotals(r.year); r.typical = quantile(t, 0.5); r.pctOfTypical = r.typical > 0 ? (100 * r.total) / r.typical : NaN; }
    const all = refTotals(null);
    return { start: mdOf(s), end: mdOf(e), peak: mdOf(pk), typicalTotal: quantile(all, 0.5), nRef: all.length, years };
  });
  return { periods: res, clim: sm };
}

export function verdict(y) {
  if (!y) return '';
  const timing = y.shift == null ? '' : Math.abs(y.shift) <= 5 ? 'on time' : y.shift < 0 ? `${-y.shift} d early` : `${y.shift} d late`;
  const size = Number.isNaN(y.pctOfTypical) ? '' : y.pctOfTypical >= 125 ? 'above normal' : y.pctOfTypical <= 75 ? 'below normal' : 'near normal';
  return [timing, size].filter(Boolean).join(', ');
}

// Typical total of a window = median over the given years of each year's own total for the same calendar window
// (same month-day start, same length). Only complete windows with ≥ 90 % covered days count; Terra-only days excluded on request.
export function windowTypical(meta, h, startIso, L, years, skipTerraOnly = true) {
  const tots = [];
  for (const y of years) {
    const a = idxOf(meta, `${y}-${md(startIso)}`);
    if (a < 0 || a + L - 1 >= meta.n_days) continue;
    let t = 0, n = 0, bad = false;
    for (let di = a; di < a + L; di++) {
      if (Number.isNaN(h[di])) continue;
      if (skipTerraOnly && meta.regime[di] === 1) { bad = true; break; }
      t += h[di]; n++;
    }
    if (bad || n < 0.9 * L) continue;
    tots.push({ year: y, total: t });
  }
  const s = tots.map((x) => x.total).sort((p, q) => p - q);
  return { median: quantile(s, 0.5), n: s.length, years: tots.map((x) => x.year) };
}

// Both baselines for a window: long-term (reference years) and the last 5 complete years before the viewed one.
export function baselines(meta, h, startIso, L, refFrom, refTo, skipTerraOnly = true) {
  const vy = +startIso.slice(0, 4);
  const ref = [];
  for (let y = refFrom; y <= refTo; y++) if (y !== vy) ref.push(y);
  const longTerm = windowTypical(meta, h, startIso, L, ref, skipTerraOnly);
  const recent = [];
  for (let y = vy - 1; y >= vy - 12 && recent.length < 5; y--) {
    const w = windowTypical(meta, h, startIso, L, [y], skipTerraOnly);
    if (w.n) recent.push(y);
  }
  const last5 = windowTypical(meta, h, startIso, L, recent, skipTerraOnly);
  return { longTerm, last5 };
}
