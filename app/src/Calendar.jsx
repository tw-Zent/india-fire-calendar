import { useEffect, useMemo, useState } from 'react';
import { ACCURACY, LEGEND_KEYS, regimeOf, regimeText, dayRegimeText } from './accuracy.js';
import { idxOf, isoOf, SENSORS, SENSOR_LABELS } from './data.js';

// Colourblind-safe sequential ramp (viridis, light → dark). Zero and no-coverage are drawn separately.
export const RAMP = ['#fde725', '#a0da39', '#4ac16d', '#1fa187', '#277f8e', '#365c8d', '#46327e', '#440154'];
const ZERO = '#eef0f2';
const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];

function bins(max) {
  if (!(max > 0)) return [1];
  const out = [];
  for (let i = 1; i <= RAMP.length; i++) out.push(Math.pow(max, i / RAMP.length));
  return out; // log-spaced upper edges
}
const colorOf = (v, edges) => {
  if (Number.isNaN(v)) return null;
  if (v <= 0) return ZERO;
  for (let i = 0; i < edges.length; i++) if (v <= edges[i]) return RAMP[i];
  return RAMP[RAMP.length - 1];
};

// Builds rows. Short range (<366 d): that month-day window for every year in the record (history view).
// Long range: one row per year, full Jan–Dec, days outside the range dimmed.
export function buildGrid(meta, series, from, to) {
  const a = idxOf(meta, from), b = idxOf(meta, to);
  const span = b - a + 1;
  const rows = [];
  if (span <= 366) {
    const fy = +from.slice(0, 4);
    const wrap = +to.slice(0, 4) - fy; // 0 or 1
    const y0 = +meta.start.slice(0, 4), y1 = +meta.end.slice(0, 4);
    for (let y = y0; y <= y1; y++) {
      const s = idxOf(meta, `${y}${from.slice(4)}`);
      const cells = [];
      for (let k = 0; k < span; k++) {
        const di = s + k;
        const out = di < 0 || di >= meta.n_days;
        cells.push({ di, v: out ? undefined : series[di] });
      }
      if (cells.every((c) => c.v === undefined)) continue;
      rows.push({ label: wrap ? `${y}–${String(y + 1).slice(2)}` : String(y), cells, selected: y === fy });
    }
    return { rows, cols: span, mode: 'window', startIso: from };
  }
  const fy = +from.slice(0, 4), ty = +to.slice(0, 4);
  for (let y = fy; y <= ty; y++) {
    const s = idxOf(meta, `${y}-01-01`);
    const len = idxOf(meta, `${y + 1}-01-01`) - s;
    const cells = [];
    for (let k = 0; k < len; k++) {
      const di = s + k;
      const out = di < 0 || di >= meta.n_days || di < a || di > b;
      cells.push({ di, v: out ? undefined : series[di] });
    }
    rows.push({ label: String(y), cells, selected: false });
  }
  return { rows, cols: 366, mode: 'year', startIso: `${fy}-01-01` };
}

