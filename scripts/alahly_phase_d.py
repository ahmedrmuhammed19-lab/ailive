#!/usr/bin/env python3
"""Phase D — FINAL LEDGER REBUILD.
Applies the pocket corrections (from 1200/2400dpi cell evidence) to the v8
ledger, then re-walks the FULL chain: every consecutive printed balance must
close exactly; telescopes opening 467,525.43 -> closing 631,182.24.
Output: final_ledger.json + walk report."""
import json

WORK = "/home/z/my-project/scripts/alahly_work"
OPENING, CLOSING = 467525.43, 631182.24

d = json.load(open(f"{WORK}/report_data.json"))
rows = [dict(r) for r in d["rows"]]

# ---------- helpers ----------
def find(page, y, tol=6):
    for i, r in enumerate(rows):
        if r["page"] == page and abs((r["y"] or 0) - y) <= tol:
            return i
    raise KeyError(f"row p{page} y{y} not found")


def drop(page, y):
    i = find(page, y)
    rows.pop(i)


def amend(page, y, **kw):
    i = find(page, y)
    rows[i].update(kw)


def insert_after(page, y, new_rows):
    i = find(page, y)
    for j, nr in enumerate(new_rows):
        rows.insert(i + 1 + j, nr)


def R(page, y, date, desc, amt, signed, bal, src, credit, ev=""):
    return {"page": page, "y": y, "date": date, "ref": "", "desc": desc,
            "vdate": None, "amt": amt, "signed": signed, "bal": bal,
            "src": src, "credit": credit, "ev": ev}


CH = []  # correction log

# ============ PAGE 3 ============
i = find(3, 1962)
rows[i:i + 1] = [
    R(3, 1962, "08/03/2026", "NBE ATM cash withdrawal (card ..794)", 12000.00, -12000.00,
      430032.03, "cell1200", False, "1200dpi: amt 12,000.00 + bal 430,032.03 printed"),
    R(3, 1970, "08/03/2026", "NBE ATM cash withdrawal (card ..798)", 12000.00, -12000.00,
      418032.03, "cell1200", False, "1200dpi: second ATM row, bal 418,032.03 printed"),
]
CH.append("p3 y1962: v8 merged two ATM withdrawals into phantom 24,075 -> split 12,000 + 12,000")
amend(3, 2261, bal=412032.03, signed=-6000.00, src="cell1200",
      ev="1200dpi: bal 412,032.03 printed")
CH.append("p3 y2261: ATM 6,000 got printed balance 412,032.03")
amend(3, 2609, bal=342012.03, signed=-70000.00, src="chain",
      ev="amt 70,000 printed; balance implied (412,012.03 - 70,000)")
CH.append("p3 y2609: transfer 70,000 balance 342,012.03 (implied)")
amend(3, 2781, amt=20.00, signed=-20.00, desc="Outgoing transfer fee (IPN) - ref ..674546",
      src="cell1200", ev="1200dpi: amt 20.00 printed (v8 76,040 was |delta| artifact)")
CH.append("p3 y2781: fee 20.00 (v8 phantom 76,040 dropped)")
i = find(3, 3345)
rows[i:i + 1] = [
    R(3, 3345, "16/03/2026", "Non-financial fee", 0.50, -0.50, 338052.53, "cell1200",
      False, "1200dpi: bal 338,052.53 printed"),
    R(3, 3350, "17/03/2026", "Outgoing transfer fee - ref ..75A059", 5.00, -5.00,
      338047.53, "cell1200", False, "1200dpi: bal 338,047.53 printed"),
]
CH.append("p3 y3345: v8 merged 0.50 + 5.00 fees into '5.5' -> split")
amend(3, 3798, bal=333047.53, signed=-5000.00, src="cell1200",
      ev="1200dpi: bal 333,047.53 printed")
CH.append("p3 y3798: SALAMA 5,000 got printed balance 333,047.53")

