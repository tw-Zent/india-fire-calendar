"""M5-hybrid (HQ 15:02): h_hybrid(day) = M3_monthly_total(unit, month) * ML(day) / sum ML(days of that unit-month).
Fallback to M3 daily where the ML monthly sum is 0. Existing LightGBM settings, not re-tuned.
Units = 2-degree tile x P&H part. Only Terra+Aqua days (modis_ta regime) are hybridised.
Evaluated on (1) original hold-outs 2013/2017/2021/2025 and (2) fresh years 2020/2022/2023/2024.
Model + M3 ratios are fit on 2012, 2014, 2015, 2016, 2018, 2019 (never on either test set)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import polars as pl
from config import INTERIM
from validate import metrics
from harmonize import fit, predict
from ml_eval import train, OUT

TRAIN = [2012, 2014, 2015, 2016, 2018, 2019]
HOLD = [2013, 2017, 2021, 2025]
FRESH = [2020, 2022, 2023, 2024]
KEY = ["tile", "ph", "d"]

def build():
    panel = pl.read_parquet(OUT / "ml_panel.parquet")
    model, feats = train(panel, TRAIN)                      # identical to the M4-ML model
    panel = panel.with_columns(pl.Series("ML", model.predict(panel.select(feats).to_pandas())))
    td = pl.read_parquet(INTERIM / "tileday_dn.parquet").filter((pl.col("mask") & 3) == 3)
    tr = td.filter(pl.col("year").is_in(TRAIN) & ((pl.col("mask") & 7) == 7))
    ref = None
    for name, mdl in (("B0", "B0"), ("M3", "M3")):
        p = predict(td, fit(tr, "ta", mdl, 200.0)).group_by(KEY).agg(pl.col("pred").sum().alias(name))
        ref = p if ref is None else ref.join(p, on=KEY, how="full", coalesce=True)
    x = panel.join(ref, on=KEY, how="left").with_columns(pl.col("B0").fill_null(0), pl.col("M3").fill_null(0))
    um = ["tile", "ph", "year", "month"]
    x = x.with_columns(pl.col("M3").sum().over(um).alias("_m3m"), pl.col("ML").sum().over(um).alias("_mlm"))
    x = x.with_columns(pl.when(pl.col("_mlm") > 0).then(pl.col("_m3m") * pl.col("ML") / pl.col("_mlm")).otherwise(pl.col("M3")).alias("HY")).drop("_m3m", "_mlm")
    return x

def table(x, years, label):
    te = x.filter(pl.col("has_s") & pl.col("year").is_in(years))
    rows = []
    for reg in ("India", "Punjab_Haryana"):
        sub = te if reg == "India" else te.filter(pl.col("ph"))
        for k in ("B0", "M3", "ML", "HY"):
            m = metrics(sub.with_columns(pl.col(k).alias("pred")), reg)
            rows.append({"test": label, "model": k, **m})
    return pl.DataFrame(rows)

def main():
    x = build()
    x.select(*KEY, "year", "month", "has_s", "s", "B0", "M3", "ML", "HY").write_parquet(OUT / "hybrid_panel.parquet")
    t = pl.concat([table(x, HOLD, "holdout_2013_2017_2021_2025"), table(x, FRESH, "fresh_2020_2022_2023_2024")])
    t.write_csv(OUT / "hybrid_validation.csv")
    with pl.Config(tbl_rows=40, tbl_width_chars=200):
        print(t)
    # step check: annual totals on Terra+Aqua days, 2001-2016
    a = x.filter(pl.col("year").is_between(2002, 2014)).group_by("year").agg(pl.col("M3").sum(), pl.col("HY").sum(), pl.col("s").sum()).sort("year")
    ap = x.filter(pl.col("ph") & pl.col("year").is_between(2002, 2014)).group_by("year").agg(pl.col("M3").sum(), pl.col("HY").sum(), pl.col("s").sum()).sort("year")
    print("India annual (TA days):", [(r["year"], round(r["M3"]), round(r["HY"])) for r in a.iter_rows(named=True)])
    print("P&H annual (TA days):", [(r["year"], round(r["M3"]), round(r["HY"])) for r in ap.iter_rows(named=True)])

if __name__ == "__main__":
    main()
