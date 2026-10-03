#!/usr/bin/env python3
"""Global EIS — Bank Statement Analysis Report (WAFA Current Account, 6 months).
Report route: ReportLab body + Template 07 cover merged via pypdf.

Numbering map (Step 3.5):
| Outline | Type    | Chapter | Title                              |
| 1       | cover   | -       | Cover (separate PDF, merged)       |
| 2       | toc     | -       | Table of Contents (roman i)        |
| 3       | content | 1       | Executive Summary                  |
| 4       | content | 2       | Account and Statement Overview     |
| 5       | content | 3       | Balance Chain Verification         |
| 6       | content | 4       | Monthly Flow Analysis              |
| 7       | content | 5       | Transaction Pattern Analysis       |
| 8       | content | 6       | Notable Transactions (>= 100k EGP) |
| 9       | content | 7       | Methodology and Limitations        |
| 10      | content | 8       | Appendix: Full Transaction Ledger  |
"""
import hashlib
import json
import os
import sys

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_JUSTIFY, TA_LEFT, TA_RIGHT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import inch
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import registerFontFamily, stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (CondPageBreak, Image, KeepTogether, PageBreak,
                                Paragraph, SimpleDocTemplate, Spacer, Table,
                                TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

PDF_SKILL_DIR = "/home/z/my-project/skills/pdf"
sys.path.insert(0, os.path.join(PDF_SKILL_DIR, "scripts"))
from pdf import install_font_fallback  # noqa: E402

WORK = "/home/z/my-project/scripts/wafa_work"
OUT_BODY = f"{WORK}/report_body.pdf"
OUT_FINAL = "/home/z/my-project/download/Global_EIS_Statement_Analysis_WAFA_6M.pdf"

# ---- Fonts (allowed set only) ----
FONT_DIR = "/usr/share/fonts"
pdfmetrics.registerFont(TTFont("NotoSerifSC", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf"))
pdfmetrics.registerFont(TTFont("NotoSerifSC-Bold", f"{FONT_DIR}/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif", f"{FONT_DIR}/truetype/freefont/FreeSerif.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Bold", f"{FONT_DIR}/truetype/freefont/FreeSerifBold.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-Italic", f"{FONT_DIR}/truetype/freefont/FreeSerifItalic.ttf"))
pdfmetrics.registerFont(TTFont("FreeSerif-BoldItalic", f"{FONT_DIR}/truetype/freefont/FreeSerifBoldItalic.ttf"))
registerFontFamily("NotoSerifSC", normal="NotoSerifSC", bold="NotoSerifSC-Bold")
registerFontFamily("FreeSerif", normal="FreeSerif", bold="FreeSerif-Bold",
                   italic="FreeSerif-Italic", boldItalic="FreeSerif-BoldItalic")
install_font_fallback()

# ---- Template 07 Crystal Blue body palette (fixed per typesetting/cover.md) ----
PAGE_BG = colors.HexColor("#f5f8fc")
SECTION_BG = colors.HexColor("#edf2f9")
CARD_BG = colors.HexColor("#e4ecf5")
TABLE_STRIPE = colors.HexColor("#eef3fa")
HEADER_FILL = colors.HexColor("#1a4a7a")
BORDER = colors.HexColor("#c0d0e2")
ACCENT = colors.HexColor("#2d7ab3")
TEXT_PRIMARY = colors.HexColor("#142840")
TEXT_MUTED = colors.HexColor("#5a7a96")
TABLE_HEADER_COLOR = HEADER_FILL
TABLE_ROW_EVEN = colors.white
TABLE_ROW_ODD = TABLE_STRIPE

MARGIN = 0.9 * inch
PAGE_W, PAGE_H = A4
AVAIL_W = PAGE_W - 2 * MARGIN
AVAIL_H = PAGE_H - 2 * MARGIN

D = json.load(open(f"{WORK}/report_data.json"))


def money(v):
    return f"{v:,.2f}"


def egp(v):
    return f"EGP {v:,.2f}"


# ---- Styles ----
body = ParagraphStyle("Body", fontName="FreeSerif", fontSize=10.5, leading=17,
                      alignment=TA_JUSTIFY, textColor=TEXT_PRIMARY, spaceAfter=10)
h1 = ParagraphStyle("H1", fontName="FreeSerif", fontSize=20, leading=26,
                    textColor=HEADER_FILL, spaceBefore=18, spaceAfter=10)
h2 = ParagraphStyle("H2", fontName="FreeSerif", fontSize=14, leading=19,
                    textColor=TEXT_PRIMARY, spaceBefore=14, spaceAfter=8)
caption = ParagraphStyle("Caption", fontName="FreeSerif", fontSize=8.5, leading=12,
                         alignment=TA_CENTER, textColor=TEXT_MUTED, spaceBefore=3, spaceAfter=6)
cell = ParagraphStyle("Cell", fontName="FreeSerif", fontSize=9, leading=12,
                      textColor=TEXT_PRIMARY, alignment=TA_LEFT)
cell_r = ParagraphStyle("CellR", parent=cell, alignment=TA_RIGHT)
cell_c = ParagraphStyle("CellC", parent=cell, alignment=TA_CENTER)
head_c = ParagraphStyle("HeadC", fontName="FreeSerif", fontSize=9.5, leading=12,
                        textColor=colors.white, alignment=TA_CENTER)
led_cell = ParagraphStyle("LedCell", parent=cell, fontSize=7.6, leading=9.4)
led_r = ParagraphStyle("LedR", parent=led_cell, alignment=TA_RIGHT)
led_c = ParagraphStyle("LedC", parent=led_cell, alignment=TA_CENTER)
stat_big = ParagraphStyle("StatBig", fontName="FreeSerif", fontSize=17, leading=21,
                          textColor=ACCENT, alignment=TA_CENTER)
stat_lab = ParagraphStyle("StatLab", fontName="FreeSerif", fontSize=8.5, leading=11,
                          textColor=TEXT_MUTED, alignment=TA_CENTER)


class TocDocTemplate(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "bookmark_name"):
            level = getattr(flowable, "bookmark_level", 0)
            text = getattr(flowable, "bookmark_text", "")
            key = getattr(flowable, "bookmark_key", "")
            # printed footer number = raw page - 1 (TOC page is roman i)
            self.notify("TOCEntry", (level, text, self.page - 1, key))


def on_page(canvas, doc):
    canvas.saveState()
    # page background (Template 07 light body)
    canvas.setFillColor(PAGE_BG)
    canvas.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)
    # footer
    canvas.setFillColor(TEXT_MUTED)
    canvas.setFont("FreeSerif", 9)
    label = "i" if doc.page == 1 else str(doc.page - 1)
    canvas.drawCentredString(PAGE_W / 2, 0.5 * inch, label)
    canvas.setFont("FreeSerif", 7.5)
    canvas.drawString(MARGIN, PAGE_H - 0.55 * inch, "Global EIS - Bank Statement Analysis")
    canvas.setStrokeColor(BORDER)
    canvas.setLineWidth(0.8)
    canvas.line(MARGIN, PAGE_H - 0.62 * inch, PAGE_W - MARGIN, PAGE_H - 0.62 * inch)
    canvas.restoreState()


def heading(text, style, level=0):
    key = "h_" + hashlib.md5(text.encode()).hexdigest()[:8]
    p = Paragraph(f'<a name="{key}"/><b>{text}</b>', style)
    p.bookmark_name = key
    p.bookmark_level = level
    p.bookmark_text = text
    p.bookmark_key = key
    return p


def H1(story, text):
    story.append(CondPageBreak(AVAIL_H * 0.25))
    story.append(heading(text, h1, 0))


def styled_table(data, col_widths, header_rows=1, stripe=True, font_check=None):
    t = Table(data, colWidths=col_widths, hAlign="CENTER", repeatRows=header_rows)
    style = [
        ("BACKGROUND", (0, 0), (-1, header_rows - 1), TABLE_HEADER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    if stripe:
        for i in range(header_rows, len(data)):
            bg = TABLE_ROW_EVEN if (i - header_rows) % 2 == 0 else TABLE_ROW_ODD
            style.append(("BACKGROUND", (0, i), (-1, i), bg))
    t.setStyle(TableStyle(style))
    return t


def callout_row(stats):
    boxes = []
    bw = (AVAIL_W - 24) / 3
    for big, lab in stats:
        inner = Table([[Paragraph(f"<b>{big}</b>", stat_big)], [Paragraph(lab, stat_lab)]],
                      colWidths=[bw])
        inner.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), CARD_BG),
            ("BOX", (0, 0), (-1, -1), 1, ACCENT),
            ("TOPPADDING", (0, 0), (-1, 0), 9),
            ("BOTTOMPADDING", (0, 1), (-1, 1), 9),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ]))
        boxes.append(inner)
    outer = Table([boxes], colWidths=[bw + 12] * 3, hAlign="CENTER")
    outer.setStyle(TableStyle([
        ("LEFTPADDING", (0, 0), (-1, -1), 6), ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return outer


def make_charts():
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.font_manager as fm
    fm.fontManager.addfont("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
    import matplotlib.pyplot as plt
    plt.rcParams["font.sans-serif"] = ["DejaVu Sans"]
    plt.rcParams["axes.unicode_minus"] = False

    months = [m for m in D["monthly"] if m["month"] != "Unattributed"]
    labels = [m["month"][:3] for m in months]
    cred = [m["credit"] / 1e6 for m in months]
    deb = [m["debit"] / 1e6 for m in months]
    net = [m["net"] / 1e6 for m in months]
    x = range(len(months))
    w = 0.38

    # Chart 1: grouped bars credits vs debits
    fig, ax = plt.subplots(figsize=(7.4, 3.2), constrained_layout=True)
    ax.bar([i - w / 2 for i in x], cred, w, label="Credits (in)", color="#2d7ab3", edgecolor="none")
    ax.bar([i + w / 2 for i in x], deb, w, label="Debits (out)", color="#1a4a7a", edgecolor="none")
    for i, v in enumerate(cred):
        ax.text(i - w / 2, v + 0.03, f"{v:.2f}", ha="center", fontsize=8, color="#2d7ab3")
    for i, v in enumerate(deb):
        ax.text(i + w / 2, v + 0.03, f"{v:.2f}", ha="center", fontsize=8, color="#1a4a7a")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("EGP million", fontsize=9)
    ax.spines["top"].set_visible(False)
    ax.spines["right"].set_visible(False)
    ax.spines["left"].set_color("#c0d0e2")
    ax.spines["bottom"].set_color("#c0d0e2")
    ax.tick_params(colors="#5a7a96")
    ax.grid(axis="y", linestyle="--", alpha=0.2, linewidth=0.5)
    ax.legend(loc="upper left", bbox_to_anchor=(0, 1.02), frameon=False, fontsize=9, ncol=2)
    p1 = f"{WORK}/chart_monthly.png"
    fig.savefig(p1, dpi=200)
    plt.close(fig)

    # Chart 2: net movement line
    fig, ax = plt.subplots(figsize=(7.4, 2.7), constrained_layout=True)
    ax.plot(list(x), net, color="#2d7ab3", linewidth=2.5, solid_capstyle="round")
    ax.fill_between(list(x), net, 0, color="#2d7ab3", alpha=0.12)
    ax.axhline(0, color="#c0d0e2", linewidth=0.8)
    for i in (0, len(net) - 1):
        ax.plot(i, net[i], "o", color="#1a4a7a", markersize=4)
        va = "bottom" if net[i] >= 0 else "top"
        ax.annotate(f"{net[i]:+.2f}", (i, net[i]), textcoords="offset points",
                    xytext=(0, 6 if net[i] >= 0 else -12), ha="center", fontsize=8, color="#1a4a7a")
    imax = max(range(len(net)), key=lambda i: net[i])
    imin = min(range(len(net)), key=lambda i: net[i])
    for i in {imax, imin}:
        ax.plot(i, net[i], "o", color="#2d7ab3", markersize=4)
        ax.annotate(f"{net[i]:+.2f}", (i, net[i]), textcoords="offset points",
                    xytext=(0, 6 if net[i] >= 0 else -12), ha="center", fontsize=8, color="#1a4a7a")
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, fontsize=9)
    ax.set_ylabel("Net (EGP million)", fontsize=9)
    for s in ("top", "right"):
        ax.spines[s].set_visible(False)
    ax.spines["left"].set_color("#c0d0e2")
    ax.spines["bottom"].set_color("#c0d0e2")
    ax.tick_params(colors="#5a7a96")
    ax.grid(axis="y", linestyle="--", alpha=0.2, linewidth=0.5)
    p2 = f"{WORK}/chart_net.png"
    fig.savefig(p2, dpi=200)
    plt.close(fig)
    return p1, p2


def fit_image(path, max_w, max_h):
    img = Image(path)
    ow, oh = img.drawWidth, img.drawHeight
    ratio = min(max_w / ow if ow > max_w else 1.0, max_h / oh if oh > max_h else 1.0)
    img.drawWidth, img.drawHeight = ow * ratio, oh * ratio
    return img


def build_body():
    story = []
    # ---- TOC (front matter, roman) ----
    story.append(Paragraph("<b>Table of Contents</b>",
                           ParagraphStyle("TOCTitle", parent=h1, spaceBefore=6)))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOC1", fontName="FreeSerif", fontSize=11.5, leading=20,
                       leftIndent=12, textColor=TEXT_PRIMARY),
    ]
    story.append(toc)
    story.append(PageBreak())

    c, m = D["count"], D["monthly"]
    td, tc = D["totalDebits"], D["totalCredits"]
    sd, sc = D["sumDebits"], D["sumCredits"]

    # ---- 1. Executive Summary ----
    H1(story, "1. Executive Summary")
    story.append(Paragraph(
        "This report presents a full analyst review of a six-month bank statement issued for a WAFA "
        "current account held by EID FARAG SAAD SHAAT. The source document was a 48-page scanned PDF "
        "produced by a mobile scanning application, with no embedded text layer, covering the movement "
        "history from 01 March 2026 to 09 September 2026. Because the automatic engine could not "
        "structure the document reliably, the analysis was completed manually using a forensic "
        "OCR pipeline with three independent reading passes and column-geometry extraction.", body))
    story.append(Paragraph(
        "The statement prints its own control totals, and these anchors reconcile exactly: the opening "
        "balance of EGP 545,904.67 on 01 March 2026, plus total credits of EGP 4,100,172.41, minus "
        "total debits of EGP 4,122,781.15, equals the printed closing balance of EGP 523,295.93 on "
        "09 September 2026. This confirms that the document itself is internally consistent as issued "
        "by the bank. The reconstructed transaction ledger contains 844 entries, of which 97.6 percent "
        "were confirmed by at least two independent OCR readings. Aggregate figures reconstructed from "
        "the parsed rows reach 99.0 percent of printed debits and 99.7 percent of printed credits, "
        "with the small residual attributable to single-digit OCR noise on a minority of rows.", body))
    story.append(Spacer(1, 8))
    story.append(callout_row([
        (egp(tc), "Total credits (printed, 6 months)"),
        (egp(td), "Total debits (printed, 6 months)"),
        (egp(D["closing"]), "Closing balance, 09 Sep 2026"),
    ]))
    story.append(Spacer(1, 12))
    story.append(Paragraph(
        "Activity over the period is dominated by instant transfers: 687 outgoing instant transfers "
        "totalling roughly EGP 2.80 million, against 24 incoming instant transfers of about EGP 0.34 "
        "million. The account also received two large cash deposits totalling EGP 1.75 million, two "
        "collected cheques totalling EGP 1.15 million, and two ACH inward credits of EGP 0.35 million. "
        "A single internal cheque debited the account by EGP 1.00 million. Transfer reversals are "
        "frequent: 92 reversal entries returning EGP 0.42 million to the account, a pattern typical of "
        "instant transfers that fail or are recalled shortly after being issued.", body))

    # ---- 2. Account and Statement Overview ----
    H1(story, "2. Account and Statement Overview")
    story.append(Paragraph(
        "The table below summarises the account identifiers exactly as printed on the statement header "
        "of each page. The document is a movement-history report rather than a running-balance "
        "statement: it lists dated transactions with debit and credit columns but does not print a "
        "balance after each row. Only the opening balance, the closing balance and the two aggregate "
        "movement totals are printed, and these are the anchors used for chain verification in "
        "Section 3.", body))
    meta_rows = [
        ["Field", "Value as printed on statement"],
        ["Account holder", "EID FARAG SAAD SHAAT"],
        ["Account", "WAFA CURRENT ACCOUNT - 60008788659-29"],
        ["Customer number", "60100363"],
        ["Branch", "00079-MOA Branch"],
        ["Currency", "EGP (Egyptian pound)"],
        ["Statement period", "01 March 2026 - 09 September 2026"],
        ["Statement reference", "CTB-102-N30041904, generated 10 September 2026 17:58"],
        ["Source document", "48-page scanned PDF (CamScanner producer, no text layer)"],
        ["Ledger entries parsed", "844 transactions (824 confirmed by 2+ OCR passes)"],
    ]
    data = [[Paragraph(f"<b>{a}</b>", head_c), Paragraph(f"<b>{b}</b>", head_c)] for a, b in meta_rows[:1]]
    data += [[Paragraph(a, cell), Paragraph(b, cell)] for a, b in meta_rows[1:]]
    t = styled_table(data, [0.30 * AVAIL_W, 0.70 * AVAIL_W])
    story.append(Spacer(1, 8))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Table 1: Account and source document overview", caption))

    # ---- 3. Balance Chain Verification ----
    H1(story, "3. Balance Chain Verification")
    story.append(Paragraph(
        "Three control figures printed on the statement were used as verification anchors. The chain "
        "check confirms that opening balance plus total credits minus total debits equals the closing "
        "balance to the piastre, so the printed aggregates are internally consistent. The parsed ledger "
        "was then summed independently and compared against each printed anchor; the residual "
        "difference is disclosed rather than hidden, in line with standard analyst practice for "
        "scanned-source workpapers.", body))
    chain = [
        ["Anchor", "Printed on statement", "Reconstructed from ledger", "Difference"],
        ["Opening balance, 01/03/2026", egp(D["opening"]), "-", "-"],
        ["Total credits", egp(tc), egp(sc), egp(sc - tc)],
        ["Total debits", egp(td), egp(sd), egp(sd - td)],
        ["Closing balance, 09/09/2026", egp(D["closing"]),
         egp(round(D["opening"] + sc - sd, 2)), egp(round((D["opening"] + sc - sd) - D["closing"], 2))],
    ]
    data = [[Paragraph(f"<b>{x}</b>", head_c) for x in chain[0]]]
    for row in chain[1:]:
        data.append([Paragraph(row[0], cell), Paragraph(row[1], cell_r),
                     Paragraph(row[2], cell_r), Paragraph(row[3], cell_r)])
    t = styled_table(data, [0.30 * AVAIL_W, 0.25 * AVAIL_W, 0.27 * AVAIL_W, 0.18 * AVAIL_W])
    story.append(Spacer(1, 8))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Table 2: Chain verification against printed anchors", caption))
    story.append(Paragraph(
        "Chain identity check: EGP 545,904.67 + EGP 4,100,172.41 - EGP 4,122,781.15 = EGP 523,295.93, "
        "which matches the printed closing balance exactly. The reconstructed ledger covers 99.0 "
        "percent of printed debit volume and 99.7 percent of printed credit volume. The residual "
        "EGP 48,971.96 on the debit side and EGP 11,086.64 on the credit side is spread across a small "
        "number of rows where single digits could not be resolved at scan resolution; no evidence of "
        "structural omission was found, because every page contributes rows consistent with its "
        "neighbours and the recovery passes found no missed transaction lines.", body))

    # ---- 4. Monthly Flow Analysis ----
    H1(story, "4. Monthly Flow Analysis")
    story.append(Paragraph(
        "Monthly aggregation shows a strongly front-loaded inflow pattern followed by steady spending. "
        "March and May carry the two largest inflow concentrations, driven by the EGP 1.5 million cash "
        "deposit (May) and the EGP 900,000 collected cheque (March). Outflows are remarkably uniform: "
        "between EGP 274,000 and EGP 638,000 of debits every month, almost entirely composed of small "
        "instant transfers. June and July show the widest gap between inflows and outflows, which "
        "explains the drawdown of the balance from its May peak.", body))
    p1, p2 = make_charts()
    story.append(Spacer(1, 14))
    story.append(KeepTogether([fit_image(p1, AVAIL_W, 250),
                               Paragraph("Figure 1: Monthly credits versus debits (EGP million)", caption)]))
    story.append(Spacer(1, 14))
    story.append(KeepTogether([fit_image(p2, AVAIL_W, 210),
                               Paragraph("Figure 2: Monthly net movement (EGP million)", caption)]))
    story.append(Spacer(1, 10))
    mrows = [["Month", "Credits (in)", "Debits (out)", "Net movement", "Entries"]]
    for m in m:
        if m["month"] == "Unattributed" and m["count"] < 25:
            continue
        mrows.append([m["month"], money(m["credit"]), money(m["debit"]),
                      ("+" if m["net"] >= 0 else "") + money(m["net"]), str(m["count"])])
    data = [[Paragraph(f"<b>{x}</b>", head_c) for x in mrows[0]]]
    for row in mrows[1:]:
        data.append([Paragraph(row[0], cell), Paragraph(row[1], cell_r), Paragraph(row[2], cell_r),
                     Paragraph(row[3], cell_r), Paragraph(row[4], cell_c)])
    t = styled_table(data, [0.20 * AVAIL_W, 0.24 * AVAIL_W, 0.24 * AVAIL_W, 0.20 * AVAIL_W, 0.12 * AVAIL_W])
    story.append(Spacer(1, 6))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Table 3: Monthly totals in EGP (rows with unreadable dates excluded)", caption))

    # ---- 5. Transaction Pattern Analysis ----
    H1(story, "5. Transaction Pattern Analysis")
    story.append(Paragraph(
        "Classifying every ledger entry by its printed description reveals the operating character of "
        "the account. It behaves as a high-velocity disbursement account: funds arrive in a small "
        "number of large deposits and cheques, then leave in hundreds of small instant transfers, each "
        "paired with a fixed-percentage fee. The count and volume of each category follow.", body))
    crows = [["Category", "Credits (EGP)", "Debits (EGP)", "Entries"]]
    for c in D["categories"]:
        crows.append([c["cat"], money(c["credit"]), money(c["debit"]), str(c["count"])])
    data = [[Paragraph(f"<b>{x}</b>", head_c) for x in crows[0]]]
    for row in crows[1:]:
        data.append([Paragraph(row[0], cell), Paragraph(row[1], cell_r),
                     Paragraph(row[2], cell_r), Paragraph(row[3], cell_c)])
    t = styled_table(data, [0.34 * AVAIL_W, 0.24 * AVAIL_W, 0.24 * AVAIL_W, 0.18 * AVAIL_W])
    story.append(Spacer(1, 8))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Table 4: Volume by transaction category", caption))
    story.append(Paragraph(
        "Three patterns deserve attention. First, the 687 outgoing instant transfers average roughly "
        "EGP 4,100 each, and 92 of all transfers were reversed within the period, returning EGP "
        "423,040.65 - a recall pattern that may indicate payees rejecting credits or details being "
        "corrected after issue. Second, incoming value is concentrated: just seven credits - two cash "
        "deposits, two collected cheques and two ACH inward transfers plus one internal transfer "
        "reversal - account for over EGP 3.2 million, more than three quarters of all inflows. Third, "
        "bank charges are modest: four explicit fee entries totalling EGP 220.04, because instant "
        "transfer fees are embedded in paired small debits rather than billed separately.", body))

    # ---- 6. Notable Transactions ----
    H1(story, "6. Notable Transactions (>= 100,000 EGP)")
    story.append(Paragraph(
        "Eight transactions individually equal to or larger than EGP 100,000 shape the balance "
        "trajectory of the period. They are listed below in descending order of value with the page "
        "of the source scan on which each appears, so every figure can be verified against the "
        "original document.", body))
    brows = [["#", "Date", "Direction", "Amount (EGP)", "Category", "Page"]]
    for i, r in enumerate(D["bigTransactions"], 1):
        direction = "Debit (out)" if r["debit"] else "Credit (in)"
        brows.append([str(i), r["date"] or "(unreadable)", direction,
                      money(r["debit"] or r["credit"]), r["cat"], str(r["page"])])
    data = [[Paragraph(f"<b>{x}</b>", head_c) for x in brows[0]]]
    for row in brows[1:]:
        data.append([Paragraph(row[0], cell_c), Paragraph(row[1], cell_c),
                     Paragraph(row[2], cell), Paragraph(row[3], cell_r),
                     Paragraph(row[4], cell), Paragraph(row[5], cell_c)])
    t = styled_table(data, [0.06 * AVAIL_W, 0.16 * AVAIL_W, 0.16 * AVAIL_W,
                            0.20 * AVAIL_W, 0.30 * AVAIL_W, 0.12 * AVAIL_W])
    story.append(Spacer(1, 8))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Table 5: Transactions of EGP 100,000 and above", caption))
    story.append(Paragraph(
        "The largest single movement is the EGP 1.5 million cash deposit of 6 May 2026, followed by "
        "the EGP 1.0 million internal cheque of 18 March 2026. Outflows of this size are limited to "
        "the same internal cheque and the 30 March EGP 250,000 cash withdrawal; every other large "
        "movement is an inflow. This concentration means the account's liquidity is governed by a "
        "handful of funding events rather than by many large payments.", body))

    # ---- 7. Methodology and Limitations ----
    H1(story, "7. Methodology and Limitations")
    story.append(Paragraph(
        "The source document is a scan without a text layer, so all data was recovered by OCR. Three "
        "independent passes were made: 300 and 450 dpi full-page readings, and a 600 dpi digit-"
        "whitelisted re-read of every amount cell. Table geometry (the x-position of each printed "
        "digit) was used to separate the debit and credit columns, which removes nearly all "
        "column-assignment ambiguity. A row's amount was accepted when at least two passes agreed; "
        "824 of the 844 entries reached this consensus standard, and the remainder are flagged in the "
        "appendix ledger.", body))
    story.append(Paragraph(
        "Rows whose printed date could not be read with confidence were kept in the ledger but "
        "excluded from the monthly aggregation; they number 20 entries worth about EGP 45,306 of "
        "debits and EGP 215 of credits. The movement-history format prints no running balance, so "
        "row-level balance reconstruction is not possible from this document; verification therefore "
        "relies on the printed opening, closing and aggregate anchors, which reconcile exactly. For a "
        "fully verified row-level chain we recommend requesting the bank's official statement export "
        "(a text-based PDF) rather than scanned images; the automatic engine in the portal will then "
        "verify the complete balance chain without manual work.", body))

    # ---- 8. Appendix: ledger ----
    H1(story, "8. Appendix: Full Transaction Ledger")
    story.append(Paragraph(
        "The complete reconstructed ledger follows, in source-document order. Dates marked with an "
        "asterisk could not be read with confidence and are excluded from monthly aggregations; "
        "entries marked with a dagger (dagger symbol in the confidence column shown as 'low') did not "
        "reach two-pass consensus. Amounts are in EGP. Descriptions are reproduced from OCR and may "
        "contain recognition artifacts; counterparties named in the bank's printing appear beneath "
        "each transfer in the source document.", body))
    story.append(Spacer(1, 6))
    hdr = ["No", "Date", "Description", "Debit (EGP)", "Credit (EGP)", "Conf."]
    data = [[Paragraph(f"<b>{x}</b>", ParagraphStyle("LH", parent=head_c, fontSize=8)) for x in hdr]]
    for r in D["rows"]:
        date = r["date"] or "(unread.)"
        conf = "2+" if r["conf"] else "low"
        desc = r["desc"] or "(no description recovered)"
        data.append([
            Paragraph(str(r["no"]), led_c),
            Paragraph(date, led_c),
            Paragraph(desc, led_cell),
            Paragraph(money(r["debit"]) if r["debit"] else "-", led_r),
            Paragraph(money(r["credit"]) if r["credit"] else "-", led_r),
            Paragraph(conf, led_c),
        ])
    widths = [0.06 * AVAIL_W, 0.12 * AVAIL_W, 0.47 * AVAIL_W,
              0.14 * AVAIL_W, 0.14 * AVAIL_W, 0.07 * AVAIL_W]
    assert sum(widths) <= AVAIL_W + 0.5
    t = Table(data, colWidths=widths, hAlign="CENTER", repeatRows=1)
    style = [
        ("BACKGROUND", (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("GRID", (0, 0), (-1, -1), 0.4, BORDER),
        ("LEFTPADDING", (0, 0), (-1, -1), 3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ("TOPPADDING", (0, 0), (-1, -1), 1.6),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.6),
    ]
    for i in range(1, len(data)):
        style.append(("BACKGROUND", (0, i), (-1, i),
                      TABLE_ROW_EVEN if (i - 1) % 2 == 0 else TABLE_ROW_ODD))
    t.setStyle(TableStyle(style))
    story.append(t)
    story.append(Spacer(1, 6))
    story.append(Paragraph("Table 6: Reconstructed transaction ledger, 844 entries (EGP)", caption))

    doc = TocDocTemplate(OUT_BODY, pagesize=A4,
                         leftMargin=MARGIN, rightMargin=MARGIN,
                         topMargin=MARGIN, bottomMargin=MARGIN,
                         title="Global EIS Bank Statement Analysis - WAFA Current Account",
                         author="Z.ai", creator="Z.ai",
                         subject="Forensic analysis of a six-month WAFA bank statement scan")
    doc.multiBuild(story, onFirstPage=on_page, onLaterPages=on_page)
    print("body built:", OUT_BODY)


if __name__ == "__main__":
    build_body()
