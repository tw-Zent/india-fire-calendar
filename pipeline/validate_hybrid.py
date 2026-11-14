"""Hold-out validation of the v1.3 hybrid (same metrics as validate_final.py).
ML + ratios fit on 2012, 2014, 2015, 2016, 2018, 2019; tested on hold-outs 2013/2017/2021/2025 and fresh years 2020/2022/2023/2024.
Pre-set bar (HQ, 15:02 Sat, before results): daily nmae -20% vs M3 on both test sets and regions; monthly nmae <= M3 + 0.005;
P&H total bias within +-5%; no step; Oct-Nov peak shift <= M3 + 1 day.  -> reports/validation_hybrid.{csv,md}"""
import polars as pl, lightgbm as lgb
from config import INTERIM, REPORTS, REGION_NAME, EXAMPLE_NAME
from validate import metrics
from harmonize import fit, predict
from hybrid import build_panel, PARAMS, NOT_FEATURES

TRAIN = [2012, 2014, 2015, 2016, 2018, 2019]
SETS = {"held-out 2013/2017/2021/2025": [2013, 2017, 2021, 2025], "fresh 2020/2022/2023/2024": [2020, 2022, 2023, 2024]}

def main():
    p = build_panel()
    feats = [c for c in p.columns if c not in NOT_FEATURES]
    p = p.filter((pl.col("mask") & 7) == 7)                       # days when Terra, Aqua and S-NPP all flew
    tr = p.filter(pl.col("year").is_in(TRAIN))
    model = lgb.LGBMRegressor(**PARAMS).fit(tr.select(feats).to_pandas(), tr["s"].to_numpy())
    p = p.with_columns(pl.Series("ML", model.predict(p.select(feats).to_pandas())))
    td = pl.read_parquet(INTERIM / "tileday_dn.parquet").filter((pl.col("mask") & 7) == 7)
    f3 = fit(td.filter(pl.col("year").is_in(TRAIN)), "ta", "M3", 200.0)
    m3 = predict(td, f3).group_by("tile", "ph", "d").agg(pl.col("pred").sum().alias("M3"))
    x = p.join(m3, on=["tile", "ph", "d"], how="left").with_columns(pl.col("M3").fill_null(0.0)).sort("tile", "ph", "d")
    um = ["tile", "ph", "year", "month"]
    x = x.with_columns(pl.when(pl.col("M3") > 0).then(pl.col("ML")).otherwise(0.0).alias("_ml"))
    x = x.with_columns(pl.col("M3").sum().over(um).alias("_m"), pl.col("_ml").sum().over(um).alias("_s"))
    x = x.with_columns(pl.when(pl.col("_s") > 0).then(pl.col("_m") * pl.col("_ml") / pl.col("_s")).otherwise(pl.col("M3")).alias("HY"))
    rows = []
    for lab, yrs in SETS.items():
        te = x.filter(pl.col("year").is_in(yrs))
        for reg, sub in ((REGION_NAME, te), (EXAMPLE_NAME, te.filter(pl.col("ph")))):
            m = metrics(sub.with_columns(pl.col("M3").alias("pred")), reg); h = metrics(sub.with_columns(pl.col("HY").alias("pred")), reg)
            rows.append({"test": lab, "region": reg, **{f"{k}_M3": m[k] for k in m if k != "region"}, **{f"{k}_HY": h[k] for k in h if k != "region"},
                         "daily_nmae_change": round(h["daily_nmae"] / m["daily_nmae"] - 1, 3)})
    t = pl.DataFrame(rows); t.write_csv(REPORTS / "validation_hybrid.csv")
    L = ["| test years | region | daily error ratio / hybrid | daily r ratio / hybrid | monthly error ratio / hybrid | total bias ratio / hybrid | Oct–Nov peak shift (d) ratio / hybrid |", "|---|---|---|---|---|---|---|"]
    for r in rows:
        L.append(f"| {r['test']} | {r['region'].replace('_', ' & ')} | {r['daily_nmae_M3']:.0%} / {r['daily_nmae_HY']:.0%} ({r['daily_nmae_change']:+.0%}) | {r['daily_r_M3']} / {r['daily_r_HY']} | "
                 f"{r['monthly_nmae_M3']:.1%} / {r['monthly_nmae_HY']:.1%} | {r['total_bias_M3']:+.1%} / {r['total_bias_HY']:+.1%} | {r['octnov_peak_shift_days_M3']} / {r['octnov_peak_shift_days_HY']} |")
    (REPORTS / "validation_hybrid.md").write_text("\n".join(L) + "\n"); print("\n".join(L))

if __name__ == "__main__":
    main()