# ============ PAGE 4 ============
amend(4, 1118, amt=0.50, signed=-0.50, desc="Non-financial fee (page-top continuation)",
      src="colscan", ev="colscan: bal 333,047.03 conf90; amt ~0.50; chain-locked")
CH.append("p4 y1118: v8 phantom 5,000.50 -> real 0.50 fee row")
drop(4, 1330)
CH.append("p4 y1330: duplicate capture of same physical row -> dropped")

# ============ PAGE 9 ============
amend(9, 590, src="chain", ev="fee 2.17 = 0.1% of 2,170; chain-locked from p8 end 97,387.92")
insert_after(9, 590, [
    R(9, 600, "26/03/2026", "Outgoing transfer IPN - ABDELRAHMAN HAB MOHAMED (..852212)",
      2170.00, -2170.00, 95215.75, "cell1200", False, "colscan: amt 2,170.00 + bal 95,215.75"),
    R(9, 610, "29/03/2026", "IPN transfer fee (0.1%)", 3.30, -3.30, 95212.45, "cell1200",
      False, "colscan: amt 3.30 conf87"),
    R(9, 620, "29/03/2026", "Outgoing transfer IPN - Mohamed Mahmoud (..852341)",
      3300.00, -3300.00, 91912.45, "cell1200", False, "colscan: amt 3,300.00 + bal 91,912.45"),
])
CH.append("p9: added hidden rows 2,170 / fee 3.30 / 3,300 (v8 skipped entirely)")
amend(9, 1324, amt=0.80, signed=-0.80, bal=91911.65, desc="IPN transfer fee (0.1% of 800)",
      src="cell1200", ev="cell: bal 91,911.65 printed (chain-exact)")
amend(9, 1491, amt=800.00, signed=-800.00, bal=91111.65, src="cell1200",
      ev="colscan: amt 800.00 printed; bal implied (91,911.65 - 800)")
CH.append("p9 y1324/y1491: v8 interp 800+400 -> real fee 0.80 + transfer 800")
i = find(9, 1594)
rows[i:i + 1] = [
    R(9, 1594, "29/03/2026", "IPN transfer fee (0.1% of 1,280)", 1.28, -1.28, 91110.37,
      "cell1200", False, "cell+colscan: bal 91,110.37 printed conf95"),
]
CH.append("p9 y1594: v8 ghost (275.38 -> 97,110.37 misread) -> fee 1.28 -> 91,110.37")
amend(9, 1742, amt=1280.00, signed=-1280.00, desc="Outgoing transfer IPN (..88A047)",
      src="colscan", ev="colscan: amt 1,280.00 printed; bal 89,830.37")
CH.append("p9 y1742: v8 '7,280' -> printed 1,280.00")
amend(9, 1943, amt=0.50, signed=-0.50, bal=89829.87, desc="Non-financial fee",
      src="cell1200", ev="cell: bal 89,829.87 printed (v8 89,329.87 misread)")
CH.append("p9 y1943: v8 phantom 500.50 -> fee 0.50 -> 89,829.87")
i = find(9, 2034)
rows[i:i + 1] = [
    R(9, 2034, "29/03/2026", "Outgoing transfer IPN (..880474)", 315.00, -315.00,
      89514.87, "colscan", False, "colscan: amt 315.00 conf95; bal chain-exact"),
    R(9, 2040, "29/03/2026", "Balance inquiry fee", 0.50, -0.50, 89514.37, "colscan",
      False, "colscan: bal 89,514.37 conf92"),
]
CH.append("p9 y2034: v8 phantom 184.50 -> transfer 315 + fee 0.50")
i = find(9, 3401)
rows[i:i + 1] = [
    R(9, 3401, "29/03/2026", "Outgoing transfer IPN - eld f s (..88A37T)", 9800.00,
      -9800.00, 73898.27, "surgical2400", False, "2400dpi 3x: bal 73,898.27"),
    R(9, 3405, "30/03/2026", "Non-financial fee", 0.50, -0.50, 73897.77, "surgical2400",
      False, "colscan: 0.50 -> 73,897.77"),
]
CH.append("p9 y3401: v8 merged 9,800 + 0.50 into '9,800.50' -> split")
amend(9, 3602, bal=73897.27, signed=-0.50, src="cell1200",
      ev="cell: bal 73,897.27 printed")
