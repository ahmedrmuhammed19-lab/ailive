from playwright.sync_api import sync_playwright
p = "/home/z/my-project/download/00_Template_Coverage_Audit_Master_v126.html"
out = "/home/z/my-project/download/04_evidence/DL9d_Coverage_Audit_v126/audit_top.png"
out2 = "/home/z/my-project/download/04_evidence/DL9d_Coverage_Audit_v126/audit_matrix.png"
with sync_playwright() as pw:
    b = pw.chromium.launch()
    pg = b.new_page(viewport={"width": 1400, "height": 1000})
    pg.goto("file://" + p)
    pg.wait_for_timeout(400)
    pg.screenshot(path=out)
    el = pg.query_selector("table.data-table")
    el.scroll_into_view_if_needed(); pg.wait_for_timeout(200)
    el.screenshot(path=out2)
    b.close()
print("shots ok")
