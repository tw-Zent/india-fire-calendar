// Copies the app-ready export from ../data/processed/ into public/data/ before each build (contract v1.x).
// Source: data/processed/tiles/{manifest.json, coverage.json, tiles/*.json}  (full India)
// Fallback: data/processed/sample/ (Punjab & Haryana only) if the full export is missing, or if run with --sample.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const proc = path.resolve(appDir, '..', 'data', 'processed');
const dst = path.join(appDir, 'public', 'data');

if (!fs.existsSync(path.join(proc, 'CONTRACT.md'))) {
  console.error('[copy-data] data/processed/CONTRACT.md not found. Nothing to build against.');
  process.exit(1);
}
const wantSample = process.argv.includes('--sample');
let src = path.join(proc, 'tiles');
if (wantSample || !fs.existsSync(path.join(src, 'manifest.json'))) src = path.join(proc, 'sample');
for (const f of ['manifest.json', 'coverage.json']) {
  if (!fs.existsSync(path.join(src, f))) { console.error(`[copy-data] Missing ${path.join(src, f)}`); process.exit(1); }
}
const man = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
if (!/^1\./.test(man.version)) { console.error(`[copy-data] Contract version ${man.version} is not 1.x; app needs updating.`); process.exit(1); }

fs.rmSync(dst, { recursive: true, force: true });
fs.mkdirSync(path.join(dst, 'tiles'), { recursive: true });
fs.copyFileSync(path.join(src, 'manifest.json'), path.join(dst, 'manifest.json'));
fs.copyFileSync(path.join(src, 'coverage.json'), path.join(dst, 'coverage.json'));
// contract ≥1.1: domain.json (cells inside the data domain). Methods text: data/processed/METHODS.md.
if (fs.existsSync(path.join(src, 'domain.json'))) fs.copyFileSync(path.join(src, 'domain.json'), path.join(dst, 'domain.json'));
else console.warn('[copy-data] No domain.json (contract < 1.1): every cell will count.');
if (fs.existsSync(path.join(proc, 'README_DATA.md'))) fs.copyFileSync(path.join(proc, 'README_DATA.md'), path.join(dst, 'README_DATA.md'));
if (fs.existsSync(path.join(proc, 'METHODS.md'))) fs.copyFileSync(path.join(proc, 'METHODS.md'), path.join(dst, 'METHODS.md'));
else console.warn('[copy-data] No data/processed/METHODS.md: Methods page will show a placeholder.');
// Aqua overpass-drift figure for the Methods page (pipeline-09): prefer the submission-grade version
for (const f of ['fig_aqua_drift.png', 'aqua_overpass_drift.png']) {
  const p = path.join(proc, 'reports', f);
  if (fs.existsSync(p)) { fs.copyFileSync(p, path.join(dst, 'fig_aqua_drift.png')); break; }
}
const drift = path.join(proc, 'reports', 'aqua_overpass_drift.csv'); // per-year overpass times for the caution line (F7)
if (fs.existsSync(drift)) fs.copyFileSync(drift, path.join(dst, 'aqua_overpass_drift.csv'));
const unc = path.join(proc, 'reports', 'uncertainty.json');
if (fs.existsSync(unc)) fs.copyFileSync(unc, path.join(dst, 'uncertainty.json'));
let n = 0;
for (const t of man.tiles) {
  const from = path.join(src, t.file);
  if (!fs.existsSync(from)) { console.error(`[copy-data] Missing tile ${from}`); process.exit(1); }
  fs.copyFileSync(from, path.join(dst, t.file));
  n++;
}
console.log(`[copy-data] contract ${man.version}, h_status=${man.h_status}: ${n} tiles from ${path.relative(appDir, src)} -> public/data`);
