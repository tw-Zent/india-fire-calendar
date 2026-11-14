// Accuracy labels by data source (labels only, no data logic).
// Numbers: data/processed/reports/uncertainty.json is copied into the build. It is used when its version matches the
// data version; otherwise the HQ-approved values below are used (webapp-06 HQ response, 15:20; MODIS daily = hybrid v1.3).
export const ACCURACY = {
  source: 'held-out validation years 2013/2017/2021/2025; ranges are India – Punjab & Haryana',
  regimes: {
    viirs_snpp: { label: 'VIIRS S-NPP direct', conf: null, monthly: '0', daily: '0', reference: true,
      note: 'the reference satellite, observed directly (only clouds and overpass time limit it)' },
    viirs_n20: { label: 'NOAA-20 filling S-NPP gap', conf: null, monthly: '3–4 %', daily: '23–31 %',
      note: 'VIIRS NOAA-20 converted to S-NPP units on days S-NPP missed' },
    modis_ta: { label: 'MODIS-era estimate', conf: null, monthly: '10–16 %', daily: '22–37 %',
      note: 'converted from MODIS Terra+Aqua (Jul 2002–2011 and VIIRS gaps)' },
    terra_only: { label: 'Terra-only estimate', conf: 'lower confidence', monthly: '12–29 %', daily: '40–93 %',
      note: 'converted from MODIS Terra alone (before Aqua, Jul 2002)' },
    none: { label: 'no coverage', conf: null, monthly: null, daily: null, note: 'no satellite data' },
  },
  // Year-marker colours (Okabe–Ito, distinct from the heatmap ramp)
  swatch: { viirs_snpp: '#000000', viirs_n20: '#555555', modis_ta: '#999999', terra_only: '#E69F00', mixed: '#56B4E9', none: '#ffffff' },
};
const ORDER = ['viirs_snpp', 'viirs_n20', 'modis_ta', 'terra_only'];
const JSON_KEYS = { viirs_snpp: 'viirs_snpp', viirs_n20: 'viirs_noaa20_filled', modis_ta: 'modis_ta', terra_only: 'terra_only' };

// Called once with data/uncertainty.json (if present) and the data version.
export function applyUncertainty(json, dataVersion) {
  if (!json?.regimes || json.version !== dataVersion) return false;
  const pct = (r) => (Array.isArray(r) ? (r[0] === r[1] ? `${r[0]}${r[0] ? ' %' : ''}` : `${r[0]}–${r[1]} %`) : null);
  for (const k of ORDER) {
    const j = json.regimes[JSON_KEYS[k]];
    if (!j) continue;
    if (j.monthly_error_pct) ACCURACY.regimes[k].monthly = pct(j.monthly_error_pct);
    if (j.daily_error_pct) ACCURACY.regimes[k].daily = pct(j.daily_error_pct);
  }
  if (json.source) ACCURACY.source = json.source.replace(/\s*\(.*?\)/, '') + '; ranges are India – Punjab & Haryana';
  return true;
}

// Day class: regime 3 (viirs) is split by mask bit S-NPP: set → direct, clear → NOAA-20-filled.
export function dayClass(meta, di) {
  const r = meta.regime[di];
  if (r === 3) return meta.mask[di] & meta.bits.s ? 'viirs_snpp' : 'viirs_n20';
  return r === 2 ? 'modis_ta' : r === 1 ? 'terra_only' : 'none';
}

// Dominant source over day indices [a, b]. VIIRS S-NPP + NOAA-20-filled count together for "mixed" decisions.
export function regimeOf(meta, a, b) {
  if (!meta?.hasRegime) return null;
  const n = { viirs_snpp: 0, viirs_n20: 0, modis_ta: 0, terra_only: 0, none: 0 };
  for (let di = Math.max(0, a); di <= Math.min(meta.n_days - 1, b); di++) n[dayClass(meta, di)]++;
  const cov = n.viirs_snpp + n.viirs_n20 + n.modis_ta + n.terra_only;
  if (!cov) return { key: 'none', mixed: false, parts: [] };
  const groups = ['viirs_snpp', 'viirs_n20', 'modis_ta', 'terra_only'].filter((k) => n[k] > 0).map((k) => [k, n[k]]).sort((x, y) => y[1] - x[1]);
  // "mixed" when a secondary source covers ≥ 15 % of days, or NOAA-20-filled days are > 10 % (stakeholder-01 minor)
  const mixed = groups.slice(1).some(([k, c]) => c / cov >= (k === 'viirs_n20' ? 0.1 : 0.15)) || (groups[0][0] !== 'viirs_n20' && n.viirs_n20 / cov > 0.1);
  return { key: groups[0][0], mixed, parts: groups.map(([k, c]) => ({ key: k, share: c / cov })), n20Days: n.viirs_n20 };
}

function oneText(k, withError) {
  const c = ACCURACY.regimes[k];
  const bits = [c.label];
  if (c.conf) bits.push(c.conf);
  if (withError) {
    if (c.reference) bits.push('reference (no conversion error)');
    else if (c.monthly) bits.push(`typical monthly error ±${c.monthly}`);
  }
  return bits.join(' · ');
}

export function regimeText(r, { withError = true } = {}) {
  if (!r) return '';
  if (r.mixed) return `mixed: ${r.parts.map((p) => `${ACCURACY.regimes[p.key].label} ${Math.round(100 * p.share)} %`).join(', ')}`;
  let t = oneText(r.key, withError);
  if (r.key === 'viirs_snpp' && r.n20Days) t += ` (${r.n20Days} day${r.n20Days > 1 ? 's' : ''} filled by NOAA-20)`;
  return t;
}

export function dayRegimeText(meta, di) {
  if (!meta?.hasRegime) return '';
  const k = dayClass(meta, di);
  const c = ACCURACY.regimes[k];
  if (k === 'none') return c.label;
  return c.reference ? `${c.label} (reference)` : `${c.label}${c.conf ? ` · ${c.conf}` : ''} · typical daily error ±${c.daily}`;
}

export function legendLines() {
  return ORDER.map((k) => {
    const c = ACCURACY.regimes[k];
    const err = c.reference ? 'reference, no conversion error' : [c.monthly && `typical monthly error ±${c.monthly}`, c.daily && `daily ±${c.daily}`].filter(Boolean).join(', ');
    return `${c.label}${c.conf ? ` (${c.conf})` : ''}: ${c.note}${err ? `; ${err}` : ''}`;
  });
}

export const LEGEND_KEYS = ORDER;