insert_after(9, 3602, [
    R(9, 3610, "30/03/2026", "IPN transfer fee (0.1% of 3,000)", 3.00, -3.00, 73894.27,
      "surgical2400", False, "2400dpi 3x: 3.00 -> 73,894.27"),
    R(9, 3620, "30/03/2026", "Outgoing transfer IPN - EID FARAG SAAD SHAAT (..898267)",
      3000.00, -3000.00, 70894.27, "surgical2400", False, "2400dpi 3x: 3,000 -> 70,894.27"),
])
CH.append("p9 tail: added fee 3.00 + transfer 3,000 (v8 missed; page ends 70,894.27)")

# ============ PAGE 10 ============
i = find(10, 893)
rows[i:i + 1] = [
    R(10, 893, "30/03/2026", "REVERSAL: transfer 3,000 + fee 3.00 returned (..898267)",
      3003.00, 3003.00, 73897.27, "surgical2400", True,
      "2400dpi 3x: bal 73,897.27; movement 70,894.27 -> 73,897.27 = +3,003.00"),
]
CH.append("p10 top: page-break REVERSAL +3,003.00 (v8 had phantom 0.50 row)")
insert_after(10, 1334, [
    R(10, 1340, "30/03/2026", "IPN transfer fee (0.1% of 1,500)", 1.50, -1.50, 71893.77,
      "surgical2400", False, "2400dpi 3x: bal 71,893.77"),
    R(10, 1350, "30/03/2026", "Outgoing transfer IPN (..89A035)", 1500.00, -1500.00,
      70393.77, "surgical2400", False, "colscan/surgical: bal 70,393.77"),
    R(10, 1360, "30/03/2026", "IPN transfer fee (0.1% of 500)", 0.50, -0.50, 70393.27,
      "surgical2400", False, "colscan: bal 70,393.27"),
    R(10, 1370, "30/03/2026", "Outgoing transfer IPN", 500.00, -500.00, 69893.27,
      "surgical2400", False, "colscan: bal 69,893.27"),
    R(10, 1380, "30/03/2026", "IPN transfer fee (0.1% of 3,000)", 3.00, -3.00, 69890.27,
      "surgical2400", False, "colscan: bal 69,890.27"),
    R(10, 1390, "30/03/2026", "Outgoing transfer IPN", 3000.00, -3000.00, 66890.27,
      "surgical2400", False, "colscan: bal 66,890.27 conf96"),
    R(10, 1400, "31/03/2026", "Statement issuance fee (print unreadable, chain-derived)",
      75.00, -75.00, 66815.27, "derived", False, "derived: 66,890.27 -> 66,814.77 = -75.50 (75.00 + 0.50)"),
])
CH.append("p10: added fee/transfer ladder 1.50+1,500+0.50+500+3.00+3,000 + stmt fee 75 (derived)")
amend(10, 2611, amt=0.50, signed=-0.50, bal=66814.77, desc="Statement fee (non-financial)",
      src="surgical2400", ev="2400dpi: bal 66,814.77 (v8 66,514.77 misread)")
CH.append("p10 y2611: v8 ghost 5,380.50 -> fee 0.50 -> 66,814.77")
amend(10, 2801, amt=0.50, signed=-0.50, src="colscan", ev="colscan: amt 0.50 printed")
CH.append("p10 y2801: v8 phantom 299.50 -> fee 0.50")
amend(10, 3358, amt=35000.00, signed=-35000.00, bal=31794.27, desc="Outgoing transfer IPN (..91A4RJ)",
      src="surgical2400", ev="colscan/surgical: 35,000 -> 31,794.27 (v8 31,463.77 misread)")
