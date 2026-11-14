"""Export gridded daily data to static JSON tiles per data/processed/contract.json.

  python export.py                 -> full region to data/processed/tiles/
  python export.py --sample        -> example-bbox tiles to data/processed/sample/

Contract v1.3: `h` = final harmonized value (harmonize.apply_final + hybrid.py day-shape on MODIS days); coverage.json carries a per-day `regime` code.
"""
import argparse, gzip, json, math, datetime as dt
import polars as pl
from config import REGION_NAME, EXAMPLE_NAME, INTERIM, PROC, SAMPLE, PH_BBOX, REPORTS
from harmonize import fit_final, apply_final, add_keys, regime_expr

def save_ratios(F):
    parts = []
    for name, f in F.items():
        if f["table"] is None:
            parts.append(pl.DataFrame({"fit": [name], "model": [f["model"]], "k": [f["k0"]]}))
        else:
            parts.append(f["table"].with_columns(pl.lit(name).alias("fit"), pl.lit(f["model"]).alias("model")))
    pl.concat(parts, how="diagonal_relaxed").write_csv(REPORTS / "harmonization_ratios.csv")

VERSION = "1.3.1"
TILE_DEG = 2
CELLS_PER_TILE_SIDE = 20
EPOCH = dt.date(1970, 1, 1)
BITS = {"t": 1, "a": 2, "s": 4, "n": 8}

def baseline_ratios(g, cov):
    """Constant ratios to S-NPP-equivalent counts, India-wide, over days where both satellites delivered data."""
    tot = g.group_by("d").agg([pl.col(c).cast(pl.Int64).sum() for c in "tasn"]).join(cov, on="d")
    def k(num, den_cols, need):
        m = tot.filter((pl.col("mask") & need) == need)
        return float(m[num].sum() / sum(m[c].sum() for c in den_cols))
    return {"modis_ta": k("s", ["t", "a"], 1 | 2 | 4), "terra": k("s", ["t"], 1 | 4),
            "aqua": k("s", ["a"], 2 | 4), "noaa20": k("s", ["n"], 4 | 8)}

def harmonize_provisional(g, cov, r):
    g = g.join(cov, on="d", how="left")
    m = pl.col("mask")
    has = lambda b: (m & b) == b
    h = (pl.when(has(4)).then(pl.col("s").cast(pl.Float64))
           .when(has(8)).then(pl.col("n") * r["noaa20"])
           .when(has(3)).then((pl.col("t").cast(pl.Float64) + pl.col("a")) * r["modis_ta"])
           .when(has(1)).then(pl.col("t") * r["terra"])
           .when(has(2)).then(pl.col("a") * r["aqua"])
           .otherwise(None))
    return g.with_columns(h.round(2).alias("h")).drop("mask")

