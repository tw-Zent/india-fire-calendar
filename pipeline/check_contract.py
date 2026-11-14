"""Check an export directory against data/processed/contract.json. Usage: python check_contract.py [dir]"""
import sys, json, gzip
from pathlib import Path
from config import PROC

def main(d):
    d = Path(d); C = json.loads((PROC / "contract.json").read_text())
    errs = []; man = json.loads((d / "manifest.json").read_text())
    if man["version"] != C["version"]: errs.append(f"manifest version {man['version']} != contract {C['version']}")
    cov = json.loads((d / "coverage.json").read_text())
    if len(cov["mask"]) != cov["d1"] - cov["d0"] + 1: errs.append("coverage mask length")
    if any(not (0 <= m <= 15) for m in cov["mask"]): errs.append("coverage mask range")
    if len(cov["regime"]) != len(cov["mask"]) or any((r == 0) != (m == 0) for r, m in zip(cov["regime"], cov["mask"])): errs.append("regime/mask mismatch")
    dom = json.loads((d / "domain.json").read_text())
    if dom["version"] != C["version"]: errs.append("domain version")
    domset = {(k, c) for k, v in dom["tiles"].items() for c in v}
    if any(not (0 <= c < 400) for v in dom["tiles"].values() for c in v): errs.append("domain c out of range")
    caps = C["caps"]; total = 0
    for t in man["tiles"]:
        raw = (d / t["file"]).read_bytes(); gz = len(gzip.compress(raw, 9)); total += gz
        if gz > caps["max_file_gzip_bytes"]: errs.append(f"{t['file']} gzip {gz} > cap")
        j = json.loads(raw); n = j["records"]
        for k in C["tile_fields"]:
            if k not in j: errs.append(f"{t['file']}: missing {k}")
        for k in ("dd", "c", "t", "a", "s", "n", "h"):
            if len(j[k]) != n: errs.append(f"{t['file']}: {k} length {len(j[k])} != {n}")
        if j["dd"][0] != 0 or any(x < 0 for x in j["dd"]): errs.append(f"{t['file']}: dd not sorted/zero-start")
        if any(not (0 <= c < 400) for c in j["c"]): errs.append(f"{t['file']}: c out of range")
        day = j["d0"]; seen = set()
        for i in range(n):
            day += j["dd"][i]
            if (day, j["c"][i]) in seen: errs.append(f"{t['file']}: duplicate cell-day"); break
            seen.add((day, j["c"][i]))
            if not (cov["d0"] <= day <= cov["d1"]): errs.append(f"{t['file']}: day outside coverage"); break
            m = cov["mask"][day - cov["d0"]]
            if m == 0: errs.append(f"{t['file']}: record on a no-coverage day"); break
            if j["h"][i] is None: errs.append(f"{t['file']}: null h on covered day"); break
            if j["t"][i] + j["a"][i] + j["s"][i] + j["n"][i] == 0: errs.append(f"{t['file']}: empty record"); break
            if (j["tile"], j["c"][i]) not in domset: errs.append(f"{t['file']}: record outside domain"); break
    print(f"{len(man['tiles'])} tiles, total gzip {total/1e6:.2f} MB")
    if man.get("scope", "").startswith("sample") and total > caps["max_ph_all_years_gzip_bytes"]: errs.append("sample over 20 MB")
    print("PASS" if not errs else "FAIL\n" + "\n".join(errs[:50]))
    return 0 if not errs else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else PROC / "tiles"))