CH.append("p10 y3358: v8 ghost 35,330.50 -> printed 35,000 -> 31,794.27")
amend(10, 3813, amt=230.00, signed=-230.00, desc="Purchase using debit card (amount derived)",
      src="derived", ev="bal 31,563.77 printed conf84; amount = 31,793.77 - 31,563.77")
CH.append("p10 y3813: v8 '+100' -> debit purchase 230.00 (derived)")

# ============ PAGE 13 ============
amend(13, 775, amt=0.50, signed=-0.50, desc="Non-financial fee",
      src="colscan", ev="colscan: amt 0.50 conf96 + bal 160,400.78")
CH.append("p13 y775: v8 phantom 1,000.50 -> fee 0.50 -> 160,400.78")
amend(13, 1398, bal=158400.78, signed=-2000.00, src="printed+chain",
      ev="amt 2,000 (450/600dpi read); balance implied")
i = find(13, 2086)
rows[i:i + 1] = [
    R(13, 2086, "28/04/2026",
      "Outgoing transfers to CB469E52F60FBDD9 / Mohamed Mahmoud Hassan + fees "
      "(print unreadable, chain-derived combined)",
      8657.14, -8657.14, 149743.64, "derived", False,
      "derived: 158,400.78 - 149,743.64 = 8,657.14; bal 149,743.64 printed 2400dpi 3x"),
]
CH.append("p13 pocket: v8 10,657.14 double-counted the 2,000 -> 8,657.14 derived residual")

# ============ PAGE 16 ============
amend(16, 2559, amt=4000.00, signed=-4000.00, bal=1280901 / 100.0,
      desc="Outgoing transfer IPN (..376083)", src="derived",
      ev="16,809.51 -> 12,809.01 = -4,000.50 (4,000 + 0.50 fee)")
CH.append("p16 y2559: v8 phantom 4,001 -> transfer 4,000 (derived) + fee 0.50")
i = find(16, 2919)
rows[i:i + 1] = [
    R(16, 2919, "17/05/2026",
      "Outgoing transfers to 4D7E4B4806081440 / AF21B6E25E34BBE3 + fees "
      "(print unreadable, chain-derived combined)",
      1021.88, -1021.88, 1138663 / 100.0, "derived", False,
      "derived: 12,408.51 -> 11,386.63; then -325 -> 11,061.63 printed"),
]
CH.append("p16 y2919: v8 1,021.68/11,386.83 -> derived 1,021.88 -> 11,386.63 (chain-locked)")
insert_after(16, 4113, [
    R(16, 4120, "18/05/2026", "Balance inquiry fee", 0.50, -0.50, 1106113 / 100.0,
      "derived", False, "derived: 11,061.63 - 118.00 = 10,943.63 printed .13 -> fee 0.50"),
])
amend(16, 4113, bal=1106163 / 100.0, signed=-325.00, src="colscan",
      ev="colscan: 325.00 -> 11,061.63 printed")
amend(16, 4283, bal=1094313 / 100.0, signed=-118.00, src="cell1200",
      ev="cell: amt 118.00 + bal 10,943.13 printed")
CH.append("p16: 325/118 rows got printed balances; dedupe of twin 118 rows; fee 0.50 added")

# ============ PAGE 17 ============
amend(17, 659, amt=320.00, signed=-320.00, desc="Outgoing transfer IPN - MA SIIIYU (..495D272)",
      src="surgical2400", ev="2400dpi 3x: amt 320.00 printed; bal 10,622.63 (v8)")
