#!/usr/bin/env python3
"""make_fixtures.py — generate text-layer PDF fixtures for comprehensive e2e testing.

1. statement_green_B.pdf — CIB "Internet Banking Account Statement" (layout B),
   7 rows, chain-verified 7/7 (100% integrity) -> auto-DONE path.
2. insurance_red.pdf  — non-statement T&C document -> red/needs-manual path.
"""
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

OUT = "/home/z/my-project/tests/e2e_fixtures"


def text_pdf(path, lines, font="Courier", size=10, leading=14):
    c = canvas.Canvas(path, pagesize=A4)
    w, h = A4
    y = h - 60
    c.setFont(font, size)
    for ln in lines:
        c.drawString(50, y, ln)
        y -= leading
        if y < 50:
            c.showPage()
            c.setFont(font, size)
            y = h - 60
    c.save()
    print("wrote", path)


GREEN = [
    "Internet Banking Account Statement",
    "Account Number 100 034 5567 891",
    "Currency EGP",
    "Statement Period 01/08/2026 - 31/08/2026",
    "Opening Balance EGP 10,000.00",
    "",
    "01/08/2026 SALARY AUGUST                     5,000.00    15,000.00",
    "05/08/2026 GROCERY STORE NAGHAM                350.25    14,649.75",
    "10/08/2026 ATM WITHDRAWAL CAIRO                200.00    14,449.75",
    "15/08/2026 UTILITY BILL PAYMENT                149.75    14,300.00",
    "20/08/2026 TRANSFER FROM CLIENT EIS          2,700.00    17,000.00",
    "25/08/2026 RESTAURANT PAYMENT ZAMALEK           85.50    16,914.50",
    "28/08/2026 ONLINE SUBSCRIPTION                  14.50    16,900.00",
]

RED = [
    "Online Insurance Conditions - Travel Policy T&C",
    "",
    "1. Definitions",
    '"Policy" means this travel insurance contract issued by the insurer.',
    '"Insured" means the person named on the certificate of insurance.',
    '"Premium" means the amount payable for the coverage described herein.',
    "",
    "2. Scope of Cover",
    "The policy covers emergency medical expenses, trip cancellation, and",
    "lost baggage up to the limits stated in the schedule of benefits.",
    "Coverage applies worldwide excluding sanctioned territories.",
    "",
    "3. Exclusions",
    "Pre-existing conditions, professional sports, and acts of war are",
    "excluded. Claims arising from intoxication are not payable.",
    "",
    "4. Claims Procedure",
    "Notify the insurer within 48 hours of any incident. Provide boarding",
    "passes, receipts, and the official report where applicable.",
    "",
    "5. Data Protection",
    "Personal data is processed under applicable data protection law for",
    "underwriting and claims handling purposes only.",
]

text_pdf(f"{OUT}/statement_green_B.pdf", GREEN)
text_pdf(f"{OUT}/insurance_red.pdf", RED)
