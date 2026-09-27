#!/usr/bin/env python3
"""
Global EIS — send one test email using config/mail_credentials.json.

Verifies your SMTP provider (Brevo / SendGrid / Gmail / custom) before
flushing the real outbox queue:

    python3 scripts/test_email.py              # send to notify_to (default operator)
    python3 scripts/test_email.py you@x.com    # send to a specific address
"""

import json
import smtplib
import sys
from datetime import datetime, timezone
from email.message import EmailMessage
from pathlib import Path

PROJECT = Path("/home/z/my-project")
CREDS = PROJECT / "config" / "mail_credentials.json"
DEFAULT_OPERATOR = "ahmedr.muhammed19@gmail.com"


def main():
    if not CREDS.exists():
        print("config/mail_credentials.json not found.")
        print("Copy config/mail_credentials.json.example and fill it in first.")
        return 1

    d = json.loads(CREDS.read_text())
    if not (d.get("email") and d.get("app_password")):
        print("config is incomplete: need at least 'email' and 'app_password'.")
        return 1

    host = (d.get("host") or "smtp.gmail.com").strip()
    port = int(d.get("port") or (465 if host == "smtp.gmail.com" else 587))
    secure = bool(d.get("secure", port == 465))
    to = sys.argv[1].strip() if len(sys.argv) > 1 else (d.get("notify_to") or DEFAULT_OPERATOR)

    print(f"Provider target : {host}:{port} ({'SSL' if secure else 'STARTTLS'})")
    print(f"Login / sender  : {d['email']}")
    print(f"Sending test to : {to}")

    msg = EmailMessage()
    msg["From"] = f"Global EIS <{d['email']}>"
    msg["To"] = to
    msg["Subject"] = "Global EIS — SMTP test email"
    msg.set_content(
        "This is a test email from the Global EIS portal.\n\n"
        f"Provider : {host}:{port}\n"
        f"Sender   : {d['email']}\n"
        f"Time     : {datetime.now(timezone.utc).isoformat()}\n\n"
        "If you received this, your mail credentials are working.\n"
        "Next step: python3 scripts/flush_outbox.py   (deliver the queued emails)"
    )

    try:
        if secure:
            s = smtplib.SMTP_SSL(host, port, timeout=30)
        else:
            s = smtplib.SMTP(host, port, timeout=30)
            s.starttls()
        with s:
            s.login(d["email"], d["app_password"])
            s.send_message(msg)
        print("\nSENT — credentials are valid. Run: python3 scripts/flush_outbox.py")
        return 0
    except Exception as e:
        print(f"\nFAILED: {e}")
        print("Check: host/port/secure values, that the SMTP key is active,")
        print("and that the sender address is verified in your provider dashboard.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