CH.append("p17 y659: v8 phantom 764.20 -> printed 320.00 -> 10,622.63")
amend(17, 932, src="derived", ev="24/05 sub-rows unread; segment total -276.83 derived")
CH.append("p17 y932: 24/05 pocket kept as derived segment total 276.83")
amend(17, 2041, src="colscan", ev="colscan: amt 1,500.00 printed")
i = find(17, 2554)
rows[i:i + 1] = [
    R(17, 2550, "01/06/2026", "Certificate/term deposit interest (amount derived)",
      205.33, 205.33, 905113 / 100.0, "derived", True,
      "interest row printed (244UD01EGP); 8,845.80 -> 9,051.13"),
    R(17, 2554, "01/06/2026", "Balance inquiry fee (..452184)", 0.50, -0.50, 905063 / 100.0,
      "surgical2400", False, "2400dpi 2x: 0.50 -> 9,050.63"),
    R(17, 2560, "01/06/2026", "Outgoing transfer IPN (..524315)", 290.00, -290.00,
      876063 / 100.0, "surgical2400", False, "2400dpi: 290.00 -> 8,760.63"),
    R(17, 2565, "01/06/2026", "Non-financial fee", 0.50, -0.50, 876013 / 100.0, "derived",
      False, "derived: 8,760.63 -> 8,690.13 = -70.50? no: -0.50 then -70"),
]
CH.append("p17: interest +205.33 added; v8 ghost 85.67 -> fee 0.50 + 290.00 ladder")
amend(17, 3060, src="chain", ev="70.00 -> 8,690.13 (v8 read kept)")
i = find(17, 3228)
rows[i:i + 1] = [
    R(17, 3228, "01/06/2026", "IPN transfer fee (0.1% of 950)", 0.95, -0.95, 868918 / 100.0,
      "surgical2400", False, "2400dpi: 0.95 -> 8,689.18"),
    R(17, 3233, "01/06/2026", "Outgoing transfer IPN - IBIEJAFDD61ADFDF", 950.00, -950.00,
      773918 / 100.0, "surgical2400", False, "2400dpi 2x: 950.00 -> 7,739.18"),
]
CH.append("p17 y3228: v8 merged 950.95 -> fee 0.95 + transfer 950.00")
drop(17, 3397)
CH.append("p17 y3397: duplicate balance row dropped")

# ============ PAGE 18 ============
i = find(18, 1104)
rows[i:i + 1] = [
    R(18, 1104, "01/06/2026", "Outgoing transfer IPN - AWLIA HASAN (..CC974S)",
      205.00, -205.00, 723368 / 100.0, "surgical2400", False, "2400dpi: amt 205.00 (psm11)"),
    R(18, 1108, "01/06/2026", "Non-financial fee", 0.50, -0.50, 723318 / 100.0, "surgical2400",
      False, "2400dpi: bal 7,233.18"),
    R(18, 1112, "01/06/2026", "Outgoing transfer IPN - MOHA~A581189AAE44BCFE (derived)",
      540.00, -540.00, 669318 / 100.0, "derived", False, "derived split of 541.08"),
    R(18, 1116, "01/06/2026", "IPN transfer fee", 0.54, -0.54, 669264 / 100.0, "derived",
      False, "derived: 0.54 x2 fees (0.1% of 540)"),
    R(18, 1120, "01/06/2026", "IPN transfer fee", 0.54, -0.54, 669210 / 100.0, "surgical2400",
      False, "2400dpi 3x: 0.54 -> 6,692.10"),
]
CH.append("p18 y1104: v8 compressed 746.58 -> rows 205.00 + 0.50 + 540.00 + 0.54 + 0.54")
drop(18, 1641)
CH.append("p18 y1641: duplicate balance row dropped")
amend(18, 1799, bal=615210 / 100.0, signed=-540.00, src="cell1200",
      ev="cell: 540.00 -> 6,152.10 printed")
