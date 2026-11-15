# India Fire Calendar: harmonized MODIS + VIIRS active-fire record

**Live app:** https://nasa-space-app-2026.web.app

Built for the **NASA Space Apps Challenge 2026**, challenge *"Harmonization of MODIS and VIIRS Hot Spots"*.

## What it does
- Harmonizes the split NASA FIRMS hotspot records into one consistent 2000–2026 record for India: MODIS C6.1 (Terra, Aqua), VIIRS S-NPP and VIIRS NOAA-20, archive plus near-real-time.
- Turns that record into a **burning-activity calendar** for any selected area of interest. Early-warning and emergency responders, scientists and land managers can use it to examine:
  - **historical fire patterns** (daily median and interquartile band over reference years)
  - **unusual conditions** (anomalies against the typical year)
  - **critical periods** (season onset, peak and end, and whether a year is early, late or above normal)
- Downloads: CSV (daily series with median and anomaly columns) plus PNG/SVG charts.
- Showcase: Punjab & Haryana stubble burning (Oct–Nov).

How it works: [METHODS.md](data/processed/METHODS.md) · Data format: [CONTRACT.md](data/processed/CONTRACT.md) · Data notes: [README_DATA.md](data/processed/README_DATA.md)

## Repository layout
| Folder | Contents |
|---|---|
| `pipeline/` | Python (polars) ingest → clean → 0.1° daily grid → harmonize → validate → export |
| `app/` | Vite + React + Leaflet static web app (no backend), deployed on Firebase Hosting |
| `data/processed/` | Method, contract and validation docs, figures and tables. The raw data and generated tiles are **not** in the repo. |

## Reproduce
1. **Get the data.** Download the FIRMS archive and NRT CSVs for India (MODIS C6.1, VIIRS S-NPP 375 m, VIIRS NOAA-20 375 m) from https://firms.modaps.eosdis.nasa.gov/download/ and place them as described in [pipeline/README.md](pipeline/README.md).
2. **Run the pipeline** (Python 3.10 or newer), which takes about 7 minutes on a laptop:
   ```
   pip install -r pipeline/requirements.txt
   python pipeline/run_all.py
   ```
   This writes the tiles, manifest and coverage files to `data/processed/`.
3. **Build the app:**
   ```
   cd app
   npm install
   npm run build      # copies data/processed tiles into the build; output in app/dist/
   npm run preview    # local check at http://localhost:4173
   ```
   To deploy your own copy, see [app/README.md](app/README.md).

## Data credit
We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Land, Atmosphere Near real-time Capability for Earth observations (LANCE) (https://earthdata.nasa.gov/lance) and NASA's Earth Science Data and Information System (ESDIS). Base map © OpenStreetMap contributors.

## AI assistance
AI assistance: code, analysis and documentation were produced with Claude (Anthropic) as an AI assistant, directed and reviewed by Ashish Das.

## How to cite
> Das, A. (2026). India Fire Calendar: harmonized MODIS/VIIRS active-fire record for India, v1.3.1. NASA Space Apps Challenge 2026. https://github.com/tw-Zent/india-fire-calendar

## Licence
- Code: [MIT](LICENSE).
- Derived data and docs: CC BY 4.0.
