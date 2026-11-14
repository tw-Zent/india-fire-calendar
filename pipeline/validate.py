"""Hold-out validation of harmonization models (HQ D7). Writes reports/validation*.csv."""
import sys
import polars as pl
from config import REGION_NAME, EXAMPLE_NAME, INTERIM, REPORTS, PH_BBOX
from harmonize import fit, predict, add_keys, NEED

HOLDOUT = [2013, 2017, 2021, 2025]
OVERLAP_TA = range(2012, 2027)

def tileday():
    g = pl.scan_parquet(INTERIM / "grid_dn" / "*.parquet")
    cov = pl.read_parquet(INTERIM / "coverage_days.parquet").with_columns(pl.col("mask").cast(pl.Int32)).lazy()
    row, col = pl.col("cell_id") // 3600, pl.col("cell_id") % 3600
    tile = ((row // 20) * 3600 + col // 20).alias("tile")
    lat, lon = row / 10 - 90, col / 10 - 180
    inph = ((lat >= PH_BBOX["lat_min"]) & (lat < PH_BBOX["lat_max"]) & (lon >= PH_BBOX["lon_min"]) & (lon < PH_BBOX["lon_max"])).alias("ph")
    t = (g.with_columns(tile, inph).group_by("tile", "ph", "d", "dn", "k").agg(pl.col("cnt").cast(pl.Int64).sum())
          .collect(engine="streaming").pivot(on="k", index=["tile", "ph", "d", "dn"], values="cnt").fill_null(0))
    return add_keys(t.lazy().join(cov, on="d", how="left").collect())

def metrics(df, region):
    """df: per-day obs (s) and pred, holdout days only."""
    day = df.group_by("d", "year", "month").agg(pl.col("s").sum().alias("obs"), pl.col("pred").sum().alias("pred")).sort("d")
    nmae = (day["obs"] - day["pred"]).abs().sum() / day["obs"].sum()
    corr = day.select(pl.corr("obs", "pred")).item()
    mon = day.group_by("year", "month").agg(pl.col("obs").sum(), pl.col("pred").sum())
    mon_nmae = (mon["obs"] - mon["pred"]).abs().sum() / mon["obs"].sum()
    bias = day["pred"].sum() / day["obs"].sum() - 1
    # Oct-Nov peak timing (7-day centred mean), per holdout year
    on = day.filter(pl.col("month").is_in([10, 11])).with_columns(
        pl.col("obs").rolling_mean(7, center=True, min_samples=1).over("year").alias("o7"),
        pl.col("pred").rolling_mean(7, center=True, min_samples=1).over("year").alias("p7"))
    pk = on.group_by("year").agg(pl.col("d").sort_by("o7").last().alias("po"), pl.col("d").sort_by("p7").last().alias("pp"))
    peak = (pk["pp"] - pk["po"]).abs().mean()
    return dict(region=region, daily_nmae=round(nmae, 3), daily_r=round(corr, 3), monthly_nmae=round(mon_nmae, 3),
                total_bias=round(bias, 3), octnov_peak_shift_days=round(float(peak), 1))

def main(alpha=50.0):
    td = tileday()
    rows = []
    for cfg in ("ta", "t", "n"):
        need = NEED[cfg]
        ok = td.filter((pl.col("mask") & need) == need)
        train = ok.filter(~pl.col("year").is_in(HOLDOUT))
        test = ok.filter(pl.col("year").is_in(HOLDOUT))
        for model in ("B0", "M1", "M2", "M3"):
            f = fit(train, cfg, model, alpha)
            p = predict(test, f)
            for region, sub in ((REGION_NAME, p), (EXAMPLE_NAME, p.filter(pl.col("ph")))):
                rows.append(dict(source=cfg, model=model, alpha=alpha, **metrics(sub, region)))
            print(rows[-2], rows[-1], flush=True)
    out = pl.DataFrame(rows)
    out.write_csv(REPORTS / f"validation_alpha{int(alpha)}.csv")
    return out

if __name__ == "__main__":
    main(float(sys.argv[1]) if len(sys.argv) > 1 else 50.0)