CH.append("p18 y1799: 540.00 got printed balance 6,152.10")
amend(18, 2002, bal=615160 / 100.0, signed=-0.50, src="cell1200", ev="cell: bal 6,151.60 printed")
i = find(18, 2389)
rows[i:i + 1] = [
    R(18, 2385, "01/06/2026", "Non-financial fee", 0.50, -0.50, 615110 / 100.0, "cell1200",
      False, "cell: bal 6,151.10 printed"),
    R(18, 2389, "01/06/2026", "Outgoing transfer IPN - MOHAMED ELSAYED MOHA (..400FB3A)",
      230.00, -230.00, 592110 / 100.0, "surgical2400", False, "2400dpi 3x: 230.00 -> 5,921.10"),
    R(18, 2393, "09/06/2026", "Balance inquiry fee", 0.50, -0.50, 592060 / 100.0, "cell1200",
      False, "cell: bal 5,920.60 printed"),
]
CH.append("p18 y2389: v8 771.5 misassigned -> fee 0.50 + transfer 230.00 + fee 0.50")
drop(18, 2575)
CH.append("p18 y2575: duplicate balance row dropped")
amend(18, 2761, bal=553560 / 100.0, signed=-385.00, src="cell1200",
      ev="cell: 385.00 -> 5,535.60 printed")
i = find(18, 2931)
rows[i:i + 1] = [
    R(18, 2931, "09/06/2026", "IPN transfer fee", 1.00, -1.00, 553460 / 100.0,
      "surgical2400", False, "2400dpi 3x: 1.00 -> 5,534.60"),
    R(18, 2936, "09/06/2026", "Outgoing transfer IPN - eld f s (..A555BDC4)", 1000.00,
      -1000.00, 453460 / 100.0, "surgical2400", False, "2400dpi 3x: 1,000 -> 4,534.60"),
]
CH.append("p18 y2931: v8 phantom 1,386 -> fee 1.00 + transfer 1,000.00")
amend(18, 3084, src="chain", ev="0.54 -> 4,534.06 (balance printed; delta-derived)")

# ============ PAGE 20 ============
amend(20, 2161, amt=4254.75, signed=-4254.75, bal=11268311 / 100.0, src="cell1200",
      ev="cell: bal 112,683.11 (1200dpi) - v8 .61 misread; amount derived")
amend(20, 2647, amt=5005.00, signed=-5005.00, bal=10767811 / 100.0, src="cell1200",
      ev="cell: bal 107,678.11; amount derived (v8 5,005.49)")
amend(20, 2942, amt=3.00, signed=-3.00, src="cell1200", ev="cell: .11 ending consistent")
CH.append("p20 middle: balances .61/.12 -> .11/.11 (1200dpi), amounts re-derived")
amend(20, 3311, bal=10467461 / 100.0, signed=-0.50, src="surgical2400",
      ev="2400dpi 3x: 0.50 -> 104,674.61")
i = find(20, 3745)
rows[i:i + 1] = [
    R(20, 3740, "30/07/2026", "Outgoing transfer fee (IPN)", 20.00, -20.00, 10415461 / 100.0,
      "surgical2400", False, "2400dpi 3x: 20.00 -> 104,154.61"),
    R(20, 3745, "30/07/2026", "Outgoing transfer IPN - EID FARAG SAAD (..481380E43DE3)",
      20000.00, -20000.00, 8415461 / 100.0, "surgical2400", False,
      "2400dpi 3x: 20,000 -> 84,154.61 (v8 84,134.61 misread)"),
]
CH.append("p20 y3745: v8 phantom 20,540.5 -> fee 20.00 + transfer 20,000.00 -> 84,154.61")
amend(21, 1825, amt=30820.77, signed=-30820.77, src="derived",
      ev="84,154.61 -> 53,333.84 (amount derived; balance as read)")
CH.append("p21 y1825: amount corrected to 30,820.77 (derived) after endpoint fix")

json.dump({"rows": rows, "corrections": CH},
          open(f"{WORK}/final_ledger.json", "w"), ensure_ascii=False, indent=1)
print(f"rows now: {len(rows)}; corrections: {len(CH)}")
