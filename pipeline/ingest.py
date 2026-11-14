"""Step 1: raw FIRMS CSV -> typed Parquet (one file per sensor x product). Raw files are read-only."""
import polars as pl
from config import RAW, INTERIM, SOURCES

SCHEMA = {
    "latitude": pl.Float64, "longitude": pl.Float64, "brightness": pl.Float64,
    "scan": pl.Float64, "track": pl.Float64, "acq_date": pl.Utf8, "acq_time": pl.Utf8,
    "satellite": pl.Utf8, "instrument": pl.Utf8, "confidence": pl.Utf8, "version": pl.Utf8,
    "bright_t31": pl.Float64, "frp": pl.Float64, "daynight": pl.Utf8, "type": pl.Int8,
}

def ingest_one(path, sensor, product):
    head = path.open().readline().strip().split(",")
    sch = {c: SCHEMA[c] for c in head}
    lf = pl.scan_csv(path, schema=sch)
    if "type" not in head:
        lf = lf.with_columns(pl.lit(None, dtype=pl.Int8).alias("type"))
    lf = lf.with_columns(
        pl.col("acq_date").str.to_date("%Y-%m-%d"),
        pl.col("acq_time").str.zfill(4),
        pl.lit(sensor).alias("sensor"),
        pl.lit(product).alias("product"),
    ).select(list(SCHEMA) + ["sensor", "product"])
    out = INTERIM / f"raw_{sensor}_{product}.parquet"
    lf.sink_parquet(out)
    return out

def main():
    INTERIM.mkdir(parents=True, exist_ok=True)
    for sensor, (folder, ga, gn) in SOURCES.items():
        for product, g in (("archive", ga), ("nrt", gn)):
            for p in sorted((RAW / folder).glob(g)):
                print("ingest", p.name, "->", ingest_one(p, sensor, product).name, flush=True)

if __name__ == "__main__":
    main()
