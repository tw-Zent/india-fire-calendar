"""Step 3: clean detections -> 0.1-degree cell x UTC-day counts per satellite.
Writes interim/grid/<year>.parquet (cell_id, d, t, a, s, n), interim/grid_dn/<year>.parquet
(cell_id, d, k, dn, cnt: long form split by satellite and day/night, used for harmonization) and
interim/coverage_days.parquet.
cell_id = row * 3600 + col, row = floor((lat + 90) * 10), col = floor((lon + 180) * 10)  (global 0.1-degree grid)
d = days since 1970-01-01 (UTC acq_date).
"""
import polars as pl
from config import INTERIM, REPORTS

SAT_COL = {"Terra": "t", "Aqua": "a", "SNPP": "s", "N20": "n"}
SAT_BIT = {"Terra": 1, "Aqua": 2, "SNPP": 4, "N20": 8}

def cell_expr():
    row = ((pl.col("latitude") + 90) * 10 + 1e-9).floor().cast(pl.Int32)
    col = ((pl.col("longitude") + 180) * 10 + 1e-9).floor().cast(pl.Int32)
    return (row * 3600 + col).alias("cell_id")

def main():
    out = INTERIM / "grid"; out.mkdir(exist_ok=True)
    out_dn = INTERIM / "grid_dn"; out_dn.mkdir(exist_ok=True)
    files = sorted(INTERIM.glob("clean_*/*.parquet"))
    years = sorted({int(f.stem) for f in files})
    rec = []
    for y in years:
        lf = pl.concat([pl.scan_parquet(f).select("latitude", "longitude", "acq_date", "satellite", "daynight") for f in files if int(f.stem) == y])
        gdn = (lf.with_columns(cell_expr(), pl.col("acq_date").cast(pl.Int32).alias("d"),
                               pl.col("satellite").replace_strict(SAT_COL).alias("k"), pl.col("daynight").alias("dn"))
                 .group_by("cell_id", "d", "k", "dn").agg(pl.len().cast(pl.UInt16).alias("cnt")).collect(engine="streaming"))
        gdn.sort("d", "cell_id").write_parquet(out_dn / f"{y}.parquet")
        g = gdn.group_by("cell_id", "d", "k").agg(pl.col("cnt").sum().cast(pl.UInt16))
        w = g.pivot(on="k", index=["cell_id", "d"], values="cnt")
        for c in SAT_COL.values():
            if c not in w.columns:
                w = w.with_columns(pl.lit(0, dtype=pl.UInt16).alias(c))
        w = w.with_columns([pl.col(c).fill_null(0).cast(pl.UInt16) for c in SAT_COL.values()]).select("cell_id", "d", *SAT_COL.values()).sort("d", "cell_id")
        w.write_parquet(out / f"{y}.parquet")
        rec.append(dict(year=y, clean_rows=lf.select(pl.len()).collect().item(),
                        gridded_detections=int(w.select(pl.sum_horizontal(*SAT_COL.values()).sum()).item()), cell_days=w.height))
        print(rec[-1], flush=True)
    pl.DataFrame(rec).write_csv(REPORTS / "reconcile_grid.csv")
    # coverage bitmask per UTC day (from RAW detections, i.e. before cleaning): satellite delivered data that day
    cov = pl.read_parquet(INTERIM / "coverage_raw.parquet")
    cov = (cov.with_columns(pl.col("acq_date").cast(pl.Int32).alias("d"), pl.col("satellite").replace_strict(SAT_BIT).alias("bit"))
              .group_by("d").agg(pl.col("bit").unique().sum().cast(pl.UInt8).alias("mask")).sort("d"))
    # partial VIIRS outages: when both VIIRS flew, a satellite with < 50% of the other's India-wide raw detections
    # lost passes that day -> its bit is cleared (it does not count as covering the day).
    rr = pl.read_parquet(INTERIM / "coverage_raw.parquet").with_columns(pl.col("acq_date").cast(pl.Int32).alias("d"))
    v = rr.filter(pl.col("satellite").is_in(["SNPP", "N20"])).pivot(on="satellite", index="d", values="raw_rows").fill_null(0)
    part = v.filter((pl.col("SNPP") > 0) & (pl.col("N20") > 0)).with_columns(
        (pl.col("SNPP") < 0.5 * pl.col("N20")).alias("s_part"), (pl.col("N20") < 0.5 * pl.col("SNPP")).alias("n_part"))
    cov = cov.join(part.select("d", "s_part", "n_part"), on="d", how="left").with_columns(
        (pl.col("mask").cast(pl.Int32) - pl.when(pl.col("s_part")).then(4).otherwise(0) - pl.when(pl.col("n_part")).then(8).otherwise(0)).cast(pl.UInt8).alias("mask"))
    print("partial VIIRS days: S-NPP", int(part["s_part"].sum()), "NOAA-20", int(part["n_part"].sum()))
    cov.drop("s_part", "n_part").write_parquet(INTERIM / "coverage_days.parquet")

if __name__ == "__main__":
    main()
