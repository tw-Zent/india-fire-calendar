"""M4-ML experiment, step 2: LightGBM (Poisson) MODIS -> S-NPP per (tile, ph-part, day); validate exactly like M3.
Hold-out 2013, 2017, 2021, 2025. Outputs in data/processed/experiments/."""
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import numpy as np, polars as pl, lightgbm as lgb
from config import INTERIM, PROC
from validate import metrics
from harmonize import fit, predict, FIT_YEARS_MODIS

OUT = PROC / "experiments"
HOLD = [2013, 2017, 2021, 2025]
DROP = {"tile", "d", "s", "has_s", "year"}

def m3_b0_preds(train_years):
    td = pl.read_parquet(INTERIM / "tileday_dn.parquet")
    ok = td.filter((pl.col("mask") & 7) == 7)
    tr = ok.filter(pl.col("year").is_in(train_years))
    out = {}
    for name, model in (("B0", "B0"), ("M3", "M3")):
        p = predict(ok, fit(tr, "ta", model, 200.0))
        out[name] = p.group_by("tile", "ph", "d").agg(pl.col("pred").sum().alias(name))
    return out["B0"].join(out["M3"], on=["tile", "ph", "d"])

def train(panel, years, seed=0):
    tr = panel.filter(pl.col("has_s") & pl.col("year").is_in(years))
    feats = [c for c in panel.columns if c not in DROP]
    X = tr.select(feats).to_pandas(); y = tr["s"].to_numpy()
    model = lgb.LGBMRegressor(objective="poisson", n_estimators=600, learning_rate=0.05, num_leaves=63,
                              min_child_samples=50, subsample=0.8, subsample_freq=1, colsample_bytree=0.8,
                              reg_lambda=1.0, random_state=seed, verbose=-1)
    model.fit(X, y)
    return model, feats

def evaluate(panel, model, feats, ref):
    te = panel.filter(pl.col("has_s") & pl.col("year").is_in(HOLD))
    te = te.with_columns(pl.Series("ML", model.predict(te.select(feats).to_pandas())))
    te = te.join(ref, on=["tile", "ph", "d"], how="left").with_columns(pl.col("B0").fill_null(0), pl.col("M3").fill_null(0))
    rows = []
    for reg in ("India", "Punjab_Haryana"):
        sub = te if reg == "India" else te.filter(pl.col("ph"))
        r = {"region": reg}
        for k in ("B0", "M3", "ML"):
            mm = metrics(sub.with_columns(pl.col(k).alias("pred")), reg)
            r.update({f"{m}_{k}": v for m, v in mm.items() if m != "region"})
        rows.append(r)
    return pl.DataFrame(rows), te

def main(variant="fit2012_2019"):
    panel = pl.read_parquet(OUT / "ml_panel.parquet")
    years = [y for y in (FIT_YEARS_MODIS if variant == "fit2012_2019" else range(2012, 2027)) if y not in HOLD]
    ref = m3_b0_preds(years)
    model, feats = train(panel, years)
    res, te = evaluate(panel, model, feats, ref)
    res = res.with_columns(pl.lit(variant).alias("variant"))
    res.write_csv(OUT / f"ml_validation_{variant}.csv")
    # importances (gain)
    imp = sorted(zip(feats, model.booster_.feature_importance("gain")), key=lambda x: -x[1])
    tot = sum(v for _, v in imp)
    pl.DataFrame({"feature": [f for f, _ in imp], "gain_share": [round(v / tot, 4) for _, v in imp]}).write_csv(OUT / f"ml_importance_{variant}.csv")
    model.booster_.save_model(str(OUT / f"ml_model_{variant}.txt"))
    with pl.Config(tbl_cols=30, tbl_width_chars=250):
        print(res.select("region", *[c for c in res.columns if c.startswith(("daily_nmae", "daily_r", "monthly_nmae", "total_bias", "octnov"))]))
    print("top5:", [(f, round(v / tot, 3)) for f, v in imp[:5]])
    return model, feats

if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "fit2012_2019")
