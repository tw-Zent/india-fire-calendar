"""Harmonization: MODIS / NOAA-20 -> S-NPP-equivalent detection counts.

Ratio models (fit on days where both the source and S-NPP flew):
  B0  constant   k = sum(s) / sum(m)                               (HQ D7 baseline)
  M1  dn         k[dn]                (day / night separately)
  M2  month_dn   k[month, dn]
  M3  tile_month_dn  k[tile, month, dn], shrunk to k[month, dn]:  k = (sum s + alpha*K) / (sum m + alpha)
m = Terra+Aqua ("ta"), Terra only ("t") or NOAA-20 ("n").  tile = 2-degree export tile.
"""
import polars as pl

NEED = {"ta": 1 | 2 | 4, "t": 1 | 4, "a": 2 | 4, "n": 4 | 8}

def src(cfg):
    return {"ta": pl.col("t") + pl.col("a"), "t": pl.col("t"), "a": pl.col("a"), "n": pl.col("n")}[cfg]

def add_keys(df):
    return df.with_columns(pl.from_epoch(pl.col("d") * 86400).dt.month().cast(pl.Int8).alias("month"),
                           pl.from_epoch(pl.col("d") * 86400).dt.year().cast(pl.Int16).alias("year"))

def fit(train, cfg, model, alpha=50.0):
    tr = train.filter((pl.col("mask") & NEED[cfg]) == NEED[cfg]).with_columns(src(cfg).alias("m"))
    def ratio(keys):
        g = tr.group_by(keys) if keys else tr.select(pl.all())
        if keys:
            return g.agg(pl.col("s").sum().alias("S"), pl.col("m").sum().alias("M"))
        return pl.DataFrame({"S": [tr["s"].sum()], "M": [tr["m"].sum()]})
    k0 = ratio([]).with_columns((pl.col("S") / pl.col("M")).alias("k"))["k"][0]
    if model == "B0":
        return {"model": model, "cfg": cfg, "k0": k0, "keys": [], "table": None}
    kd = ratio(["dn"]).with_columns(((pl.col("S") + alpha * k0) / (pl.col("M") + alpha)).alias("k")).select("dn", "k")
    if model == "M1":
        return {"model": model, "cfg": cfg, "k0": k0, "keys": ["dn"], "table": kd}
    kmd = (ratio(["month", "dn"]).join(kd.rename({"k": "kp"}), on="dn")
           .with_columns(((pl.col("S") + alpha * pl.col("kp")) / (pl.col("M") + alpha)).alias("k")).select("month", "dn", "k"))
    if model == "M2":
        return {"model": model, "cfg": cfg, "k0": k0, "keys": ["month", "dn"], "table": kmd}
    ktmd = (ratio(["tile", "month", "dn"]).join(kmd.rename({"k": "kp"}), on=["month", "dn"])
            .with_columns(((pl.col("S") + alpha * pl.col("kp")) / (pl.col("M") + alpha)).alias("k")).select("tile", "month", "dn", "k"))
    return {"model": model, "cfg": cfg, "k0": k0, "keys": ["tile", "month", "dn"], "table": ktmd, "parent": kmd}

def predict(df, f):
    """df rows: (..., d, dn, t, a, s, n, month, tile). Returns df with column 'pred' (S-NPP-equivalent)."""
    m = src(f["cfg"])
    if f["table"] is None:
        return df.with_columns((m * f["k0"]).alias("pred"))
    out = df.join(f["table"], on=f["keys"], how="left")
    if f["model"] == "M3":   # unseen tile-month -> parent ratio
        out = out.join(f["parent"].rename({"k": "kp"}), on=["month", "dn"], how="left").with_columns(pl.coalesce("k", "kp").alias("k")).drop("kp")
    return out.with_columns((m * pl.coalesce("k", pl.lit(f["k0"]))).alias("pred")).drop("k")

def fit_all(train, model="M3", alpha=200.0):
    """Fits for every source config. train: tile-day-dn table (see validate.tileday)."""
    return {cfg: fit(train, cfg, model if cfg != "n" else "B0", alpha) for cfg in ("ta", "t", "a", "n")}

