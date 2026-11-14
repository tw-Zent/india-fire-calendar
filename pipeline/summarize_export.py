"""Summaries of an export dir (annual h totals India; P&H bbox Oct-Nov h) -> JSON. Used to compare versions.
Usage: python summarize_export.py <export_dir> <out.json>"""
import sys, json, glob, datetime as dt
from config import PH_BBOX

def main(d, out):
    ann, ph = {}, {}
    for f in glob.glob(f"{d}/tiles/*.json"):
        j = json.load(open(f)); day = j["d0"]
        for i in range(j["records"]):
            day += j["dd"][i]; h = j["h"][i] or 0.0
            date = dt.date(1970, 1, 1) + dt.timedelta(day)
            ann[date.year] = ann.get(date.year, 0.0) + h
            c = j["c"][i]; lat = j["lat0"] + (c // 20) * 0.1; lon = j["lon0"] + (c % 20) * 0.1
            if PH_BBOX["lat_min"] <= lat < PH_BBOX["lat_max"] and PH_BBOX["lon_min"] <= lon < PH_BBOX["lon_max"] and date.month in (10, 11):
                ph[date.year] = ph.get(date.year, 0.0) + h
    res = {"annual_h_india": {y: round(v, 2) for y, v in sorted(ann.items())}, "ph_octnov_h": {y: round(v, 2) for y, v in sorted(ph.items())}}
    json.dump(res, open(out, "w"), indent=1); print({k: res["ph_octnov_h"].get(k) for k in (2016, 2025)})

if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
