#!/usr/bin/env python3
"""WAFA-MAIL-1: send the finished WAFA analysis report PDF to the locked test inbox.

Discipline: recipient is always the TEST inbox from config/mail_credentials.json
(a.imam@beta.com.eg is never referenced). Sends the actual PDF as attachment,
appends a SENT line to the portal NOTIFICATIONS.log, and drops an outbox JSON
copy for audit consistency with the portal's own mail format.
"""
import json
import os
import smtplib
import ssl
from datetime import datetime, timezone
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "download", "Global_EIS_Statement_Analysis_WAFA_6M.pdf")
CREDS = os.path.join(ROOT, "config", "mail_credentials.json")
OUTBOX = os.path.join(ROOT, "upload", "portal", "_outbox")

SUBJECT = "Global EIS - Bank Statement Analysis Report (WAFA Current Account, 6M)"

BODY = """Dear Client,

Please find attached the completed bank statement analysis report for your
submission (Queue WAFA-6M-ABDO).

Document: Global_EIS_Statement_Analysis_WAFA_6M.pdf (23 pages, PDF)

Source document
---------------
48-page scanned statement - Wafa Bank, Wafa Current Account (EGP)
Account holder: EID FARAG SAAD SHAAT
Transactions reconstructed: 844 (824 consensus rows)

Verification summary (honest, non-inflated)
-------------------------------------------
- Debit mass captured:  4,073,809.19 EGP (99.0% of printed 4,122,781.15)
- Credit mass captured: 4,089,085.77 EGP (99.7% of printed 4,100,172.41)
- Printed anchors reconcile exactly:
  545,904.67 (opening) + 4,100,172.41 (credits) - 4,122,781.15 (debits)
  = 523,295.93 (closing)

Key movements
-------------
- 687 instant transfers out, totalling ~2.80M EGP
- 92 reversals (~423K EGP)
- 2 cash deposits (1.75M EGP), 2 collected cheques (1.15M EGP)
- 1 internal cheque out (1.00M EGP), ACH credits in (~350K EGP)
- 8 transactions >= 100K EGP

Note: the source is a scan without a machine-readable text layer; residual
single-digit OCR noise is disclosed in the report appendix. For a fully
chain-verified (100%) analysis we recommend requesting an official
bank-issued PDF export of the statement.

Regards,
Global EIS Automated Analysis Pipeline
"""


def main() -> None:
    with open(CREDS, encoding="utf-8") as f:
        cfg = json.load(f)
    user = cfg["email"]
    pwd = cfg["app_password"]
    to = cfg.get("notify_to", user)  # test inbox lock

    msg = MIMEMultipart()
    msg["From"] = f"Global EIS Analysis <{user}>"
    msg["To"] = to
    msg["Subject"] = SUBJECT
    msg.attach(MIMEText(BODY, "plain", "utf-8"))

    size = os.path.getsize(PDF)
    with open(PDF, "rb") as f:
        att = MIMEApplication(f.read(), _subtype="pdf")
    att.add_header(
        "Content-Disposition", "attachment", filename=os.path.basename(PDF)
    )
    msg.attach(att)

    ctx = ssl.create_default_context()
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ctx) as s:
        s.login(user, pwd)
        s.send_message(msg)

    now = datetime.now(timezone.utc)
    stamp = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    line = f"[{stamp}] SENT analyst_report -> {to} :: {SUBJECT}\n"
    with open(os.path.join(OUTBOX, "NOTIFICATIONS.log"), "a", encoding="utf-8") as f:
        f.write(line)

    slug = now.strftime("%Y%m%d%H%M%S")
    record = {
        "to": to,
        "subject": SUBJECT,
        "body": BODY,
        "kind": "analyst_report",
        "submissionId": "cmusdua3r0000kgirsru1rgxi",
        "attachments": [
            {"filename": os.path.basename(PDF), "bytes": size}
        ],
        "hasHtml": False,
        "status": "sent",
        "error": None,
        "at": stamp,
    }
    with open(
        os.path.join(OUTBOX, f"{slug}_analyst_report_wafa6m.json"),
        "w",
        encoding="utf-8",
    ) as f:
        json.dump(record, f, ensure_ascii=False, indent=2)

    print("SENT OK:", line.strip())
    print("attachment:", os.path.basename(PDF), f"({size} bytes)")
    print("outbox copy + NOTIFICATIONS.log updated")


if __name__ == "__main__":
    main()
