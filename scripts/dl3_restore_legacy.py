#!/usr/bin/env python3
"""DL-3: Restore the historical task files (the chat "All files in task" panel)
from the old git lineage (pre-wipe era) into download/05_legacy_task_files/.
For each candidate path, walk ALL refs and extract the newest blob."""
import subprocess
from pathlib import Path

REPO = Path("/home/z/my-project")
DL = REPO / "download/05_legacy_task_files"
DL.mkdir(parents=True, exist_ok=True)

CANDIDATES = [
    "GlobalEIS_Report_HaythamAttia_EGP.html",
    "GlobalEIS_Report_HaythamAttia_EGP.pdf",
    "GlobalEIS_Report_HaythamAttia_EUR.html",
    "GlobalEIS_Report_HaythamAttia_EUR.pdf",
    "GlobalEIS_Report_HaythamAttia_USD.html",
    "GlobalEIS_Report_HaythamAttia_USD.pdf",
    "Haytham_Mohamed_Attia_Global_EIS_Report.html",
    "Haytham_Mohamed_Attia_Global_EIS_Report.pdf",
    "GlobalEIS_Report_AbdelrahmanElgarayadli_EGP.html",
    "GlobalEIS_Report_AbdelrahmanElgarayadli_EGP.pdf",
    "Ahmed_Abdelhameed_Global_EIS_Report.html",
    "Bola_Ayad_Gerges_Global_EIS_Report.html",
    "Ibrahim_Mossad_Moussa_Aouda_Global_EIS_Report.html",
    "Mahmoud_Adel_Fathy_Global_EIS_Report.html",
    "Mohamed_Abdelfattah_Global_EIS_Report.html",
    "Mohamed_Ibrahim_Ahmed_Global_EIS_Report.html",
    "Mohamed_Ibrahim_Ahmed_Global_EIS_Report_6M.html",
    "Mohamed_Soliman_Saad_Soliman_Global_EIS_Report.html",
    "Salah_Beshr_Mohamed_Global_EIS_Report.html",
    "Global_EIS_Pipeline_SelfTest_Report.html",
    "Global_EIS_Pipeline_SelfTest_Report.pdf",
    "Global_EIS_Pipeline_SelfTest_Report_compact.html",
]

def run(*args):
    return subprocess.run(args, capture_output=True, text=True, cwd=REPO)

# All commits across every ref, newest first by commit date
log = run("git", "log", "--all", "--format=%H %ct").stdout.strip().splitlines()
commits = [(h, int(t)) for h, t in (ln.split() for ln in log if ln.strip())]
commits.sort(key=lambda x: -x[1])

restored, missing = [], []
for name in CANDIDATES:
    got = False
    for h, t in commits:
        ls = run("git", "ls-tree", "-r", h, "--name-only")
        if f"download/{name}" in ls.stdout.splitlines():
            blob = subprocess.run(["git", "show", f"{h}:download/{name}"],
                                  capture_output=True, cwd=REPO)
            if blob.returncode == 0 and blob.stdout:
                (DL / name).write_bytes(blob.stdout)
                import datetime
                restored.append((name, h[:8], datetime.datetime.utcfromtimestamp(t).strftime("%Y-%m-%d"), len(blob.stdout)))
                got = True
                break
    if not got:
        missing.append(name)

print(f"RESTORED {len(restored)}/{len(CANDIDATES)} -> {DL}")
for n, c, d, s in restored:
    print(f"  {n}  <- {c} ({d}) {s:,} B")
if missing:
    print("MISSING:", missing)
