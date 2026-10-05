#!/usr/bin/env python3
"""Phase D2 — final gap fixes (each backed by printed cell evidence)."""
import json

WORK = "/home/z/my-project/scripts/alahly_work"
d = json.load(open(f"{WORK}/final_ledger.json"))
rows = d["rows"]


def find(page, y, tol=6):
    for i, r in enumerate(rows):
        if r["page"] == page and abs((r["y"] or 0) - y) <= tol:
            return i
    raise KeyError(f"p{page} y{y}")


def R(page, y, date, desc, amt, signed, bal, src, credit, ev=""):
    return {"page": page, "y": y, "date": date, "ref": "", "desc": desc,
            "vdate": None, "amt": amt, "signed": signed, "bal": bal,
            "src": src, "credit": credit, "ev": ev}


# a. p3: hidden 75.00 fee (printed row found at 2400dpi) before ATM rows
i = find(3, 1962)
rows.insert(i, R(3, 1900, "04/03/2026", "Account/statement fee (auto-sweep block)",
                 75.00, -75.00, 442032.03, "surgical2400", False,
                 "2400dpi: '-75.00 442,032.03' printed between VISA row and ATM"))
# b. p3: fee 20.00 -> 412,012.03 (ref ..674545) after y2261
i = find(3, 2261)
rows.insert(i + 1, R(3, 2435, "08/03/2026", "Outgoing transfer fee (IPN) - ref ..674545",
                     20.00, -20.00, 412012.03, "cell1200", False,
                     "cell: amt 20.00 + bal 412,012.03 printed"))
# c. p10: fee 0.50 -> 31,793.77 after y3358
i = find(10, 3358)
rows.insert(i + 1, R(10, 3400, "01/04/2026", "Non-financial fee", 0.50, -0.50,
                     31793.77, "cell1200", False,
                     "cell/colscan: bal 31,793.77 printed conf95"))
# d. p13 y775 split: 1,000.00 derived + 0.50 printed
i = find(13, 775)
rows[i:i + 1] = [
    R(13, 770, "26/04/2026", "To-Revenue account fee (print unreadable, derived)",
      1000.00, -1000.00, 160401.28, "derived", False,
      "derived: 161,401.28 - 0.50 - 1,000.00 = 160,400.78"),
    R(13, 775, "27/04/2026", "Non-financial fee", 0.50, -0.50, 160400.78, "colscan",
      False, "colscan: amt 0.50 conf96 + bal 160,400.78 conf77"),
]
# e. p16 y2559 split: 4,000 derived + 0.50 printed
i = find(16, 2559)
rows[i:i + 1] = [
    R(16, 2555, "17/05/2026", "Outgoing transfer IPN (..376083 block)", 4000.00,
      -4000.00, 1280901 / 100.0 - 0.50, "derived", False,
      "derived: 16,809.51 - 4,000.50 = 12,809.01"),
    R(16, 2559, "17/05/2026", "Balance inquiry fee", 0.50, -0.50, 1280901 / 100.0,
      "colscan", False, "colscan: amt 0.50 + bal 12,809.01 printed"),
]
# f. p16 y2753 split: 400 implied + 0.50 printed
i = find(16, 2753)
rows[i:i + 1] = [
    R(16, 2750, "17/05/2026", "Outgoing transfer IPN - 61396AED7D0CADDC", 400.00,
      -400.00, 1240851 / 100.0 + 0.50, "colscan", False,
      "colscan: amt 400.00 printed; balance implied"),
    R(16, 2753, "17/05/2026", "Balance inquiry fee", 0.50, -0.50, 1240851 / 100.0,
      "colscan", False, "colscan: bal 12,408.51 printed conf95"),
]
# g. p17: fee 0.50 -> 10,942.63 before y659
i = find(17, 659)
rows.insert(i, R(17, 1402, "18/05/2026", "Balance inquiry fee", 0.50, -0.50,
                 1094263 / 100.0, "surgical2400", False,
                 "surgical/colscan: 0.50 -> 10,942.63 printed"))
# h. p20: drop dup y2328; insert 500.00 derived before y3740
i = find(20, 2328)
rows.pop(i)
i = find(20, 3740)
rows.insert(i, R(20, 3700, "30/07/2026", "Outgoing transfer IPN - E7AC9C4BEF2FDAFD (derived)",
                 500.00, -500.00, 10417461 / 100.0, "derived", False,
                 "derived: 104,674.61 - 500.00 - 20.00 = 104,154.61"))

json.dump({"rows": rows, "corrections": d["corrections"] +
           ["D2: +75.00 p3, +20.00 p3, +0.50 p10, p13 split, p16 splits x2, +0.50 p17, p20 dup drop + 500.00"]},
          open(f"{WORK}/final_ledger.json", "w"), ensure_ascii=False, indent=1)
print(f"rows now: {len(rows)}")
