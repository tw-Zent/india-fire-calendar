import { useEffect, useMemo, useRef, useState } from 'react';
import MapPanel from './MapPanel.jsx';
import Calendar from './Calendar.jsx';
import { LineChart, AnomalyChart } from './Charts.jsx';
import { aggregate, cellStats, domainOverlay, idxOf, isoOf, loadMeta, SENSORS, SENSOR_LABELS } from './data.js';
import { buildRaster, DIV, DIV_LABELS, MIN_TYPICAL, pctOf } from './mapLayer.js';
import { RAMP } from './Calendar.jsx';
import { mdToHtml } from './md.js';
import { ACCURACY, dayClass, regimeOf, regimeText, legendLines } from './accuracy.js';
import { baselines, compare, criticalPeriods, verdict, yearsOf } from './analysis.js';
import { downloadCSV, downloadPNG, downloadSVG } from './exporters.js';

// Bbox matches Pipeline's Punjab & Haryana sample bbox (CONTRACT.md) so totals are comparable.
// `season` = month-day window; dates are picked from the data (season so far if it is in progress, else the latest complete one).
export const PRESETS = [
  { id: 'ph', name: 'Punjab & Haryana (box) — stubble season (Oct–Nov)', title: 'A latitude/longitude box, not the state borders', type: 'rect', bounds: [[27.5, 73.8], [32.6, 77.6]], season: ['10-01', '11-30'], from: '2025-10-01', to: '2025-11-30' },
  // Other well-known burning regions (seasons checked against the data: ≥80 % of 2012+ S-NPP detections fall in the window).
  { id: 'ne', name: 'Northeast hills — jhum burning (Feb–Apr)', title: 'A latitude/longitude box', type: 'rect', bounds: [[22.5, 91.5], [27.5, 95.5]], season: ['02-01', '04-30'], from: '2026-02-01', to: '2026-04-30' },
  { id: 'ci', name: 'Central India forests — spring fires (Feb–May)', title: 'A latitude/longitude box', type: 'rect', bounds: [[18.0, 80.0], [24.0, 86.0]], season: ['02-15', '05-15'], from: '2026-02-15', to: '2026-05-15' },
  // Hand-drawn coarse polygon over Uttarakhand's forested hills incl. the Kumaon foothills (Nainital, Haldwani, Champawat);
  // excludes the Haridwar/Saharanpur and Udham Singh Nagar plains and Himachal (stakeholder-01 #2, HQ webapp-09 b).
  { id: 'uk', name: 'Uttarakhand — forest-fire season (Mar–Jun)', title: 'A hand-drawn outline of the forested hills, not the state border', type: 'poly',
    latlngs: [[30.95, 77.75], [31.45, 78.35], [31.0, 79.3], [30.4, 80.3], [30.2, 81.0], [29.6, 80.4], [29.05, 80.15], [29.15, 79.55], [29.3, 79.1], [29.8, 78.45], [30.1, 78.1], [30.3, 77.8]],
    season: ['03-15', '06-15'], from: '2026-03-15', to: '2026-06-15' },
];
// Season so far when a preset's season is in progress on the latest data date (stakeholder-01 #3).
export function presetDates(p, meta) {
  if (!p?.season || !meta) return { from: p.from, to: p.to, soFar: false };
  const end = meta.end, Y = +end.slice(0, 4);
  const f = `${Y}-${p.season[0]}`, t = `${Y}-${p.season[1]}`;
  if (end >= f && end <= t) return { from: f, to: end, soFar: true };
  if (end < f) return { from: `${Y - 1}-${p.season[0]}`, to: `${Y - 1}-${p.season[1]}`, soFar: false };
  return { from: f, to: t, soFar: false };
}
const REF_DEFAULT_FROM = 2003; // HQ D17 with h v1.2: Terra+Aqua validates well from 2003. Terra-only 2000–2002 never in the default.
const TAB_IDS = ['calendar', 'history', 'unusual', 'critical', 'sensors', 'download'];

