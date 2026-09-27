from pathlib import Path
import shutil, subprocess, json
db = "/home/z/my-project/db/custom.db"
out = subprocess.run(["sqlite3", db, "SELECT id, userId FROM Submission WHERE userId='SMTP_PROBE';"], capture_output=True, text=True)
rows = [r.split("|") for r in out.stdout.strip().splitlines() if r]
for sid, uid in rows:
    subprocess.run(["sqlite3", db, f"DELETE FROM StatementFile WHERE submissionId='{sid}'; DELETE FROM Submission WHERE id='{sid}';"], check=True)
    p = Path(f"/home/z/my-project/upload/portal") 
    for d in p.glob(f"*_{uid}"):
        shutil.rmtree(d, ignore_errors=True)
    print("removed", sid, uid)
# purge the probe outbox mail too
for f in Path("/home/z/my-project/upload/portal/_outbox").glob("*c2rox5ua.json"):
    f.unlink(); print("removed", f.name)
