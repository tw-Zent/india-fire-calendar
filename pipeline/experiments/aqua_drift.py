"""Aqua overpass-drift check (stakeholder-02 N1). P&H bbox, 1 Oct - 13 Nov, 2018-2026, clean detections.
Daytime acq_time -> local solar time (UTC + lon/15 h) and IST. Writes reports/aqua_overpass_drift.{csv,png}."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import datetime as dt
import polars as pl
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
from config import INTERIM, REPORTS, EXAMPLE_BBOX as B

def main():
    lf = pl.concat([pl.scan_parquet(INTERIM / f"clean_{s}" / "*.parquet").select("latitude", "longitude", "acq_date", "acq_time", "satellite", "daynight")
                    for s in ("modis", "snpp", "noaa20")])
    x = (lf.filter(pl.col("latitude").is_between(B["lat_min"], B["lat_max"], closed="left") & pl.col("longitude").is_between(B["lon_min"], B["lon_max"], closed="left"))
           .with_columns(pl.col("acq_date").dt.year().alias("year"), pl.col("acq_date").dt.month().alias("m"), pl.col("acq_date").dt.day().alias("dd"))
           .filter(pl.col("year").is_between(2018, 2026) & ((pl.col("m") == 10) | ((pl.col("m") == 11) & (pl.col("dd") <= 13))))
           .with_columns((pl.col("acq_time").str.slice(0, 2).cast(pl.Float64) + pl.col("acq_time").str.slice(2, 2).cast(pl.Float64) / 60).alias("utc_h"))
           .with_columns((pl.col("utc_h") + pl.col("longitude") / 15).alias("lst_h"), (pl.col("utc_h") + 5.5).alias("ist_h"))
           .collect())
    cnt = x.group_by("year", "satellite").agg(pl.len().alias("n_all")).pivot(on="satellite", index="year", values="n_all").fill_null(0)
    day = x.filter(pl.col("daynight") == "D")
    st = (day.group_by("year", "satellite").agg(pl.len().alias("n_day"), pl.col("lst_h").median().alias("lst_med"),
                                               pl.col("lst_h").quantile(0.25).alias("lst_q25"), pl.col("lst_h").quantile(0.75).alias("lst_q75"),
                                               pl.col("ist_h").median().alias("ist_med")).sort("satellite", "year"))
    out = st.join(cnt.select("year", (pl.col("Aqua") / pl.col("N20")).round(2).alias("aqua_n20_ratio_all"),
                             (pl.col("Terra") / pl.col("N20")).round(2).alias("terra_n20_ratio_all")), on="year")
    out = out.with_columns([pl.col(c).round(2) for c in ("lst_med", "lst_q25", "lst_q75", "ist_med")])
    out.write_csv(REPORTS / "aqua_overpass_drift.csv")
    hm = lambda h: f"{int(h):02d}:{int(round((h % 1) * 60)) % 60:02d}"
    print("year | Aqua LST median [IQR] | NOAA-20 | S-NPP | Terra | Aqua/N20 all")
    for y in range(2018, 2027):
        r = {s: out.filter((pl.col("year") == y) & (pl.col("satellite") == s)).to_dicts() for s in ("Aqua", "N20", "SNPP", "Terra")}
        f = lambda s: (f"{hm(r[s][0]['lst_med'])} [{hm(r[s][0]['lst_q25'])}–{hm(r[s][0]['lst_q75'])}] n={r[s][0]['n_day']}" if r[s] else "—")
        ratio = r["Aqua"][0]["aqua_n20_ratio_all"] if r["Aqua"] else None
        print(y, "|", f("Aqua"), "|", f("N20"), "|", f("SNPP"), "|", f("Terra"), "|", ratio)
    fig, (a1, a2) = plt.subplots(1, 2, figsize=(13, 4.8))
    col = {"Aqua": "#eb6834", "N20": "#eda100", "SNPP": "#1baf7a", "Terra": "#2a78d6"}
    nm = {"Aqua": "MODIS Aqua", "N20": "VIIRS NOAA-20", "SNPP": "VIIRS S-NPP", "Terra": "MODIS Terra"}
    for s in ("Terra", "Aqua", "SNPP", "N20"):
        d = out.filter(pl.col("satellite") == s).sort("year")
        a1.fill_between(d["year"], d["lst_q25"], d["lst_q75"], color=col[s], alpha=0.15)
        a1.plot(d["year"], d["lst_med"], color=col[s], lw=2, marker="o", ms=4, label=nm[s])
    a1.set_title("Daytime detection time, P&H, 1 Oct–13 Nov\n(local solar time, median and IQR)", loc="left", fontsize=10)
    a1.set_ylabel("local solar time (h)"); a1.legend(frameon=False, fontsize=8)
    r = out.filter(pl.col("satellite") == "Aqua").sort("year")
    a2.plot(r["year"], r["aqua_n20_ratio_all"], color=col["Aqua"], lw=2, marker="o", ms=5)
    a2.set_title("Aqua / NOAA-20 detections, P&H, 1 Oct–13 Nov (day+night)", loc="left", fontsize=10); a2.set_ylim(bottom=0)
    for a in (a1, a2):
        for sp in ("top", "right"): a.spines[sp].set_visible(False)
        a.grid(axis="y", color="#e5e4df"); a.set_axisbelow(True)
    fig.tight_layout(); fig.savefig(REPORTS / "aqua_overpass_drift.png", dpi=120)

if __name__ == "__main__":
    main()
