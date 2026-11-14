"""Submission figure (1920x1080): harmonized vs constant-ratio baseline vs S-NPP reference, India + P&H.
-> data/processed/reports/fig_harmonized_record.png"""
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
import polars as pl
from config import REGION_NAME, EXAMPLE_NAME, INTERIM, REPORTS
from harmonize import fit_final, apply_final
from charts import baseline

GREEN, PINK, AQUA, INK, MUTED, GRID = "#008300", "#e87ba4", "#1baf7a", "#1f1f1c", "#55554f", "#e5e4df"

def main():
    td = pl.read_parquet(INTERIM / "tileday_dn.parquet")
    x = apply_final(td, fit_final(td)).rename({"h": "hm"}).with_columns(baseline(td).alias("hb"))
    fac = pl.read_parquet(INTERIM / "hybrid_factors.parquet")
    x = x.join(fac, on=["tile", "ph", "d"], how="left").with_columns((pl.col("hm") * pl.col("f").fill_null(1.0)).alias("hm")).drop("f")
    plt.rcParams.update({"font.size": 18, "font.family": "DejaVu Sans"})
    fig, axes = plt.subplots(1, 2, figsize=(16, 9), dpi=120)
    for ax, (reg, sub) in zip(axes, ((REGION_NAME, x), (EXAMPLE_NAME.replace("_", " & "), x.filter(pl.col("ph"))))):
        yr = sub.filter(pl.col("year").is_between(2001, 2025)).group_by("year").agg(
            pl.col("s").sum(), pl.col("hb").sum(), pl.col("hm").sum()).sort("year")
        ys = yr.filter(pl.col("s") > 0)
        ax.plot(ys["year"], ys["s"] / 1000, color=AQUA, lw=12, alpha=0.35, solid_capstyle="round", label="VIIRS S-NPP (reference)")
        ax.plot(yr["year"], yr["hb"] / 1000, color=PINK, lw=2.5, marker="o", ms=8, label="Constant ratio (baseline)")
        ax.plot(yr["year"], yr["hm"] / 1000, color=GREEN, lw=3.5, marker="s", ms=9, label="Harmonized v1.3")
        for b, lab in ((2002.5, "Aqua joins"), (2011.5, "S-NPP starts"), (2018.25, "NOAA-20 joins")):
            ax.axvline(b, color="#8a8980", lw=1.2, ls="--")
            ax.text(b + 0.25, 0.02, lab, transform=ax.get_xaxis_transform(), rotation=90, va="bottom", fontsize=13, color=MUTED)
        ax.set_title(reg, loc="left", fontsize=24, color=INK, fontweight="bold", pad=12)
        ax.set_ylabel("Fire detections per year (thousands,\nS-NPP-equivalent)", fontsize=16, color=MUTED)
        ax.set_ylim(bottom=0); ax.set_xlim(2000.5, 2025.5)
        ax.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{v:,.0f}"))
        for sp in ("top", "right"): ax.spines[sp].set_visible(False)
        for sp in ("left", "bottom"): ax.spines[sp].set_color("#b9b8b0")
        ax.grid(axis="y", color=GRID, lw=1); ax.set_axisbelow(True); ax.tick_params(colors=MUTED, labelsize=16)
    h, l = axes[0].get_legend_handles_labels()
    fig.legend(h[::-1], l[::-1], loc="upper center", ncol=3, frameon=False, fontsize=17, bbox_to_anchor=(0.5, 0.945))
    fig.suptitle("Harmonized MODIS + VIIRS active-fire record, 2001–2025", fontsize=28, fontweight="bold", color=INK, y=0.995)
    fig.text(0.5, 0.015, "Harmonized record (green) follows S-NPP where it exists and has no step at 2012.   "
             f"Data: NASA FIRMS (MODIS C6.1, VIIRS 375 m), {REGION_NAME}, full years.", ha="center", fontsize=15, color=MUTED)
    fig.tight_layout(rect=(0, 0.04, 1, 0.93))
    fig.savefig(REPORTS / "fig_harmonized_record.png", dpi=120)
    print("saved")

if __name__ == "__main__":
    main()
