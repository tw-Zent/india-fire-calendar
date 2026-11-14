import { useState } from 'react';
import { isoOf, SENSORS, SENSOR_LABELS } from './data.js';

// Okabe–Ito (colourblind-safe)
export const OI = { value: '#000000', median: '#0072B2', band: '#56B4E9', above: '#D55E00', below: '#0072B2',
  t: '#E69F00', a: '#CC79A7', s: '#009E73', n: '#F0E442' };
const W = 720, H = 260, L = 52, R = 10, T = 12, B = 34;

function niceMax(v) {
  if (!(v > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= v);
}
const fmt = (v) => (Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : `${+v.toFixed(1)}`);

function xTicks(meta, a, n) {
  const ticks = [];
  const long = n > 400;
  for (let k = 0; k < n; k++) {
    const iso = isoOf(meta, a + k);
    if (long ? iso.endsWith('-01-01') : iso.endsWith('-01') || (n <= 62 && iso.endsWith('-15'))) ticks.push({ k, label: long ? iso.slice(0, 4) : iso.slice(5) });
  }
  if (ticks.length > 14) { const step = Math.ceil(ticks.length / 12); return ticks.filter((_, i) => i % step === 0); }
  return ticks;
}

function Frame({ meta, a, n, ymin, ymax, ylabel, children, svgRef, title, noCov }) {
  const x = (k) => L + ((W - L - R) * (k + 0.5)) / n;
  const y = (v) => T + (H - T - B) * (1 - (v - ymin) / (ymax - ymin));
  const ticksY = [0, 0.25, 0.5, 0.75, 1].map((f) => ymin + f * (ymax - ymin));
  const bw = (W - L - R) / n;
  return (
    <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={title} fontFamily="system-ui, sans-serif">
      <rect width={W} height={H} fill="#fff" />
      {noCov.map((k) => <rect key={'nc' + k} x={L + k * bw} y={T} width={Math.max(bw, 1)} height={H - T - B} fill="#d0d3d6" opacity="0.6" />)}
      {ticksY.map((v, i) => (
        <g key={i}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#eee" /><text x={L - 4} y={y(v) + 3} fontSize="9" textAnchor="end" fill="#555">{fmt(v)}</text></g>
      ))}
      {ymin < 0 && <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#888" />}
      {xTicks(meta, a, n).map((t) => <text key={t.k} x={x(t.k)} y={H - B + 13} fontSize="9" textAnchor="middle" fill="#555">{t.label}</text>)}
      <text x={12} y={T + (H - T - B) / 2} fontSize="9" fill="#555" transform={`rotate(-90 12 ${T + (H - T - B) / 2})`} textAnchor="middle">{ylabel}</text>
      {children({ x, y, bw })}
    </svg>
  );
}

const path = (arr, x, y) => {
  let d = '', pen = false;
  for (let k = 0; k < arr.length; k++) {
    const v = arr[k];
    if (Number.isNaN(v)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(k).toFixed(1)},${y(v).toFixed(1)}`; pen = true;
  }
  return d;
};

export function LineChart({ meta, cmp, raw, showRaw, svgRef, label }) {
  const n = cmp.value.length;
  let mx = 0;
  for (let k = 0; k < n; k++) for (const v of [cmp.value[k], cmp.p75[k]]) if (v > mx) mx = v;
  const rawSlices = showRaw ? SENSORS.map((s) => [s, raw[s].slice(cmp.a, cmp.b + 1)]) : [];
  for (const [, arr] of rawSlices) for (const v of arr) if (v > mx) mx = v;
  const noCov = []; for (let k = 0; k < n; k++) if (Number.isNaN(cmp.value[k])) noCov.push(k);
  return (
    <Frame meta={meta} a={cmp.a} n={n} ymin={0} ymax={niceMax(mx)} ylabel="detections / day" svgRef={svgRef} title="Daily line chart with median band" noCov={noCov}>
      {({ x, y }) => {
        let band = '';
        const up = [], dn = [];
        for (let k = 0; k < n; k++) if (!Number.isNaN(cmp.p75[k])) { up.push(`${x(k).toFixed(1)},${y(cmp.p75[k]).toFixed(1)}`); dn.unshift(`${x(k).toFixed(1)},${y(cmp.p25[k]).toFixed(1)}`); }
        if (up.length) band = `M${up.join('L')}L${dn.join('L')}Z`;
        return (
          <g>
            <path d={band} fill={OI.band} opacity="0.35" />
            <path d={path(cmp.median, x, y)} fill="none" stroke={OI.median} strokeWidth="1.8" strokeDasharray="5 3" />
            {rawSlices.map(([s, arr]) => <path key={s} d={path(arr, x, y)} fill="none" stroke={OI[s]} strokeWidth="1" />)}
            <path d={path(cmp.value, x, y)} fill="none" stroke={OI.value} strokeWidth="1.6" />
            <g transform={`translate(${L + 4},${T + 4})`} fontSize="9">
              <rect width="10" height="3" y="3" fill={OI.value} /><text x="13" y="8">{label}</text>
              <rect x="0" y="14" width="10" height="3" fill={OI.median} /><text x="13" y="19">median of reference years</text>
              <rect x="0" y="25" width="10" height="7" fill={OI.band} opacity="0.35" /><text x="13" y="31">25th–75th percentile</text>
              <rect x="0" y="37" width="10" height="7" fill="#d0d3d6" /><text x="13" y="43">no coverage</text>
              {rawSlices.map(([s], i) => <g key={s}><rect x="160" y={i * 11 + 3} width="10" height="3" fill={OI[s]} /><text x="173" y={i * 11 + 8}>{SENSOR_LABELS[s]} (raw)</text></g>)}
            </g>
          </g>
        );
      }}
    </Frame>
  );
}

export function AnomalyChart({ meta, cmp, mode, svgRef }) {
  const arr = mode === 'pct' ? cmp.pct : cmp.diff;
  const n = arr.length;
  let mx = 0;
  for (const v of arr) if (Math.abs(v) > mx) mx = Math.abs(v);
  if (mode === 'pct') mx = Math.min(mx, 500);
  const lim = niceMax(mx);
  const noCov = []; for (let k = 0; k < n; k++) if (Number.isNaN(cmp.value[k])) noCov.push(k);
  return (
    <Frame meta={meta} a={cmp.a} n={n} ymin={-lim} ymax={lim} ylabel={mode === 'pct' ? '% vs median' : 'difference vs median'} svgRef={svgRef} title="Anomaly chart" noCov={noCov}>
      {({ x, y, bw }) => (
        <g>
          {Array.from(arr, (v, k) => {
            if (Number.isNaN(v)) return null;
            const c = Math.max(-lim, Math.min(lim, v));
            return <rect key={k} x={x(k) - bw / 2} width={Math.max(bw - (bw > 3 ? 1 : 0), 0.8)} y={Math.min(y(0), y(c))} height={Math.abs(y(c) - y(0))} fill={v >= 0 ? OI.above : OI.below} />;
          })}
          <g transform={`translate(${L + 4},${T + 4})`} fontSize="9">
            <rect width="10" height="8" fill={OI.above} /><text x="13" y="8">more burning than usual</text>
            <rect y="12" width="10" height="8" fill={OI.below} /><text x="13" y="20">less than usual</text>
            <rect y="24" width="10" height="8" fill="#d0d3d6" /><text x="13" y="32">no coverage</text>
          </g>
        </g>
      )}
    </Frame>
  );
}

export function useHover() { return useState(null); }
