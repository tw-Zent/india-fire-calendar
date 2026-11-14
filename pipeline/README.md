# Pipeline — harmonized NASA FIRMS active-fire record for India (2000–2026)

Turns the raw FIRMS hotspot CSVs (MODIS C6.1 Terra/Aqua, VIIRS 375 m S-NPP/NOAA-20) into one harmonized, validated, gridded daily record (0.1°, UTC days), exported as static JSON for the web app.
Method and limits in plain words: [`data/processed/METHODS.md`](../data/processed/METHODS.md). Data contract (what the app reads): [`data/processed/CONTRACT.md`](../data/processed/CONTRACT.md) + `contract.json` (v1.3.1).

Code: https://github.com/tw-Zent/india-fire-calendar · Licence for derived data: CC BY 4.0 (source data: NASA FIRMS).

AI assistance: code, analysis and documentation were produced with Claude (Anthropic) as an AI assistant, directed and reviewed by Ashish Das.

## Setup
Python ≥ 3.10.
```
pip install -r pipeline/requirements.txt      # polars, pyarrow, matplotlib, lightgbm, scikit-learn
```
Input (read-only): `data/raw/{modis,viirs_snpp,viirs_noaa20}/fire_{archive,nrt}_*.csv` as downloaded from FIRMS.

## Run
```
python pipeline/run_all.py          # everything, raw -> export + checks, ~7 min
python pipeline/run_all.py 11       # resume from step 11 (step list in run_all.py)
```
Windows: double-click `pipeline/run_pipeline.bat`. The run stops on the first failing step or check.

## Steps
| # | script | does | writes (under `data/processed/`) |
|---|---|---|---|
| 0 | ingest.py | raw CSV → typed Parquet | `interim/raw_<sensor>_<archive|nrt>.parquet` |
| 1 | profile_raw.py | rows, date ranges, gaps, value ranges | `reports/profile.json`, `profile_by_year.csv` |
| 2 | clean.py | archive>NRT, de-dup, static sources, low confidence | `interim/clean_<sensor>/<year>.parquet`, `reports/reconcile_clean.csv` |
| 3 | grid.py | 0.1° cell × UTC day counts per satellite (+ day/night); daily coverage mask | `interim/grid/`, `interim/grid_dn/`, `interim/coverage_days.parquet`, `reports/reconcile_grid.csv` |
| 4 | build_tileday.py | 2° tile × day table for fitting | `interim/tileday_dn.parquet` |
| 5 | hybrid.py | LightGBM day-shape for MODIS days (keeps monthly totals) | `interim/hybrid_factors.parquet`, `interim/hybrid_lgbm.txt` |
| 6 | validate.py | model comparison (exploratory) | `reports/validation_alpha200.csv` |
| 7 | validate_final.py | held-out validation, baseline vs ratio method | `reports/validation_final.{md,csv}`, `validation_terra_chain_2004.csv` |
| 8 | validate_hybrid.py | held-out + fresh-year validation of the hybrid | `reports/validation_hybrid.{md,csv}` |
| 9–10 | charts.py, fig_submission.py | evidence + submission figures | `reports/annual_totals.png`, `ph_octnov_daily.png`, `fig_harmonized_record.png` |
| 11–12 | export.py --sample, check_contract.py | example-area sample + contract check | `sample/` |
| 13–14 | export.py, check_contract.py | full export + contract check | `tiles/` (`manifest.json`, `coverage.json`, `domain.json`, `tiles/*.json`), `reports/harmonization_ratios.csv` |

Shared code: `config.py` (paths, grid, **region settings**), `harmonize.py` (ratio fitting + `fit_final` / `apply_final`), `hybrid.py` (v1.3 day-shape). `experiments/` holds the ML experiments (evidence only, not part of the run).

## Outputs
- `data/processed/tiles/` — India, 109 tiles of 2°×2°, 9.5 MB gzipped in total; `data/processed/sample/` — Punjab & Haryana, same format.
- `data/processed/reports/` — reconciliation tables, validation tables, ratio table, charts.

## Checks built in
- Row counts reconcile raw → clean → gridded (each dropped row has a reason; `check_zero` column = 0).
- No duplicate (satellite, lat, lon, date, time) after de-duplication (asserted).
- `check_contract.py` validates every exported file against `contract.json`: field lengths, ranges, sorted days, no duplicate cell-days, records only on covered days and inside the domain, no null `h` on covered days, file-size caps (≤ 5 MB gz per file, ≤ 20 MB for the sample).

## Run it for another country or the globe
Nothing in the code is specific to India; the region is whatever the raw files cover.
1. Download the FIRMS archive + NRT CSVs for your country or region (MODIS C6.1, VIIRS S-NPP 375 m, VIIRS NOAA-20 375 m) from https://firms.modaps.eosdis.nasa.gov/download/ and put them in `data/raw/modis/`, `data/raw/viirs_snpp/`, `data/raw/viirs_noaa20/` (file names `fire_archive_*.csv`, `fire_nrt_*.csv`).
2. In `pipeline/config.py` set `REGION_NAME`, and `EXAMPLE_NAME` + `EXAMPLE_BBOX` to an area you care about. It's used for the sample export and as the second validation region; Punjab & Haryana is just our example.
3. Run `python pipeline/run_all.py`. Ratios and the hybrid model are refitted from your data; the grid is global (0.1°), so tile ids stay valid anywhere.

Notes: the globe has tens of times India's detections. Ingest, clean and grid stream or work year by year, but `export.py` and `hybrid.py` hold the whole grid in memory (India: under 3 GB). For the globe, run one continent at a time (one raw download + one output folder each) or use a large-memory machine. Satellite dates (Aqua start, NOAA-20 start, S-NPP end) are global and need no change.
