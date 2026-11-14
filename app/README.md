# India Fire Calendar: web app

A static React (Vite) app showing a burning-activity calendar from harmonized MODIS + VIIRS hotspots (NASA FIRMS, India, 2000–2026). It has no backend.

## Data (contract v1.3, `../data/processed/CONTRACT.md`)
- `npm run build` first runs `scripts/copy-data.mjs`, which copies `../data/processed/tiles/{manifest.json, coverage.json, tiles/*.json}` (full India) into `public/data/`, plus `domain.json` (v1.1+) and `../data/processed/METHODS.md` (rendered on the Methods page).
- `npm run build:sample` uses `../data/processed/sample/` instead (Punjab & Haryana only).
- `public/data/` is generated; don't edit it.

## Features → challenge statement
- Area of interest: draw a rectangle or polygon, or use the preset. Pick a date range.
- **Where (map)**: fire density per 0.1° cell in the selection, or anomaly vs typical years; tap a cell for its numbers.
- **Now & next** (top of Critical periods): last 30 days vs typical, and where today sits relative to the typical critical periods (past patterns, not a forecast).
- **Accuracy labels**: every day/year shows its data source and typical error, from `data/processed/reports/uncertainty.json` (copied into the build; falls back to `src/accuracy.js` if versions differ).
- **Calendar**: years × days heatmap; no coverage is hatched grey, distinct from zero.
- **Historical patterns**: daily line with the median and 25–75 % band of the reference years; optional raw per-sensor lines.
- **Unusual conditions**: anomaly vs median (difference or %), optional 7/15-day smoothing.
- **Critical periods**: typical seasons from the median climatology; per-year peak date, early/late, % of typical.
- **Sensors**: raw counts per satellite behind the harmonized value.
- **Share**: the URL encodes area, dates, tab, reference years and smoothing (`?a=ph&f=…&t=…&tab=…`); a "Copy link" button copies it.
- **Download**: CSV (header block plus daily harmonized, raw, regime, median, p25, p75, anomaly) and PNG/SVG of the calendar, line chart and anomaly chart.
- **Methods & data**: the `#about` page.

## Build (Windows PowerShell, from this folder)
```
npm install
npm run build        # copies data, writes dist/
npm run preview      # optional local check at http://localhost:4173
```

## Deploy to Firebase Hosting
One-time setup:
```
npm install -g firebase-tools
firebase login
firebase projects:create <PROJECT_ID>   # or create it in the console with the Space Apps Google account
```
Every deploy:
```
cd app
npm run build
firebase deploy --only hosting --project <PROJECT_ID>
```
The deploy output ends with `Hosting URL: https://<PROJECT_ID>.web.app`. `firebase.json` is already here (public = `dist`), so there is no need to run `firebase init`.

**Never overwrite `firebase.json` or `.firebaserc` from a build sync. Hosting config is owned by Helpdesk (D15).** Builds sync only `dist/`, `src/`, `scripts/`, `public/`, `package*.json` and `README.md`.

`_bundle/` holds transfer archives and stale files from earlier builds. It is not deployed and can be deleted.
