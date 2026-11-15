import { idxOf, isoOf, SENSORS, SENSOR_LABELS } from './data.js';
import { dayClass, legendLines } from './accuracy.js';

function save(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

const cell = (v) => (Number.isNaN(v) || v === undefined ? '' : String(+(+v).toFixed(3)));

export function downloadCSV({ meta, agg, sel, from, to, cmp, ref, win, skipT, fileBase, caveats }) {
  const area = sel.type === 'rect'
    ? `bbox S${sel.bounds[0][0].toFixed(3)} W${sel.bounds[0][1].toFixed(3)} N${sel.bounds[1][0].toFixed(3)} E${sel.bounds[1][1].toFixed(3)}`
    : `polygon ${sel.latlngs.map(([a, b]) => `${a.toFixed(3)} ${b.toFixed(3)}`).join('; ')}`;
  const q = (x) => String(x).replace(/[\r\n]+/g, ' '); // metadata lines are written unquoted as '# …' so read_csv(comment='#') works
  const lines = [
    q('# India Fire Calendar export (NASA FIRMS MODIS + VIIRS, harmonized)'),
    q(`# Area: ${sel.name || ''} (${area}); 0.1 deg cells whose centre is inside: ${agg.nSel}, of which inside the data domain: ${agg.nCells}`),
    q(`# Date range: ${from} to ${to} (UTC days)`),
    q(`# Data version: ${meta.version}`),
    q(`# harmonized = S-NPP-VIIRS-equivalent detections per day; *_raw = clean detections per satellite (not harmonized)`),
    q(`# median/p25/p75 = same calendar day across reference years ${ref?.[0]}-${ref?.[1]}${ref?.[0] <= 2002 ? ' (includes lower-confidence Terra-only years)' : ''} excluding the day's own year${skipT ? ' and terra_only days' : ''}; smoothing ${win > 1 ? win + '-day centred mean' : 'none'}`),
    q('# Empty cell = no satellite coverage that day (unknown, not zero)'),
    ...(caveats || []).map((c) => q(`# caveat: ${c}`)),
    q('# code: https://github.com/tw-Zent/india-fire-calendar'),
    q('# ai_assistance: Built with AI assistance (Claude, Anthropic), directed and reviewed by Ashish Das.'),
    q('# regime = which satellites the harmonized value rests on: viirs_snpp (S-NPP observed directly) / viirs_noaa20_filled (NOAA-20 converted, S-NPP missing) / modis_ta (Terra+Aqua) / terra_only (lower confidence) / none'),
    ...legendLines().map((l) => q(`# accuracy: ${l}`)),
  ];
  const head = ['date', 'harmonized', ...SENSORS.map((s) => SENSOR_LABELS[s].toLowerCase().replace(/[^a-z0-9]+/g, '_') + '_raw'),
    'regime', 'median', 'p25', 'p75', 'anomaly', 'anomaly_pct'];
  lines.push(head.join(','));
  const a = idxOf(meta, from), b = idxOf(meta, to);
  for (let di = a; di <= b; di++) {
    const k = di - a;
    lines.push([isoOf(meta, di), cell(agg.h[di]), ...SENSORS.map((s) => cell(agg.raw[s][di])), meta.hasRegime ? ({ viirs_snpp: 'viirs_snpp', viirs_n20: 'viirs_noaa20_filled', modis_ta: 'modis_ta', terra_only: 'terra_only', none: 'none' })[dayClass(meta, di)] : '',
      cell(cmp?.median[k]), cell(cmp?.p25[k]), cell(cmp?.p75[k]), cell(cmp?.diff[k]), cell(cmp?.pct[k])].join(','));
  }
  save(new Blob(['\ufeff' + lines.join('\r\n') + '\r\n'], { type: 'text/csv' }), `${fileBase || 'fire-calendar_' + from + '_' + to}_daily.csv`);
}

const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Wraps a chart in a titled, footed SVG (stakeholder-01 #6): title lines on top, source/credit footer below.
function svgString(svg, stamp) {
  const clone = svg.cloneNode(true);
  const vb = svg.viewBox.baseVal;
  clone.setAttribute('width', vb.width);
  clone.setAttribute('height', vb.height);
  clone.removeAttribute('style');
  if (!stamp) return new XMLSerializer().serializeToString(clone);
  const W = Math.max(vb.width, 560);
  const titles = stamp.title || [];
  const foots = stamp.footer || [];
  const TOP = 10 + titles.length * 16, BOT = 8 + foots.length * 12;
  clone.setAttribute('x', 0);
  clone.setAttribute('y', TOP);
  const inner = new XMLSerializer().serializeToString(clone);
  const t = titles.map((l, i) => `<text x="8" y="${18 + i * 16}" font-size="${i === 0 ? 13 : 11}" font-weight="${i === 0 ? 700 : 400}" fill="#111">${esc(l)}</text>`).join('');
  const f = foots.map((l, i) => `<text x="8" y="${TOP + vb.height + 12 + i * 12}" font-size="9" fill="#444">${esc(l)}</text>`).join('');
  const H = TOP + vb.height + BOT;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="system-ui, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>${t}${inner}${f}</svg>`;
}

export function downloadSVG(svg, name, stamp) {
  if (!svg) return;
  save(new Blob([svgString(svg, stamp)], { type: 'image/svg+xml' }), name);
}

export function downloadPNG(svg, name, stamp, scale = 3) {
  if (!svg) return;
  const str = svgString(svg, stamp);
  const m = str.match(/^<svg[^>]*width="([\d.]+)" height="([\d.]+)"/);
  const W = m ? +m[1] : svg.viewBox.baseVal.width, H = m ? +m[2] : svg.viewBox.baseVal.height;
  const img = new Image();
  const url = URL.createObjectURL(new Blob([str], { type: 'image/svg+xml' }));
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = W * scale; c.height = H * scale;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    c.toBlob((b) => save(b, name), 'image/png');
  };
  img.src = url;
}
