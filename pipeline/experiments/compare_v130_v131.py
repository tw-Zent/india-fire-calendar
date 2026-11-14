"""How much did daily h move between v1.3.0 (app bundle copy) and v1.3.1 (data/processed/tiles)? modis_ta days only.
Levels: cell-day, P&H daily total, India daily total; plus monthly totals."""
import sys, json, glob, datetime as dt
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import polars as pl
from config import PROC, EXAMPLE_BBOX as B

OLD = PROC.parents[1] / "app" / "_bundle" / "stale-w12" / "dist" / "data"   # read-only copy of the v1.3.0 export (15:36 IST)
NEW = PROC / "tiles"

def load(d):
    rows = []
    for f in sorted(glob.glob(str(d / "tiles" / "*.json"))):
        j = json.load(open(f)); day = j["d0"]; lat0, lon0 = j["lat0"], j["lon0"]
        for i in range(j["records"]):
            day += j["dd"][i]; c = j["c"][i]
            rows.append((j["tile"], c, day, lat0 + (c // 20) * 0.1, lon0 + (c % 20) * 0.1, j["h"][i]))
    return pl.DataFrame(rows, schema=["tile", "c", "d", "lat", "lon", "h"], orient="row")

def main():
    mo = json.load(open(OLD / "manifest.json")); mn = json.load(open(NEW / "manifest.json"))
    print("old", mo["version"], mo["generated_utc"], "| new", mn["version"], mn["generated_utc"])
    cov = json.load(open(NEW / "coverage.json"))
    reg = pl.DataFrame({"d": list(range(cov["d0"], cov["d1"] + 1)), "regime": cov["regime"], "mask": cov["mask"]})
    a = load(OLD).rename({"h": "h0"}); b = load(NEW).rename({"h": "h1"})
    x = a.join(b.select("tile", "c", "d", "h1"), on=["tile", "c", "d"], how="full", coalesce=True).join(reg, on="d", how="left")
    assert x.filter(pl.col("h0").is_null() | pl.col("h1").is_null()).height == 0, "record sets differ"
    x = x.with_columns(pl.from_epoch(pl.col("d") * 86400).dt.year().alias("y"), pl.from_epoch(pl.col("d") * 86400).dt.month().alias("m"),
                       ((pl.col("lat") >= B["lat_min"]) & (pl.col("lat") < B["lat_max"]) & (pl.col("lon") >= B["lon_min"]) & (pl.col("lon") < B["lon_max"])).alias("ph"))
    oth = x.filter(pl.col("regime") != 2)
    print("non-modis_ta records changed:", oth.filter((pl.col("h0") - pl.col("h1")).abs() > 0.011).height, "of", oth.height)
    mt = x.filter((pl.col("regime") == 2) & ((pl.col("mask") & 12) == 0))   # MODIS-filled Terra+Aqua days
    def dist(df, label):
        r = df.filter(pl.col("h0") > 0).with_columns(((pl.col("h1") - pl.col("h0")).abs() / pl.col("h0")).alias("rel"))
        q = r.select(pl.col("rel").median().alias("med"), pl.col("rel").quantile(0.9).alias("p90"), pl.col("rel").max().alias("max"), pl.len().alias("n"))
        q = q.to_dicts()[0]; print(f"{label}: n={q['n']} median {q['med']:.1%} p90 {q['p90']:.1%} max {q['max']:.1%}"); return {"level": label, **q}
    out = [dist(mt, "cell-day"),
           dist(mt.filter(pl.col("ph")).group_by("d").agg(pl.col("h0").sum(), pl.col("h1").sum()), "P&H daily total"),
           dist(mt.group_by("d").agg(pl.col("h0").sum(), pl.col("h1").sum()), "India daily total")]
    mon = x.group_by("y", "m").agg(pl.col("h0").sum(), pl.col("h1").sum()).with_columns(((pl.col("h1") - pl.col("h0")).abs() / pl.col("h0")).alias("rel"))
    monp = x.filter(pl.col("ph")).group_by("y", "m").agg(pl.col("h0").sum(), pl.col("h1").sum()).filter(pl.col("h0") > 0).with_columns(((pl.col("h1") - pl.col("h0")).abs() / pl.col("h0")).alias("rel"))
    print(f"monthly totals India: max rel diff {mon['rel'].max():.1e}; P&H box: max rel diff {monp['rel'].max():.1e}")
    e = x.filter(pl.col("ph") & (pl.col("d") == (dt.date(2008, 10, 1) - dt.date(1970, 1, 1)).days)).select(pl.col("h0").sum(), pl.col("h1").sum())
    print("P&H 2008-10-01:", e.to_dicts())
    pl.DataFrame(out).write_csv(PROC / "reports" / "v130_v131_daily_change.csv")

if __name__ == "__main__":
    main()
