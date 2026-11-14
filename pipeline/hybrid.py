"""v1.3 hybrid (HQ D26): keep the ratio method's (M3) monthly totals, take the day-to-day shape from a LightGBM model.

For each unit (2-degree tile, split at the example bbox) x month, over the MODIS-filled Terra+Aqua days that have M3 > 0:
    h_hybrid(day) = M3_month_total * ML(day) / sum(ML over those days)
Days with M3 = 0 keep 0 (so monthly and annual totals equal M3 exactly, and cells are allocated by that day's M3 shares).
ML: LightGBM (Poisson), features from MODIS detections only, trained on 2012-2019 days when Terra, Aqua and S-NPP all flew.
Writes interim/hybrid_factors.parquet (tile, ph, d, f = h_hybrid / M3) and interim/hybrid_panel.parquet.
"""
import polars as pl
import polars.selectors  # noqa: F401
import lightgbm as lgb
from config import INTERIM, EXAMPLE_BBOX
from harmonize import fit_final, predict, FIT_YEARS_MODIS

PARAMS = dict(objective="poisson", n_estimators=600, learning_rate=0.05, num_leaves=63, min_child_samples=50,
              subsample=0.8, subsample_freq=1, colsample_bytree=0.8, reg_lambda=1.0, random_state=0, verbose=-1,
              deterministic=True, force_row_wise=True, num_threads=1, seed=20261114)  # v1.3.1: bit-for-bit reproducible
NOT_FEATURES = {"tile", "d", "s", "has_s", "year", "mask"}

