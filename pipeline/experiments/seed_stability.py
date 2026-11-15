"""D53 stability bar: 5-seed ensemble A (production, seeds 20261114+0..4) vs ensemble B (seeds 20261114+100..104).
Change in daily totals on MODIS Terra+Aqua days: P&H box (sum of P&H units) and India. -> reports/seed_stability.csv"""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import polars as pl
from config import INTERIM, REPORTS
from hybrid import compute_hy

def stats(a, b, label, filt=None):
    x = a.join(b, on=["tile", "ph", "d"])
    if filt is not None: x = x.filter(filt)
    x = x.group_by("d").agg(pl.col("HYa").sum(), pl.col("HYb").sum()).filter(pl.col("HYa") > 0)
    r = x.with_columns(((pl.col("HYb") - pl.col("HYa")).abs() / pl.col("HYa")).alias("rel"))
    q = r.select(pl.col("rel").median().alias("median"), pl.col("rel").quantile(0.9).alias("p90"), pl.col("rel").max().alias("max"), pl.len().alias("n_days")).to_dicts()[0]
    top = r.sort("rel", descending=True).head(1).to_dicts()[0]
    print(f"{label}: median {q['median']:.2%} p90 {q['p90']:.2%} max {q['max']:.1%} (d={top['d']}, {top['HYa']:.0f} -> {top['HYb']:.0f}) n={q['n_days']}")
    return {"level": label, **q}

def main():
    a = pl.read_parquet(INTERIM / "hybrid_panel.parquet").select("tile", "ph", "d", pl.col("HY").alias("HYa"))
    b = compute_hy([20261114 + 100 + k for k in range(5)]).select("tile", "ph", "d", pl.col("HY").alias("HYb"))
    b.write_parquet(INTERIM / "hybrid_panel_seedsB.parquet")
    rows = [stats(a, b, "P&H daily total", pl.col("ph")), stats(a, b, "India daily total")]
    c = a.join(b, on=["tile", "ph", "d"]).filter(pl.col("HYa") > 0).with_columns(((pl.col("HYb") - pl.col("HYa")).abs() / pl.col("HYa")).alias("rel"))
    print("unit-day (2-deg tile): median %.2f%% p90 %.2f%%" % (100 * c["rel"].median(), 100 * c["rel"].quantile(0.9)))
    pl.DataFrame(rows).write_csv(REPORTS / "seed_stability.csv")

if __name__ == "__main__":
    main()
