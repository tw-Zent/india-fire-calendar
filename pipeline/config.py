"""Shared paths and constants for the FIRMS India pipeline."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "raw"
PROC = ROOT / "data" / "processed"
INTERIM = PROC / "interim"
SAMPLE = PROC / "sample"
REPORTS = PROC / "reports"

# sensor key -> (folder, archive glob, nrt glob)
SOURCES = {
    "modis":  ("modis",        "fire_archive_M-C61_*.csv", "fire_nrt_M-C61_*.csv"),
    "snpp":   ("viirs_snpp",   "fire_archive_SV-C2_*.csv", "fire_nrt_SV-C2_*.csv"),
    "noaa20": ("viirs_noaa20", "fire_archive_J1V-C2_*.csv", "fire_nrt_J1V-C2_*.csv"),
}

GRID_DEG = 0.1

# ---- Region settings: the only place the region is defined -------------------------------------------
# To run for another country or the globe: download the FIRMS archive + NRT CSVs for that region into
# data/raw/{modis,viirs_snpp,viirs_noaa20}/ (RAW above) and set the names/bbox below. The pipeline itself has
# no region-specific constants; the domain is whatever area the raw files cover.
REGION_NAME = "India"
# Example area used for the sample export and for the second validation region (any bbox works).
EXAMPLE_NAME = "Punjab_Haryana"
EXAMPLE_BBOX = dict(lat_min=27.5, lat_max=32.6, lon_min=73.8, lon_max=77.6)  # Punjab & Haryana (approx.)
PH_BBOX = EXAMPLE_BBOX  # backwards-compatible alias
