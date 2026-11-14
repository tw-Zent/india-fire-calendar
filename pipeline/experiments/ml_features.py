"""M4-ML experiment, step 1: features from MODIS clean detections per (tile, ph-part, UTC day) + S-NPP target.
Only MODIS (source) information is used as features. Output: data/processed/experiments/ml_panel.parquet
Panel = every (unit, day) with Terra+Aqua coverage (zero-filled; s null where S-NPP did not cover the day), so units with no MODIS fire are included."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import polars as pl
from config import INTERIM, PROC, PH_BBOX

OUT = PROC / "experiments"

def unit_cols():
    row = ((pl.col("latitude") + 90) * 10 + 1e-9).floor().cast(pl.Int32)
    col = ((pl.col("longitude") + 180) * 10 + 1e-9).floor().cast(pl.Int32)
    lat, lon = row / 10 - 90, col / 10 - 180
    ph = ((lat >= PH_BBOX["lat_min"]) & (lat < PH_BBOX["lat_max"]) & (lon >= PH_BBOX["lon_min"]) & (lon < PH_BBOX["lon_max"]))
    return [((row // 20) * 3600 + col // 20).alias("tile"), ph.alias("ph"), pl.col("acq_date").cast(pl.Int32).alias("d")]

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    key = ["satellite", "latitude", "longitude", "acq_date", "acq_time"]
    raw_scan = pl.concat([pl.scan_parquet(INTERIM / f"raw_modis_{p}.parquet").select(*key, "scan") for p in ("archive", "nrt")]).unique(subset=key)
    m = pl.scan_parquet(INTERIM / "clean_modis" / "*.parquet").join(raw_scan, on=key, how="left").with_columns(
        *unit_cols(), pl.col("confidence").cast(pl.Int32).alias("conf"),
        (pl.col("acq_time").str.slice(0, 2).cast(pl.Int32) * 60 + pl.col("acq_time").str.slice(2, 2).cast(pl.Int32)).alias("tmin"))
    aggs = []
    for sat, p in (("Terra", "t"), ("Aqua", "a")):
        for dn in ("D", "N"):
            f = (pl.col("satellite") == sat) & (pl.col("daynight") == dn)
            aggs.append(f.sum().alias(f"{p}{dn}_n"))
            aggs.append(pl.col("frp").filter(f).sum().alias(f"{p}{dn}_frp"))
        f = pl.col("satellite") == sat
        aggs += [pl.col("frp").filter(f).median().alias(f"{p}_frp_med"), pl.col("frp").filter(f).quantile(0.9).alias(f"{p}_frp_p90"),
                 pl.col("conf").filter(f).mean().alias(f"{p}_conf_mean"), (pl.col("conf").filter(f) >= 80).mean().alias(f"{p}_conf_hi"),
                 pl.col("scan").filter(f).mean().alias(f"{p}_scan"), pl.col("tmin").filter(f).mean().alias(f"{p}_tmin"),
                 pl.col("tmin").filter(f).std().alias(f"{p}_tmin_sd")]
    feat = m.group_by("tile", "ph", "d").agg(aggs).collect(engine="streaming")
    # target: S-NPP clean counts per unit-day (all, day, night)
    s = (pl.scan_parquet(INTERIM / "clean_snpp" / "*.parquet").with_columns(*unit_cols())
           .group_by("tile", "ph", "d").agg(pl.len().alias("s")).collect(engine="streaming"))
    cov = pl.read_parquet(INTERIM / "coverage_days.parquet").with_columns(pl.col("mask").cast(pl.Int32))
    days = cov.filter((pl.col("mask") & 3) == 3).select("d", ((pl.col("mask") & 4) == 4).alias("has_s"))  # Terra+Aqua covered
    units = pl.concat([feat.select("tile", "ph"), s.select("tile", "ph")]).unique()
    panel = (units.join(days, how="cross").join(feat, on=["tile", "ph", "d"], how="left").join(s, on=["tile", "ph", "d"], how="left"))
    cnt = [c for c in panel.columns if c.endswith("_n") or c.endswith("_frp")]
    panel = panel.with_columns([pl.col(c).fill_null(0) for c in cnt] + [pl.when(pl.col("has_s")).then(pl.col("s").fill_null(0)).otherwise(None).alias("s")])
    panel = panel.with_columns(
        pl.from_epoch(pl.col("d") * 86400).dt.month().cast(pl.Int8).alias("month"),
        pl.from_epoch(pl.col("d") * 86400).dt.year().cast(pl.Int16).alias("year"),
        pl.from_epoch(pl.col("d") * 86400).dt.ordinal_day().cast(pl.Int16).alias("doy"),
        ((pl.col("tile") // 3600) * 2 - 90 + 1).alias("lat_c"), ((pl.col("tile") % 3600) * 2 - 180 + 1).alias("lon_c"))
    panel.write_parquet(OUT / "ml_panel.parquet")
    print(panel.shape, "rows with S-NPP covered:", panel.filter(pl.col("has_s")).height, "S-NPP>0:", panel.filter(pl.col("s") > 0).height,
          "rows with S-NPP>0 & MODIS=0:", panel.filter((pl.col("s") > 0) & (pl.sum_horizontal([c for c in cnt if c.endswith("_n")]) == 0)).height)

if __name__ == "__main__":
    main()
