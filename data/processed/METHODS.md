# Methods — harmonized active-fire record for India, 2000–2026 (data v1.3.1)

AI assistance: code, analysis and documentation were produced with Claude (Anthropic) as an AI assistant, directed and reviewed by Ashish Das.

**Data.** NASA FIRMS active-fire detections for India from four satellites: MODIS Collection 6.1 on Terra and Aqua (1 km) and VIIRS 375 m on S-NPP and NOAA-20. Standard archive plus the near-real-time extension, 1 Nov 2000 – 13 Nov 2026.

**Cleaning.** We keep the archive wherever it exists; near-real-time data only extends it. We remove duplicates, low-confidence detections (MODIS < 30, VIIRS "low"), and non-vegetation sources such as volcanoes, industrial sites, gas flares and offshore platforms. These are FIRMS' "static source" flags plus a mask of 0.01° spots dominated by them. Day and night detections are both kept. Detections are then counted per 0.1° cell per UTC day.

**Harmonization.** The satellites see fires differently: VIIRS 375 m finds about 5× more fires than MODIS by day and about 15–20× more at night (India, 2012–2026). We express everything as what one VIIRS S-NPP satellite would detect: it is the longest 375 m record (2012–2026), overlaps MODIS and NOAA-20 for calibration, and keeps recent years at full detail. Counting one satellite at a time avoids artificial jumps when satellites join or leave. If S-NPP flew that day, we use its count; otherwise NOAA-20 × 0.99. Before 2012, MODIS is converted with ratios learned in 2012–2019, when both flew, per 2°×2° area, month, and day/night. Before Aqua (Nov 2000 – Jul 2002) only Terra flew, and Terra's share of fires changed over the decades, so Terra is first converted to "Terra+Aqua" units using 2002–2006, then to S-NPP units.

**Day-to-day shape (v1.3 hybrid).** On MODIS Terra+Aqua days, each 2° area keeps the ratio method's monthly total, and that total is spread across the month's days in proportion to a gradient-boosted model's (LightGBM) daily estimate. The model uses MODIS fire features: counts, fire radiative power, confidence, view angle and overpass time. Days with no MODIS detection in a 2° tile stay zero. Monthly and annual totals are therefore exactly those of the ratio method; only the daily pattern changes.

**Validation.** Four years (2013, 2017, 2021, 2025) were never used for fitting. In those years we predicted S-NPP from the other satellites and compared against what S-NPP actually saw. The baseline is one constant India-wide ratio. The ratio method beats it for MODIS everywhere; in Punjab & Haryana the total bias drops from +22% to +3% and the monthly error from 26% to 16%. For NOAA-20 both are near-identical, so the simple constant is used. For the hybrid, the pass bar was written down before any results. It cut daily error by 28–43%, confirmed on four fresh years (2020, 2022–2024) that were used for neither fitting nor testing, and monthly error is unchanged. It **did not meet** one criterion: Punjab & Haryana total bias within ±5% on the fresh years (+9.7%). That bias comes from the ratio method, which the hybrid copies, not from the hybrid. A gradient-boosted model used on its own (without keeping the monthly totals) tracked days better too, but was worse on monthly error (Punjab & Haryana 17.3% vs 15.7%), so it is only used for the daily shape.

**How accurate is this?** Typical error of the harmonized value against what S-NPP actually saw, on held-out years (low end India, high end Punjab & Haryana):

| days based on | monthly error | daily error |
|---|---|---|
| S-NPP (2012 – 2 Nov 2026) | none: it is the reference | none |
| NOAA-20, filling S-NPP gaps | 3–4 % | 23–31 % |
| MODIS Terra + Aqua (Jul 2002 – 2011, VIIRS gaps) | 10–16 % | 22–38 % |
| MODIS Terra only (before 4 Jul 2002) | 12–29 % | 40–93 % |

Monthly and seasonal patterns are dependable in every period; single days before 2012 are rougher than after, and Terra-only days are rough, so use 7-day smoothing there. Machine-readable: `data/processed/reports/uncertainty.json`.

