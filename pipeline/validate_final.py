"""Final hold-out validation (HQ D7): hold out 2013, 2017, 2021, 2025.
MODIS ratios fit on 2012-2019 minus hold-outs; NOAA-20 on 2018-2026 minus hold-outs. Baseline B0 = one constant ratio
fitted on the same training days. Writes reports/validation_final.csv and .md"""
import polars as pl
from config import REGION_NAME, EXAMPLE_NAME, INTERIM, REPORTS
from validate import metrics
from harmonize import fit, predict, NEED, FIT_YEARS_MODIS, FIT_YEARS_N20, fit_final, predict_terra_chain

HOLDOUT = [2013, 2017, 2021, 2025]
LABEL = {"daily_nmae": "low", "monthly_nmae": "low", "daily_r": "high"}

def main():
    td = pl.read_parquet(INTERIM / "tileday_dn.parquet")
    rows = []
    for cfg, years, model in (("ta", FIT_YEARS_MODIS, "M3"), ("t", FIT_YEARS_MODIS, "M3"), ("n", FIT_YEARS_N20, "B0")):
        ok = td.filter((pl.col("mask") & NEED[cfg]) == NEED[cfg])
        tr = ok.filter(pl.col("year").is_in(list(years)) & ~pl.col("year").is_in(HOLDOUT))
        te = ok.filter(pl.col("year").is_in(HOLDOUT))
        fb, fm = fit(tr, cfg, "B0"), fit(tr, cfg, "M3", 200.0)
        for reg in (REGION_NAME, EXAMPLE_NAME):
            sub = te if reg == REGION_NAME else te.filter(pl.col("ph"))
            b, m = metrics(predict(sub, fb), reg), metrics(predict(sub, fm), reg)
            score = sum((m[k] < b[k] - 0.005) - (m[k] > b[k] + 0.005) for k in ("daily_nmae", "monthly_nmae")) + \
                    ((m["daily_r"] > b["daily_r"] + 0.005) - (m["daily_r"] < b["daily_r"] - 0.005)) + \
                    ((abs(m["total_bias"]) < abs(b["total_bias"]) - 0.005) - (abs(m["total_bias"]) > abs(b["total_bias"]) + 0.005)) + \
                    ((m["octnov_peak_shift_days"] < b["octnov_peak_shift_days"]) - (m["octnov_peak_shift_days"] > b["octnov_peak_shift_days"]))
            verdict = "M3 better" if score > 0 else ("M3 worse" if score < 0 else "same")
            rows.append({"source": {"ta": "Terra+Aqua", "t": "Terra only (direct)", "n": "NOAA-20"}[cfg], "region": reg,
                         **{f"{k}_B0": b[k] for k in b if k != "region"}, **{f"{k}_M3": m[k] for k in m if k != "region"},
                         "verdict": verdict, "shipped": "M3" if cfg != "n" else "B0"})
    out = pl.DataFrame(rows); out.write_csv(REPORTS / "validation_final.csv")
    # Terra-only chain check (Terra -> TA ratios fit in 2002-07..2006 minus 2004; truth = TA->S-NPP estimate on 2004)
    F = fit_final(td, holdout=(2004,))
    d4 = td.filter((pl.col("year") == 2004) & ((pl.col("mask") & 3) == 3))
    a = predict(d4, F["ta"]).rename({"pred": "ref"})
    c = predict_terra_chain(a, F["t2ta"], F["ta"]).rename({"pred": "chain"})
    c = predict(c, F["t_direct"]).rename({"pred": "direct"})
    chain = []
    for reg, sub in ((REGION_NAME, c), (EXAMPLE_NAME, c.filter(pl.col("ph")))):
        dd = sub.group_by("d").agg(pl.col("ref").sum(), pl.col("chain").sum(), pl.col("direct").sum())
        chain.append({"region": reg, "chain_total_ratio": round(sub["chain"].sum() / sub["ref"].sum(), 3),
                      "direct_total_ratio": round(sub["direct"].sum() / sub["ref"].sum(), 3),
                      "chain_daily_r": round(dd.select(pl.corr("ref", "chain")).item(), 3),
                      "direct_daily_r": round(dd.select(pl.corr("ref", "direct")).item(), 3)})
    pl.DataFrame(chain).write_csv(REPORTS / "validation_terra_chain_2004.csv")
    # markdown table
    L = ["| source → S-NPP | region | daily nmae B0 / M3 | daily r B0 / M3 | monthly nmae B0 / M3 | total bias B0 / M3 | Oct–Nov peak shift d B0 / M3 | verdict | shipped |",
         "|---|---|---|---|---|---|---|---|---|"]
    for r in rows:
        L.append(f"| {r['source']} | {r['region'].replace('_', ' & ')} | {r['daily_nmae_B0']} / {r['daily_nmae_M3']} | {r['daily_r_B0']} / {r['daily_r_M3']} | "
                 f"{r['monthly_nmae_B0']} / {r['monthly_nmae_M3']} | {r['total_bias_B0']:+.0%} / {r['total_bias_M3']:+.0%} | "
                 f"{r['octnov_peak_shift_days_B0']} / {r['octnov_peak_shift_days_M3']} | {r['verdict']} | {r['shipped']} |")
    L += ["", "Terra-only chain check (2004 held out; reference = Terra+Aqua-based estimate):", "",
          "| region | total chain / direct | daily r chain / direct |", "|---|---|---|"]
    for r in chain:
        L.append(f"| {r['region'].replace('_', ' & ')} | {r['chain_total_ratio']} / {r['direct_total_ratio']} | {r['chain_daily_r']} / {r['direct_daily_r']} |")
    (REPORTS / "validation_final.md").write_text("\n".join(L) + "\n")
    print("\n".join(L))

if __name__ == "__main__":
    main()
