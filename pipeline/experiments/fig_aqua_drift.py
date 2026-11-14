"""Submission figure (1920x1080) of the Aqua overpass drift -> data/processed/reports/fig_aqua_drift.png
Input: reports/aqua_overpass_drift.csv (from aqua_drift.py)."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import matplotlib; matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.ticker import FuncFormatter
import polars as pl
from config import REPORTS, EXAMPLE_NAME

COL = {"Aqua": "#eb6834", "N20": "#eda100", "SNPP": "#1baf7a", "Terra": "#2a78d6"}
NM = {"Aqua": "MODIS Aqua", "N20": "VIIRS NOAA-20", "SNPP": "VIIRS S-NPP", "Terra": "MODIS Terra"}
INK, MUTED, GRID = "#1f1f1c", "#55554f", "#e5e4df"

def main():
    d = pl.read_csv(REPORTS / "aqua_overpass_drift.csv")
    plt.rcParams.update({"font.size": 18, "font.family": "DejaVu Sans"})
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(16, 9), dpi=120, gridspec_kw={"width_ratios": [1.35, 1]})
    for s in ("Terra", "Aqua", "SNPP", "N20"):
        x = d.filter(pl.col("satellite") == s).sort("year")
        a1.fill_between(x["year"], x["lst_q25"], x["lst_q75"], color=COL[s], alpha=0.15, lw=0)
        a1.plot(x["year"], x["lst_med"], color=COL[s], lw=4 if s == "Aqua" else 3, marker="o", ms=9, label=NM[s])
    a1.yaxis.set_major_formatter(FuncFormatter(lambda v, _: f"{int(v):02d}:{int(round((v % 1) * 60)) % 60:02d}"))
    a1.set_ylim(8.75, 16.25)
    a1.set_title("When each satellite sees the fires", loc="left", fontsize=24, fontweight="bold", color=INK, pad=12)
    a1.set_ylabel("Daytime detection time\n(local solar time, median and middle half)", fontsize=16, color=MUTED)
    a1.legend(frameon=False, fontsize=16, loc="upper left", ncol=2)
    r = d.filter(pl.col("satellite") == "Aqua").sort("year")
    a2.bar(r["year"], r["aqua_n20_ratio_all"], color=COL["Aqua"], width=0.7)
    a2.axhline(1, color="#8a8980", lw=1.5, ls="--")
    a2.text(2017.6, 1.03, "Aqua = NOAA-20", fontsize=14, color=MUTED)
    for yv, v in zip(r["year"], r["aqua_n20_ratio_all"]):
        if yv >= 2024: a2.text(yv, v + 0.03, f"{v:.2f}", ha="center", fontsize=15, color=INK)
    a2.set_title("Aqua fires per NOAA-20 fire", loc="left", fontsize=24, fontweight="bold", color=INK, pad=12)
    a2.set_ylim(0, 1.3)
    for a in (a1, a2):
        for sp in ("top", "right"): a.spines[sp].set_visible(False)
        for sp in ("left", "bottom"): a.spines[sp].set_color("#b9b8b0")
        a.grid(axis="y", color=GRID, lw=1); a.set_axisbelow(True); a.tick_params(colors=MUTED, labelsize=16)
        a.set_xticks(range(2018, 2027, 2))
    fig.suptitle(f"{EXAMPLE_NAME.replace('_', ' & ')}, 1 Oct – 13 Nov, 2018–2026", fontsize=26, fontweight="bold", color=INK, y=0.985)
    fig.text(0.5, 0.06, "Since 2022 MODIS Aqua's detections in Punjab & Haryana moved from ~13:15 to ~15:30 local solar time while VIIRS stayed at ~13:10,",
             ha="center", fontsize=15, color=MUTED)
    fig.text(0.5, 0.025, "and Aqua now sees more fires than VIIRS. That's consistent with burning shifting later in the afternoon (not proof).   Data: NASA FIRMS.",
             ha="center", fontsize=15, color=MUTED)
    fig.tight_layout(rect=(0, 0.1, 1, 0.94))
    fig.savefig(REPORTS / "fig_aqua_drift.png", dpi=120); print("saved")

if __name__ == "__main__":
    main()
