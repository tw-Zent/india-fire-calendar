"""M4-ML step 3: per-year breakdown on held-out years + annual totals 2003-2016 (step-at-2012 check)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import polars as pl, lightgbm as lgb
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from config import INTERIM, PROC
from harmonize import fit, predict, FIT_YEARS_MODIS
from ml_eval import train, HOLD, OUT

def main():
    panel = pl.read_parquet(OUT / "ml_panel.parquet")
    years = [y for y in FIT_YEARS_MODIS if y not in HOLD]
    model, feats = train(panel, years)
    panel = panel.with_columns(pl.Series("ML", model.predict(panel.select(feats).to_pandas())))
    td = pl.read_parquet(INTERIM / "tileday_dn.parquet").filter((pl.col("mask") & 3) == 3)
    tr = td.filter(pl.col("year").is_in(years) & ((pl.col("mask") & 7) == 7))
    ref = None
    for name, mdl in (("B0", "B0"), ("M3", "M3")):
        p = predict(td, fit(tr, "ta", mdl, 200.0)).group_by("tile", "ph", "d").agg(pl.col("pred").sum().alias(name))
        ref = p if ref is None else ref.join(p, on=["tile", "ph", "d"], how="full", coalesce=True)
    x = panel.join(ref, on=["tile", "ph", "d"], how="left").with_columns(pl.col("B0").fill_null(0), pl.col("M3").fill_null(0))
    # per held-out year, monthly nmae P&H
    rows = []
    for y in HOLD:
        for reg, sub in (("India", x), ("Punjab_Haryana", x.filter(pl.col("ph")))):
            mon = sub.filter((pl.col("year") == y) & pl.col("has_s")).group_by("month").agg(pl.col("s").sum(), pl.col("M3").sum(), pl.col("ML").sum())
            rows.append({"year": y, "region": reg, "monthly_nmae_M3": round(((mon["M3"] - mon["s"]).abs().sum() / mon["s"].sum()), 3),
                         "monthly_nmae_ML": round(((mon["ML"] - mon["s"]).abs().sum() / mon["s"].sum()), 3),
                         "bias_M3": round(mon["M3"].sum() / mon["s"].sum() - 1, 3), "bias_ML": round(mon["ML"].sum() / mon["s"].sum() - 1, 3)})
    by = pl.DataFrame(rows); by.write_csv(OUT / "ml_by_year.csv"); print(by)
    # annual totals, Terra+Aqua days, 2003-2016 (ML/M3/B0 from MODIS; S-NPP where it flew)
    fig, axes = plt.subplots(1, 2, figsize=(13, 4.5))
    for ax, (reg, sub) in zip(axes, (("India", x), ("Punjab & Haryana", x.filter(pl.col("ph"))))):
        a = sub.filter(pl.col("year").is_between(2003, 2016)).group_by("year").agg(
            pl.col("B0").sum(), pl.col("M3").sum(), pl.col("ML").sum(), pl.col("s").sum()).sort("year")
        print(reg, a.with_columns([pl.col(c).round(0) for c in ("B0", "M3", "ML")]).to_dicts()[7:11])
        for k, c in (("B0", "#e87ba4"), ("M3", "#008300"), ("ML", "#2a78d6")):
            ax.plot(a["year"], a[k], color=c, lw=2, marker="o", ms=4, label=f"{k} (from MODIS)")
        s = a.filter(pl.col("s") > 0)
        ax.plot(s["year"], s["s"], color="#1baf7a", lw=6, alpha=0.35, label="S-NPP observed")
        ax.axvline(2011.5, color="#8a8980", ls="--", lw=0.8); ax.set_title(reg, loc="left"); ax.set_ylim(bottom=0)
        for sp in ("top", "right"): ax.spines[sp].set_visible(False)
    axes[0].legend(frameon=False, fontsize=8)
    fig.suptitle("M4-ML experiment: annual totals on Terra+Aqua days, models fit on 2012-2019 (minus 2013, 2017)", fontsize=9)
    fig.tight_layout(); fig.savefig(OUT / "ml_annual_totals.png", dpi=110)

if __name__ == "__main__":
    main()
