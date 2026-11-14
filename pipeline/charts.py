"""Evidence charts -> data/processed/reports/annual_totals.png, ph_octnov_daily.png"""
import datetime as dt
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
import polars as pl
from config import REGION_NAME, EXAMPLE_NAME, INTERIM, REPORTS
from harmonize import fit_final, apply_final, fit

C = {"t": "#2a78d6", "a": "#eb6834", "s": "#1baf7a", "n": "#eda100", "hb": "#e87ba4", "hm": "#008300"}
NAME = {"t": "MODIS Terra", "a": "MODIS Aqua", "s": "VIIRS S-NPP", "n": "VIIRS NOAA-20",
        "hb": "harmonized: constant ratio (D7 baseline)", "hm": "harmonized: final v1.3"}

def style(ax):
    for sp in ("top", "right"): ax.spines[sp].set_visible(False)
    ax.grid(axis="y", color="#e5e4df", lw=0.8); ax.set_axisbelow(True); ax.tick_params(colors="#55554f", labelsize=8)

def baseline(td):
    m = pl.col("mask"); has = lambda b: (m & b) == b
    k = {c: fit(td, c, "B0")["k0"] for c in ("ta", "t", "a", "n")}
    return (pl.when(has(4)).then(pl.col("s").cast(pl.Float64)).when(has(8)).then(pl.col("n") * k["n"])
              .when(has(3)).then((pl.col("t") + pl.col("a")) * k["ta"]).when(has(1)).then(pl.col("t") * k["t"])
              .when(has(2)).then(pl.col("a") * k["a"]))

def main():
    td = pl.read_parquet(INTERIM / "tileday_dn.parquet")
    x = apply_final(td, fit_final(td)).rename({"h": "hm"}).with_columns(baseline(td).alias("hb"))
    fac = pl.read_parquet(INTERIM / "hybrid_factors.parquet")       # v1.3 day-shape on MODIS Terra+Aqua days
    x = x.join(fac, on=["tile", "ph", "d"], how="left").with_columns((pl.col("hm") * pl.col("f").fill_null(1.0)).alias("hm")).drop("f")
    fig, axes = plt.subplots(2, 2, figsize=(12, 7.5), sharex=True)
    for col, (reg, sub) in enumerate(((REGION_NAME, x), (EXAMPLE_NAME.replace("_", " ") + " bbox", x.filter(pl.col("ph"))))):
        yr = sub.filter(pl.col("year").is_between(2001, 2025)).group_by("year").agg([pl.col(k).sum() for k in ("t", "a", "s", "n", "hb", "hm")]).sort("year")
        ax = axes[0, col]
        for k in "tasn":
            v = yr.with_columns(pl.when(pl.col(k) > 0).then(pl.col(k)).otherwise(None).alias(k))
            ax.plot(v["year"], v[k], color=C[k], lw=2, marker="o", ms=4, label=NAME[k])
        ax.set_yscale("log"); ax.set_title(f"{reg}: clean detections per satellite (log)", fontsize=10, loc="left"); style(ax)
        ax = axes[1, col]
        ax.plot(yr["year"], yr["s"].replace(0, None), color=C["s"], lw=5, alpha=0.35, label="VIIRS S-NPP (reference)")
        ax.plot(yr["year"], yr["hb"], color=C["hb"], lw=2, marker="o", ms=4, label=NAME["hb"])
        ax.plot(yr["year"], yr["hm"], color=C["hm"], lw=2, marker="s", ms=4, label=NAME["hm"])
        for b in (2002.5, 2011.5, 2018.25): ax.axvline(b, color="#8a8980", lw=0.8, ls="--")
        ax.set_title(f"{reg}: harmonized, S-NPP-equivalent detections / yr", fontsize=10, loc="left"); style(ax); ax.set_ylim(bottom=0)
    axes[0, 0].legend(fontsize=8, frameon=False); axes[1, 0].legend(fontsize=8, frameon=False)
    fig.suptitle("Annual totals 2001–2025 (full years). Dashed: Aqua joins Jul 2002, S-NPP Jan 2012, NOAA-20 Apr 2018.", fontsize=9, color="#55554f")
    fig.tight_layout(); fig.savefig(REPORTS / "annual_totals.png", dpi=130); plt.close(fig)

    # P&H Oct-Nov daily, 3 regimes
    ph = x.filter(pl.col("ph")).group_by("d", "year", "mask").agg([pl.col(k).sum() for k in ("t", "a", "s", "n", "hm")])
    fig, axes = plt.subplots(3, 1, figsize=(11, 8), sharey=False)
    for ax, y in zip(axes, (2005, 2016, 2024)):
        d0 = (dt.date(y, 10, 1) - dt.date(1970, 1, 1)).days
        days = pl.DataFrame({"d": list(range(d0, d0 + 61))})
        s = days.join(ph, on="d", how="left").sort("d")
        xs = [dt.date(1970, 1, 1) + dt.timedelta(int(v)) for v in s["d"]]
        ax.bar(xs, s["hm"].fill_null(0), color=C["hm"], width=0.8, label="harmonized h (S-NPP-equivalent)")
        for k in ("t", "a", "s", "n"):
            if s[k].fill_null(0).sum() > 0:
                ax.plot(xs, s[k].fill_null(0), color=C[k], lw=1.5, label=NAME[k] + " (raw)")
        cov = pl.read_parquet(INTERIM / "coverage_days.parquet")
        nocov = set(days["d"].to_list()) - set(cov.filter(pl.col("mask") > 0)["d"].to_list())
        for d in nocov:
            ax.axvspan(dt.date(1970, 1, 1) + dt.timedelta(d - 0.5), dt.date(1970, 1, 1) + dt.timedelta(d + 0.5), color="#d4d3cd")
        ax.set_title(f"{EXAMPLE_NAME.replace('_', ' ')} bbox, Oct–Nov {y}", fontsize=10, loc="left"); style(ax)
        ax.legend(fontsize=7, frameon=False, loc="upper left")
    fig.tight_layout(); fig.savefig(REPORTS / "ph_octnov_daily.png", dpi=120); plt.close(fig)
    print("charts written")

if __name__ == "__main__":
    main()