def unit_cols():
    row = ((pl.col("latitude") + 90) * 10 + 1e-9).floor().cast(pl.Int32)
    col = ((pl.col("longitude") + 180) * 10 + 1e-9).floor().cast(pl.Int32)
    lat, lon = row / 10 - 90, col / 10 - 180
    b = EXAMPLE_BBOX
    ph = (lat >= b["lat_min"]) & (lat < b["lat_max"]) & (lon >= b["lon_min"]) & (lon < b["lon_max"])
    return [((row // 20) * 3600 + col // 20).alias("tile"), ph.alias("ph"), pl.col("acq_date").cast(pl.Int32).alias("d")]

def build_panel():
    key = ["satellite", "latitude", "longitude", "acq_date", "acq_time"]
    raw_scan = pl.concat([pl.scan_parquet(INTERIM / f"raw_modis_{p}.parquet").select(*key, "scan") for p in ("archive", "nrt")]).unique(subset=key)
    m = pl.scan_parquet(INTERIM / "clean_modis" / "*.parquet").join(raw_scan, on=key, how="left").with_columns(
        *unit_cols(), pl.col("confidence").cast(pl.Int32).alias("conf"),
        (pl.col("acq_time").str.slice(0, 2).cast(pl.Int32) * 60 + pl.col("acq_time").str.slice(2, 2).cast(pl.Int32)).alias("tmin"))
    aggs = []
    for sat, p in (("Terra", "t"), ("Aqua", "a")):
        for dn in ("D", "N"):
            f = (pl.col("satellite") == sat) & (pl.col("daynight") == dn)
            aggs += [f.sum().alias(f"{p}{dn}_n"), pl.col("frp").filter(f).sum().alias(f"{p}{dn}_frp")]
        f = pl.col("satellite") == sat
        aggs += [pl.col("frp").filter(f).median().alias(f"{p}_frp_med"), pl.col("frp").filter(f).quantile(0.9).alias(f"{p}_frp_p90"),
                 pl.col("conf").filter(f).mean().alias(f"{p}_conf_mean"), (pl.col("conf").filter(f) >= 80).mean().alias(f"{p}_conf_hi"),
                 pl.col("scan").filter(f).mean().alias(f"{p}_scan"), pl.col("tmin").filter(f).mean().alias(f"{p}_tmin"),
                 pl.col("tmin").filter(f).std().alias(f"{p}_tmin_sd")]
    feat = m.group_by("tile", "ph", "d").agg(aggs).collect(engine="streaming")
    feat = feat.with_columns(pl.selectors.float().round(6))   # strip summation-order noise
    s = (pl.scan_parquet(INTERIM / "clean_snpp" / "*.parquet").with_columns(*unit_cols())
           .group_by("tile", "ph", "d").agg(pl.len().alias("s")).collect(engine="streaming"))
    cov = pl.read_parquet(INTERIM / "coverage_days.parquet").with_columns(pl.col("mask").cast(pl.Int32))
    days = cov.filter((pl.col("mask") & 3) == 3).select("d", "mask", ((pl.col("mask") & 4) == 4).alias("has_s"))
    units = pl.concat([feat.select("tile", "ph"), s.select("tile", "ph")]).unique()
    panel = units.join(days, how="cross").join(feat, on=["tile", "ph", "d"], how="left").join(s, on=["tile", "ph", "d"], how="left")
    cnt = [c for c in panel.columns if c.endswith("_n") or c.endswith("_frp")]
    panel = panel.with_columns([pl.col(c).fill_null(0) for c in cnt] +
                               [pl.when(pl.col("has_s")).then(pl.col("s").fill_null(0)).otherwise(None).alias("s")])
    return panel.with_columns(
        pl.from_epoch(pl.col("d") * 86400).dt.month().cast(pl.Int8).alias("month"),
        pl.from_epoch(pl.col("d") * 86400).dt.year().cast(pl.Int16).alias("year"),
        pl.from_epoch(pl.col("d") * 86400).dt.ordinal_day().cast(pl.Int16).alias("doy"),
        ((pl.col("tile") // 3600) * 2 - 90 + 1).alias("lat_c"), ((pl.col("tile") % 3600) * 2 - 180 + 1).alias("lon_c")).sort("tile", "ph", "d")  # fixed row order -> reproducible model

def main():
    panel = build_panel()
    feats = [c for c in panel.columns if c not in NOT_FEATURES]
    tr = panel.filter(pl.col("has_s") & ((pl.col("mask") & 7) == 7) & pl.col("year").is_in(list(FIT_YEARS_MODIS)))
    model = lgb.LGBMRegressor(**PARAMS).fit(tr.select(feats).to_pandas(), tr["s"].to_numpy())
    model.booster_.save_model(str(INTERIM / "hybrid_lgbm.txt"))
    panel = panel.with_columns(pl.Series("ML", model.predict(panel.select(feats).to_pandas())))
    # M3 unit-day values on the days where h comes from Terra+Aqua (no VIIRS that day)
    td = pl.read_parquet(INTERIM / "tileday_dn.parquet")
    F = fit_final(td)
    ta_days = td.filter(((pl.col("mask") & 3) == 3) & ((pl.col("mask") & 12) == 0))
    m3 = predict(ta_days, F["ta"]).group_by("tile", "ph", "d").agg(pl.col("pred").sum().alias("M3"))
    x = panel.join(m3, on=["tile", "ph", "d"], how="inner").sort("tile", "ph", "d")
    um = ["tile", "ph", "year", "month"]
    x = x.with_columns(pl.when(pl.col("M3") > 0).then(pl.col("ML")).otherwise(0.0).alias("_ml"))
    x = x.with_columns(pl.col("M3").sum().over(um).alias("_m3m"), pl.col("_ml").sum().over(um).alias("_mlm"))
    x = x.with_columns(pl.when(pl.col("_mlm") > 0).then(pl.col("_m3m") * pl.col("_ml") / pl.col("_mlm")).otherwise(pl.col("M3")).alias("HY"))
    x = x.with_columns(pl.when(pl.col("M3") > 0).then(pl.col("HY") / pl.col("M3")).otherwise(1.0).alias("f"))
    x.select("tile", "ph", "d", "f").write_parquet(INTERIM / "hybrid_factors.parquet")
    x.select("tile", "ph", "d", "year", "month", "M3", "ML", "HY").write_parquet(INTERIM / "hybrid_panel.parquet")
    chk = x.group_by("year").agg(pl.col("M3").sum(), pl.col("HY").sum()).with_columns((pl.col("HY") / pl.col("M3") - 1).abs().alias("rel")).filter(pl.col("M3") > 0)
    assert chk["rel"].max() < 1e-9, chk
    print("hybrid factors:", x.height, "unit-days; annual totals equal M3 (max rel diff %.1e)" % chk["rel"].max())

if __name__ == "__main__":
    main()
