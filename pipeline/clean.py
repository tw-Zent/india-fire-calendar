"""Step 2: merge archive+NRT, de-duplicate, apply cleaning policy. Writes interim/clean_<sensor>/<year>.parquet,
interim/coverage_raw.parquet and reports/reconcile_clean.csv.

Policy (contract v1):
  * Archive beats NRT (HQ D6): NRT rows kept only for dates after that sensor's archive end.
  * Duplicates: key (satellite, latitude, longitude, acq_date, acq_time) must be unique after merge.
  * Static / non-vegetation sources: archive rows with type 1 (volcano), 2 (other static land source),
    3 (offshore) are dropped. NRT has no `type`, so a STATIC MASK is built from the archive: 0.01-degree bins
    with >= 3 type-1/2/3 detections (any sensor, any year) that make up >= 50% of the bin's detections.
    The mask is applied to ALL rows (archive and NRT) so both products are treated the same.
  * Confidence: MODIS confidence < 30 dropped; VIIRS class 'l' (low) dropped. Same intent for both sensors.
  * Day and night detections are both kept (counts include both).
"""
import polars as pl
from config import INTERIM, REPORTS

KEY = ["satellite", "latitude", "longitude", "acq_date", "acq_time"]
KEEP = ["latitude", "longitude", "acq_date", "acq_time", "satellite", "sensor", "product",
        "confidence", "frp", "daynight", "type"]
BIN = 100            # 0.01 degree bins for the static mask
MASK_MIN_STATIC = 3
MASK_MIN_FRAC = 0.5

def bins(lf):
    return lf.with_columns(
        (pl.col("latitude") * BIN).floor().cast(pl.Int32).alias("_bl"),
        (pl.col("longitude") * BIN).floor().cast(pl.Int32).alias("_bo"))

def build_static_mask():
    a = pl.concat([pl.scan_parquet(INTERIM / f"raw_{s}_archive.parquet").select("latitude", "longitude", "type")
                   for s in ("modis", "snpp", "noaa20")]).pipe(bins)
    g = (a.group_by("_bl", "_bo").agg(pl.len().alias("n"), pl.col("type").is_in([1, 2, 3]).sum().alias("st"))
          .filter((pl.col("st") >= MASK_MIN_STATIC) & (pl.col("st") / pl.col("n") >= MASK_MIN_FRAC))
          .select("_bl", "_bo").collect(engine="streaming"))
    g.write_parquet(INTERIM / "static_mask.parquet")
    return g.with_columns(pl.lit(True).alias("_st"))

def main():
    REPORTS.mkdir(parents=True, exist_ok=True)
    mask = build_static_mask()
    print("static mask bins:", mask.height, flush=True)
    rec, cov = [], []
    for s in ("modis", "snpp", "noaa20"):
        a = pl.scan_parquet(INTERIM / f"raw_{s}_archive.parquet").select(KEEP)
        n = pl.scan_parquet(INTERIM / f"raw_{s}_nrt.parquet").select(KEEP)
        a_end = a.select(pl.col("acq_date").max()).collect().item()
        allrows = pl.concat([a, n])
        years = sorted(allrows.select(pl.col("acq_date").dt.year().unique()).collect().to_series().to_list())
        outdir = INTERIM / f"clean_{s}"; outdir.mkdir(exist_ok=True)
        r = dict(sensor=s, raw_archive=a.select(pl.len()).collect().item(), raw_nrt=n.select(pl.len()).collect().item(),
                 nrt_dropped_archive_wins=0, duplicates_dropped=0, static_type_dropped=0,
                 static_mask_dropped=0, low_conf_dropped=0, clean=0)
        low = (pl.col("confidence").cast(pl.Int32) < 30) if s == "modis" else (pl.col("confidence") == "l")
        for y in years:   # year chunks keep memory low (dedup key contains the date)
            yr = pl.col("acq_date").dt.year() == y
            ny = n.filter(yr).select(pl.len()).collect().item()
            df = pl.concat([a.filter(yr), n.filter(yr & (pl.col("acq_date") > a_end))]).collect()  # archive beats NRT (D6)
            r["nrt_dropped_archive_wins"] += ny - n.filter(yr & (pl.col("acq_date") > a_end)).select(pl.len()).collect().item()
            cov.append(df.group_by("satellite", "acq_date").agg(pl.len().alias("raw_rows")))
            h = df.height; df = df.unique(subset=KEY, keep="first", maintain_order=True); r["duplicates_dropped"] += h - df.height
            h = df.height; df = df.filter(~pl.col("type").is_in([1, 2, 3]).fill_null(False)); r["static_type_dropped"] += h - df.height
            h = df.height
            df = bins(df).join(mask, on=["_bl", "_bo"], how="left").filter(pl.col("_st").is_null()).drop("_bl", "_bo", "_st")
            r["static_mask_dropped"] += h - df.height
            h = df.height; df = df.filter(~low); r["low_conf_dropped"] += h - df.height
            assert df.height == df.unique(subset=KEY).height, f"{s} {y}: duplicate detections remain"
            r["clean"] += df.height
            df.drop("type").write_parquet(outdir / f"{y}.parquet")
            del df
        r["check_zero"] = r["raw_archive"] + r["raw_nrt"] - sum(v for k, v in r.items() if k.endswith("dropped")) - r["clean"]
        assert r["check_zero"] == 0
        rec.append(r); print(r, flush=True)
    pl.concat(cov).write_parquet(INTERIM / "coverage_raw.parquet")
    pl.DataFrame(rec).write_csv(REPORTS / "reconcile_clean.csv")
    print("dup test passed: 0 duplicate (satellite,lat,lon,acq_date,acq_time) keys per sensor")

if __name__ == "__main__":
    main()
