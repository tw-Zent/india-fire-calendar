"""Step 0: profile the ingested raw data. Writes data/processed/reports/profile.json + profile_by_year.csv."""
import json
import polars as pl
from config import INTERIM, REPORTS

def main():
    REPORTS.mkdir(parents=True, exist_ok=True)
    out = {}
    for f in sorted(INTERIM.glob("raw_*.parquet")):
        lf = pl.scan_parquet(f)
        s = lf.select(
            pl.len().alias("rows"),
            pl.col("acq_date").min().alias("date_min"), pl.col("acq_date").max().alias("date_max"),
            pl.col("acq_date").n_unique().alias("n_days"),
            pl.col("latitude").min().alias("lat_min"), pl.col("latitude").max().alias("lat_max"),
            pl.col("longitude").min().alias("lon_min"), pl.col("longitude").max().alias("lon_max"),
            pl.col("frp").min().alias("frp_min"), pl.col("frp").median().alias("frp_med"),
            pl.col("frp").quantile(0.99).alias("frp_p99"), pl.col("frp").max().alias("frp_max"),
            pl.col("frp").is_null().sum().alias("frp_null"),
            pl.col("scan").max().alias("scan_max"), pl.col("track").max().alias("track_max"),
        ).collect(engine="streaming").to_dicts()[0]
        s = {k: (str(v) if hasattr(v, "isoformat") else v) for k, v in s.items()}
        for c in ("satellite", "instrument", "version", "daynight", "type"):
            vc = lf.group_by(c).len().sort(c).collect(engine="streaming")
            s[f"values_{c}"] = {str(r[c]): r["len"] for r in vc.to_dicts()}
        conf = lf.select(pl.col("confidence")).collect(engine="streaming")["confidence"]
        if conf.str.contains(r"^\d+$").all():
            ci = conf.cast(pl.Int32)
            s["confidence"] = {"kind": "0-100", "min": int(ci.min()), "max": int(ci.max()),
                               "lt30": int((ci < 30).sum()), "30to79": int(((ci >= 30) & (ci < 80)).sum()), "ge80": int((ci >= 80).sum())}
        else:
            s["confidence"] = {"kind": "class", **{k: v for k, v in conf.value_counts().rows()}}
        # exact duplicate rows
        s["exact_dup_rows"] = int(s["rows"] - lf.unique().select(pl.len()).collect(engine="streaming").item())
        # day gaps: calendar days between min and max with zero detections
        days = lf.select(pl.col("acq_date").unique()).collect(engine="streaming")["acq_date"].sort()
        full = pl.date_range(days.min(), days.max(), "1d", eager=True)
        missing = full.filter(~full.is_in(days))
        s["missing_days"] = len(missing)
        # group into runs
        runs, start, prev = [], None, None
        for d in missing.to_list():
            if start is None: start = prev = d
            elif (d - prev).days == 1: prev = d
            else: runs.append((start, prev)); start = prev = d
        if start: runs.append((start, prev))
        s["missing_runs_ge3d"] = [(str(a), str(b), (b - a).days + 1) for a, b in runs if (b - a).days + 1 >= 3]
        out[f.stem] = s
        print(f.stem, s["rows"], s["date_min"], s["date_max"], flush=True)
    # archive vs nrt overlap
    for sensor in ("modis", "snpp", "noaa20"):
        a = out[f"raw_{sensor}_archive"]; n = out[f"raw_{sensor}_nrt"]
        lfn = pl.scan_parquet(INTERIM / f"raw_{sensor}_nrt.parquet")
        ov = lfn.filter(pl.col("acq_date") <= pl.lit(a["date_max"]).str.to_date()).select(pl.len()).collect().item()
        out[f"overlap_{sensor}"] = {"archive_end": a["date_max"], "nrt_start": n["date_min"], "nrt_rows_on_or_before_archive_end": ov}
    json.dump(out, open(REPORTS / "profile.json", "w"), indent=1, default=str)
    # per year x sensor x product x satellite
    lf = pl.concat([pl.scan_parquet(f) for f in sorted(INTERIM.glob("raw_*.parquet"))])
    by = (lf.with_columns(pl.col("acq_date").dt.year().alias("year"))
            .group_by("sensor", "product", "satellite", "year").agg(pl.len().alias("rows"), pl.col("acq_date").n_unique().alias("days"))
            .sort("sensor", "satellite", "year", "product").collect(engine="streaming"))
    by.write_csv(REPORTS / "profile_by_year.csv")

if __name__ == "__main__":
    main()