// Shareable URL: ?a=<preset> | ?r=S,W,N,E | ?p=lat lon;lat lon…  &f=&t=&tab=&ref=Y1-Y2&sm=&tt=0
function readUrl() {
  const q = new URLSearchParams(location.search);
  const out = {};
  const num = (x) => Number.isFinite(+x);
  if (q.get('a')) { const p = PRESETS.find((x) => x.id === q.get('a')); if (p) out.sel = p; }
  else if (q.get('r')) {
    const v = q.get('r').split(',').map(Number);
    if (v.length === 4 && v.every(num)) out.sel = { type: 'rect', name: 'Shared rectangle', bounds: [[v[0], v[1]], [v[2], v[3]]] };
  } else if (q.get('p')) {
    const ll = q.get('p').split(';').map((x) => x.trim().split(/[ ,]+/).map(Number)).filter((x) => x.length === 2 && x.every(num));
    if (ll.length >= 3) out.sel = { type: 'poly', name: 'Shared polygon', latlngs: ll };
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  if (iso.test(q.get('f') || '')) out.from = q.get('f');
  if (iso.test(q.get('t') || '')) out.to = q.get('t');
  if (TAB_IDS.includes(q.get('tab'))) out.tab = q.get('tab');
  const r = (q.get('ref') || '').match(/^(\d{4})-(\d{4})$/);
  if (r) out.ref = [+r[1], +r[2]];
  if (['1', '7', '15'].includes(q.get('sm'))) out.win = +q.get('sm');
  if (q.get('tt') === '0') out.skipT = false;
  if (['total', 'anomaly', 'off'].includes(q.get('map'))) out.map = q.get('map');
  return out;
}
function writeUrl({ sel, from, to, tab, ref, win, skipT, mapMode }) {
  const q = new URLSearchParams();
  if (sel?.id) q.set('a', sel.id);
  else if (sel?.type === 'rect') q.set('r', sel.bounds.flat().map((x) => x.toFixed(3)).join(','));
  else if (sel?.type === 'poly') q.set('p', sel.latlngs.map(([a, b]) => `${a.toFixed(3)} ${b.toFixed(3)}`).join(';'));
  q.set('f', from); q.set('t', to); q.set('tab', tab);
  if (ref) q.set('ref', `${ref[0]}-${ref[1]}`);
  if (win > 1) q.set('sm', String(win));
  if (!skipT) q.set('tt', '0');
  if (mapMode && mapMode !== 'total') q.set('map', mapMode);
  const url = `${location.pathname}?${q.toString()}${location.hash}`;
  try { history.replaceState(null, '', url); } catch { /* ignore */ }
}
const URL0 = readUrl();
const lowConf = (y) => y <= 2002;

const fmt = (v) => (Number.isNaN(v) ? '—' : Math.round(+v.toFixed(6)).toLocaleString('en-US')); // toFixed(6): undo float summing error before rounding
const TABS = [
  ['calendar', 'Calendar'],
  ['history', 'Historical patterns'],
  ['unusual', 'Unusual conditions'],
  ['critical', 'Critical periods'],
  ['sensors', 'Sensors'],
  ['download', 'Download'],
];

export default function App() {
  const [meta, setMeta] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(URL0.sel || PRESETS[0]);
  const [from, setFrom] = useState(URL0.from || (URL0.sel?.from ?? PRESETS[0].from));
  const [to, setTo] = useState(URL0.to || (URL0.sel?.to ?? PRESETS[0].to));
  const [prog, setProg] = useState(null);
  const [copied, setCopied] = useState(false);
  const [agg, setAgg] = useState(null);
  const [busy, setBusy] = useState(false);
  const [ms, setMs] = useState(null);
  const [tab, setTab] = useState(URL0.tab || 'calendar');
  const [page, setPage] = useState(location.hash === '#about' ? 'about' : 'app');
  const [ref, setRef] = useState(null); // [fromYear, toYear]
  const [win, setWin] = useState(URL0.win || 1);
  const [skipT, setSkipT] = useState(URL0.skipT ?? true);
  const [mapMode, setMapMode] = useState(URL0.map || 'total'); // total | anomaly | off
  const [density, setDensity] = useState(null);
  const [anomMode, setAnomMode] = useState('diff');
  const [showRaw, setShowRaw] = useState(false);
  const calRef = useRef(null), lineRef = useRef(null), anomRef = useRef(null);

  useEffect(() => { loadMeta().then((m) => {
    setMeta(m); const { y1 } = yearsOf(m); setRef(URL0.ref || [REF_DEFAULT_FROM, y1]);
    if (!URL0.from && !URL0.to) { const s0 = URL0.sel || PRESETS[0]; if (s0.id) { const d = presetDates(s0, m); setFrom(d.from); setTo(d.to); } }
  }).catch((e) => setErr(e.message)); }, []);
  useEffect(() => {
    const h = () => setPage(location.hash === '#about' ? 'about' : 'app');
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  useEffect(() => {
    if (!meta || !sel) return;
    let live = true;
    setBusy(true);
    const t = performance.now();
    aggregate(sel, (d, n) => { if (live) setProg({ d, n }); }).then((a) => { if (live) { setAgg(a); setMs(Math.round(performance.now() - t)); setBusy(false); } })
      .catch((e) => { if (live) { setErr(e.message); setBusy(false); } });
    return () => { live = false; };
  }, [meta, sel]);

  const rangeOk = meta && from && to && from <= to && from >= meta.start && from <= meta.end;
  const clampTo = meta && to > meta.end ? meta.end : to;

  const totals = useMemo(() => {
    if (!agg || !rangeOk) return null;
    const a = idxOf(meta, from), b = idxOf(meta, clampTo);
    const t = { h: 0, noCov: 0, days: b - a + 1, raw: Object.fromEntries(SENSORS.map((s) => [s, 0])) };
    for (let di = a; di <= b; di++) {
      if (Number.isNaN(agg.h[di])) t.noCov++; else t.h += agg.h[di];
      for (const s of SENSORS) if (!Number.isNaN(agg.raw[s][di])) t.raw[s] += agg.raw[s][di];
    }
    return t;
  }, [agg, meta, from, clampTo, rangeOk]);

  const cmp = useMemo(() => (agg && rangeOk && ref ? compare(meta, agg.h, from, clampTo, ref[0], ref[1], win, skipT) : null),
    [agg, meta, from, clampTo, rangeOk, ref, win, skipT]);
  const crit = useMemo(() => (agg && ref ? criticalPeriods(meta, agg.h, ref[0], ref[1], skipT) : null), [agg, meta, ref, skipT]);
  useEffect(() => { if (meta && ref) writeUrl({ sel, from, to, tab, ref, win, skipT, mapMode }); }, [meta, sel, from, to, tab, ref, win, skipT, mapMode]);
  const spanDays = meta && rangeOk ? idxOf(meta, clampTo) - idxOf(meta, from) + 1 : 0;
  const anomalyOk = spanDays > 0 && spanDays <= 366;
  useEffect(() => {
    if (!meta || !agg || !rangeOk || !ref || mapMode === 'off' || agg.nCells === 0) { setDensity(null); return; }
    let live = true;
    const a = idxOf(meta, from), b = idxOf(meta, clampTo), L = b - a + 1;
    const mode = mapMode === 'anomaly' && anomalyOk ? 'anomaly' : 'total';
    const starts = [];
    if (mode === 'anomaly') {
      const vy = +from.slice(0, 4);
      for (let y = ref[0]; y <= ref[1]; y++) {
        if (y === vy) continue;
        const s0 = idxOf(meta, `${y}${from.slice(4)}`);
        if (s0 >= 0 && s0 + L - 1 < meta.n_days) starts.push(s0); // only complete windows
      }
    }
    const skipDay = skipT && meta.hasRegime ? (di) => meta.regime[di] === 1 : null;
    const t0 = performance.now();
    cellStats(sel, a, b, starts, skipDay).then((st) => {
      if (!live) return;
      const r = buildRaster(st.cells, mode);
      if (r) { r.nRef = st.nRef; r.ms = Math.round(performance.now() - t0); r.nCells = st.cells.length; }
      setDensity(r);
    });
    return () => { live = false; };
  }, [meta, agg, sel, from, clampTo, rangeOk, ref, skipT, mapMode, anomalyOk]);
  const describeCell = (c) => {
    const f = (v) => (Number.isNaN(v) ? '—' : (Math.round(v * 10) / 10).toLocaleString('en-US'));
    const head = `<b>Cell ${c.lat.toFixed(2)}° N, ${c.lon.toFixed(2)}° E</b> (0.1°)<br/>`;
    let t = `${head}${from} → ${clampTo}: <b>${f(c.total)}</b> harmonized detections`;
    if (density?.mode === 'anomaly') {
      const p = pctOf(c);
      const d = c.total - c.typical;
      t += `<br/>Typical (median of ${density.nRef} reference years' own totals): ${f(c.typical)}<br/>`;
      t += !(c.typical >= MIN_TYPICAL) ? `Too few fires to compare (typical below ${MIN_TYPICAL} detections)`
        : `Difference: <b>${d >= 0 ? '+' : '−'}${f(Math.abs(d))}</b> detections (${p >= 0 ? '+' : ''}${Math.round(p)} % vs typical)`;
    }
    return t;
  };
  // Title/footer for exported charts and the export file name: <area>_<from>_<to>_<view>
  const stampFor = (view) => {
    const areaName = (sel?.name || 'Selected area').split(' — ')[0];
    const slug = areaName.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'area';
    const w = windowSummary(meta, agg.h, from, clampTo, ref, skipT && meta.hasRegime);
    const viewName = { calendar: 'Burning-activity calendar', history: 'Daily detections vs typical', anomaly: 'Daily anomaly vs typical' }[view] || '';
    const soFar = sel?.season && clampTo === meta.end && from.slice(5) === sel.season[0] ? ' (season so far)' : '';
    const cmpTxt = [w.lt && `${pctTxt(w.lt.pct)} vs long-term typical`, w.l5 && `${pctTxt(w.l5.pct)} vs last 5 years`].filter(Boolean).join(', ');
    return {
      base: `${slug}_${from}_${clampTo}`,
      title: [`${viewName}: ${sel?.name || 'Selected area'}`, `${from} → ${clampTo}${soFar} · total ${fmt(w.total)} harmonized detections${cmpTxt ? ` (${cmpTxt})` : ''}`],
      footer: [`Reference years ${ref[0]}–${ref[1]} · data v${meta.rawVersion} (${meta.h_status || ''}) · harmonized = S-NPP-VIIRS-equivalent detections`,
        'NASA FIRMS MODIS/VIIRS · nasa-space-app-2026.web.app'],
    };
  };
  const copyLink = () => {
    const done = () => { setCopied(true); setTimeout(() => setCopied(false), 1800); };
    try { navigator.clipboard.writeText(location.href).then(done, () => window.prompt('Copy this link:', location.href)); }
    catch { window.prompt('Copy this link:', location.href); }
  };
  const viewYear = +from.slice(0, 4);
  const rangeSrc = useMemo(() => (meta && rangeOk ? regimeText(regimeOf(meta, idxOf(meta, from), idxOf(meta, clampTo))) : ''), [meta, rangeOk, from, clampTo]);
  const overlay = useMemo(() => (meta ? domainOverlay(meta) : null), [meta]);
  const refText = ref ? `Reference years ${ref[0]}–${ref[1]}${ref[0] <= 2002 ? ' (includes lower-confidence years)' : ''}, each day's own year left out${skipT && meta?.hasRegime ? ', Terra-only days left out' : ''}` : '';

  const pickPreset = (p) => { const d = presetDates(p, meta); setSel(p); setFrom(d.from); setTo(d.to); };
  const yrs = meta ? yearsOf(meta) : null;
  const yearOpts = yrs ? Array.from({ length: yrs.y1 - yrs.y0 + 1 }, (_, i) => yrs.y0 + i) : [];

  if (page === 'about') return <About meta={meta} />;

  return (
    <div className="app">
      <header>
        <h1>India Fire Calendar</h1>
        <p className="sub">Harmonized NASA MODIS + VIIRS active-fire hotspots, 2000–2026 · <a href="#about">Methods &amp; data</a></p>
        {meta?.h_status?.startsWith('provisional') && <p className="mock">Provisional harmonization (constant-ratio baseline).</p>}
        {meta?.h_status?.startsWith('final') && <p className="okline"><a href="#about">Harmonized record v{meta.rawVersion.split('.').slice(0, 2).join('.')}: validated on held-out years; accuracy shown per year (see Methods)</a></p>}
      </header>
      {err && <p className="err">Error: {err}</p>}
      <section className="controls">
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.id} className={sel?.id === p.id ? 'on' : ''} aria-pressed={sel?.id === p.id} title={p.title} onClick={() => pickPreset(p)}>{p.name}</button>
          ))}
          <span className="hint">or draw an area on the map (tools top-right)</span>
        </div>
        <div className="dates">
          <label>From <input type="date" value={from} min={meta?.start} max={meta?.end} onChange={(e) => setFrom(e.target.value)} /></label>
          <label>To <input type="date" value={to} min={meta?.start} onChange={(e) => setTo(e.target.value)} /></label>
          {meta && !rangeOk && <span className="err">Pick dates between {meta.start} and {meta.end}, with From ≤ To.</span>}
        </div>
      </section>
      <MapPanel selection={sel} onSelect={(s) => setSel(s)} overlay={overlay} density={density} describeCell={describeCell} />
      <MapLegend mode={mapMode} setMode={setMapMode} density={density} anomalyOk={anomalyOk} from={from} to={clampTo} />
      <section className="summary" aria-live="polite">
        <strong>{sel?.name || 'No area'}</strong>
        {busy && <span> · computing…</span>}
        {totals && !busy && (
          <span> · {from} → {clampTo}{sel?.season && clampTo === meta.end && from.slice(5) === sel.season[0] && to <= meta.end && <b className="sofar"> · season so far (data through {nice(meta.end.slice(5))} {meta.end.slice(0, 4)})</b>} · <b>{fmt(totals.h)}</b> harmonized detections<span className="xtra"> · {agg.nCells.toLocaleString('en-US')} of {agg.nSel.toLocaleString('en-US')} cells (0.1°) have data</span>
            {totals.noCov > 0 && <> · {totals.noCov} days without coverage</>}<span className="xtra"> · {ms} ms</span>
            {meta.h_status?.startsWith('provisional') && <span className="prov"> · provisional harmonization</span>}</span>
        )}
      </section>
      <div className="sharebar"><button className="small" onClick={copyLink}>{copied ? '✓ Link copied' : 'Copy link to this view'}</button></div>
      {agg && agg.nCells === 0 && !busy && <p className="err">No data here: this area is outside the data domain (shaded grey on the map). Select an area inside India.</p>}
      <details className="howto">
        <summary>How to read this</summary>
        <ul>
          <li><b>Pick an area and dates.</b> Use a preset, or draw a rectangle or polygon on the map. Areas shaded <span className="legend-inline" /> grey on the map have no data.</li>
          <li><b>Calendar:</b> each row is a year and each square a day; darker means more fire detections. Your year is outlined, so you can compare it with history at a glance. Hatched grey = no satellite coverage that day (unknown, not zero).</li>
          <li><b>Historical patterns:</b> your days (black) against the typical value (dashed median) and the usual range (blue band).</li>
          <li><b>Unusual conditions:</b> orange bars = more burning than usual, blue = less.</li>
          <li><b>Critical periods:</b> when the fire season usually starts, peaks and ends here, and whether a year was early, late, or above or below normal.</li>
          <li>Values are <i>harmonized</i>: every year is expressed as the detections one S-NPP VIIRS satellite would record, so 2005 and 2025 can be compared. Detections are hotspots, not burned area. See <a href="#about">Methods</a>.</li>
        </ul>
      </details>
      <nav className="tabs" aria-label="Views">
        {TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </nav>
      {['history', 'unusual', 'critical', 'download'].includes(tab) && ref && (
        <div className="opts">
          <label>Reference years <select value={ref[0]} onChange={(e) => setRef([+e.target.value, Math.max(+e.target.value, ref[1])])}>{yearOpts.map((y) => <option key={y} value={y}>{y}{lowConf(y) ? ' (lower confidence)' : ''}</option>)}</select>
            – <select value={ref[1]} onChange={(e) => setRef([Math.min(ref[0], +e.target.value), +e.target.value])}>{yearOpts.map((y) => <option key={y} value={y}>{y}{lowConf(y) ? ' (lower confidence)' : ''}</option>)}</select></label>
          <span className="hint">(each day's own year is always left out)</span>
          {meta?.hasRegime && <label className="chk inl"><input type="checkbox" checked={skipT} onChange={(e) => setSkipT(e.target.checked)} /> Leave out Terra-only days (before Jul 2002)</label>}
          <label>Smoothing <select value={win} onChange={(e) => setWin(+e.target.value)}><option value={1}>none</option><option value={7}>7-day</option><option value={15}>15-day</option></select></label>
        </div>
      )}
      <section className="panel">
        {!meta || !agg ? (
          <div className="loading" role="status">
            <div className="spinner" aria-hidden="true" />
            <p>Loading fire data for this area{prog && prog.n ? ` (${prog.d} of ${prog.n} map tiles)` : ''}…</p>
            {prog && prog.n > 0 && <div className="bar"><div style={{ width: `${(100 * prog.d) / prog.n}%` }} /></div>}
            <p className="note">The first load downloads about 1–2 MB; after that it's instant.</p>
          </div>
        ) : !rangeOk ? <p>Choose a valid date range.</p> : (
          <>
            <div style={{ display: tab === 'calendar' ? 'block' : 'none' }}>
              <p className="note">
                {idxOf(meta, clampTo) - idxOf(meta, from) < 366
                  ? 'Each row is a year and each column a day of your window. The outlined row is your year; the rest show the historical pattern.'
                  : 'Each row is a year (Jan–Dec). Days outside your range are blank.'} Tap a cell for its value.
              </p>
              <Calendar meta={meta} series={agg.h} raw={agg.raw} from={from} to={clampTo} svgRef={calRef} />
            </div>
            {tab === 'history' && cmp && (
              <>
                <p className="refline">{refText}.</p>
                {rangeSrc && <p className="srcline">Data source in your range: <b>{rangeSrc}</b>. <AccLegend /></p>}
                <p className="note">Historical patterns: daily harmonized detections in your range, against the median and middle 50 % of the same calendar days in the reference years.</p>
                <label className="chk"><input type="checkbox" checked={showRaw} onChange={(e) => setShowRaw(e.target.checked)} /> Show raw per-sensor counts (not harmonized)</label>
                <LineChart meta={meta} cmp={cmp} raw={agg.raw} showRaw={showRaw} svgRef={lineRef} label={win > 1 ? `harmonized (${win}-day mean)` : 'harmonized'} />
              </>
            )}
            {tab === 'unusual' && cmp && (
              <>
                <p className="refline">{refText}.</p>
                {rangeSrc && <p className="srcline">Data source in your range: <b>{rangeSrc}</b>. <AccLegend /></p>}
                <p className="note">Unusual conditions: how far each day sits above or below the median of the reference years.</p>
                <div className="seg">
                  <button className={anomMode === 'diff' ? 'on' : ''} onClick={() => setAnomMode('diff')}>Difference</button>
                  <button className={anomMode === 'pct' ? 'on' : ''} onClick={() => setAnomMode('pct')}>% vs median</button>
                </div>
                <AnomalyChart meta={meta} cmp={cmp} mode={anomMode} svgRef={anomRef} />
                <AnomSummary cmp={cmp} meta={meta} h={agg.h} from={from} to={clampTo} refY={ref} skipT={skipT && meta.hasRegime} ph={sel?.id === 'ph'} />
              </>
            )}
            {tab === 'critical' && crit && <><p className="refline">Typical season from reference years {ref[0]}–{ref[1]}{ref[0] <= 2002 ? ' (includes lower-confidence years)' : ''}.</p><NowNext meta={meta} h={agg.h} crit={crit} refY={ref} skipT={skipT && meta.hasRegime} /><Critical crit={crit} viewYear={viewYear} meta={meta} /></>}
            {tab === 'sensors' && totals && (
              <>
                <p className="note">The raw per-sensor counts behind the harmonized value. Satellites have different swaths and pixel sizes, so raw counts can't be compared directly; that is why the record is harmonized.</p>
                <table className="sens">
                  <thead><tr><th>Series ({from} → {clampTo})</th><th>Total</th></tr></thead>
                  <tbody>
                    <tr><td><b>{meta.harmonized_label}</b></td><td><b>{fmt(totals.h)}</b></td></tr>
                    {SENSORS.map((s) => <tr key={s}><td>{SENSOR_LABELS[s]} (raw)</td><td>{fmt(totals.raw[s])}</td></tr>)}
                  </tbody>
                </table>
                <p className="note">Data version {meta.version}.</p>
              </>
            )}
            {tab === 'download' && (
              <div className="dl">
                <button onClick={() => downloadCSV({ meta, agg, sel, from, to: clampTo, cmp, ref, win, skipT: skipT && meta.hasRegime, fileBase: stampFor('x').base })}>CSV: daily series</button>
                <button onClick={() => { const st = stampFor('calendar'); downloadSVG(calRef.current, `${st.base}_calendar.svg`, st); }}>Calendar SVG</button>
                <button onClick={() => { const st = stampFor('calendar'); downloadPNG(calRef.current, `${st.base}_calendar.png`, st); }}>Calendar PNG</button>
                <ChartDl meta={meta} cmp={cmp} raw={agg.raw} win={win} stampFor={stampFor} />
              </div>
            )}
          </>
        )}
      </section>
      <footer>Data: NASA FIRMS (MODIS C6.1; VIIRS S-NPP and NOAA-20 C2). Data version {meta?.version || '…'}. Map © OpenStreetMap contributors.</footer>
    </div>
  );
}

// Hidden-render charts for the Download tab, so they can be exported without visiting their tabs.
function ChartDl({ meta, cmp, raw, win, stampFor }) {
  const l = useRef(null), a = useRef(null);
  if (!cmp) return null;
  return (
    <>
      <button onClick={() => { const st = stampFor('history'); downloadSVG(l.current, `${st.base}_history.svg`, st); }}>Line chart SVG</button>
      <button onClick={() => { const st = stampFor('history'); downloadPNG(l.current, `${st.base}_history.png`, st); }}>Line chart PNG</button>
      <button onClick={() => { const st = stampFor('anomaly'); downloadSVG(a.current, `${st.base}_anomaly.svg`, st); }}>Anomaly SVG</button>
      <button onClick={() => { const st = stampFor('anomaly'); downloadPNG(a.current, `${st.base}_anomaly.png`, st); }}>Anomaly PNG</button>
      <div style={{ position: 'absolute', left: -9999, width: 720 }} aria-hidden="true">
        <LineChart meta={meta} cmp={cmp} raw={raw} showRaw={false} svgRef={l} label={win > 1 ? `harmonized (${win}-day mean)` : 'harmonized'} />
        <AnomalyChart meta={meta} cmp={cmp} mode="diff" svgRef={a} />
      </div>
    </>
  );
}

// One-line comparison of a window total with a baseline (median of each year's own window total).
export function vsText(total, base) {
  if (!base || !base.n) return null;
  const pct = base.median > 0 ? Math.round((100 * (total - base.median)) / base.median) : null;
  return { pct, median: base.median, n: base.n, years: base.years };
}
export function windowSummary(meta, h, from, to, ref, skipT) {
  const a = idxOf(meta, from), b = idxOf(meta, to), L = b - a + 1;
  let total = 0, cov = 0;
  for (let di = a; di <= b; di++) if (!Number.isNaN(h[di])) { total += h[di]; cov++; }
  const bl = L <= 366 ? baselines(meta, h, from, L, ref[0], ref[1], skipT) : null;
  return { total, cov, L, lt: bl && vsText(total, bl.longTerm), l5: bl && vsText(total, bl.last5) };
}
const pctTxt = (p) => (p == null ? '' : `${p >= 0 ? '+' : ''}${p} %`);
const yrsTxt = (ys) => (ys.length ? `${Math.min(...ys)}–${Math.max(...ys)}` : '');

const CAVEAT = 'Satellites pass around 10:30 and 13:30 (VIIRS ~13:30). Fires lit later in the day may be missed, so part of a drop can reflect a shift in burning time.';

function AnomSummary({ cmp, meta, h, from, to, refY, skipT, ph }) {
  let above = 0, below = 0;
  for (let k = 0; k < cmp.value.length; k++) {
    if (Number.isNaN(cmp.value[k]) || Number.isNaN(cmp.median[k])) continue;
    if (cmp.value[k] > cmp.p75[k]) above++; else if (cmp.value[k] < cmp.p25[k]) below++;
  }
  const w = windowSummary(meta, h, from, to, refY, skipT);
  return (
    <>
      <p className="note">
        Over {w.cov} covered days the total is <b>{fmt(w.total)}</b>.{' '}
        {w.lt ? <>Vs long-term (median of {w.lt.n} reference years' own totals, {refY[0]}–{refY[1]}): <b>{fmt(w.lt.median)}</b> → <b>{pctTxt(w.lt.pct)}</b>. </> : <>Pick a range of up to one year to compare totals with other years. </>}
        {w.l5 && <>Vs last 5 complete years ({yrsTxt(w.l5.years)}): <b>{fmt(w.l5.median)}</b> → <b>{pctTxt(w.l5.pct)}</b>. </>}
        {above} days were above the usual daily range (75th percentile) and {below} below it (25th).
      </p>
      <p className={ph ? 'caveat strong' : 'caveat'}>{ph && <b>Caution: </b>}{CAVEAT}</p>
    </>
  );
}

function MapLegend({ mode, setMode, density, anomalyOk, from, to }) {
  const eff = mode === 'anomaly' && !anomalyOk ? 'total' : mode;
  return (
    <div className="maplegend">
      <div className="seg" role="group" aria-label="Map layer">
        <span className="lbl">Where:</span>
        <button className={eff === 'total' ? 'on' : ''} aria-pressed={eff === 'total'} onClick={() => setMode('total')}>Fire density</button>
        <button className={eff === 'anomaly' ? 'on' : ''} aria-pressed={eff === 'anomaly'} disabled={!anomalyOk}
          title={anomalyOk ? '' : 'Pick a range of up to one year to compare with typical years'} onClick={() => setMode('anomaly')}>Anomaly vs typical</button>
        <button className={mode === 'off' ? 'on' : ''} aria-pressed={mode === 'off'} onClick={() => setMode('off')}>Hide</button>
      </div>
      {density && eff === 'total' && (
        <div className="lg">
          <span className="sw0" /> 0
          {RAMP.map((c) => <span key={c} className="swr" style={{ background: c }} />)}
          <span> {Math.round(density.max).toLocaleString('en-US')} detections per 0.1° cell, {from} → {to} (log scale)</span>
        </div>
      )}
      {density && eff === 'anomaly' && (
        <div className="lg lgdiv">
          {DIV.colors.map((c, i) => <span key={c} className="bin"><span className="swd" style={{ background: c }} /><span className="bl">{DIV_LABELS[i]}</span></span>)}
          <span className="bin"><span className="swd" style={{ background: 'rgba(150,150,150,.6)' }} /><span className="bl">too few to compare</span></span>
          <span className="lgtxt">% vs typical (median of {density.nRef} reference years' own totals for the same days). Blue: below typical; orange: above. Grey: typical under {MIN_TYPICAL} detections in the cell.</span>
        </div>
      )}
      {mode !== 'off' && <p className="note">Tap a cell on the map for its numbers. Grey outside the coloured area means no data.</p>}
    </div>
  );
}

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const doyOf = (mmdd) => { const [m, d] = mmdd.split('-').map(Number); return Math.round((Date.UTC(2001, m - 1, Math.min(d, m === 2 ? 28 : d)) - Date.UTC(2001, 0, 1)) / 864e5); };
const nice = (mmdd) => { const [m, d] = mmdd.split('-').map(Number); return `${d} ${MON[m - 1]}`; };

// "Now & next": the latest 30 days vs typical, and where the latest data date sits relative to the typical critical periods.
// Based on past patterns (median of reference years); not a forecast.
function NowNext({ meta, h, crit, refY: ref, skipT }) {
  const end = meta.n_days - 1;
  const endIso = meta.end;
  const ey = +endIso.slice(0, 4);
  const W = 30;
  const startIso = isoOf(meta, end - W + 1);
  const w = windowSummary(meta, h, startIso, endIso, ref, skipT);
  const cur = w.total, curDays = w.cov;
  const med = w.lt ? w.lt.median : NaN;
  const pct = w.lt ? w.lt.pct : null;
  const verdictTxt = pct == null ? (cur > 0 ? 'burning where there usually is none' : 'quiet, as usual')
    : pct >= 25 ? 'above typical' : pct <= -25 ? 'below typical' : 'near typical';

  // Now & next speaks about the MAIN season (largest typical total); other seasons get one secondary line.
  const doy = doyOf(endIso.slice(5));
  const ps = crit.periods.map((p) => ({ ...p, s: doyOf(p.start), e: doyOf(p.end), k: doyOf(p.peak) }));
  const main = ps.length ? ps.reduce((x, y) => ((y.typicalTotal || 0) > (x.typicalTotal || 0) ? y : x)) : null;
  const daysUntil = (d) => (d > doy ? d - doy : d + 365 - doy);
  let season = null;
  if (!main) season = <>No recurring critical period in this area.</>;
  else if (doy >= main.s && doy <= main.e) {
    const toPeak = main.k - doy, toEnd = main.e - doy;
    season = <>Now <b>inside the main critical period</b> ({nice(main.start)} – {nice(main.end)}). {toPeak > 0
      ? <>Peak usually around <b>{nice(main.peak)}</b> (in {toPeak} days).</>
      : <>The typical peak ({nice(main.peak)}) was {-toPeak} days ago; the period usually ends around <b>{nice(main.end)}</b> (in {toEnd} days).</>}</>;
  } else {
    const inDays = daysUntil(main.s);
    const toPeak = inDays + ((main.k - main.s + 365) % 365);
    season = <>Next <b>main critical period</b>: starts around <b>{nice(main.start)}</b> (in {inDays} days), peaks around <b>{nice(main.peak)}</b> (in {toPeak} days).</>;
  }
  const others = ps.filter((p) => p !== main);
  const otherInside = others.find((p) => doy >= p.s && doy <= p.e);
  const otherNext = others.length ? [...others].sort((x, y) => daysUntil(x.s) - daysUntil(y.s))[0] : null;
  const secondary = otherInside ? <>Also now inside a smaller season ({nice(otherInside.start)} – {nice(otherInside.end)}).</>
    : otherNext ? <>Smaller season{others.length > 1 ? 's' : ''}: {others.map((p) => `${nice(p.start)} – ${nice(p.end)}`).join('; ')}.</> : null;

  return (
    <div className="nownext" role="region" aria-label="Now and next">
      <h3>Now &amp; next <span className="tag">based on past patterns, not a forecast</span></h3>
      <p>Data through <b>{nice(endIso.slice(5))} {ey}</b> (latest available).</p>
      <p>Last 30 days ({nice(startIso.slice(5))} – {nice(endIso.slice(5))}): <b>{fmt(cur)}</b> detections. Vs long-term ({ref[0]}–{ref[1]}) typical <b>{fmt(med)}</b>
        {pct != null && <> ({pctTxt(pct)})</>}: <b className={pct != null && pct >= 25 ? 'up' : pct != null && pct <= -25 ? 'down' : ''}>{verdictTxt}</b>.
        {w.l5 && <> Vs last 5 complete years ({yrsTxt(w.l5.years)}): {fmt(w.l5.median)} ({pctTxt(w.l5.pct)}).</>}
        {curDays < W && <> {W - curDays} days had no coverage.</>}</p>
      <p>{season}</p>
      {secondary && <p className="note">{secondary}</p>}
      <p className="note">Typical = median, over reference years, of each year's own total for the same calendar days. Critical periods: recurring seasons, each running while typical burning stays at or above 25 % of its own peak.</p>
    </div>
  );
}

function AccLegend() {
  return (
    <details className="acc">
      <summary>What do the data-source labels mean?</summary>
      <ul>{legendLines().map((l) => <li key={l}>{l}</li>)}</ul>
      <p className="note">Typical errors come from {ACCURACY.source}.</p>
    </details>
  );
}

function Critical({ crit, viewYear, meta }) {
  const srcOf = (p, y) => {
    const a = idxOf(meta, `${y}-${p.start}`), b = idxOf(meta, `${y}-${p.end}`);
    return regimeOf(meta, a, b);
  };
  if (!crit.periods.length) return <p className="note">No recurring fire season was found for this area.</p>;
  return (
    <>
      <p className="note">Critical periods: the recurring fire seasons in this area. Each season runs while typical burning (multi-year median of the reference years, 15-day smoothed) stays at or above 25 % of that season's own peak. For each year: the peak date (7-day mean), and the total compared with a typical season.</p>
      {crit.periods.map((p, i) => {
        const vy = p.years.find((y) => y.year === viewYear);
        return (
          <div key={i} className="crit">
            <h3>Season {i + 1}: {p.start} → {p.end}, typical peak {p.peak}{crit.periods.length > 1 && p.typicalTotal === Math.max(...crit.periods.map((q) => q.typicalTotal)) ? ' · main season' : ''}</h3>
            {vy && <p><b>{viewYear}</b> · {regimeText(srcOf(p, viewYear))}: peak {vy.peak?.slice(5) || '—'} · total {fmt(vy.total)} ({Math.round(vy.pctOfTypical)} % of typical) · <b>{verdict(vy)}</b>{vy.partial && ' · season not complete in record'}</p>}
            <div className="tablewrap">
              <table className="sens">
                <thead><tr><th>Year</th><th>Peak</th><th>vs typical</th><th>Total</th><th>% typical</th><th>Verdict</th><th>Data source</th></tr></thead>
                <tbody>
                  {p.years.map((y) => (
                    <tr key={y.year} className={y.year === viewYear ? 'hl' : ''}>
                      <td>{y.year}{y.partial ? '*' : ''}{lowConf(y.year) ? ' †' : ''}</td><td>{y.peak?.slice(5) || '—'}</td>
                      <td>{y.shift == null ? '—' : y.shift === 0 ? '0 d' : `${y.shift > 0 ? '+' : ''}${y.shift} d`}</td>
                      <td>{fmt(y.total)}</td><td>{Number.isNaN(y.pctOfTypical) ? '—' : Math.round(y.pctOfTypical)}</td><td className="v">{verdict(y)}</td><td className="v src">{regimeText(srcOf(p, y.year))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AccLegend />
            <p className="note">† lower confidence (Terra-only years, before Aqua joined in July 2002; harmonized from MODIS ratios). * season not fully inside the record. Negative = earlier than typical. Days without coverage are left out of totals. Seasons that span New Year appear as two parts.</p>
          </div>
        );
      })}
    </>
  );
}

function About({ meta }) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    fetch('data/METHODS.md').then((r) => (r.ok ? r.text() : null)).then((t) => setHtml(t ? mdToHtml(t) : '')).catch(() => setHtml(''));
  }, []);
  return (
    <div className="app about">
      <p><a href="#">← Back to the calendar</a></p>
      <h1>Methods &amp; data</h1>
      <p className="note">Data version {meta?.version || '…'}. The section below comes straight from the data team's methods notes (data/processed/METHODS.md).</p>
      {html === null ? <p>Loading…</p> : html ? <div className="md" dangerouslySetInnerHTML={{ __html: html }} /> : <p className="slot">Methods notes not found in this build.</p>}
      {meta?.h_method && (
        <>
          <h2>Harmonized value in this version</h2>
          <p>Data version {meta.rawVersion}: {meta.h_method}.</p>
        </>
      )}
      {meta?.h_ratios && !meta?.h_method && (
        <>
          <h2>Harmonized value in this version</h2>
          <p>Expressed as S-NPP VIIRS-equivalent detections. {meta.h_status?.startsWith('provisional') ? 'Provisional baseline' : 'Method'}: S-NPP where it flew; otherwise NOAA-20 × {meta.h_ratios.noaa20?.toFixed(3)}; otherwise (Terra + Aqua) × {meta.h_ratios.modis_ta?.toFixed(2)}; otherwise Terra × {meta.h_ratios.terra?.toFixed(2)} or Aqua × {meta.h_ratios.aqua?.toFixed(2)}. India-wide ratios from days both satellites flew.</p>
        </>
      )}
      <h2>How the app uses the data</h2>
      <ul>
        <li><b>Area:</b> an area includes every 0.1° cell whose centre lies inside it. Cells outside the data domain (outside India, or no detection in 26 years) are no data; they are shaded grey on the map and never counted as zero.</li>
        <li><b>No coverage vs zero:</b> a day with no data from any satellite is "no coverage". It is shown hatched or shaded grey and left out of medians, anomalies and totals. A covered day with no detection counts as zero.</li>
        <li><b>Median and usual range:</b> for each day, the median and 25th–75th percentiles of the same calendar day (29 Feb treated as 28 Feb) across the reference years, always leaving out that day's own year. The default reference years are 2003 onward, and Terra-only days (before July 2002) are left out of medians by default because their daily values are unreliable. Years 2000–2002 are marked lower confidence. Each day in the CSV carries its regime (viirs, modis_ta, terra_only).</li>
        <li><b>Anomaly:</b> value minus median, or as a percentage of the median. Optional 7- or 15-day centred smoothing.</li>
        <li><b>Critical periods:</b> each recurring season is found around its own peak in the 15-day-smoothed median and runs while the median stays at or above 25 % of that peak. Seasons holding under 5 % of a typical year's detections are ignored. Each year's peak is the highest 7-day mean within the season, searched 15 days beyond its typical bounds. Early or late means more than 5 days from the typical peak. Above or below normal means more than 125 % or less than 75 % of the typical total. A typical total is always the median, over the reference years, of each year's own total for the same days or season (the year being judged is left out), never a sum of daily medians. Summaries also compare with the last 5 complete years.</li>
        <li><b>Presets</b> are simple latitude/longitude boxes, not administrative boundaries.</li>
      </ul>
      <h2>Credits</h2>
      <p>We acknowledge the use of data and imagery from NASA's Fire Information for Resource Management System (FIRMS), part of NASA's Earth Science Data and Information System (ESDIS). Base map © OpenStreetMap contributors. Built for the NASA Space Apps Challenge 2026: "Harmonization of MODIS and VIIRS Hot Spots".</p>
    </div>
  );
}