def apply_h(df, fits):
    """S-NPP-equivalent h per row, by what flew that day: S-NPP itself > NOAA-20 > Terra+Aqua > Terra > Aqua; null if nothing."""
    m = pl.col("mask")
    has = lambda b: (m & b) == b
    out = df
    for cfg in ("n", "ta", "t", "a"):
        out = predict(out, fits[cfg]).rename({"pred": f"p_{cfg}"})
    h = (pl.when(has(4)).then(pl.col("s").cast(pl.Float64)).when(has(8)).then(pl.col("p_n"))
           .when(has(3)).then(pl.col("p_ta")).when(has(1)).then(pl.col("p_t")).when(has(2)).then(pl.col("p_a")).otherwise(None))
    return out.with_columns(h.alias("h")).drop("p_n", "p_ta", "p_t", "p_a")

# ---- v1.2 final method -------------------------------------------------------------------------
FIT_YEARS_MODIS = range(2012, 2020)      # MODIS -> S-NPP ratios: pre-drift overlap years
FIT_YEARS_N20 = range(2018, 2027)        # NOAA-20 -> S-NPP constant ratio

import datetime as _dt
CHAIN_FROM = (_dt.date(2002, 7, 4) - _dt.date(1970, 1, 1)).days   # Aqua starts
CHAIN_TO = (_dt.date(2006, 12, 31) - _dt.date(1970, 1, 1)).days

def fit_terra_to_ta(train, alpha=200.0):
    """Terra -> (Terra+Aqua) ratios, fitted in the early Aqua era (Terra's share of detections drifts over time)."""
    tr = train.filter(((pl.col("mask") & 3) == 3)).with_columns((pl.col("t") + pl.col("a")).alias("s"), pl.lit(5).alias("mask"))
    return fit(tr, "t", "M3", alpha)

def predict_terra_chain(df, f_t2ta, f_ta):
    """Terra-only rows -> TA-equivalent -> S-NPP-equivalent."""
    x = predict(df, f_t2ta).with_columns(pl.col("pred").alias("_ta"))
    x = x.with_columns(pl.col("t").alias("_t0"), pl.col("a").alias("_a0")).with_columns(pl.col("_ta").alias("t"), pl.lit(0.0).alias("a")).drop("pred")
    x = predict(x, f_ta)
    return x.with_columns(pl.col("_t0").alias("t"), pl.col("_a0").alias("a")).drop("_ta", "_t0", "_a0")

def fit_final(td, holdout=(), alpha=200.0):
    y = pl.col("year"); ok = ~y.is_in(list(holdout))
    trm = td.filter(y.is_in(list(FIT_YEARS_MODIS)) & ok)
    return {"ta": fit(trm, "ta", "M3", alpha), "a": fit(trm, "a", "M3", alpha),
            "n": fit(td.filter(y.is_in(list(FIT_YEARS_N20)) & ok), "n", "B0"),
            "t_direct": fit(trm, "t", "M3", alpha),
            "t2ta": fit_terra_to_ta(td.filter(pl.col("d").is_between(CHAIN_FROM, CHAIN_TO) & ok), alpha)}

def regime_expr():
    m = pl.col("mask")
    return (pl.when((m & 12) != 0).then(3).when((m & 2) != 0).then(2).when((m & 1) != 0).then(1).otherwise(0)).cast(pl.Int8)

def apply_final(df, F):
    m = pl.col("mask"); has = lambda b: (m & b) == b
    x = predict(df, F["n"]).rename({"pred": "p_n"})
    x = predict(x, F["ta"]).rename({"pred": "p_ta"})
    x = predict(x, F["a"]).rename({"pred": "p_a"})
    x = predict_terra_chain(x, F["t2ta"], F["ta"]).rename({"pred": "p_t"})
    h = (pl.when(has(4)).then(pl.col("s").cast(pl.Float64)).when(has(8)).then(pl.col("p_n"))
           .when(has(3)).then(pl.col("p_ta")).when(has(1)).then(pl.col("p_t")).when(has(2)).then(pl.col("p_a")).otherwise(None))
    return x.with_columns(h.alias("h")).drop("p_n", "p_ta", "p_a", "p_t")