def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--sample", action="store_true"); args = ap.parse_args()
    out = SAMPLE if args.sample else PROC / "tiles"
    (out / "tiles").mkdir(parents=True, exist_ok=True)
    cov = pl.read_parquet(INTERIM / "coverage_days.parquet").with_columns(pl.col("mask").cast(pl.Int32))
    g = pl.concat([pl.scan_parquet(f) for f in sorted((INTERIM / "grid").glob("*.parquet"))]).collect()
    g0 = g.group_by("d").agg([pl.col(c).cast(pl.Int64).sum() for c in "tasn"])
    r = baseline_ratios(g0, cov)                      # kept for the manifest (= HQ D7 baseline)
    F = fit_final(pl.read_parquet(INTERIM / "tileday_dn.parquet"))
    save_ratios(F)
    hd = (pl.scan_parquet(INTERIM / "grid_dn" / "*.parquet").collect()
            .pivot(on="k", index=["cell_id", "d", "dn"], values="cnt").fill_null(0))
    for c in "tasn":
        if c not in hd.columns: hd = hd.with_columns(pl.lit(0).alias(c))
    row_, col_ = pl.col("cell_id") // 3600, pl.col("cell_id") % 3600
    hd = add_keys(hd.with_columns([pl.col(c).cast(pl.Float64) for c in "tasn"]).with_columns(((row_ // 20) * 3600 + col_ // 20).alias("tile")))
    hd = apply_final(hd.join(cov, on="d", how="left"), F)
    hd = hd.group_by("cell_id", "d").agg(pl.col("h").sum(), pl.col("h").is_null().all().alias("hnull"))
    # v1.3 hybrid: rescale MODIS-filled Terra+Aqua days by the unit-day factor (hybrid.py); monthly totals unchanged
    lat_c, lon_c = (pl.col("cell_id") // 3600) / 10 - 90, (pl.col("cell_id") % 3600) / 10 - 180
    b = PH_BBOX
    fac = pl.read_parquet(INTERIM / "hybrid_factors.parquet")
    hd = (hd.with_columns((((pl.col("cell_id") // 3600) // 20) * 3600 + (pl.col("cell_id") % 3600) // 20).alias("tile"),
                          ((lat_c >= b["lat_min"]) & (lat_c < b["lat_max"]) & (lon_c >= b["lon_min"]) & (lon_c < b["lon_max"])).alias("ph"))
            .join(fac, on=["tile", "ph", "d"], how="left")
            .with_columns((pl.col("h") * pl.col("f").fill_null(1.0)).round(2).alias("h")).drop("tile", "ph", "f"))
    g = g.join(hd, on=["cell_id", "d"], how="left").with_columns(pl.when(pl.col("hnull")).then(None).otherwise(pl.col("h")).alias("h")).drop("hnull")
    row = g["cell_id"] // 3600; col = g["cell_id"] % 3600
    g = g.with_columns((row // CELLS_PER_TILE_SIDE).alias("tr"), (col // CELLS_PER_TILE_SIDE).alias("tc"),
                       ((row % CELLS_PER_TILE_SIDE) * CELLS_PER_TILE_SIDE + col % CELLS_PER_TILE_SIDE).alias("c"))
    if args.sample:
        b = PH_BBOX
        trs = range(math.floor((b["lat_min"] + 90) / TILE_DEG), math.floor((b["lat_max"] + 90) / TILE_DEG) + 1)
        tcs = range(math.floor((b["lon_min"] + 180) / TILE_DEG), math.floor((b["lon_max"] + 180) / TILE_DEG) + 1)
        g = g.filter(pl.col("tr").is_in(list(trs)) & pl.col("tc").is_in(list(tcs)))
    tiles = []
    for (tr, tc), part in g.sort("d", "c").group_by(["tr", "tc"], maintain_order=True):
        lat0, lon0 = tr * TILE_DEG - 90, tc * TILE_DEG - 180
        tid = f"{lat0}_{lon0}"
        d = part["d"].to_list()
        body = {"version": VERSION, "tile": tid, "lat0": lat0, "lon0": lon0, "tile_deg": TILE_DEG,
                "cells_per_side": CELLS_PER_TILE_SIDE, "records": part.height,
                "d0": d[0], "dd": [d[0] - d[0]] + [d[i] - d[i - 1] for i in range(1, len(d))],
                "c": part["c"].to_list(), "t": part["t"].to_list(), "a": part["a"].to_list(),
                "s": part["s"].to_list(), "n": part["n"].to_list(),
                "h": [None if v is None else (int(v) if v == int(v) else v) for v in part["h"].to_list()]}
        raw = json.dumps(body, separators=(",", ":")).encode()
        fn = out / "tiles" / f"{tid}.json"; fn.write_bytes(raw)
        tiles.append({"tile": tid, "file": f"tiles/{tid}.json", "lat0": lat0, "lon0": lon0,
                      "lat1": lat0 + TILE_DEG, "lon1": lon0 + TILE_DEG, "records": part.height,
                      "bytes": len(raw), "gzip_bytes": len(gzip.compress(raw, 9))})
    # domain mask (v1.1): cells with >=1 RAW detection (any sensor, any date) = proxy for the India data extent
    row_e, col_e = ((pl.col("latitude") + 90) * 10 + 1e-9).floor().cast(pl.Int32), ((pl.col("longitude") + 180) * 10 + 1e-9).floor().cast(pl.Int32)
    dom = (pl.concat([pl.scan_parquet(f).select("latitude", "longitude") for f in sorted(INTERIM.glob("raw_*.parquet"))])
             .select(row_e.alias("r"), col_e.alias("q")).unique().collect(engine="streaming")
             .with_columns((pl.col("r") // CELLS_PER_TILE_SIDE * TILE_DEG - 90).alias("lat0"), (pl.col("q") // CELLS_PER_TILE_SIDE * TILE_DEG - 180).alias("lon0"),
                           ((pl.col("r") % CELLS_PER_TILE_SIDE) * CELLS_PER_TILE_SIDE + pl.col("q") % CELLS_PER_TILE_SIDE).alias("c")))
    keep = {t["tile"] for t in tiles}
    domj = {"version": VERSION, "rule": "cell had >=1 raw FIRMS detection (any sensor, 2000-11-01..date_last)", "tiles": {}}
    for (la, lo), part in dom.sort("lat0", "lon0", "c").group_by(["lat0", "lon0"], maintain_order=True):
        tid = f"{la}_{lo}"
        if args.sample and tid not in keep:
            continue
        domj["tiles"][tid] = part["c"].to_list()
    domj["n_cells"] = sum(len(v) for v in domj["tiles"].values())
    (out / "domain.json").write_text(json.dumps(domj, separators=(",", ":")))
    cov_days = cov.sort("d")
    d0, d1 = int(cov_days["d"].min()), int(cov_days["d"].max())
    full = pl.DataFrame({"d": pl.int_range(d0, d1 + 1, eager=True)}).join(cov_days, on="d", how="left").with_columns(pl.col("mask").fill_null(0))
    full = full.with_columns(regime_expr().alias("regime"))
    covj = {"version": VERSION, "d0": d0, "d1": d1, "bits": BITS, "mask": full["mask"].to_list(),
            "regimes": {"0": "none", "1": "terra_only", "2": "modis_ta", "3": "viirs"}, "regime": full["regime"].to_list()}
    (out / "coverage.json").write_text(json.dumps(covj, separators=(",", ":")))
    manifest = {"version": VERSION, "generated_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                "scope": f"sample: {EXAMPLE_NAME.replace('_', ' & ')} tiles" if args.sample else REGION_NAME,
                "sample_bbox": PH_BBOX if args.sample else None,
                "date_first": str(EPOCH + dt.timedelta(d0)), "date_last": str(EPOCH + dt.timedelta(d1)),
                "h_status": "final_v1.3", "h_method": "S-NPP if flown; else NOAA-20 x constant; else MODIS via 2-deg tile x month x day/night ratios (fit 2012-2019, shrunk alpha=200); Terra-only days chained Terra->Terra+Aqua (fit 2002-07-04..2006) -> S-NPP. v1.3 hybrid: on MODIS Terra+Aqua days the ratio method's monthly totals per 2-deg tile are kept and redistributed across days by a LightGBM model of MODIS fire features (hybrid.py)",
                "h_ratios_file": "reports/harmonization_ratios.csv (in data/processed)", "baseline_ratios_D7": r,
                "tiles": sorted(tiles, key=lambda x: x["tile"]),
                "total_bytes": sum(t["bytes"] for t in tiles), "total_gzip_bytes": sum(t["gzip_bytes"] for t in tiles)}
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1))
    print(json.dumps({k: v for k, v in manifest.items() if k != "tiles"}, indent=1))
    for t in manifest["tiles"]:
        print(t["tile"], t["records"], t["bytes"], t["gzip_bytes"])

if __name__ == "__main__":
    main()
