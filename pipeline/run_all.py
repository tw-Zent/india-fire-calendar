"""One-command rerun:  python pipeline/run_all.py   (from the project root, Windows or Linux)."""
import subprocess, sys
from pathlib import Path
HERE = Path(__file__).resolve().parent
STEPS = [["ingest.py"], ["profile_raw.py"], ["clean.py"], ["grid.py"], ["build_tileday.py"], ["hybrid.py"], ["validate.py", "200"], ["validate_final.py"], ["validate_hybrid.py"], ["charts.py"], ["fig_submission.py"],
         ["export.py", "--sample"], ["check_contract.py", str(HERE.parent / "data" / "processed" / "sample")],
         ["export.py"], ["check_contract.py"]]
a = int(sys.argv[1]) if len(sys.argv) > 1 else 0
b = int(sys.argv[2]) if len(sys.argv) > 2 else len(STEPS)
for s in STEPS[a:b]:  # optional: run_all.py <first> <last> (step indices) to resume
    print("==>", " ".join(s), flush=True)
    subprocess.run([sys.executable, str(HERE / s[0]), *s[1:]], cwd=HERE, check=True)
print("pipeline OK")