export default function Calendar({ meta, series, raw, from, to, svgRef }) {
  const [tip, setTip] = useState(null);
  const grid = useMemo(() => buildGrid(meta, series, from, to), [meta, series, from, to]);
  // Keyboard / tap cursor: {ri, k}. Starts on the selected row's first cell.
  const [cur, setCur] = useState(null);
  useEffect(() => { setCur(null); }, [grid]);
  const rowRegimes = useMemo(() => grid.rows.map((r) => {
    const ds = r.cells.filter((c) => c.v !== undefined).map((c) => c.di);
    return ds.length ? regimeOf(meta, ds[0], ds[ds.length - 1]) : null;
  }), [grid, meta]);
  const max = useMemo(() => {
    let mx = 0;
    for (const r of grid.rows) for (const c of r.cells) if (c.v > mx) mx = c.v;
    return mx;
  }, [grid]);
  const edges = useMemo(() => bins(max), [max]);

  const cw = grid.mode === 'window' ? Math.max(4, Math.min(14, Math.floor(640 / grid.cols))) : 2;
  const ch = grid.mode === 'window' ? Math.max(8, Math.min(14, cw)) : 10;
  const left = 62, top = 18, legendH = 34;
  const W = left + grid.cols * cw + 6;
  const H = top + grid.rows.length * ch + legendH + 8;

  // Month ticks for the header
  const ticks = [];
  grid.rows[0]?.cells.forEach((c, k) => {
    const iso = isoOf(meta, c.di);
    if (iso.endsWith('-01') || (k === 0 && grid.mode === 'window')) ticks.push({ k, label: grid.mode === 'window' ? iso.slice(5) : MONTHS[+iso.slice(5, 7) - 1] });
  });

  const describe = (ri, k) => {
    const c = grid.rows[ri]?.cells[k];
    if (!c || c.v === undefined) return null;
    const di = c.di, v = series[di];
    const val = Number.isNaN(v) ? 'no coverage' : `${(+v).toFixed(1)} harmonized detections`;
    const rawTxt = Number.isNaN(v) || !raw ? '' : SENSORS.filter((s) => !Number.isNaN(raw[s][di])).map((s) => `${SENSOR_LABELS[s]} ${raw[s][di]}`).join(' · ');
    return { date: isoOf(meta, di), val, rawTxt, reg: dayRegimeText(meta, di) };
  };
  const findCell = (ri, k, dir) => {
    const cells = grid.rows[ri]?.cells || [];
    for (let j = k; j >= 0 && j < cells.length; j += dir || 1) if (cells[j].v !== undefined) return j;
    return null;
  };
  const start = () => {
    const ri = Math.max(0, grid.rows.findIndex((r) => r.selected));
    const k = findCell(ri, 0, 1);
    return k == null ? null : { ri, k };
  };
  const onKey = (e) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    let c = cur || start();
    if (!c) return;
    if (cur) {
      let { ri, k } = c;
      if (e.key === 'ArrowLeft') k = findCell(ri, k - 1, -1) ?? k;
      if (e.key === 'ArrowRight') k = findCell(ri, k + 1, 1) ?? k;
      if (e.key === 'Home') k = findCell(ri, 0, 1) ?? k;
      if (e.key === 'End') k = findCell(ri, grid.rows[ri].cells.length - 1, -1) ?? k;
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        const nr = ri + (e.key === 'ArrowUp' ? -1 : 1);
        if (nr >= 0 && nr < grid.rows.length) { const nk = findCell(nr, Math.min(k, grid.rows[nr].cells.length - 1), -1) ?? findCell(nr, k, 1); if (nk != null) { ri = nr; k = nk; } }
      }
      c = { ri, k };
    }
    setCur(c); setTip(null);
  };
  const onTap = (e) => {
    const t = e.target;
    if (!t.dataset || t.dataset.ri === undefined) return;
    setCur({ ri: +t.dataset.ri, k: +t.dataset.k });
  };
  const readout = cur ? describe(cur.ri, cur.k) : null;

  const onMove = (e) => {
    const t = e.target;
    if (!t.dataset || t.dataset.di === undefined) return setTip(null);
    const di = +t.dataset.di;
    const v = series[di];
    const box = e.currentTarget.getBoundingClientRect();
    setTip({ x: e.clientX - box.left, y: e.clientY - box.top, text: `${isoOf(meta, di)}: ${Number.isNaN(v) ? 'no coverage' : (+v).toFixed(1) + ' harmonized'}`, sub: [Number.isNaN(v) || !raw ? '' : SENSORS.filter((s) => !Number.isNaN(raw[s][di])).map((s) => `${SENSOR_LABELS[s]} ${raw[s][di]}`).join(' · '), dayRegimeText(meta, di)].filter(Boolean).join('\n') });
  };

  const legendY = top + grid.rows.length * ch + 10;
  return (
    <div className="cal-wrap" onMouseLeave={() => setTip(null)}>
      <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W * 1.6 }}
        onMouseMove={onMove} onClick={(e) => { onMove(e); onTap(e); }} onKeyDown={onKey} tabIndex={0} className="cal-svg"
        role="application" aria-roledescription="calendar heatmap" aria-label="Burning-activity calendar. Use the arrow keys to move between days; the value is read out below." aria-describedby="cal-readout" fontFamily="system-ui, sans-serif">
        <defs>
          <pattern id="nocov" width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="4" height="4" fill="#d0d3d6" />
            <line x1="0" y1="0" x2="0" y2="4" stroke="#9aa0a6" strokeWidth="1.5" />
          </pattern>
        </defs>
        <rect width={W} height={H} fill="#fff" />
        {ticks.map((t) => (
          <text key={t.k} x={left + t.k * cw} y={12} fontSize="9" fill="#555">{t.label}</text>
        ))}
        {grid.rows.map((r, ri) => (
          <g key={r.label}>
            <text x={left - 4} y={top + ri * ch + ch - 2} fontSize={Math.min(9, ch)} textAnchor="end" fill={r.selected ? '#000' : '#444'} fontWeight={r.selected ? 700 : 400}>{r.label}</text>
            {rowRegimes[ri] && (
              <rect x={3} y={top + ri * ch + 1} width={7} height={Math.max(ch - 3, 4)} stroke="#666" strokeWidth="0.5"
                fill={rowRegimes[ri].mixed ? ACCURACY.swatch.mixed : ACCURACY.swatch[rowRegimes[ri].key]}>
                <title>{`${r.label}: ${regimeText(rowRegimes[ri])}`}</title>
              </rect>
            )}
            {r.cells.map((c, k) => {
              if (c.v === undefined) return null;
              const col = colorOf(c.v, edges);
              return <rect key={k} data-di={c.di} data-ri={ri} data-k={k} x={left + k * cw} y={top + ri * ch} width={cw - (cw > 3 ? 1 : 0)} height={ch - 1} fill={col || 'url(#nocov)'} />;
            })}
            {cur && cur.ri === ri && <rect x={left + cur.k * cw - 1} y={top + ri * ch - 1} width={cw + 1} height={ch + 1} fill="none" stroke="#D55E00" strokeWidth="2" pointerEvents="none" />}
            {r.selected && <rect x={left - 1} y={top + ri * ch - 1} width={grid.cols * cw + 1} height={ch + 1} fill="none" stroke="#000" strokeWidth="1" />}
          </g>
        ))}
        <g transform={`translate(${left},${legendY})`} fontSize="9" fill="#333">
          <rect x="0" y="0" width="10" height="10" fill="url(#nocov)" /><text x="13" y="9">no coverage</text>
          <rect x="78" y="0" width="10" height="10" fill={ZERO} stroke="#ccc" /><text x="91" y="9">0</text>
          {RAMP.map((c, i) => <rect key={c} x={110 + i * 22} y="0" width="22" height="10" fill={c} />)}
          <text x="110" y="21">&gt;0</text>
          <text x={110 + RAMP.length * 22} y="21" textAnchor="end">{max > 0 ? max.toFixed(0) : '—'}</text>
          <text x={116 + RAMP.length * 22} y="9">hotspots/day (log scale)</text>
        </g>
      </svg>
      <p id="cal-readout" className="readout" aria-live="polite">
        {readout ? <><b>{readout.date}</b> · {readout.val}{readout.rawTxt && <> · {readout.rawTxt}</>}{readout.reg && <> · <i>{readout.reg}</i></>}</>
          : 'Tap a day, or focus the calendar and use the arrow keys, to read its value here.'}
      </p>
      <p className="reglegend">
        Year marker (left edge) = data source:{' '}
        {LEGEND_KEYS.map((k) => { const c = ACCURACY.regimes[k]; return (
          <span key={k}><span className="sw" style={{ background: ACCURACY.swatch[k] }} />{c.label}{c.conf ? ` (${c.conf})` : ''}{c.reference ? ' (reference)' : c.monthly ? `, ±${c.monthly} monthly` : ''} </span>
        ); })}
        <span><span className="sw" style={{ background: ACCURACY.swatch.mixed }} />mixed</span>
      </p>
      {tip && <div className="tip" style={{ left: Math.min(tip.x + 10, 200), top: tip.y + 12 }}>{tip.text}{tip.sub && <><br />{tip.sub}</>}</div>}
    </div>
  );
}