**Limits — please read.**
- *Detections ≠ fires or burned area.* They are hotspots seen at overpass time (MODIS ~10:30 / 13:30 and ~22:30 / 01:30 local; VIIRS ~13:30 / 01:30). Clouds and smoke hide fires, and the data carries no cloud information, so a zero-detection day may simply be cloudy.
- *Satellite overpass times.* Terra passes at about 10:30 and Aqua at about 13:30 local time (both drifting since about 2022, see below); S-NPP and NOAA-20 at about 13:30. Each also has a night pass (about 22:30 for Terra, 01:30 for the others). Burning later in the afternoon, after the last daytime pass, is under-detected by all four satellites.
- *Before July 2002 (Terra only) daily values are unreliable;* seasonal totals are usable. These days are flagged `terra_only` and left out of default medians. India 2001 reads high (Terra's own counts were 22% above 2003).
- *Ratio drift after 2019.* Ratios fitted on 2012–2019 overestimate Punjab & Haryana by about 10% in 2020–2024, likely from Terra/Aqua orbit drift. This affects only MODIS-filled days after 2012 (when both VIIRS were missing); on held-out years the pre-2012 bias is +3%.
- *Terra-only days zig-zag:* one MODIS satellite views an area well only every other day. Use 7-day smoothing for 2000–2002.
- *The unit is detections, not burned area or fire intensity;* those are future work.
- *Aqua's overpass has drifted later.* In the Punjab & Haryana box (1 Oct–13 Nov), Aqua's daytime detections moved from about 13:15 local solar time in 2018–2021 to about 14:45 in 2025 and 15:30 in 2026. Both VIIRS satellites stayed near 13:10, and Terra drifted earlier (about 10:55 → 09:10). Over the same years the Aqua/NOAA-20 detection ratio rose from 0.2 to 1.1. This is consistent with part of the burning happening later in the afternoon, which the drifting Aqua now catches and the ~13:30 VIIRS passes miss; it does not prove it. So the recent drop measured by VIIRS may partly be a shift of burning to later hours. The harmonized record uses Aqua after 2012 only to fill VIIRS gaps. Evidence: `reports/aqua_overpass_drift.png` / `.csv`.
- *Punjab & Haryana decline.* Harmonized detections in Oct–Nov fell from 97,882 (2016) to **6,870** (2025), and NOAA-20 shows the same drop. The 2025 harmonized value is above S-NPP's own count (6,369 in total; 5,960 on the days S-NPP fully covered) because 4 S-NPP partial-outage days (21 and 27 Oct, 1 and 12 Nov) are filled from NOAA-20. Part of the decline is likely real, but part may be burning moving later in the afternoon, after the satellites pass. Counts can't tell these apart, so we don't claim the whole drop is less burning. All Punjab & Haryana figures use the preset box 27.5–32.6° N, 73.8–77.6° E, which also includes north Rajasthan and slivers of Jammu & Kashmir and Himachal Pradesh.
- *No coverage ≠ zero.* Days when no satellite delivered data, and cells outside India, are shown as no data.

**Reproduce.** `python pipeline/run_all.py` rebuilds everything from the raw FIRMS CSVs in about 7 minutes and reproduces the published files bit for bit (see `pipeline/README.md`). Data contract: `data/processed/CONTRACT.md`. Ratio table: `data/processed/reports/harmonization_ratios.csv`.

**How to cite.** India Fire Calendar: harmonized MODIS/VIIRS active-fire record for India, v1.3.1 (2026), built from NASA FIRMS data. NASA Space Apps Challenge 2026. Code: https://github.com/tw-Zent/india-fire-calendar. Fire data: NASA FIRMS (see `README_DATA.md` for the credit line).

---

### Cleaning: rows removed

| | raw | duplicates | static type | static mask | low confidence | kept |
|---|---|---|---|---|---|---|
| MODIS | 1,928,361 | 0 | 97,540 | 7,395 | 71,179 | 1,752,247 |
| VIIRS S-NPP | 8,758,392 | 3 | 944,437 | 93,441 | 1,475,974 | 6,244,537 |
| VIIRS NOAA-20 | 5,163,686 | 2 | 607,225 | 60,583 | 864,029 | 3,631,847 |

### Validation on held-out years (B0 = constant ratio, M3 = our method)
nmae = total absolute error ÷ total detections (daily or monthly); r = correlation of the daily series; peak shift = days between the true and predicted Oct–Nov peak (7-day mean).

| source → S-NPP | region | daily nmae B0 / M3 | daily r B0 / M3 | monthly nmae B0 / M3 | total bias B0 / M3 | Oct–Nov peak shift d B0 / M3 | verdict | shipped |
|---|---|---|---|---|---|---|---|---|
| Terra+Aqua | India | 0.351 / 0.318 | 0.868 / 0.909 | 0.1 / 0.095 | +2% / +1% | 1.2 / 1.0 | M3 better | M3 |
| Terra+Aqua | Punjab & Haryana | 0.76 / 0.669 | 0.75 / 0.751 | 0.262 / 0.157 | +22% / +3% | 1.5 / 1.2 | M3 better | M3 |
| Terra only (direct) | India | 0.482 / 0.399 | 0.797 / 0.853 | 0.315 / 0.118 | +0% / -4% | 10.2 / 10.2 | M3 better | M3 |
| Terra only (direct) | Punjab & Haryana | 1.017 / 0.928 | 0.404 / 0.616 | 0.799 / 0.29 | -19% / -9% | 2.8 / 2.8 | M3 better | M3 |
| NOAA-20 | India | 0.227 / 0.223 | 0.941 / 0.945 | 0.031 / 0.023 | -0% / -1% | 2.0 / 1.5 | M3 better | B0 |
| NOAA-20 | Punjab & Haryana | 0.308 / 0.305 | 0.957 / 0.957 | 0.044 / 0.045 | -1% / -2% | 0.0 / 0.0 | M3 worse | B0 |

Terra-only chain check (2004 held out; reference = Terra+Aqua-based estimate):

| region | total chain / direct | daily r chain / direct |
|---|---|---|
| India | 1.022 / 1.051 | 0.864 / 0.722 |
| Punjab & Haryana | 0.859 / 1.436 | 0.269 / 0.268 |
### Hybrid (v1.3) vs ratio method, daily shape on MODIS days
Ratio method / hybrid. The bar was set before results: daily error −20% on both test sets, monthly error no worse, P&H bias within ±5%, no step, peak shift ≤ +1 day.

| test years | region | daily error ratio / hybrid | daily r ratio / hybrid | monthly error ratio / hybrid | total bias ratio / hybrid | Oct–Nov peak shift (d) ratio / hybrid |
|---|---|---|---|---|---|---|
| held-out 2013/2017/2021/2025 | India | 32% / 22% (-30%) | 0.909 / 0.949 | 9.5% / 9.5% | +1.0% / +1.0% | 1.0 / 1.0 |
| held-out 2013/2017/2021/2025 | Punjab & Haryana | 67% / 38% (-43%) | 0.753 / 0.908 | 15.7% / 15.7% | +3.3% / +3.3% | 1.2 / 1.8 |
| fresh 2020/2022/2023/2024 | India | 34% / 24% (-28%) | 0.87 / 0.933 | 10.6% / 10.6% | +1.0% / +1.0% | 1.5 / 1.5 |
| fresh 2020/2022/2023/2024 | Punjab & Haryana | 72% / 46% (-37%) | 0.762 / 0.908 | 22.0% / 22.0% | +9.7% / +9.7% | 4.0 / 3.0 |

Day regimes: viirs 5,411 · modis_ta 3,275 · terra_only 707 · none 116. A VIIRS satellite with under half the other's India-wide detections that day counts as a partial outage (S-NPP 108 days, NOAA-20 72).
