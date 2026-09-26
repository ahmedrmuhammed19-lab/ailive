#!/usr/bin/env python3
"""
Global EIS — data backup (the half that git does NOT carry).

Git (after push) holds the CODE. This script packs everything else needed to
rebuild the system on any machine:

  db/                         queue + submissions database
  upload/                     client statements, outbox, case briefs, state
  download/                   generated reports (HTML + PDF)
  .env                        access code + database URL
  config/mail_credentials.json  SMTP credentials

Usage:
    python3 scripts/backup_data.py              # create backup zip
    python3 scripts/backup_data.py --list       # show contents only

The zip lands in download/ (excluded from the archive itself) and is named
GlobalEIS_DATA_BACKUP_<timestamp>.zip. Restore = clone the git repo, drop the
folders from this zip into the project root, copy .env, `npx prisma generate`,
`npm run dev`.
"""

import argparse
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path

PROJECT = Path("/home/z/my-project")
TARGETS = [
    PROJECT / "db",
    PROJECT / "upload",
    PROJECT / "download",
    PROJECT / ".env",
    PROJECT / "config" / "mail_credentials.json",
]
OUT_DIR = PROJECT / "download"
EXCLUDE_NAMES = {"NOTIFICATIONS.log.bak"}


def collect_files():
    files = []
    for t in TARGETS:
        if t.is_file():
            files.append(t)
        elif t.is_dir():
            for p in sorted(t.rglob("*")):
                if p.is_file() and p.name not in EXCLUDE_NAMES and p.suffix != ".zip":
                    files.append(p)
    return files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true", help="list what would be backed up")
    args = ap.parse_args()

    files = collect_files()
    if not files:
        print("Nothing to back up.")
        return 1

    total = sum(f.stat().st_size for f in files)
    print(f"{len(files)} files, {total:,} bytes")

    if args.list:
        for f in files[:40]:
            print("  ", f.relative_to(PROJECT))
        if len(files) > 40:
            print(f"   … and {len(files) - 40} more")
        return 0

    ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
    out = OUT_DIR / f"GlobalEIS_DATA_BACKUP_{ts}.zip"
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in files:
            z.write(f, arcname=f.relative_to(PROJECT))
    print(f"\nBackup written: {out}")
    print(f"Size: {out.stat().st_size:,} bytes")
    print("\nTo move the system anywhere: git clone <your repo> + unzip this archive "
          "into the project root + copy .env + 'npx prisma generate' + 'npm run dev'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
