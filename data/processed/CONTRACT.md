# Data contract v1.3.0 — FIRMS India harmonized daily fire grid
Owner: Pipeline. Machine-readable twin: `contract.json`. The app relies only on what is stated here.
**Changes in v1.3.0 (14 Nov 15:40 IST):** only `h` values on MODIS Terra+Aqua days change (hybrid day-to-day shape; monthly and annual totals unchanged). Layout, fields and every other value unchanged. `manifest.h_status` = `final_v1.3`.
**v1.2.0 (14:10 IST):** `h` is now the FINAL harmonized value (method below); `coverage.json` adds `regimes` + per-day `regime`; S-NPP/NOAA-20 partial-outage days have their coverage bit cleared. Layout unchanged.
**v1.1.0 (13:55 IST):** new file `domain.json` (cells outside the India data extent = no data). Nothing else changed.
**Status:** layout + fields frozen. 

## Date convention
Day = **UTC calendar day** (= FIRMS `acq_date`). Encoded as integer days since 1970-01-01 (JS: `new Date(day*86400000)`).
For India a UTC day = 05:30 IST on D → 05:29 IST on D+1, i.e. day D's afternoon passes plus the following night's passes.
Coverage of the record: 2000-11-01 → 2026-11-13 (raw data ends 13 Nov; no 14 Nov rows exist).

## Grid
0.1° × 0.1°, EPSG:4326, global origin (−90, −180).
`row = floor((lat+90)*10)`, `col = floor((lon+180)*10)`, `cell_id = row*3600 + col`.
Cell SW corner = (row/10 − 90, col/10 − 180).

## Files (all JSON, served gzipped by hosting)
| file | content |
|---|---|
| `manifest.json` | version, scope, date_first/last, `h_status`, `h_ratios`, `tiles[]` {tile, file, lat0, lon0, lat1, lon1, records, bytes, gzip_bytes} |
| `coverage.json` | `{version, d0, d1, bits:{t:1,a:2,s:4,n:8}, mask:[…], regimes:{0:none,1:terra_only,2:modis_ta,3:viirs}, regime:[…]}` — `mask[i]`, `regime[i]` are for day `d0+i`. A bit is set when that satellite fully covered the day (partial VIIRS outages cleared). Use `regime` to drop `terra_only` days from default medians. |
| `domain.json` | `{version, rule, n_cells, tiles:{tile_id:[local c…]}}` — cells inside the data domain (27,136 cells for India) |
| `tiles/{lat0}_{lon0}.json` | one 2°×2° tile (20×20 cells), all dates, sparse cell-day records |

Tile id = integer SW corner, e.g. `30_74` covers 30–32°N, 74–76°E. `tile_row=floor(row/20)`, `tile_col=floor(col/20)`, `lat0=tile_row*2−90`, `lon0=tile_col*2−180`.

### Tile fields (parallel arrays, length = `records`, sorted by day then cell)
| field | type | units / meaning |
|---|---|---|
| `d0` | int | day of first record |
| `dd` | int[] | delta-encoded day: `day[i] = d0 + Σ dd[0..i]`, `dd[0]=0` |
| `c` | int[] 0–399 | local cell: `(row%20)*20 + col%20` |
| `t` | int[] | MODIS **Terra** clean detections in the cell-day |
| `a` | int[] | MODIS **Aqua** clean detections |
| `s` | int[] | VIIRS **S-NPP** (375 m) clean detections |
| `n` | int[] | VIIRS **NOAA-20** (375 m) clean detections |
| `h` | number[] (null allowed) | **harmonized metric**: S-NPP-VIIRS-equivalent detections per cell-day |

Per-sensor counts `t a s n` are the un-harmonized "raw" counts kept for transparency (after cleaning, see below).

## Harmonized metric `h`
Units: number of active-fire detections a single S-NPP VIIRS (375 m) satellite would record in the cell that day. Chosen because S-NPP is the longest 375 m record (2012–2026) and 375 m resolves small crop-residue fires.
v1.2 (final): S-NPP count if S-NPP covered the day; else NOAA-20 × 0.99 (constant); else MODIS converted with ratios per 2° tile × month × day/night (fit 2012–2019, shrunk toward the India-wide month × day/night ratio); Terra-only days go Terra → Terra+Aqua (ratios fit Jul 2002–2006) → S-NPP. Ratio table: `reports/harmonization_ratios.csv`. v1.3: on MODIS Terra+Aqua days the daily values within each 2° tile-month are redistributed by a LightGBM model of MODIS fire features, keeping the tile-month total (`pipeline/hybrid.py`). Validation and caveats: `METHODS.md`. A record can have s > 0 on a day whose S-NPP bit is cleared (partial outage); `h` then comes from NOAA-20/MODIS.

## Missing ≠ zero (HQ D9)
- **No coverage**: `coverage.mask[day] == 0`, or day outside `d0..d1` → value unknown. Show grey; exclude from medians/anomalies.
- **Outside domain**: (tile, c) not listed in `domain.json` → always no data (outside India, or no detection in 26 years). Grey it out; never count it as zero.
- **Observed zero**: mask ≠ 0 and no record for (cell, day) → 0 fires.
- **Partial**: mask lacks a satellite normally present (e.g. Terra-only before 4 Jul 2002; S-NPP gone after 2 Nov 2026) → `h` still estimated from what flew.
- **Limits** (state on Methods page): the raw data has no swath/cloud info, so per-cell gaps cannot be told from zero; the FIRMS download is clipped to India, so cells outside India are always empty — `domain.json` marks them. Domain rule: the cell had ≥1 raw detection in 26 years, so a few never-burning cells inside India also show as no data.

## Cleaning applied before counting (v1)
Archive beats NRT (no overlap found: NRT starts the day after each archive ends). Duplicates on (satellite, lat, lon, date, time) removed. Static/non-vegetation: archive `type` 1/2/3 dropped, plus a static mask (0.01° bins with ≥3 static detections making ≥50% of the bin) applied to archive and NRT alike. Low confidence dropped (MODIS < 30, VIIRS class `l`). Day and night both kept.

## Size caps
Each file ≤ 5 MB gzipped; Punjab & Haryana (all years) ≤ 20 MB. v1.3: sample 12 tiles 1.43 MB gz; India 109 tiles 9.77 MB gz.

## Sample
`data/processed/sample/` — same format, the 12 tiles intersecting the Punjab & Haryana bbox (27.5–32.6°N, 73.8–77.6°E), all dates. `h` final (`manifest.h_status` = final_v1.3).

## Versioning
Semver. Patch = data refresh; minor = new optional fields or method change of `h` (units unchanged); major = breaking layout change. Every change is announced in a pipeline report.
