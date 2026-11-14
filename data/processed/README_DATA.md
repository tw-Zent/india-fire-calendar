# India Fire Calendar data — v1.3.0

A daily record of satellite fire detections over India, 1 Nov 2000 – 13 Nov 2026, on a 0.1° grid. Four satellites (MODIS Terra and Aqua, VIIRS S-NPP and NOAA-20) are harmonized into one consistent unit.

**Unit:** `h` = active-fire detections that one VIIRS S-NPP satellite would record in a 0.1° cell on one UTC day ("S-NPP-equivalent detections"). Detections are hotspots seen at overpass time. They are not burned area, fire size or emissions.
**Version:** 1.3.0 (final), contract in [`CONTRACT.md`](CONTRACT.md) / `contract.json`. Method, accuracy and limits: [`METHODS.md`](METHODS.md).

## Files
| path | what it is |
|---|---|
| `tiles/manifest.json` | version, date range, method summary, list of tiles with their bounding boxes and sizes |
| `tiles/coverage.json` | one entry per day: which satellites delivered data (`mask`, bits Terra 1, Aqua 2, S-NPP 4, NOAA-20 8) and the `regime` the value rests on (0 none, 1 Terra only, 2 MODIS Terra+Aqua, 3 VIIRS). Days with `mask` 0 are **no data**, not zero. |
| `tiles/domain.json` | cells inside the data area (India). Cells not listed are **no data**. |
| `tiles/tiles/{lat}_{lon}.json` | one 2°×2° tile (south-west corner in the name), every day with fire: cell, day, raw counts per satellite (`t`, `a`, `s`, `n`) and the harmonized value `h`. A covered day with no record for a cell means 0 detections. |
| `sample/` | the same files for the Punjab & Haryana example area only (27.5–32.6° N, 73.8–77.6° E) |
| `reports/uncertainty.json` | typical monthly and daily error per regime (from held-out years) |
| `reports/validation_*.md` | validation tables |
| `reports/harmonization_ratios.csv` | the MODIS → S-NPP ratios used |

Day numbers are days since 1970-01-01 (UTC). Exact field definitions, encoding (delta-coded days) and size limits are in `CONTRACT.md`.

## Rebuild
`python pipeline/run_all.py` rebuilds everything from the raw NASA FIRMS CSVs in about 7 minutes; see `pipeline/README.md`.

## Credit and licence
- **Fire data:** NASA FIRMS active-fire products, MODIS Collection 6.1 (Terra, Aqua) and VIIRS 375 m (S-NPP, NOAA-20), standard archive plus near-real-time. Credit line: *"We acknowledge the use of data from NASA's Fire Information for Resource Management System (FIRMS) (https://firms.modaps.eosdis.nasa.gov), part of NASA's Earth Science Data and Information System (ESDIS)."* NASA data are freely and openly available.
- **This derived dataset:** licence [HQ to confirm, e.g. CC BY 4.0].
- **Cite as:** India Fire Calendar: harmonized MODIS/VIIRS active-fire record for India, v1.3.0 (2026), built from NASA FIRMS data. NASA Space Apps Challenge 2026. Code: [code link].
